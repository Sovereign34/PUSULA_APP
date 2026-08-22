// core/validation/envelopeBuilder.test.js
// checks.test.js / gate.test.js ile aynı desen: plain Node assert, `node`
// ile doğrudan çalıştırılabilir (test framework bağımlılığı yok).

const assert = require('assert');
const {
  computeInputContextHash,
  checkRequiredEnvelopeFields,
  buildDecisionEnvelope,
  runEnvelopeBuilderNode,
} = require('./envelopeBuilder');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  - ${name}`);
    console.log(`        ${err.message}`);
  }
}

const validTriggerRequest = {
  campaign_brief_request: {
    trigger_source: 'manual',
    objective_hint: 'hafta sonu trafiği',
    target_window: { start_date: '2026-08-20', end_date: '2026-08-27' },
    requested_by: 'omer',
  },
};

const validExecutorOutput = {
  decision_id: 'a1b2c3d4-e5f6-4789-8abc-def012345678',
  decision_type: 'ig_campaign_brief',
  executor_model: 'claude-sonnet-5',
  campaign_brief: {
    objective: 'TRAFFIC',
    daily_budget_try: 500,
    duration_days: 7,
    targeting: { age_min: 18, age_max: 45, locations: ['TR'], interests: [] },
    placement: 'instagram_only',
    creative_brief: { caption_draft: 'draft', visual_direction: 'direction' },
    utm: { source: 'instagram', medium: 'paid', campaign: 'c1', content: 'v1' },
  },
  reasoning_summary: 'ok',
  confidence: 0.8,
  requires_critic: true,
};

// --- computeInputContextHash ---

test('computeInputContextHash: aynı girdi -> aynı hash (deterministik)', () => {
  const h1 = computeInputContextHash(validTriggerRequest);
  const h2 = computeInputContextHash(JSON.parse(JSON.stringify(validTriggerRequest)));
  assert.strictEqual(h1, h2);
  assert.strictEqual(h1.length, 64); // sha256 hex
});

test('computeInputContextHash: farklı girdi -> farklı hash', () => {
  const other = JSON.parse(JSON.stringify(validTriggerRequest));
  other.campaign_brief_request.requested_by = 'baska_kullanici';
  assert.notStrictEqual(computeInputContextHash(validTriggerRequest), computeInputContextHash(other));
});

test('computeInputContextHash: anahtar sırası (iç içe dahil) hash sonucunu değiştirmez', () => {
  const reordered = {
    campaign_brief_request: {
      requested_by: validTriggerRequest.campaign_brief_request.requested_by,
      target_window: validTriggerRequest.campaign_brief_request.target_window,
      objective_hint: validTriggerRequest.campaign_brief_request.objective_hint,
      trigger_source: validTriggerRequest.campaign_brief_request.trigger_source,
    },
  };
  assert.strictEqual(computeInputContextHash(validTriggerRequest), computeInputContextHash(reordered));
});

test('computeInputContextHash: iç içe alan değişikliği ASLA sessizce yutulmaz (regresyon — eski array-replacer bug)', () => {
  const modified = JSON.parse(JSON.stringify(validTriggerRequest));
  modified.campaign_brief_request.objective_hint = 'tamamen farklı bir hedef';
  assert.notStrictEqual(computeInputContextHash(validTriggerRequest), computeInputContextHash(modified));
});

// --- checkRequiredEnvelopeFields ---

test('checkRequiredEnvelopeFields: geçerli envelope geçer', () => {
  const envelope = { decision_id: validExecutorOutput.decision_id, actor: 'omer', input_context_hash: 'x'.repeat(64) };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, true);
  assert.deepStrictEqual(result.errors, []);
});

test('checkRequiredEnvelopeFields: decision_id eksik reddedilir', () => {
  const envelope = { actor: 'omer', input_context_hash: 'x'.repeat(64) };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('decision_id')));
});

test('checkRequiredEnvelopeFields: decision_id UUIDv4 formatında değilse reddedilir', () => {
  const envelope = { decision_id: 'not-a-uuid', actor: 'omer', input_context_hash: 'x'.repeat(64) };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, false);
});

test('checkRequiredEnvelopeFields: actor eksik reddedilir', () => {
  const envelope = { decision_id: validExecutorOutput.decision_id, input_context_hash: 'x'.repeat(64) };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('actor')));
});

test('checkRequiredEnvelopeFields: actor boş string ise reddedilir', () => {
  const envelope = { decision_id: validExecutorOutput.decision_id, actor: '   ', input_context_hash: 'x'.repeat(64) };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, false);
});

test('checkRequiredEnvelopeFields: input_context_hash eksik reddedilir', () => {
  const envelope = { decision_id: validExecutorOutput.decision_id, actor: 'omer' };
  const result = checkRequiredEnvelopeFields(envelope);
  assert.strictEqual(result.passed, false);
  assert.ok(result.errors.some((e) => e.includes('input_context_hash')));
});

test('checkRequiredEnvelopeFields: null envelope reddedilir, çökmez', () => {
  const result = checkRequiredEnvelopeFields(null);
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.errors.length, 3);
});

// --- buildDecisionEnvelope ---

test('buildDecisionEnvelope: alanlar doğru eşleniyor', () => {
  const hash = computeInputContextHash(validTriggerRequest);
  const envelope = buildDecisionEnvelope(validTriggerRequest, validExecutorOutput, hash);
  assert.strictEqual(envelope.decision_id, validExecutorOutput.decision_id);
  assert.strictEqual(envelope.actor, 'omer');
  assert.strictEqual(envelope.input_context_hash, hash);
  assert.deepStrictEqual(envelope.campaign_brief, validExecutorOutput.campaign_brief);
});

test('buildDecisionEnvelope: audit.record_hash bilerek null', () => {
  const hash = computeInputContextHash(validTriggerRequest);
  const envelope = buildDecisionEnvelope(validTriggerRequest, validExecutorOutput, hash);
  assert.strictEqual(envelope.audit.record_hash, null);
});

test('buildDecisionEnvelope: learning_context Faz 5\'e ertelendiği için null', () => {
  const hash = computeInputContextHash(validTriggerRequest);
  const envelope = buildDecisionEnvelope(validTriggerRequest, validExecutorOutput, hash);
  assert.strictEqual(envelope.learning_context, null);
});

// --- runEnvelopeBuilderNode (koordinasyon) ---

test('runEnvelopeBuilderNode: geçerli girdiyle başarılı envelope üretir', () => {
  const result = runEnvelopeBuilderNode(validTriggerRequest, validExecutorOutput);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.envelope.decision_id, validExecutorOutput.decision_id);
});

test('runEnvelopeBuilderNode: geçersiz decision_id ile fail-closed', () => {
  const badOutput = { ...validExecutorOutput, decision_id: 'bozuk' };
  const result = runEnvelopeBuilderNode(validTriggerRequest, badOutput);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.stage, 'validation');
});

test('runEnvelopeBuilderNode: requested_by boşsa fail-closed (actor eksik)', () => {
  const badRequest = JSON.parse(JSON.stringify(validTriggerRequest));
  badRequest.campaign_brief_request.requested_by = '';
  const result = runEnvelopeBuilderNode(badRequest, validExecutorOutput);
  assert.strictEqual(result.success, false);
  assert.ok(result.errors.some((e) => e.includes('actor')));
});

test('runEnvelopeBuilderNode: campaign_brief değiştirilmeden taşınır', () => {
  const result = runEnvelopeBuilderNode(validTriggerRequest, validExecutorOutput);
  assert.deepStrictEqual(result.envelope.campaign_brief, validExecutorOutput.campaign_brief);
});

console.log(`\n${passed}/${passed + failed} test geçti`);
if (failed > 0) process.exit(1);
