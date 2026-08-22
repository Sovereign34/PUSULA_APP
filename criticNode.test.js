// critic/criticNode.test.js
// Amaç:    criticNode.js'teki fonksiyonların birim testleri — TEST_MATRIX.md'ye
//          işlenecek (checkpoint sonrası).
// Bağlı:   criticNode.js
// AMC:     AMC-3 (Critic onayı olmadan Policy Engine'e geçilmez)
// Risk:    Bu dosya geçmeden gerçek n8n'e deploy edilmez (AGENT.md Kural 8).

const assert = require('assert');
const {
  buildCriticPrompt,
  callCriticModel,
  parseCriticOutput,
  validateCriticOutput,
  runCriticNode,
} = require('./criticNode');

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

const VALID_EXECUTOR_OUTPUT = {
  decision_id: '11111111-1111-4111-8111-111111111111',
  decision_type: 'ig_campaign_brief',
  executor_model: 'claude-sonnet-5',
  campaign_brief: {
    objective: 'TRAFFIC',
    daily_budget_try: 500,
    duration_days: 7,
    targeting: { age_min: 18, age_max: 45, locations: ['Çağlayan'], interests: ['sağlıklı beslenme'] },
    placement: 'instagram_only',
    creative_brief: { caption_draft: 'Yeni bowl menümüzü keşfet', visual_direction: 'renkli, doğal ışık' },
    utm: { source: 'instagram', medium: 'paid', campaign: 'yaz_lansman', content: 'bowl_v1' },
  },
  reasoning_summary: 'Hafta sonu trafiğini artırmak için hedeflenen kampanya',
  confidence: 0.82,
  requires_critic: true,
};

const VALID_CRITIC_OUTPUT_STR = JSON.stringify({
  critic_verdict: 'approve',
  critic_model: 'gpt-5',
  checks: {
    budget_target_coherence: true,
    targeting_kvkk_risk: false,
    forbidden_phrase_in_caption: false,
    objective_placement_mismatch: false,
    utm_format_valid: true,
  },
  notes: 'Brief tutarlı, risk yok',
});

(async () => {
  // ---- buildCriticPrompt ----
  test('buildCriticPrompt: objective prompt\'a giriyor', () => {
    const p = buildCriticPrompt(VALID_EXECUTOR_OUTPUT);
    assert.ok(p.includes('TRAFFIC'));
  });
  test('buildCriticPrompt: caption_draft prompt\'a giriyor', () => {
    const p = buildCriticPrompt(VALID_EXECUTOR_OUTPUT);
    assert.ok(p.includes('Yeni bowl menümüzü keşfet'));
  });

  // ---- callCriticModel ----
  test('callCriticModel: geçerli client', () => {
    const r = callCriticModel('prompt', { complete: () => VALID_CRITIC_OUTPUT_STR });
    assert.strictEqual(r.success, true);
  });
  test('callCriticModel: llmClient yok (fail-closed)', () => {
    const r = callCriticModel('prompt', null);
    assert.strictEqual(r.success, false);
  });
  test('callCriticModel: complete() fonksiyonu yok', () => {
    const r = callCriticModel('prompt', {});
    assert.strictEqual(r.success, false);
  });
  test('callCriticModel: boş yanıt', () => {
    const r = callCriticModel('prompt', { complete: () => '' });
    assert.strictEqual(r.success, false);
  });
  test('callCriticModel: client hata atarsa (fail-closed)', () => {
    const r = callCriticModel('prompt', { complete: () => { throw new Error('timeout'); } });
    assert.strictEqual(r.success, false);
  });

  // ---- parseCriticOutput ----
  test('parseCriticOutput: geçerli JSON', () => {
    const r = parseCriticOutput(VALID_CRITIC_OUTPUT_STR);
    assert.strictEqual(r.success, true);
  });
  test('parseCriticOutput: bozuk JSON', () => {
    const r = parseCriticOutput('{not json');
    assert.strictEqual(r.success, false);
  });
  test('parseCriticOutput: boş string', () => {
    const r = parseCriticOutput('');
    assert.strictEqual(r.success, false);
  });

  // ---- validateCriticOutput ----
  test('validateCriticOutput: geçerli tam çıktı', () => {
    const errors = validateCriticOutput(JSON.parse(VALID_CRITIC_OUTPUT_STR));
    assert.strictEqual(errors.length, 0);
  });
  test('validateCriticOutput: null', () => {
    const errors = validateCriticOutput(null);
    assert.ok(errors.length > 0);
  });
  test('validateCriticOutput: geçersiz critic_verdict', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), critic_verdict: 'maybe' };
    const errors = validateCriticOutput(o);
    assert.ok(errors.some((e) => e.includes('critic_verdict')));
  });
  test('validateCriticOutput: critic_verdict "reject" geçerli', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), critic_verdict: 'reject' };
    const errors = validateCriticOutput(o);
    assert.strictEqual(errors.length, 0);
  });
  test('validateCriticOutput: critic_verdict "request_revision" geçerli', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), critic_verdict: 'request_revision' };
    const errors = validateCriticOutput(o);
    assert.strictEqual(errors.length, 0);
  });
  test('validateCriticOutput: critic_model boş string', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), critic_model: '' };
    const errors = validateCriticOutput(o);
    assert.ok(errors.some((e) => e.includes('critic_model')));
  });
  test('validateCriticOutput: checks obje değil', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), checks: null };
    const errors = validateCriticOutput(o);
    assert.ok(errors.some((e) => e.includes('checks obje')));
  });
  for (const field of [
    'budget_target_coherence',
    'targeting_kvkk_risk',
    'forbidden_phrase_in_caption',
    'objective_placement_mismatch',
    'utm_format_valid',
  ]) {
    test(`validateCriticOutput: checks.${field} boolean değil`, () => {
      const o = JSON.parse(VALID_CRITIC_OUTPUT_STR);
      o.checks[field] = 'evet';
      const errors = validateCriticOutput(o);
      assert.ok(errors.some((e) => e.includes(field)));
    });
  }
  test('validateCriticOutput: notes string değil', () => {
    const o = { ...JSON.parse(VALID_CRITIC_OUTPUT_STR), notes: 42 };
    const errors = validateCriticOutput(o);
    assert.ok(errors.some((e) => e.includes('notes')));
  });

  // ---- runCriticNode (koordinasyon) ----
  test('runCriticNode: geçerli akış', () => {
    const r = runCriticNode(VALID_EXECUTOR_OUTPUT, { complete: () => VALID_CRITIC_OUTPUT_STR });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.output.critic_verdict, 'approve');
  });
  test('runCriticNode: model çağrısı çökerse (fail-closed)', () => {
    const r = runCriticNode(VALID_EXECUTOR_OUTPUT, null);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.stage, 'model_call');
  });
  test('runCriticNode: bozuk JSON (fail-closed)', () => {
    const r = runCriticNode(VALID_EXECUTOR_OUTPUT, { complete: () => '{not json' });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.stage, 'parse');
  });
  test('runCriticNode: şema ihlali (fail-closed)', () => {
    const r = runCriticNode(VALID_EXECUTOR_OUTPUT, { complete: () => JSON.stringify({ critic_verdict: 'approve' }) });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.stage, 'validation');
  });
  test('runCriticNode: reject verdict de başarıyla dönüyor (Policy Engine karar versin)', () => {
    const rejectOutput = JSON.parse(VALID_CRITIC_OUTPUT_STR);
    rejectOutput.critic_verdict = 'reject';
    const r = runCriticNode(VALID_EXECUTOR_OUTPUT, { complete: () => JSON.stringify(rejectOutput) });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.output.critic_verdict, 'reject');
  });

  console.log(`\n${passed} geçti, ${failed} başarısız (toplam ${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
})();
