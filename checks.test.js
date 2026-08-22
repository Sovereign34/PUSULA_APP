// policy-engine/checks.test.
// Amaç:    checks.js'teki 7 fonksiyonun her birini geçerli/sınır/aşım/null
//          senaryolarıyla doğrular (AGENT.md Kod Kalitesi Kural 6).
// Bağlı:   checks.js (test edilen dosya) — checks.js'e yeni fonksiyon eklenirse
//          buraya da geçerli/sınır/aşım/null testleri eklenmeli; sonuçlar ayrıca
//          TEST_MATRIX.md Bölüm 1a'ya işlenir.
// AMC:     AMC-1, AMC-3, AMC-4, AMC-8 (checks.js'teki fonksiyonlarla birebir)
// Risk:    Test eksik/yanlışsa Policy Engine'deki bir hata (ör. null bütçe kabulü,
//          ya da Critic'in kritik bir bulgusunun sessizce geçmesi) fark edilmeden
//          production'a sızabilir.
// Dokunma: checks.js'in fonksiyon imzası değişirse (parametre sırası/tipi) burası
//          da güncellenmeli.
const assert = require('assert');
const checks = require('./checks');

const config = {
  budget: { max_daily_ad_spend_try: 2000, max_single_campaign_pct: 40 },
  placement: { allowed: ['instagram'] },
};

// --- checkCriticApproved (AMC-3) ---
assert.strictEqual(checks.checkCriticApproved('approve').passed, true, 'geçerli: approve');
assert.strictEqual(checks.checkCriticApproved('reject').passed, false, 'aşım: reject');
assert.strictEqual(checks.checkCriticApproved(null).passed, false, 'null: verdict eksik');

// --- checkBudgetCap (AMC-1) — TÜM aktif kampanyaların toplamı ---
assert.strictEqual(checks.checkBudgetCap(800, 1200, config).passed, true, 'sınır: tam tavan (800+1200=2000)');
assert.strictEqual(checks.checkBudgetCap(800, 1199, config).passed, true, 'geçerli: tavan altı');
assert.strictEqual(checks.checkBudgetCap(800, 1201, config).passed, false, 'aşım: toplam tavan üstü');
assert.strictEqual(checks.checkBudgetCap(null, 1000, config).passed, false, 'null: bütçe eksik');
assert.strictEqual(checks.checkBudgetCap(500, 0, config).passed, true, 'sınır: ilk kampanya, aktif toplam 0');

// --- checkSingleCampaignPct (AMC-1) — günlük tavanın sabit %'i, aktif kampanya sayısından bağımsız ---
assert.strictEqual(checks.checkSingleCampaignPct(800, config).passed, true, 'sınır: tam %40 (2000*0.4=800)');
assert.strictEqual(checks.checkSingleCampaignPct(799, config).passed, true, 'geçerli: %40 altı');
assert.strictEqual(checks.checkSingleCampaignPct(801, config).passed, false, 'aşım: %40 üstü');
assert.strictEqual(checks.checkSingleCampaignPct(800, config).passed, true, 'sınır: ilk kampanya olsa da aynı formül geçerli');
assert.strictEqual(checks.checkSingleCampaignPct(null, config).passed, false, 'null: bütçe eksik');

// --- checkPlacementLock (AMC-4) ---
assert.strictEqual(checks.checkPlacementLock('instagram_only', config).passed, true, 'geçerli: instagram_only');
assert.strictEqual(checks.checkPlacementLock('facebook', config).passed, false, 'aşım: yanlış platform');
assert.strictEqual(checks.checkPlacementLock(null, config).passed, false, 'null: placement eksik');

// --- checkCreativeUploaded (AMC-8) ---
assert.strictEqual(checks.checkCreativeUploaded(true).passed, true, 'geçerli: yüklendi');
assert.strictEqual(checks.checkCreativeUploaded(false).passed, false, 'aşım: yüklenmedi');
assert.strictEqual(checks.checkCreativeUploaded(null).passed, false, 'null: alan eksik');

// --- checkUtmComplete (AMC-4) ---
assert.strictEqual(checks.checkUtmComplete({ campaign: 'x', content: 'y' }).passed, true, 'geçerli: dolu');
assert.strictEqual(checks.checkUtmComplete({ campaign: 'x', content: '' }).passed, false, 'aşım: content boş');
assert.strictEqual(checks.checkUtmComplete(null).passed, false, 'null: utm objesi yok');

// --- checkCriticChecksIndependent (AMC-3/AMC-4) — R-IG-19, ARCHITECTURE.md §1.4 madde 7 ---
const validCriticChecks = {
  targeting_kvkk_risk: false,
  forbidden_phrase_in_caption: false,
  objective_placement_mismatch: false,
  budget_target_coherence: true,
  utm_format_valid: true,
};
assert.strictEqual(checks.checkCriticChecksIndependent(validCriticChecks).passed, true, 'geçerli: 5 alan da beklenen değerde');
assert.strictEqual(
  checks.checkCriticChecksIndependent({ ...validCriticChecks, targeting_kvkk_risk: true }).passed,
  false,
  'aşım: targeting_kvkk_risk=true (verdict approve olsa bile reddedilmeli)'
);
assert.strictEqual(
  checks.checkCriticChecksIndependent({ ...validCriticChecks, budget_target_coherence: false }).passed,
  false,
  'aşım: budget_target_coherence=false'
);
assert.strictEqual(
  checks.checkCriticChecksIndependent({ ...validCriticChecks, forbidden_phrase_in_caption: true }).passed,
  false,
  'aşım: forbidden_phrase_in_caption=true'
);
assert.strictEqual(
  checks.checkCriticChecksIndependent({ ...validCriticChecks, objective_placement_mismatch: true }).passed,
  false,
  'aşım: objective_placement_mismatch=true'
);
assert.strictEqual(
  checks.checkCriticChecksIndependent({ ...validCriticChecks, utm_format_valid: false }).passed,
  false,
  'aşım: utm_format_valid=false'
);
assert.strictEqual(checks.checkCriticChecksIndependent(null).passed, false, 'null: checks objesi eksik');
assert.strictEqual(checks.checkCriticChecksIndependent({}).passed, false, 'sınır: checks objesi boş (tüm alanlar eksik)');

console.log('✅ Tüm checks.js testleri geçti (30/30)');
