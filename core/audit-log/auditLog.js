//core/audit-log/auditLog.js
// Amaç:    MASTER_PLAN §5 audit şemasını + DecisionEnvelope'un Faz-3-zorunlu
//          alanlarını (actor, input_context_hash, audit.record_hash —
//          ARCHITECTURE.md §1.5 v1.4) + zincirleme previous_hash'i
//          (R-IG-22, DUAL-AI spec §9/§24) tek bir satıra derleyip
//          `dbClient` üzerinden append-only Postgres tablosuna yazar.
//          [B18, Session 26] Bu dosyanın kodu zaten platform-agnostikti
//          (dbClient enjekte ediliyor, hiçbir platform literali yok) — tek
//          bulgu, bu yorum bloğundaki eski `IG_ADS_DB_URL` env adı referansıydı,
//          genel ifadeyle değiştirildi. KOD DEĞİŞMEDİ. Gerçek n8n/Hetzner
//          ortamındaki Postgres credential/env adının hâlâ `IG_ADS_DB_URL`
//          olması ayrı bir infra-seviyesi takip maddesi (bu dosyanın kapsamı
//          dışında — n8n Credentials Store/VPS env değişkeni, PSC-2).
// Bağlı:   meta-api/metaApi.js (runMetaApiNode çıktısı → meta_api_response);
//          execution-gate/gate.js (decision_id, actor Execution Token'dan);
//          policy-engine/runPolicyEngine.js (policy_engine_result);
//          `dbClient.getLastRecordHash()` — gate.js'teki idempotency lookup
//          enjeksiyon deseniyle aynı, son kaydın record_hash'ini döner
//          (hiç kayıt yoksa null/undefined döner → GENESIS).
// AMC:     AMC-6 (Audit Trail Bütünlüğü — başarılı/başarısız fark etmeksizin
//          HER çağrı yazılır; yazma başarısız olursa kritik eskalasyon).
//          R-IG-22'nin zincir ilkesi de AMC-6 kapsamında — yeni AMC kodu
//          gerekmedi (KARAR BİLDİRİMİ ile onaylandı).
// Risk:    Meta API çağrısı gerçekleşip audit satırı yazılamazsa, gerçek
//          parayla açılmış bir kampanyanın izlenebilir kaydı kalmaz — bu
//          durum sessizce geçilemez, insan bildirimi ZORUNLU. AYRICA:
//          previous_hash lookup'ı başarısız olursa kayıt YİNE DE yazılır
//          (AMC-6, kayıt kaybı zincir kırılmasından daha kötü) ama
//          `audit.chain_broken: true` ile işaretlenir ve criticalEscalation
//          tetiklenir — sessizce geçilmez.
// Dokunma: record_hash formülü (decision_id+campaign_brief+critic_verdict+
//          policy_engine_result+meta_api_response+previous_hash) değişirse,
//          geçmiş satırların bütünlüğü bozulmadan yeni formüle geçiş ayrıca
//          planlanmalı — append-only ilkesi geriye dönük değişikliğe izin
//          vermez.

const crypto = require('crypto');

const GENESIS = 'GENESIS';
const CHAIN_LOOKUP_FAILED = 'CHAIN_LOOKUP_FAILED';

/**
 * AMC-6: Audit satırının kendi içeriğinin + zincir konumunun bütünlük
 * imzası. `previousHash` dahil edildiği için satır hem kendi içeriği hem
 * zincirdeki yeri değiştirilirse bu hash bir daha eşleşmez.
 */
function computeRecordHash({ decisionId, campaignBrief, criticVerdict, policyEngineResult, metaApiResponse, previousHash }) {
  const payload = JSON.stringify({ decisionId, campaignBrief, criticVerdict, policyEngineResult, metaApiResponse, previousHash });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * R-IG-22: Zincirdeki bir önceki kaydın hash'ini `dbClient` üzerinden
 * çözer. Üç durum ayrı ayrı etiketlenir (birbirine karıştırılmaz):
 *  - Gerçekten ilk kayıt (lookup null/undefined döner)  → GENESIS
 *  - Lookup fonksiyonu hiç enjekte edilmemiş             → CHAIN_LOOKUP_FAILED
 *  - Lookup çağrısı hata fırlatır (DB down vb.)          → CHAIN_LOOKUP_FAILED
 * Kayıt CHAIN_LOOKUP_FAILED durumunda da yazılır (AMC-6), ama chainBroken
 * true döner — çağıran taraf (runAuditLogNode) bunu criticalEscalation'a
 * çevirir, sessizce geçilmez.
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
 * MASTER_PLAN §5 + ARCHITECTURE.md §1.5 alanlarını tek satıra derler.
 * Faz 3 zorunlu üç alan (decisionId, actor, inputContextHash) eksikse
 * fail-closed reddedilir — audit satırı kimliksiz yazılamaz.
 * `previousHash`/`chainBroken` zaten çözülmüş olarak (resolvePreviousHash'ten)
 * gelir — bu fonksiyon saf/senkron kalır, DB'ye kendi erişmez.
 */
function buildAuditRecord(input, now = new Date().toISOString()) {
  const { decisionId, actor, inputContextHash, campaignBrief, criticVerdict,
    policyEngineResult, metaApiResponse, humanFinalApproval, aiDisclosureApplied,
    previousHash, chainBroken } = input || {};

  if (!decisionId || !actor || !inputContextHash) {
    return { record: null, error: 'decisionId/actor/inputContextHash zorunlu (ARCHITECTURE.md §1.5)' };
  }

  const resolvedPreviousHash = previousHash || CHAIN_LOOKUP_FAILED;
  const recordHash = computeRecordHash({
    decisionId, campaignBrief, criticVerdict, policyEngineResult, metaApiResponse,
    previousHash: resolvedPreviousHash,
  });

  return {
    record: {
      decision_id: decisionId,
      actor,
      input_context_hash: inputContextHash,
      campaign_brief: campaignBrief || null,
      critic_verdict: criticVerdict || null,
      policy_engine_result: policyEngineResult || null,
      meta_api_response: metaApiResponse || null,
      human_final_approval: humanFinalApproval || { approved: false, timestamp: null },
      ai_disclosure_applied: aiDisclosureApplied ?? false,
      audit: {
        record_hash: recordHash,
        previous_hash: resolvedPreviousHash,
        chain_broken: chainBroken === true,
      },
      created_at: now,
    },
    error: null,
  };
}

/**
 * AMC-6: Satırı append-only tabloya yazar. `dbClient` enjekte edilir
 * (gate.js'teki audit lookup deseniyle aynı — gerçek Postgres olmadan test
 * edilebilir). Yazma başarısız olursa `criticalEscalation: true` döner —
 * bu durum sessizce yutulmaz, insan bildirim node'una gitmesi gerekir.
 */
async function insertAuditRecord(record, dbClient) {
  if (!record) {
    return { inserted: false, criticalEscalation: true, error: 'record null (fail-closed)' };
  }
  try {
    await dbClient.insert(record);
    return { inserted: true, criticalEscalation: false, error: null };
  } catch (err) {
    return { inserted: false, criticalEscalation: true, error: `DB yazma hatası: ${err.message || err}` };
  }
}

/**
 * Koordinasyon fonksiyonu — önce previous_hash zincirini çözer, sonra satırı
 * derler, sonra yazar. AMC-6 gereği bu fonksiyon Meta API sonucu BAŞARISIZ
 * olsa bile çağrılmalı (audit her durumda tutulur). R-IG-22 gereği zincir
 * lookup'ı başarısız olsa bile kayıt yine yazılır ama chainBroken true
 * olduğunda criticalEscalation da true'ya zorlanır — sessizce geçilmez.
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
  buildAuditRecord,
  insertAuditRecord,
  runAuditLogNode,
};
