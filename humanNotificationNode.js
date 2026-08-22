// human-notification/humanNotificationNode.js
// Amaç:    Kampanya PAUSED durumundayken insan onayını yönetir — kreatif
//          yüklendi mi kontrolü (AMC-8) + WhatsApp üzerinden ONAYLA/REDDET
//          onayının çözümlenmesi (R-IG-14, MASTER_PLAN v3.10, kanal: WhatsApp).
// Bağlı:   STATE_MACHINE.md PAUSED→ACTIVE geçişi bu node'un çıktısına bağlı;
//          execution-gate/gate.js'in decision_id üretimiyle aynı UUID burada
//          eşleştirilir (checkDecisionIdMatch) — decision_id formatı değişirse
//          burası da kontrol edilmeli.
// AMC:     AMC-8 (Kreatif Onaysız Yayın Yasağı), AMC-4 (Sessiz Sapma Yasağı —
//          yanlış/eksik decision_id ile yanlış kampanyanın onaylanmaması)
// Risk:    checkCreativeUploaded yanlışlıkla true dönerse kreatifsiz kampanya
//          ACTIVE olabilir (AMC-8 ihlali, gerçek para). checkDecisionIdMatch
//          fail-open olursa aynı anda bekleyen başka bir kampanya yanlışlıkla
//          onaylanabilir.
// Dokunma: MASTER_PLAN §7 (İnsan bildirim node kararları), R-IG-14 (v3.10,
//          KARAR BİLDİRİMİ ile onaylandı: kanal=WhatsApp, onay=sabit anahtar
//          kelime + decision_id, timeout=24 saat) değişmeden burası değişmez.

const TIMEOUT_HOURS_DEFAULT = 24;
const APPROVAL_PATTERN = /^(ONAYLA|REDDET)\s+([0-9a-fA-F-]{36})$/i;

// AMC-8: kreatif yüklenmeden hiçbir onay akışı başlamaz — fail-closed.
function checkCreativeUploaded(creativeRef) {
  return typeof creativeRef === "string" && creativeRef.trim().length > 0;
}

// Onay isteği mesajını kurar. decision_id yoksa güvenli bir mesaj
// kurulamaz — sessizce boş/placeholder değer üretmek yerine hata verir.
function buildApprovalRequestMessage(decisionEnvelope) {
  if (!decisionEnvelope || !decisionEnvelope.decision_id) {
    throw new Error("decisionEnvelope.decision_id zorunlu — mesaj kurulamaz");
  }
  const id = decisionEnvelope.decision_id;
  return (
    `Yeni kampanya onayı bekliyor (decision_id: ${id}).\n` +
    `Onaylamak için: ONAYLA ${id}\n` +
    `Reddetmek için: REDDET ${id}`
  );
}

// Gelen WhatsApp yanıtını parse eder. Beklenen kalıba uymayan her şey
// (serbest metin, emoji, eksik decision_id) "unrecognized" olarak döner —
// tahmin/yorum yapılmaz (AGENT.md Kural 1).
function parseApprovalReply(rawText) {
  if (typeof rawText !== "string") {
    return { action: "unrecognized", decisionId: null };
  }
  const match = rawText.trim().match(APPROVAL_PATTERN);
  if (!match) {
    return { action: "unrecognized", decisionId: null };
  }
  const action = match[1].toUpperCase() === "ONAYLA" ? "approve" : "reject";
  return { action, decisionId: match[2] };
}

// AMC-4: parse edilen decision_id, beklenen kampanyanın decision_id'siyle
// birebir (case-insensitive) eşleşmezse fail-closed — eşleşme yok say.
function checkDecisionIdMatch(parsedDecisionId, expectedDecisionId) {
  if (!parsedDecisionId || !expectedDecisionId) return false;
  return parsedDecisionId.toLowerCase() === expectedDecisionId.toLowerCase();
}

// 24 saatlik pencere doldu mu? Geçersiz tarih girdisinde sessizce false
// dönmek yerine hata fırlatır — zaman kontrolü sessizce atlanmamalı.
function checkApprovalTimeoutExpired(sentAtIso, nowIso, timeoutHours = TIMEOUT_HOURS_DEFAULT) {
  const sentAt = new Date(sentAtIso);
  const now = new Date(nowIso);
  if (isNaN(sentAt.getTime()) || isNaN(now.getTime())) {
    throw new Error("checkApprovalTimeoutExpired: geçersiz ISO tarih");
  }
  const elapsedMs = now.getTime() - sentAt.getTime();
  return elapsedMs >= timeoutHours * 60 * 60 * 1000;
}

// Koordinasyon: kreatif kapısı → (yanıt yoksa) mesaj gönder → (yanıt varsa)
// timeout/parse/eşleşme sırasıyla değerlendirir. Timeout, geç gelen bir
// "ONAYLA"dan bile önceliklidir (stale onay gerçek para riski taşır).
function runHumanNotificationNode({
  decisionEnvelope,
  creativeRef,
  sendMessageFn,
  incomingReply,
  sentAtIso,
  nowIso,
  timeoutHours = TIMEOUT_HOURS_DEFAULT,
}) {
  if (!checkCreativeUploaded(creativeRef)) {
    return { status: "blocked_no_creative", decisionId: decisionEnvelope && decisionEnvelope.decision_id };
  }

  if (incomingReply === undefined || incomingReply === null) {
    if (typeof sendMessageFn !== "function") {
      throw new Error("sendMessageFn enjekte edilmedi — mesaj fail-closed olarak gönderilmez");
    }
    const message = buildApprovalRequestMessage(decisionEnvelope);
    sendMessageFn(message);
    return { status: "awaiting_response", decisionId: decisionEnvelope.decision_id };
  }

  if (checkApprovalTimeoutExpired(sentAtIso, nowIso, timeoutHours)) {
    return { status: "human_timeout", decisionId: decisionEnvelope.decision_id };
  }

  const parsed = parseApprovalReply(incomingReply);
  if (parsed.action === "unrecognized" || !checkDecisionIdMatch(parsed.decisionId, decisionEnvelope.decision_id)) {
    return { status: "unrecognized_or_mismatched", decisionId: decisionEnvelope.decision_id };
  }

  return {
    status: parsed.action === "approve" ? "human_approved" : "human_rejected",
    decisionId: decisionEnvelope.decision_id,
  };
}

module.exports = {
  checkCreativeUploaded,
  buildApprovalRequestMessage,
  parseApprovalReply,
  checkDecisionIdMatch,
  checkApprovalTimeoutExpired,
  runHumanNotificationNode,
};
