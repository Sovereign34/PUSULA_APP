// policy-engine/checks.js
// Amaç:    Executor→Critic onayından geçen kampanya brief'ini Meta Marketing API'ye
//          göndermeden önce deterministik, sabit kurallarla tek tek denetler.
// Bağlı:   runPolicyEngine.js (bu dosyadaki 7 fonksiyonu sabit sırayla çağırır),
//          checks.test.js (her fonksiyon için geçerli/sınır/aşım/null testi) —
//          checks.js'e yeni fonksiyon eklenirse ikisi de güncellenmeli.
// AMC:     AMC-1 (bütçe), AMC-3 (çift onay), AMC-4 (placement/UTM/Critic bulgu sessiz sapma), AMC-8 (kreatif onay)
// Risk:    Hatalı çalışırsa gerçek bütçe/placement sınırları aşılabilir, kreatifsiz
//          kampanya ACTIVE'e geçebilir, ya da Critic'in tespit ettiği kritik bir bulgu
//          (KVKK riski, yasak ifade, hedef/placement uyumsuzluğu) 'approve' verdict'i
//          arkasında fark edilmeden geçebilir — gerçek para + uyum riski.
// Dokunma: Değiştirmeden önce ARCHITECTURE.md §1.4 (7 kontrol listesi) ve
//          CONFIG_SCHEMA.md §2 (ig_ads_policy_config.yaml) kontrol edilmeli.
//          Kaynak: MASTER_PLAN.md §2.4 (Policy Engine ilkesi), ARCHITECTURE.md §1.4.

/**
 * AMC-3 — Critic onayı olmadan hiçbir brief Policy Engine'den geçemez.
 */
function checkCriticApproved(criticVerdict) {
  const passed = criticVerdict === 'approve';
  return {
    amc: 'AMC-3',
    passed,
    reason: passed ? null : `critic_verdict='${criticVerdict}', 'approve' bekleniyor`,
  };
}

/**
 * AMC-1 — TÜM aktif kampanyaların toplam günlük harcaması, config'teki tavanı aşamaz
 * (isim "max_daily_AD_SPEND", tek kampanya değil, hesap geneli).
 */
function checkBudgetCap(dailyBudgetTry, activeTotalBudgetTry, config) {
  const cap = config.budget.max_daily_ad_spend_try;
  const validInput = typeof dailyBudgetTry === 'number' && typeof activeTotalBudgetTry === 'number' && typeof cap === 'number';
  const combinedTotal = validInput ? activeTotalBudgetTry + dailyBudgetTry : NaN;
  const passed = validInput && combinedTotal <= cap;
  return {
    amc: 'AMC-1',
    passed,
    reason: passed ? null : `toplam_aktif+yeni=${combinedTotal} > tavan=${cap} (veya alan eksik)`,
  };
}

/**
 * AMC-1 — Tek kampanya, GÜNLÜK TAVANIN (max_daily_ad_spend_try) sabit bir %'ini
 * aşamaz — aktif kampanya sayısından bağımsız (Session 3 kararı: "tek kampanya
 * bütçenin yarısını aşamaz", referans "bütçe"=tavan, aktif toplam değil; bu formül
 * ilk kampanyayı da bloklamayan, kilitlenmesiz tek yorumdur — kullanıcı onayı, Session 4).
 */
function checkSingleCampaignPct(dailyBudgetTry, config) {
  const pct = config.budget.max_single_campaign_pct;
  const cap = config.budget.max_daily_ad_spend_try;
  const validInput = typeof dailyBudgetTry === 'number' && typeof pct === 'number' && typeof cap === 'number';
  const limit = validInput ? cap * (pct / 100) : NaN;
  const passed = validInput && dailyBudgetTry <= limit;
  return {
    amc: 'AMC-1',
    passed,
    reason: passed ? null : `daily_budget_try=${dailyBudgetTry}, tavanın %${pct}'i=${limit} (veya alan eksik)`,
  };
}

/**
 * AMC-4 — Placement kod seviyesinde sabit: sadece instagram_only, sessiz sapma yasak.
 */
function checkPlacementLock(placement, config) {
  const allowed = config.placement.allowed;
  const passed = placement === 'instagram_only' && allowed.length === 1 && allowed[0] === 'instagram';
  return {
    amc: 'AMC-4',
    passed,
    reason: passed ? null : `placement='${placement}', beklenen='instagram_only'`,
  };
}

/**
 * AMC-8 — Kreatif insan tarafından yüklenmeden kampanya ACTIVE'e geçemez, PAUSED kalır.
 */
function checkCreativeUploaded(creativeUploaded) {
  const passed = creativeUploaded === true;
  return {
    amc: 'AMC-8',
    passed,
    reason: passed ? null : 'kreatif henüz insan tarafından yüklenmedi — PAUSED kalır',
  };
}

/**
 * AMC-4 — UTM alanları (campaign, content) boş geçemez — sessiz veri kaybı yasağı.
 */
function checkUtmComplete(utm) {
  const passed = !!(utm && utm.campaign && utm.content);
  return {
    amc: 'AMC-4',
    passed,
    reason: passed ? null : 'utm.campaign veya utm.content boş',
  };
}

/**
 * AMC-3, AMC-4 — R-IG-19 çözümü (ARCHITECTURE.md §1.4 madde 7). Critic `checks`
 * objesinin 5 alanı `critic_verdict`'ten BAĞIMSIZ doğrulanır — 'approve' verdict'i
 * gelse bile, altındaki bulgulardan biri beklenen değeri sağlamıyorsa reddedilir.
 * Kaynak: DUAL-AI spec §12 ("Policy must recheck critical facts, don't trust
 * critic.safe==true"). Beklenen değerler (ARCHITECTURE.md §1.3 şemasıyla birebir):
 *   targeting_kvkk_risk=false, forbidden_phrase_in_caption=false,
 *   objective_placement_mismatch=false, budget_target_coherence=true,
 *   utm_format_valid=true.
 */
function checkCriticChecksIndependent(criticChecks) {
  const expected = {
    targeting_kvkk_risk: false,
    forbidden_phrase_in_caption: false,
    objective_placement_mismatch: false,
    budget_target_coherence: true,
    utm_format_valid: true,
  };
  const failedFields = Object.keys(expected).filter(
    (field) => !criticChecks || criticChecks[field] !== expected[field]
  );
  const passed = failedFields.length === 0;
  return {
    amc: 'AMC-3/AMC-4',
    passed,
    reason: passed ? null : `criticChecks beklenen değerde değil veya eksik: ${failedFields.join(', ')}`,
  };
}

module.exports = {
  checkCriticApproved,
  checkBudgetCap,
  checkSingleCampaignPct,
  checkPlacementLock,
  checkCreativeUploaded,
  checkUtmComplete,
  checkCriticChecksIndependent,
};
