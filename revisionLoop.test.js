// critic/revisionLoop.test.js
// checks.test.js / gate.test.js / envelopeBuilder.test.js ile aynı desen:
// plain Node assert, `node` ile doğrudan çalıştırılabilir.

const assert = require('assert');
const {
  checkRevisionAttemptsWithinLimit,
  buildRevisionId,
  buildParentRevisionId,
  determineNextStep,
  buildRevisionAuditRecord,
  runRevisionLoopNode,
} = require('./revisionLoop');

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

const decisionId = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
const executorOutput = { decision_id: decisionId, campaign_brief: { objective: 'TRAFFIC' } };
const approveOutput = { critic_verdict: 'approve', checks: {} };
const rejectOutput = { critic_verdict: 'reject', checks: {} };
const revisionOutput = { critic_verdict: 'request_revision', checks: {} };

// --- checkRevisionAttemptsWithinLimit ---

test('checkRevisionAttemptsWithinLimit: sınır içindeyken geçer', () => {
  const result = checkRevisionAttemptsWithinLimit(0, 3);
  assert.strictEqual(result.passed, true);
});

test('checkRevisionAttemptsWithinLimit: sınırın bir altı (son izinli deneme) geçer', () => {
  const result = checkRevisionAttemptsWithinLimit(2, 3);
  assert.strictEqual(result.passed, true);
});

test('checkRevisionAttemptsWithinLimit: sınıra ulaşınca reddedilir', () => {
  const result = checkRevisionAttemptsWithinLimit(3, 3);
  assert.strictEqual(result.passed, false);
});

test('checkRevisionAttemptsWithinLimit: maxRevisionAttempts enjekte edilmemişse fail-closed', () => {
  const result = checkRevisionAttemptsWithinLimit(0, undefined);
  assert.strictEqual(result.passed, false);
  assert.ok(result.reason.includes('enjekte edilmedi'));
});

test('checkRevisionAttemptsWithinLimit: maxRevisionAttempts 0 veya negatifse fail-closed', () => {
  assert.strictEqual(checkRevisionAttemptsWithinLimit(0, 0).passed, false);
  assert.strictEqual(checkRevisionAttemptsWithinLimit(0, -1).passed, false);
});

test('checkRevisionAttemptsWithinLimit: maxRevisionAttempts tamsayı değilse fail-closed', () => {
  const result = checkRevisionAttemptsWithinLimit(0, 2.5);
  assert.strictEqual(result.passed, false);
});

// --- buildRevisionId / buildParentRevisionId ---

test('buildRevisionId: deterministik format', () => {
  assert.strictEqual(buildRevisionId(decisionId, 0), `${decisionId}::rev0`);
  assert.strictEqual(buildRevisionId(decisionId, 2), `${decisionId}::rev2`);
});

test('buildParentRevisionId: ilk denemede (0) parent yok', () => {
  assert.strictEqual(buildParentRevisionId(decisionId, 0), null);
});

test('buildParentRevisionId: sonraki denemeler bir önceki denemeye zincirlenir', () => {
  assert.strictEqual(buildParentRevisionId(decisionId, 2), `${decisionId}::rev1`);
});

test('buildParentRevisionId: negatif attemptNumber null döner, çökmez', () => {
  assert.strictEqual(buildParentRevisionId(decisionId, -1), null);
});

// --- determineNextStep ---

test('determineNextStep: verdict approve ise NOT_APPLICABLE', () => {
  const limitCheck = checkRevisionAttemptsWithinLimit(0, 3);
  assert.strictEqual(determineNextStep('approve', limitCheck), 'NOT_APPLICABLE');
});

test('determineNextStep: verdict reject ise NOT_APPLICABLE', () => {
  const limitCheck = checkRevisionAttemptsWithinLimit(0, 3);
  assert.strictEqual(determineNextStep('reject', limitCheck), 'NOT_APPLICABLE');
});

test('determineNextStep: request_revision + sınır içinde -> RETRY_EXECUTOR', () => {
  const limitCheck = checkRevisionAttemptsWithinLimit(1, 3);
  assert.strictEqual(determineNextStep('request_revision', limitCheck), 'RETRY_EXECUTOR');
});

test('determineNextStep: request_revision + sınır aşıldı -> HUMAN_REVIEW', () => {
  const limitCheck = checkRevisionAttemptsWithinLimit(3, 3);
  assert.strictEqual(determineNextStep('request_revision', limitCheck), 'HUMAN_REVIEW');
});

// --- buildRevisionAuditRecord ---

test('buildRevisionAuditRecord: spec §8 gereken 5 alanı da içerir', () => {
  const record = buildRevisionAuditRecord(decisionId, 1, executorOutput, revisionOutput);
  assert.strictEqual(record.decision_id, decisionId);
  assert.strictEqual(record.revision_id, `${decisionId}::rev1`);
  assert.strictEqual(record.parent_revision_id, `${decisionId}::rev0`);
  assert.deepStrictEqual(record.executor_output, executorOutput);
  assert.deepStrictEqual(record.critic_output, revisionOutput);
});

// --- runRevisionLoopNode (koordinasyon) ---

test('runRevisionLoopNode: request_revision + sınır içinde -> RETRY_EXECUTOR', () => {
  const result = runRevisionLoopNode(decisionId, 0, executorOutput, revisionOutput, { maxRevisionAttempts: 3 });
  assert.strictEqual(result.next_step, 'RETRY_EXECUTOR');
  assert.strictEqual(result.limit_check.passed, true);
});

test('runRevisionLoopNode: sınır aşıldığında HUMAN_REVIEW', () => {
  const result = runRevisionLoopNode(decisionId, 3, executorOutput, revisionOutput, { maxRevisionAttempts: 3 });
  assert.strictEqual(result.next_step, 'HUMAN_REVIEW');
  assert.strictEqual(result.limit_check.passed, false);
});

test('runRevisionLoopNode: maxRevisionAttempts enjekte edilmemişse ilk denemede bile HUMAN_REVIEW (fail-closed)', () => {
  const result = runRevisionLoopNode(decisionId, 0, executorOutput, revisionOutput, {});
  assert.strictEqual(result.next_step, 'HUMAN_REVIEW');
});

test('runRevisionLoopNode: verdict approve ise sınırdan bağımsız NOT_APPLICABLE', () => {
  const result = runRevisionLoopNode(decisionId, 5, executorOutput, approveOutput, { maxRevisionAttempts: 3 });
  assert.strictEqual(result.next_step, 'NOT_APPLICABLE');
});

test('runRevisionLoopNode: verdict reject ise sınırdan bağımsız NOT_APPLICABLE', () => {
  const result = runRevisionLoopNode(decisionId, 0, executorOutput, rejectOutput, { maxRevisionAttempts: 3 });
  assert.strictEqual(result.next_step, 'NOT_APPLICABLE');
});

test('runRevisionLoopNode: audit_record her koşulda üretilir (HUMAN_REVIEW dahil)', () => {
  const result = runRevisionLoopNode(decisionId, 3, executorOutput, revisionOutput, { maxRevisionAttempts: 3 });
  assert.strictEqual(result.audit_record.decision_id, decisionId);
  assert.strictEqual(result.audit_record.revision_id, `${decisionId}::rev3`);
});

console.log(`\n${passed}/${passed + failed} test geçti`);
if (failed > 0) process.exit(1);
