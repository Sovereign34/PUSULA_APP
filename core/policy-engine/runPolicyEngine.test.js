// core/policy-engine/runPolicyEngine.test.js
// Amaç:    runPolicyEngine.js'teki buildPolicyChecks ve runPolicyEngine
//          fonksiyonlarının birim testleri — SESSION_INDEX.md'de B18 test
//          borcunun 4. maddesi olarak takip ediliyordu, bu dosya daha önce
//          hiç yazılmamıştı (bkz. Session 26 (devam 2) notu).
// Bağlı:   runPolicyEngine.js (test edilen dosya), checks.js (gerçek/mock
//          checkFns) — checks.js'e yeni fonksiyon eklenirse buradaki mock
//          checkFns nesnesi ve ARCHITECTURE.md §1.4 sıra testi güncellenmeli.
// AMC:     checks.js'teki tüm AMC kodları — bu dosya kontrol eklemez, sadece
//          koordinasyonu (sıra, .every() birleşimi, platformConfig thread'i,
//          decision_id passthrough) doğrular.
// Risk:    Sıra testi eksikse, kontrol sırasındaki bir regresyon (ör.
//          checkCriticApproved yanlışlıkla başa alınırsa, runPolicyEngine.js
//          Değişiklik Notu'ndaki gerçek hata) audit log'daki `results`
//          dizisinin ARCHITECTURE.md §1.4 numaralarıyla eşleşmesini bozar
//          ama fark edilmez, çünkü .every() kararı etkilemez.
// Dokunma: runPolicyEngine.js'in imzası (platformConfig dördüncü parametre,
//          B18) değişirse burası da güncellenmeli.

const assert = require('assert');
const { buildPolicyChecks, runPolicyEngine } = require('./runPolicyEngine');
const realChecks = require('./checks');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name} — ${err.message}`);
    failed++;
  }
}

// [B18] platformConfig fixture — executorNode/criticNode/checks
// test fixture'larıyla aynı nesne.
const IG_PLATFORM_CONFIG = {
  platformName: 'instagram',
  placementValue: 'instagram_only',
  decisionType: 'ig_campaign_brief',
  promptLabel: 'Instagram',
};

const REAL_CONFIG = {
  budget: { max_daily_ad_spend_try: 2000, max_single_campaign_pct: 40 },
  placement: { allowed: ['instagram'] },
};

const VALID_INPUT = {
  decision_id: '11111111-1111-4111-8111-111111111111',
  critic_verdict: 'approve',
  critic_checks: {
    targeting_kvkk_risk: false,
    forbidden_phrase_in_caption: false,
    objective_placement_mismatch: false,
    budget_target_coherence: true,
    utm_format_valid: true,
  },
  daily_budget_try: 500,
  active_total_budget_try: 0,
  placement: 'instagram_only',
  creative_uploaded: true,
  utm: { campaign: 'yaz_lansman', content: 'bowl_v1' },
};

// Her çağrıyı sırasıyla kaydeden mock checkFns — ARCHITECTURE.md §1.4'ün
// 1-7 numaralı sırasını doğrulamak için.
function makeOrderTrackingMock() {
  const callOrder = [];
  return {
    callOrder,
    fns: {
      checkBudgetCap: (...args) => {
        callOrder.push('checkBudgetCap');
        return { amc: 'AMC-1', passed: true, reason: null };
      },
      checkSingleCampaignPct: (...args) => {
        callOrder.push('checkSingleCampaignPct');
        return { amc: 'AMC-1', passed: true, reason: null };
      },
      checkPlacementLock: (...args) => {
        callOrder.push('checkPlacementLock');
        return { amc: 'AMC-4', passed: true, reason: null };
      },
      checkCreativeUploaded: (...args) => {
        callOrder.push('checkCreativeUploaded');
        return { amc: 'AMC-8', passed: true, reason: null };
      },
      checkUtmComplete: (...args) => {
        callOrder.push('checkUtmComplete');
        return { amc: null, passed: true, reason: null };
      },
      checkCriticApproved: (...args) => {
        callOrder.push('checkCriticApproved');
        return { amc: 'AMC-3', passed: true, reason: null };
      },
      checkCriticChecksIndependent: (...args) => {
        callOrder.push('checkCriticChecksIndependent');
        return { amc: 'AMC-3/AMC-4', passed: true, reason: null };
      },
    },
  };
}

// Her çağrının aldığı argümanları da kaydeden mock — parametre eşleme
// (input alanı → doğru fonksiyon → doğru parametre) testleri için.
function makeArgTrackingMock() {
  const calls = {};
  return {
    calls,
    fns: {
      checkBudgetCap: (...args) => {
        calls.checkBudgetCap = args;
        return { amc: 'AMC-1', passed: true, reason: null };
      },
      checkSingleCampaignPct: (...args) => {
        calls.checkSingleCampaignPct = args;
        return { amc: 'AMC-1', passed: true, reason: null };
      },
      checkPlacementLock: (...args) => {
        calls.checkPlacementLock = args;
        return { amc: 'AMC-4', passed: true, reason: null };
      },
      checkCreativeUploaded: (...args) => {
        calls.checkCreativeUploaded = args;
        return { amc: 'AMC-8', passed: true, reason: null };
      },
      checkUtmComplete: (...args) => {
        calls.checkUtmComplete = args;
        return { amc: null, passed: true, reason: null };
      },
      checkCriticApproved: (...args) => {
        calls.checkCriticApproved = args;
        return { amc: 'AMC-3', passed: true, reason: null };
      },
      checkCriticChecksIndependent: (...args) => {
        calls.checkCriticChecksIndependent = args;
        return { amc: 'AMC-3/AMC-4', passed: true, reason: null };
      },
    },
  };
}

// ---- buildPolicyChecks: sıra (ARCHITECTURE.md §1.4, 1-7) ----
test('buildPolicyChecks: 7 kontrolü ARCHITECTURE.md §1.4 sırasıyla çağırır', () => {
  const mock = makeOrderTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.callOrder, [
    'checkBudgetCap',
    'checkSingleCampaignPct',
    'checkPlacementLock',
    'checkCreativeUploaded',
    'checkUtmComplete',
    'checkCriticApproved',
    'checkCriticChecksIndependent',
  ]);
});

test('buildPolicyChecks: checkCriticApproved başa alınmamalı (runPolicyEngine.js Değişiklik Notu\'ndaki regresyon)', () => {
  const mock = makeOrderTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.notStrictEqual(mock.callOrder[0], 'checkCriticApproved');
  assert.strictEqual(mock.callOrder[0], 'checkBudgetCap');
});

test('buildPolicyChecks: 7 sonuç da döner', () => {
  const mock = makeOrderTrackingMock();
  const results = buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.strictEqual(results.length, 7);
});

// ---- buildPolicyChecks: input alanları doğru fonksiyona/parametreye gidiyor ----
test('buildPolicyChecks: checkBudgetCap(daily_budget_try, active_total_budget_try, config)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkBudgetCap, [500, 0, REAL_CONFIG]);
});

test('buildPolicyChecks: checkSingleCampaignPct(daily_budget_try, config)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkSingleCampaignPct, [500, REAL_CONFIG]);
});

test('buildPolicyChecks: checkPlacementLock(placement, config, platformConfig) [B18]', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkPlacementLock, ['instagram_only', REAL_CONFIG, IG_PLATFORM_CONFIG]);
});

test('buildPolicyChecks: checkCreativeUploaded(creative_uploaded)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkCreativeUploaded, [true]);
});

test('buildPolicyChecks: checkUtmComplete(utm)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkUtmComplete, [VALID_INPUT.utm]);
});

test('buildPolicyChecks: checkCriticApproved(critic_verdict)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkCriticApproved, ['approve']);
});

test('buildPolicyChecks: checkCriticChecksIndependent(critic_checks)', () => {
  const mock = makeArgTrackingMock();
  buildPolicyChecks(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.deepStrictEqual(mock.calls.checkCriticChecksIndependent, [VALID_INPUT.critic_checks]);
});

test('buildPolicyChecks: input null/undefined ise destructuring çökmemeli (fail-closed alanlar undefined geçer)', () => {
  const mock = makeArgTrackingMock();
  assert.doesNotThrow(() => buildPolicyChecks(null, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG));
  assert.deepStrictEqual(mock.calls.checkCriticApproved, [undefined]);
});

// ---- runPolicyEngine: .every() birleşimi + decision_id passthrough ----
test('runPolicyEngine: tüm kontroller geçerse approved=true', () => {
  const mock = makeOrderTrackingMock();
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, true);
  assert.strictEqual(result.results.length, 7);
});

test('runPolicyEngine: decision_id input\'tan aynen taşınır (doğrulanmaz)', () => {
  const mock = makeOrderTrackingMock();
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.decision_id, '11111111-1111-4111-8111-111111111111');
});

test('runPolicyEngine: input null ise decision_id null (çökmemeli, input&&input.decision_id kısa devresi)', () => {
  const mock = makeOrderTrackingMock();
  assert.doesNotThrow(() => {
    const result = runPolicyEngine(null, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
    assert.strictEqual(result.decision_id, null);
    assert.strictEqual(result.approved, true); // mock her zaman passed:true döner
  });
});

test('runPolicyEngine: tek bir kontrol bile fail ederse approved=false (AND mantığı)', () => {
  const mock = makeOrderTrackingMock();
  mock.fns.checkUtmComplete = () => ({ amc: null, passed: false, reason: 'utm eksik' });
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, false);
});

test('runPolicyEngine: 7 kontrolden 6\'sı geçse bile approved=false (tek başarısızlık yeterli)', () => {
  const mock = makeOrderTrackingMock();
  mock.fns.checkCriticApproved = () => ({ amc: 'AMC-3', passed: false, reason: "critic_verdict='reject'" });
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, mock.fns, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, false);
  assert.strictEqual(result.results.filter((r) => r.passed).length, 6);
});

test('runPolicyEngine: checkFns verilmezse gerçek checks.js kullanılır (varsayılan)', () => {
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, undefined, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, true);
});

// ---- runPolicyEngine: gerçek checks.js ile uçtan uca entegrasyon ----
test('[entegrasyon] runPolicyEngine + gerçek checks.js: geçerli girdi approved=true', () => {
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, realChecks, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, true);
  assert.ok(result.results.every((r) => r.passed === true));
});

test('[entegrasyon] runPolicyEngine + gerçek checks.js: bütçe tavanı aşılırsa approved=false', () => {
  const overBudgetInput = { ...VALID_INPUT, daily_budget_try: 1900, active_total_budget_try: 200 };
  const result = runPolicyEngine(overBudgetInput, REAL_CONFIG, realChecks, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, false);
});

test('[entegrasyon] runPolicyEngine + gerçek checks.js: Critic reject verdict\'i tek başına reddettirir', () => {
  const rejectedInput = { ...VALID_INPUT, critic_verdict: 'reject' };
  const result = runPolicyEngine(rejectedInput, REAL_CONFIG, realChecks, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, false);
});

test('[entegrasyon] runPolicyEngine + gerçek checks.js: Critic approve dese bile checks.targeting_kvkk_risk=true reddeder (R-IG-19)', () => {
  const kvkkRiskInput = {
    ...VALID_INPUT,
    critic_checks: { ...VALID_INPUT.critic_checks, targeting_kvkk_risk: true },
  };
  const result = runPolicyEngine(kvkkRiskInput, REAL_CONFIG, realChecks, IG_PLATFORM_CONFIG);
  assert.strictEqual(result.approved, false);
});

test('[entegrasyon] runPolicyEngine + gerçek checks.js: platformConfig eksikse fail-closed reddeder [B18]', () => {
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, realChecks, null);
  assert.strictEqual(result.approved, false);
});

test('[entegrasyon] runPolicyEngine + gerçek checks.js: yanlış placementValue içeren platformConfig reddeder [B18]', () => {
  const wrongConfig = { ...IG_PLATFORM_CONFIG, placementValue: 'facebook_only' };
  const result = runPolicyEngine(VALID_INPUT, REAL_CONFIG, realChecks, wrongConfig);
  assert.strictEqual(result.approved, false);
});

console.log(`\n${passed} geçti, ${failed} başarısız (toplam ${passed + failed})`);
if (failed > 0) process.exitCode = 1;
