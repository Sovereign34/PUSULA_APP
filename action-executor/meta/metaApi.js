// action-executor/meta/metaApi.js
// Amaç:    Execution Gate'in ürettiği Execution Token'ı TÜKETİR — TTL ve
//          policy_hash doğrulamasını yapar, sonra Campaign'i ve ardından
//          Ad Set'i Meta Marketing API'ye PAUSED durumunda oluşturur
//          (MASTER_PLAN §3.1 — iki ayrı node/adım olarak tanımlı).
// Bağlı:   execution-gate/gate.js (buildExecutionToken çıktısını burada tüketir);
//          policy-engine/checks.js (policyHash hesaplama mantığı computePolicyHash
//          ile aynı formülü kullanmalı, DEPENDENCIES.md §3a); audit log node
//          (bu modül audit'e YAZMAZ, sadece sonucu döner — AMC-6 audit node'un işi)
// AMC:     AMC-4 (Sessiz Sapma Yasağı — TTL/hash), AMC-7 (Rate Limit/Backoff),
//          AMC-8 (Kreatif Onaysız Yayın Yasağı — PAUSED zorunluluğu), AMC-2
//          (placement sabiti, dolaylı)
// Risk:    Süresi dolmuş veya hash uyuşmayan bir token'la API çağrısı = onay
//          anıyla yürütme anı arasında sessizce sapmış bir kararın gerçek
//          parayla yürütülmesi. Yanlış publisher_platforms = kapsam dışı
//          yayın (MASTER_PLAN §3.2 ihlali). Campaign oluşup Ad Set oluşmazsa
//          yarım kalmış (orphan) bir Campaign kalabilir — bkz. Dokunma notu.
// Dokunma: policyEngineVersion kaynağı (git commit hash, DEPENDENCIES.md v1.4)
//          değişirse computePolicyHash'in iki tarafı da (gate.js + burası)
//          aynı anda güncellenmeli, yoksa hash hiç eşleşmez.
// DOKUNMA / DÜRÜSTLÜK NOTU (bu oturumda eklendi): `buildAdSetPayload`'daki
//          `targeting.geo_locations` alanının gerçek Meta Marketing API şeması
//          (custom_locations mi, countries mi, ne format) bu ajana hiç teyit
//          edilmedi — executorNode.js'in ürettiği `targeting.locations` düz
//          bir string dizisi, Meta API'nin beklediği gerçek yapı ARAŞTIRMA
//          gerektirir (Faz 4 sandbox testinde netleşecek, §6 madde 1). Ayrıca
//          Campaign başarılı, Ad Set başarısız olursa oluşan "orphan" Campaign'in
//          nasıl temizleneceği/işaretleneceği bu dosyada tanımlanmadı — bu,
//          resmi bir risk numarası (R-IG-#) almalı, MASTER_PLAN §8'e eklenmeli.

/**
 * AMC-4: Execution Token'ın TTL'i (60 saniye) dolmuş mu kontrol eder.
 * Fail-closed: `now` enjekte edilmezse gerçek zaman kullanılır ama test edilebilirlik
 * için parametre olarak alınır (gate.js'teki idempotency deneyiminden ders).
 */
function checkTokenNotExpired(token, now = Date.now()) {
  if (!token || typeof token.expiration !== 'number') {
    return { passed: false, reason: 'token veya expiration alanı eksik' };
  }
  if (now > token.expiration) {
    return { passed: false, reason: `token süresi doldu (now=${now}, exp=${token.expiration})` };
  }
  return { passed: true, reason: null };
}

/**
 * AMC-4: Token mint edilirken hesaplanan policy_hash, ŞU AN yeniden hesaplanan
 * hash ile eşleşiyor mu — onay anıyla yürütme anı arasında config veya
 * policy-engine kodu değiştiyse hash uyuşmaz, reddedilir.
 */
function checkPolicyHashMatch(token, currentPolicyHash) {
  if (!token || !token.policy_hash) {
    return { passed: false, reason: 'token.policy_hash eksik' };
  }
  if (!currentPolicyHash) {
    return { passed: false, reason: 'currentPolicyHash hesaplanamadı (fail-closed)' };
  }
  if (token.policy_hash !== currentPolicyHash) {
    return { passed: false, reason: 'policy_hash uyuşmuyor — config veya kod onay sonrası değişmiş' };
  }
  return { passed: true, reason: null };
}

/**
 * AMC-8 / AMC-2: Campaign payload'ı inşa eder. Kampanya HER ZAMAN PAUSED,
 * placement HER ZAMAN sadece instagram — bu iki değer kod seviyesinde sabit,
 * brief'ten okunmaz (MASTER_PLAN §2.4, §3.2, AGENT.md Mutlak Yasaklar).
 */
function buildCampaignPayload(campaignBrief) {
  if (!campaignBrief || !campaignBrief.daily_budget || !campaignBrief.objective) {
    return { payload: null, error: 'campaignBrief eksik alan içeriyor (daily_budget/objective)' };
  }
  return {
    payload: {
      name: campaignBrief.name,
      objective: campaignBrief.objective,
      status: 'PAUSED', // AMC-8 — kodda sabit, brief'ten asla okunmaz
      daily_budget: campaignBrief.daily_budget,
      publisher_platforms: ['instagram'], // MASTER_PLAN §3.2 — kodda sabit
      special_ad_categories: campaignBrief.special_ad_categories || [],
    },
    error: null,
  };
}

/**
 * [YENİ, bu oturum] AMC-8 / AMC-2: Ad Set payload'ı — campaignBrief.targeting'i
 * kullanır (age_min/age_max/locations/interests, executorNode.js §1.2 şeması).
 * `instagram_positions` MASTER_PLAN §3.2'deki izin verilen liste dışına
 * çıkarsa kod seviyesinde kırpılır (Policy Engine'e güvenilmez, defense in
 * depth — buildCampaignPayload'daki publisher_platforms sabitlemesiyle aynı
 * mantık). GERÇEK Meta API alan adları/şeması (özellikle geo_locations)
 * TEYİT EDİLMEDİ — bkz. dosya başındaki Dokunma/Dürüstlük notu.
 */
const ALLOWED_IG_POSITIONS = ['feed', 'story', 'reels']; // MASTER_PLAN §3.2 — "explore" v26.0'da kaldırıldı

function buildAdSetPayload(campaignBrief, campaignId) {
  if (!campaignBrief || !campaignBrief.targeting || !campaignId) {
    return { payload: null, error: 'campaignBrief.targeting veya campaignId eksik' };
  }
  const t = campaignBrief.targeting;
  if (!Number.isInteger(t.age_min) || !Number.isInteger(t.age_max) || !Array.isArray(t.locations)) {
    return { payload: null, error: 'targeting.age_min/age_max/locations eksik veya geçersiz' };
  }
  const requestedPositions = Array.isArray(campaignBrief.instagram_positions)
    ? campaignBrief.instagram_positions
    : ALLOWED_IG_POSITIONS;
  const instagramPositions = requestedPositions.filter((p) => ALLOWED_IG_POSITIONS.includes(p));

  return {
    payload: {
      name: campaignBrief.name ? `${campaignBrief.name} - Ad Set` : undefined,
      campaign_id: campaignId,
      status: 'PAUSED', // AMC-8 — kodda sabit
      daily_budget: campaignBrief.daily_budget,
      targeting: {
        age_min: t.age_min,
        age_max: t.age_max,
        // TEYİT EDİLMEDİ: gerçek Meta API geo_locations şeması Faz 4'te doğrulanmalı
        geo_locations: { custom_locations: t.locations },
        interests: t.interests || [],
        publisher_platforms: ['instagram'], // MASTER_PLAN §3.2 — kodda sabit
        instagram_positions: instagramPositions,
      },
    },
    error: null,
  };
}

/**
 * AMC-7: Meta API çağrısını exponential backoff ile yapar. `httpClient`
 * enjekte edilir (gerçek fetch/axios değil) — bu sayede gerçek ağ çağrısı
 * olmadan test edilebilir, gate.js'teki idempotency lookup deseniyle aynı.
 */
async function callMetaApiWithBackoff(payload, httpClient, maxAttempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await httpClient(payload);
      if (response.status >= 200 && response.status < 300) {
        return { success: true, response, error: null };
      }
      if (response.status === 429 || response.status >= 500) {
        lastError = response;
        await new Promise((r) => setTimeout(r, 2 ** attempt * 500));
        continue;
      }
      return { success: false, response, error: `4xx hata: ${response.status}` };
    } catch (err) {
      lastError = err;
    }
  }
  return { success: false, response: null, error: `${maxAttempts} denemede başarısız: ${lastError}` };
}

/**
 * Koordinasyon fonksiyonu — TTL kontrolü, hash kontrolü, Campaign payload
 * inşası, Campaign API çağrısı, [YENİ] Ad Set payload inşası, Ad Set API
 * çağrısı sırayla yapılır. Herhangi biri başarısız olursa FAIL-CLOSED.
 * [YENİ, DOKUNMA]: Campaign oluşup Ad Set oluşmazsa `stage: 'ad_set'` ile
 * döner ve `campaignResult` alanında oluşmuş Campaign bilgisi taşınır —
 * orphan Campaign'in nasıl ele alınacağı (silme/işaretleme) audit-log/insan
 * bildirim seviyesinde ayrıca kararlaştırılmalı (bu dosyanın kapsamı dışı).
 */
async function runMetaApiNode({ token, campaignBrief, currentPolicyHash, httpClient, now }) {
  const ttlCheck = checkTokenNotExpired(token, now);
  if (!ttlCheck.passed) {
    return { executed: false, stage: 'ttl', reason: ttlCheck.reason };
  }

  const hashCheck = checkPolicyHashMatch(token, currentPolicyHash);
  if (!hashCheck.passed) {
    return { executed: false, stage: 'policy_hash', reason: hashCheck.reason };
  }

  const { payload: campaignPayload, error: campaignPayloadError } = buildCampaignPayload(campaignBrief);
  if (campaignPayloadError) {
    return { executed: false, stage: 'campaign_payload', reason: campaignPayloadError };
  }

  const campaignResult = await callMetaApiWithBackoff(campaignPayload, httpClient);
  if (!campaignResult.success) {
    return { executed: false, stage: 'campaign_api', ...campaignResult };
  }

  const campaignId = campaignResult.response && campaignResult.response.id;
  const { payload: adSetPayload, error: adSetPayloadError } = buildAdSetPayload(campaignBrief, campaignId);
  if (adSetPayloadError) {
    return { executed: false, stage: 'ad_set_payload', reason: adSetPayloadError, campaignResult };
  }

  const adSetResult = await callMetaApiWithBackoff(adSetPayload, httpClient);
  return {
    executed: adSetResult.success,
    stage: 'ad_set_api',
    campaignResult,
    ...adSetResult,
  };
}

module.exports = {
  checkTokenNotExpired,
  checkPolicyHashMatch,
  buildCampaignPayload,
  buildAdSetPayload,
  callMetaApiWithBackoff,
  runMetaApiNode,
};
