// validation/envelopeBuilder.js
// Amaç:    Trigger node'un girdisi (§1.1 campaign_brief_request) ile Executor
//          node'un çıktısını (§1.2, zaten kendi içinde validateExecutorOutput
//          ile doğrulanmış) alıp ARCHITECTURE.md §1.5 kararlı şemasına uyan
//          canonical bir DecisionEnvelope üretir. DUAL-AI spec §10'un
//          "AI output hiçbir zaman doğrudan Policy/Execution'a akmamalı"
//          ilkesinin eksik kalan parçasını (envelope inşası) kapatır —
//          şema/tip doğrulaması bilerek TEKRAR EDİLMEZ, o iş zaten
//          executorNode.js > validateExecutorOutput'a ait (AGENT.md §27,
//          duplicate functionality yaratma yasağı).
// Bağlı:   trigger/validateRequest.js (girdi: campaign_brief_request),
//          executor/executorNode.js (girdi: runExecutorNode çıktısı,
//          decision_id/campaign_brief burada taşınır, değiştirilmez).
//          Bu node'un çıktısı critic/criticNode.js'e girer — criticNode.js
//          envelope.campaign_brief'i okuduğu için (superset) kırılma olmaz.
//          audit.record_hash burada BİLEREK null bırakılır — gerçek hash
//          ancak audit-log node çalıştıktan sonra hesaplanabilir, bu node
//          audit-log'dan ÖNCE çalışır (n8n zincir sırası).
// AMC:     AMC-4 (envelope alanları eksik/boş geçilirse sessizce ilerlenmez —
//          checkRequiredEnvelopeFields bunu API/Execution Gate'e ulaşmadan
//          keser), AMC-6 (input_context_hash, audit zincirinin Faz 3 ön koşulu)
// Risk:    Hatalı çalışırsa: (a) actor boş/yanlış giderse Execution Token
//          yanlış kişiye/role bağlanır, (b) input_context_hash tutarsızsa
//          audit replay bütünlüğü (DUAL-AI spec §24) baştan bozulur — ikisi
//          de sessizce geçilirse tespit edilemez bir sapma olur.
// Dokunma: Değiştirmeden önce ARCHITECTURE.md §1.5 (DecisionEnvelope kararlı
//          şema) ve executorNode.js §1.2 çıktı şekli kontrol edilmeli.
//          Kaynak: MASTER_PLAN.md §7b/R-IG-21, DUAL-AI spec §9/§10.

const crypto = require('crypto');

const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Object.keys(obj).sort() JSON.stringify'a replacer olarak verilirse SADECE
 * üst seviye anahtarları beyaz listeye alır — iç içe alanlar (örn.
 * requested_by) sessizce elenir, farklı içerikler aynı hash'i üretebilir.
 * Bu yüzden anahtarlar HER seviyede recursive olarak sıralanır.
 */
function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeysDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * input_context_hash — Trigger node'un ORİJİNAL girdisinin (Executor'ın
 * çıktısının değil) canonical hash'i. Anahtar sırası JSON.stringify'da
 * garanti olmadığı için recursive sıralanmış bir kopya üzerinden hash alınır
 * (deterministik — aynı içerik, farklı anahtar sırasıyla verilse bile aynı
 * hash'i üretir).
 */
function computeInputContextHash(triggerRequest) {
  const canonical = JSON.stringify(sortKeysDeep(triggerRequest));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * AMC-4 — envelope'un Execution Gate'e kadar taşınacak üç kritik alanı
 * (decision_id, actor, input_context_hash) eksik/boş sessizce geçilmez.
 * Savunma amaçlı tekrar kontrol (Policy Engine'in checks.js'teki 7. madde
 * deseniyle aynı — üreten koda değil, çıktıya güvenilir).
 */
function checkRequiredEnvelopeFields(envelope) {
  const errors = [];
  if (!envelope || typeof envelope.decision_id !== 'string' || !UUIDV4_RE.test(envelope.decision_id)) {
    errors.push('decision_id geçerli UUIDv4 değil');
  }
  if (!envelope || typeof envelope.actor !== 'string' || envelope.actor.trim().length === 0) {
    errors.push('actor boş veya string değil');
  }
  if (!envelope || typeof envelope.input_context_hash !== 'string' || envelope.input_context_hash.trim().length === 0) {
    errors.push('input_context_hash boş veya string değil');
  }
  return { passed: errors.length === 0, errors };
}

/**
 * Envelope inşası — kontrol değil, deterministik bir üretici (gate.js'teki
 * buildExecutionToken'la aynı desen). campaign_brief §1.2'den olduğu gibi
 * taşınır, yeniden doğrulanmaz (zaten executorNode.js'te doğrulandı).
 */
function buildDecisionEnvelope(triggerRequest, executorOutput, inputContextHash) {
  return {
    decision_id: executorOutput.decision_id,
    actor: triggerRequest.campaign_brief_request.requested_by,
    input_context_hash: inputContextHash,
    campaign_brief: executorOutput.campaign_brief,
    learning_context: null,
    audit: { record_hash: null },
  };
}

/**
 * Koordinasyon katmanı. Fail-closed: gerekli alanlar eksikse envelope
 * Critic'e hiç gitmez (runExecutorNode/runCriticNode deseniyle aynı).
 */
function runEnvelopeBuilderNode(triggerRequest, executorOutput) {
  const inputContextHash = computeInputContextHash(triggerRequest);
  const envelope = buildDecisionEnvelope(triggerRequest, executorOutput, inputContextHash);
  const check = checkRequiredEnvelopeFields(envelope);
  if (!check.passed) {
    return { success: false, stage: 'validation', errors: check.errors };
  }
  return { success: true, stage: 'done', envelope };
}

module.exports = {
  sortKeysDeep,
  computeInputContextHash,
  checkRequiredEnvelopeFields,
  buildDecisionEnvelope,
  runEnvelopeBuilderNode,
};
