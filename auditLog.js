// audit-log/auditLog.js
// Amaç:    AUDIT_SCHEMA.md §1 tablosuna, ARCHITECTURE.md §1.1-1.4
//          katmanlarından gelen kaydı append-only + hash-chain olarak
//          yazar. IG-ADS-MODULE/audit-log/auditLog.js ile AYNI zincir
//          mantığı (previous_hash/record_hash/chain_broken) kullanılır —
//          bu, Pusula geneli tek bir audit ailesi olsun diye BİLİNÇLİ bir
//          tekrar (module-specific alanlar farklı: campaign_brief yerine
//          quarantine_analysis/executor_output/critic_verdict/policy_decision).
// Bağlı:   db/migrations/001_audit_log.sql (tablo şeması),
//          dbClient.getLastRecordHash() / dbClient.insert() enjekte edilir
//          (IG-ADS'teki client-enjeksiyon deseniyle birebir — gerçek
//          Postgres olmadan test edilebilir).
// AMC:     AMC-6 (Audit Trail Bütünlüğü — başarılı/başarısız fark etmeksizin
//          HER çağrı yazılır; previous_hash lookup başarısız olsa bile kayıt
//          yine yazılır, ama chain_broken=true + criticalEscalation=true).
// Risk:    Karar zincirinin (Karantina→Executor→Critic→Policy) herhangi bir
//          dalı audit'e yazılamazsa, o kararın izlenebilir kaydı kalmaz —
//          AUDIT_SCHEMA.md §3'teki "her dalda log" kuralı bu dosyanın
//          çağrılma zorunluluğunun kaynağıdır (çağrı sorumluluğu n8n
//          orkestrasyon katmanına ait, bu dosyaya değil).
// Dokunma: record_hash formülüne alan eklenip çıkarılırsa geçmiş satırların
//          bütünlüğü bozulmadan yeni formüle geçiş ayrıca planlanmalı
//          (append-only ilkesi geriye dönük değişikliğe izin vermez).
//          AUDIT_SCHEMA.md §1 ile alan adları burada birebir eşleşmeli.

const crypto = require('crypto');

const GENESIS = 'GENESIS';
const CHAIN_LOOKUP_FAILED = 'CHAIN_LOOKUP_FAILED';

const VALID_FINAL_OUTCOMES = ['AUTO_APPLIED', 'HUMAN_QUEUE', 'BLOCKED'];

/**
 * AMC-6: Audit satırının kendi içeriğinin + zincir konumunun bütünlük
 * imzası. previousHash dahil edildiği için satır hem kendi içeriği hem
 * zincirdeki yeri değiştirilirse bu hash bir daha eşleşmez.
 * Alan seti AUDIT_SCHEMA.md §1'deki JSONB sütunlarla birebir — yeni bir
 * katman eklenirse (örn. DQTL/DIL, bkz. MASTER_PLAN B14/B15) bu fonksiyona
 * da eklenmeli, aksi halde o katmanın çıktısı zincir bütünlüğüne dahil
 * olmaz.
 */
function computeRecordHash({
  decisionId, decisionType, triggerSource, quarantineAnalysis, crisisFlag,
  executorOutput, criticVerdict, policyDecision, finalOutcome, previousHash,
}) {
  const payload = JSON.stringify({
    decisionId, decisionType, triggerSource, quarantineAnalysis, crisisFlag,
    executorOutput, criticVerdict, policyDecision, finalOutcome, previousHash,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Zincirdeki bir önceki kaydın hash'ini dbClient üzerinden çözer.
 * Üç durum ayrı ayrı etiketlenir (IG-ADS'teki resolvePreviousHash ile
 * aynı üç durum):
 *  - Gerçekten ilk kayıt (lookup null/undefined döner)  → GENESIS
 *  - Lookup fonksiyonu hiç enjekte edilmemiş             → CHAIN_LOOKUP_FAILED
 *  - Lookup çağrısı hata fırlatır (DB down vb.)          → CHAIN_LOOKUP_FAILED
 * Kayıt CHAIN_LOOKUP_FAILED durumunda da yazılır (AMC-6), ama chainBroken
 * true döner — çağıran taraf bunu criticalEscalation'a çevirir.
 */
async function resolvePreviousHash(dbClient) {
  if (!dbClient || typeof dbClient.getLastRecordHash !== 'function') {
    return { previousHash: CHAIN_LOOKUP_FAILED, chainBroken: true };
  }
  try {
    const lastHash = await dbClient.getLastRecordHash();
    if (lastHash === null || lastHash === undefined) {
      return { previousHash: GENESIS, chainBroken: false };
    }
    return { previousHash: lastHash, chainBroken: false };
  } catch (err) {
    return { previousHash: CHAIN_LOOKUP_FAILED, chainBroken: true };
  }
}

/**
 * AUDIT_SCHEMA.md §3 — "her dalda log" kuralının fail-closed karşılığı:
 * decisionId/decisionType/triggerSource/quarantineAnalysis/policyDecision/
 * finalOutcome her zaman zorunlu (policy_decision hiçbir zaman NULL değil —
 * CORE.md §4 "Policy Engine AI değil" kuralının audit karşılığı).
 * executorOutput ve criticVerdict şarta bağlı NULL olabilir (crisis_flag=true
 * veya requires_critic=false dallarında) — bu yüzden zorunlu alan listesine
 * girmezler.
 */
function checkRequiredAuditFields(input) {
  const errors = [];
  if (!input || typeof input.decisionId !== 'string' || input.decisionId.trim().length === 0) {
    errors.push('decisionId zorunlu');
  }
  if (!input || typeof input.decisionType !== 'string' || input.decisionType.trim().length === 0) {
    errors.push('decisionType zorunlu');
  }
  if (!input || typeof input.triggerSource !== 'string' || input.triggerSource.trim().length === 0) {
    errors.push('triggerSource zorunlu');
  }
  if (!input || input.quarantineAnalysis === undefined || input.quarantineAnalysis === null) {
    errors.push('quarantineAnalysis zorunlu (ARCHITECTURE §1.1)');
  }
  if (!input || input.policyDecision === undefined || input.policyDecision === null) {
    errors.push('policyDecision zorunlu — hiçbir zaman NULL olamaz (CORE.md §4)');
  }
  if (!input || !VALID_FINAL_OUTCOMES.includes(input.finalOutcome)) {
    errors.push(`finalOutcome geçersiz — beklenen: ${VALID_FINAL_OUTCOMES.join(' | ')}`);
  }
  return { passed: errors.length === 0, errors };
}

/**
 * AUDIT_SCHEMA.md §1 satırını derler. previousHash/chainBroken zaten
 * çözülmüş olarak (resolvePreviousHash'ten) gelir — bu fonksiyon saf/senkron
 * kalır, DB'ye kendi erişmez (envelopeBuilder.js/auditLog.js IG-ADS
 * deseniyle tutarlı: üretim ile doğrulama ayrı fonksiyonlarda).
 */
function buildAuditRecord(input, now = new Date().toISOString()) {
  const check = checkRequiredAuditFields(input);
  if (!check.passed) {
    return { record: null, error: check.errors.join('; ') };
  }

  const {
    decisionId, decisionType, triggerSource, rawInputPayload, quarantineAnalysis,
    crisisFlag, executorOutput, criticVerdict, policyDecision, finalOutcome,
    humanQueueRef, previousHash, chainBroken,
  } = input;

  const resolvedPreviousHash = previousHash || CHAIN_LOOKUP_FAILED;
  const recordHash = computeRecordHash({
    decisionId, decisionType, triggerSource, quarantineAnalysis,
    crisisFlag: crisisFlag === true, executorOutput, criticVerdict, policyDecision,
    finalOutcome, previousHash: resolvedPreviousHash,
  });

  return {
    record: {
      decision_id: decisionId,
      decision_type: decisionType,
      trigger_source: triggerSource,
      raw_input_payload: rawInputPayload || null,
      quarantine_analysis: quarantineAnalysis,
      crisis_flag: crisisFlag === true,
      executor_output: executorOutput || null,
      critic_verdict: criticVerdict || null,
      policy_decision: policyDecision,
      final_outcome: finalOutcome,
      human_queue_ref: humanQueueRef || null,
      record_hash: recordHash,
      previous_hash: resolvedPreviousHash,
      chain_broken: chainBroken === true,
      created_at: now,
    },
    error: null,
  };
}

/**
 * AMC-6: Satırı append-only tabloya yazar. Yazma başarısız olursa
 * criticalEscalation:true döner — sessizce yutulmaz.
 */
async function insertAuditRecord(record, dbClient) {
  if (!record) {
    return { inserted: false, criticalEscalation: true, error: 'record null (fail-closed)' };
  }
  if (!dbClient || typeof dbClient.insert !== 'function') {
    return { inserted: false, criticalEscalation: true, error: 'dbClient enjekte edilmedi veya insert() fonksiyonu yok' };
  }
  try {
    await dbClient.insert(record);
    return { inserted: true, criticalEscalation: false, error: null };
  } catch (err) {
    return { inserted: false, criticalEscalation: true, error: `DB yazma hatası: ${err.message || err}` };
  }
}

/**
 * Koordinasyon fonksiyonu. AMC-6 gereği bu, karar zincirinin sonucu ne
 * olursa olsun (BLOCKED/HUMAN_QUEUE/AUTO_APPLIED fark etmeksizin)
 * çağrılmalı — çağrı sorumluluğu n8n orkestrasyon katmanına aittir.
 */
async function runAuditLogNode(input, dbClient, now) {
  const { previousHash, chainBroken } = await resolvePreviousHash(dbClient);

  const { record, error: buildError } = buildAuditRecord({ ...input, previousHash, chainBroken }, now);
  if (buildError) {
    return { inserted: false, criticalEscalation: true, error: buildError };
  }

  const insertResult = await insertAuditRecord(record, dbClient);
  return {
    ...insertResult,
    chainBroken,
    criticalEscalation: insertResult.criticalEscalation || chainBroken,
  };
}

module.exports = {
  computeRecordHash,
  resolvePreviousHash,
  checkRequiredAuditFields,
  buildAuditRecord,
  insertAuditRecord,
  runAuditLogNode,
};
