// execution-gate/gate.js
// Amaç:    Policy Engine'in approved:true çıktığını tüketip bir Execution Token
//          üretir — Meta API'ye "consequential" çağrı yapma yetkisi sadece bu
//          token'ı üreten koddan geçer. Bu oturum sadece token ÜRETİMİNİ kapsar
//          (idempotency + policy_hash hesaplama + mint) — TTL/hash DOĞRULAMA
//          fonksiyonları (checkTokenNotExpired, checkPolicyHashMatch) kasıtlı
//          olarak burada YOK, Meta API node'u kodlanırken eklenecek (kullanıcı
//          onayı, AGENT.md Kural 5 — tek node tek seferde).
// Bağlı:   policy-engine/runPolicyEngine.js (girdisi: { decision_id, approved,
//          results }) — Execution Gate, Policy Engine'in ÇIKTISINI tüketir, onu
//          değiştirmez. Meta API node'u (henüz TASARIM) kodlanırken bu dosyaya
//          TTL/hash doğrulama fonksiyonları eklenecek, o zaman bu header ve
//          runExecutionGate güncellenmeli.
// AMC:     AMC-3 (Policy Engine onayı olmadan token üretilmez), AMC-4 (decision_id
//          uyuşmazlığı sessizce geçilmez), AMC-5 (idempotency — aynı karar iki kez
//          token almaz), AMC-6 (audit log sorgusu üzerinden çalışır), AMC-9
//          (policy_hash, config'in kalibre haliyle bağlanır)
// Risk:    Hatalı çalışırsa: (a) reddedilen bir karara token üretilir (gerçek para
//          riski), (b) aynı karar için iki kez token üretilip duplicate kampanya
//          oluşur (AMC-5 ihlali), (c) policy_hash yanlış hesaplanırsa onay anıyla
//          yürütme anı arasındaki config/kod sapması sessizce geçer.
// Dokunma: Değiştirmeden önce ARCHITECTURE.md §1.5 (Execution Token kararlı şema,
//          v1.5) ve runPolicyEngine.js'in çıktı şekli kontrol edilmeli. Kaynak:
//          MASTER_PLAN.md §7b, ARCHITECTURE.md §1.5.

const crypto = require('crypto');

/**
 * AMC-3 — Policy Engine onayı olmadan Execution Gate hiçbir şey üretmez.
 */
function checkPolicyEngineApproved(policyEngineResult) {
  const passed = !!policyEngineResult && policyEngineResult.approved === true;
  return {
    amc: 'AMC-3',
    passed,
    reason: passed ? null : `policyEngineResult.approved=${policyEngineResult && policyEngineResult.approved}, true bekleniyor`,
  };
}

/**
 * AMC-4 — DecisionEnvelope ve Policy Engine sonucu aynı kararı mı temsil ediyor?
 * Uyuşmazlık sessizce geçilmez (örn. yanlış envelope'a token üretilmesi riski).
 */
function checkDecisionIdMatch(decisionEnvelope, policyEngineResult) {
  const passed = !!decisionEnvelope && !!policyEngineResult &&
    decisionEnvelope.decision_id === policyEngineResult.decision_id;
  return {
    amc: 'AMC-4',
    passed,
    reason: passed ? null : `envelope.decision_id='${decisionEnvelope && decisionEnvelope.decision_id}' != policyEngineResult.decision_id='${policyEngineResult && policyEngineResult.decision_id}'`,
  };
}

/**
 * AMC-5 — Aynı decision_id için daha önce başarılı bir audit kaydı varsa,
 * ikinci bir Execution Token üretilmez (idempotency_key = decision_id,
 * ARCHITECTURE.md §1.5 kararı). auditLogLookupFn: (decisionId) => boolean
 * — DB entegrasyonu henüz kodlanmadığı için enjekte edilir (audit log node
 * hâlâ TASARIM aşamasında, ARCHITECTURE.md §2).
 */
function checkIdempotency(decisionId, auditLogLookupFn) {
  if (typeof auditLogLookupFn !== 'function') {
    return { amc: 'AMC-5', passed: false, reason: 'auditLogLookupFn enjekte edilmedi — fail-closed (duplicate kontrolü yapılamıyorsa token üretilmez)' };
  }
  const alreadyExists = auditLogLookupFn(decisionId) === true;
  const passed = !alreadyExists;
  return {
    amc: 'AMC-5',
    passed,
    reason: passed ? null : `decision_id='${decisionId}' için audit log'da başarılı kayıt zaten var`,
  };
}

/**
 * AMC-9 — policy_hash = sha256(config içeriği + policy-engine kod versiyonu).
 * Bu bir kontrol değil, deterministik bir üretici — ARCHITECTURE.md §1.5 kararı.
 * configContent: ig_ads_policy_config.yaml'ın HAM string içeriği (parse edilmemiş,
 * hash'in config'in gerçek dosya içeriğini yakalaması için).
 */
function computePolicyHash(configContent, policyEngineVersion) {
  const combined = `${configContent}::${policyEngineVersion}`;
  return crypto.createHash('sha256').update(combined, 'utf8').digest('hex');
}

/**
 * ARCHITECTURE.md §1.5 kararlı şema — token üretimi (kontrol değil, koordinatör
 * çağırır). `expiration` burada set edilir ama BU OTURUMDA hiçbir fonksiyon onu
 * doğrulamıyor (kasıtlı — Meta API node'u kodlanırken checkTokenNotExpired
 * eklenecek, KARAR BİLDİRİMİ ile onaylandı).
 */
function buildExecutionToken(decisionEnvelope, policyHash, nowFn) {
  const iat = (nowFn || Date.now)();
  return {
    decision_id: decisionEnvelope.decision_id,
    policy_hash: policyHash,
    iat,
    expiration: iat + 60 * 1000,
    actor: decisionEnvelope.actor,
  };
}

/**
 * Koordinasyon katmanı — kendisi bir kontrol değildir (runPolicyEngine.js
 * örneğiyle aynı desen). Sabit sırayla: Policy Engine onayı → decision_id
 * eşleşmesi → idempotency → (hepsi geçerse) token üretimi.
 * deps: { auditLogLookupFn, configContent, policyEngineVersion, nowFn }
 */
function runExecutionGate(decisionEnvelope, policyEngineResult, deps) {
  const results = [
    checkPolicyEngineApproved(policyEngineResult),
    checkDecisionIdMatch(decisionEnvelope, policyEngineResult),
    checkIdempotency(decisionEnvelope.decision_id, deps.auditLogLookupFn),
  ];
  const authorized = results.every((r) => r.passed);
  if (!authorized) {
    return { authorized: false, decision_id: decisionEnvelope.decision_id, results, token: null };
  }
  const policyHash = computePolicyHash(deps.configContent, deps.policyEngineVersion);
  const token = buildExecutionToken(decisionEnvelope, policyHash, deps.nowFn);
  return { authorized: true, decision_id: decisionEnvelope.decision_id, results, token };
}

module.exports = {
  checkPolicyEngineApproved,
  checkDecisionIdMatch,
  checkIdempotency,
  computePolicyHash,
  buildExecutionToken,
  runExecutionGate,
};
