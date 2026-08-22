// critic/revisionLoop.js
// Amaç:    DUAL-AI spec §8 (Critic Revision Loop) — Critic `request_revision`
//          dönünce n8n akışı kararı Executor'a geri gönderir. Bu modül DÖNGÜYÜ
//          KENDİSİ ÇALIŞTIRMAZ (n8n'in IF/loop node'u yönetir, AGENT.md/MASTER_PLAN
//          §9'un "kod = deterministik kontrol, orkestrasyon = n8n" ayrımı korunur,
//          Executor/Critic ayrı model sağlayıcılarına bağlı kalmaya devam eder).
//          Bu modülün tek işi: (a) MAX_REVISION_ATTEMPTS sınırını zorlamak
//          (AMC-11, sonsuz döngü asla), (b) her denemeyi deterministik
//          revision_id/parent_revision_id ile izlenebilir kılmak (spec §8'in
//          "each revision must be auditable" gereği).
// Bağlı:   critic/criticNode.js (girdisi: runCriticNode çıktısı — critic_verdict
//          okunur, değiştirilmez), executor/executorNode.js (n8n bu node'un
//          RETRY_EXECUTOR kararına göre executorNode'u tekrar çağırır — bu
//          dosya Executor'ı KENDİSİ ÇAĞIRMAZ). CONFIG_SCHEMA.md'ye eklenmesi
//          gereken MAX_REVISION_ATTEMPTS değişkeni henüz yok (bu oturuma
//          CONFIG_SCHEMA.md yüklenmedi) — deps.maxRevisionAttempts enjekte
//          edilir, hardcode edilmez (AMC-9).
// AMC:     AMC-11 (YENİ — Sonsuz Karar Döngüsü Yasağı: MAX_REVISION_ATTEMPTS
//          config-driven olmalı, sınır aşılınca daima HUMAN_REVIEW, asla
//          sessizce tekrar deneme), AMC-9 (maxRevisionAttempts hardcode edilmez)
// Risk:    Hatalı çalışırsa: (a) sınır kontrolü atlanırsa Executor↔Critic
//          arasında n8n'de gerçek bir sonsuz döngü oluşur (LLM maliyeti +
//          kampanya asla karara bağlanmaz), (b) revision_id deterministik
//          değilse audit zincirinde hangi denemenin hangi kararla sonuçlandığı
//          izlenemez.
// Dokunma: Değiştirmeden önce criticNode.js'in çıktı şekli (critic_verdict)
//          ve CONFIG_SCHEMA.md'ye MAX_REVISION_ATTEMPTS eklenip eklenmediği
//          kontrol edilmeli. Kaynak: MASTER_PLAN.md §7b/R-IG-20, DUAL-AI spec §8.

/**
 * AMC-11 — deneme sayısı sınırı aşılmışsa (ya da sınır hiç enjekte
 * edilmemişse) fail-closed: retry YAPILMAZ. maxRevisionAttempts eksikse
 * "sınırsız" varsayılmaz — TASLAK/eksik config, kalibre edilmiş gibi
 * kullanılamaz (AMC-9).
 */
function checkRevisionAttemptsWithinLimit(attemptNumber, maxRevisionAttempts) {
  if (!Number.isInteger(maxRevisionAttempts) || maxRevisionAttempts < 1) {
    return { amc: 'AMC-11', passed: false, reason: 'maxRevisionAttempts enjekte edilmedi veya geçersiz — fail-closed (sınırsız retry varsayılmaz)' };
  }
  const passed = Number.isInteger(attemptNumber) && attemptNumber < maxRevisionAttempts;
  return {
    amc: 'AMC-11',
    passed,
    reason: passed ? null : `attemptNumber=${attemptNumber} >= maxRevisionAttempts=${maxRevisionAttempts}`,
  };
}

/**
 * Deterministik revision_id — decision_id + deneme numarasına bağlı,
 * rastgele üretilmez (audit'te aynı decision_id için aynı denemenin her
 * zaman aynı id'ye sahip olması gerekir, tekrar sorgulanabilirlik).
 */
function buildRevisionId(decisionId, attemptNumber) {
  return `${decisionId}::rev${attemptNumber}`;
}

/**
 * İlk deneme (attemptNumber=0) için parent yok. Sonraki her deneme bir
 * önceki denemeye zincirlenir — spec §8'in "parent_revision_id" gereği.
 */
function buildParentRevisionId(decisionId, attemptNumber) {
  if (!Number.isInteger(attemptNumber) || attemptNumber <= 0) {
    return null;
  }
  return buildRevisionId(decisionId, attemptNumber - 1);
}

/**
 * Karar mantığı — kontrol değil, koordinatörün kullandığı saf fonksiyon.
 * verdict "request_revision" değilse döngü zaten bitmiştir (approve/reject
 * Policy Engine'e gider, bu modülün işi değil).
 */
function determineNextStep(criticVerdict, limitCheck) {
  if (criticVerdict !== 'request_revision') {
    return 'NOT_APPLICABLE';
  }
  return limitCheck.passed ? 'RETRY_EXECUTOR' : 'HUMAN_REVIEW';
}

/**
 * spec §8 — "each revision must be auditable": decision_id, revision_id,
 * parent_revision_id, executor_output, critic_output tek bir kayıtta.
 */
function buildRevisionAuditRecord(decisionId, attemptNumber, executorOutput, criticOutput) {
  return {
    decision_id: decisionId,
    revision_id: buildRevisionId(decisionId, attemptNumber),
    parent_revision_id: buildParentRevisionId(decisionId, attemptNumber),
    executor_output: executorOutput,
    critic_output: criticOutput,
  };
}

/**
 * Koordinasyon katmanı. Bu fonksiyon Executor/Critic'i ÇAĞIRMAZ — n8n,
 * next_step === 'RETRY_EXECUTOR' ise executorNode'u tekrar tetikler.
 * deps: { maxRevisionAttempts }
 */
function runRevisionLoopNode(decisionId, attemptNumber, executorOutput, criticOutput, deps) {
  const limitCheck = checkRevisionAttemptsWithinLimit(attemptNumber, deps.maxRevisionAttempts);
  const nextStep = determineNextStep(criticOutput.critic_verdict, limitCheck);
  const auditRecord = buildRevisionAuditRecord(decisionId, attemptNumber, executorOutput, criticOutput);
  return { next_step: nextStep, limit_check: limitCheck, audit_record: auditRecord };
}

module.exports = {
  checkRevisionAttemptsWithinLimit,
  buildRevisionId,
  buildParentRevisionId,
  determineNextStep,
  buildRevisionAuditRecord,
  runRevisionLoopNode,
};
