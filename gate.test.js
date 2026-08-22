// execution-gate/gate.test.js
// Amaç:    gate.js'teki 6 fonksiyonun her biri için geçerli/sınır/aşım/null
//          senaryolarını test eder — checks.test.js ile aynı disiplin (AGENT.md
//          KOD KALİTESİ KURALLARI madde 6).
// Bağlı:   execution-gate/gate.js — gate.js'e yeni fonksiyon eklenirse burada
//          da test satırı eklenmeli.
// AMC:     Test dosyası — kendisi bir AMC kontrolü değil, gate.js'teki AMC-3/
//          AMC-4/AMC-5/AMC-9 kontrollerinin doğruluğunu doğrular.
// Risk:    Bu dosya atlanırsa/eksik kalırsa, gate.js'teki hatalı bir kontrol
//          fark edilmeden production'a sızabilir — gerçek para riski.
// Dokunma: Değiştirmeden önce gate.js'in güncel fonksiyon imzalarına bakılmalı.

const assert = require('assert');
const {
  checkPolicyEngineApproved,
  checkDecisionIdMatch,
  checkIdempotency,
  computePolicyHash,
  buildExecutionToken,
  runExecutionGate,
} = require('./gate');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    passCount++;
    console.log(`✅ ${name}`);
  } catch (err) {
    failCount++;
    console.error(`❌ ${name}\n   ${err.message}`);
  }
}

// ── checkPolicyEngineApproved (AMC-3) ──────────────────────────────
test('checkPolicyEngineApproved: approved=true → passed', () => {
  const r = checkPolicyEngineApproved({ approved: true });
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.amc, 'AMC-3');
});

test('checkPolicyEngineApproved: approved=false → reddedilir', () => {
  const r = checkPolicyEngineApproved({ approved: false });
  assert.strictEqual(r.passed, false);
});

test('checkPolicyEngineApproved: null girdi → reddedilir', () => {
  const r = checkPolicyEngineApproved(null);
  assert.strictEqual(r.passed, false);
});

test('checkPolicyEngineApproved: approved alanı eksik → reddedilir', () => {
  const r = checkPolicyEngineApproved({});
  assert.strictEqual(r.passed, false);
});

// ── checkDecisionIdMatch (AMC-4) ───────────────────────────────────
test('checkDecisionIdMatch: eşleşen decision_id → passed', () => {
  const r = checkDecisionIdMatch({ decision_id: 'abc' }, { decision_id: 'abc' });
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.amc, 'AMC-4');
});

test('checkDecisionIdMatch: uyuşmayan decision_id → reddedilir', () => {
  const r = checkDecisionIdMatch({ decision_id: 'abc' }, { decision_id: 'xyz' });
  assert.strictEqual(r.passed, false);
});

test('checkDecisionIdMatch: envelope null → reddedilir', () => {
  const r = checkDecisionIdMatch(null, { decision_id: 'abc' });
  assert.strictEqual(r.passed, false);
});

test('checkDecisionIdMatch: policyEngineResult null → reddedilir', () => {
  const r = checkDecisionIdMatch({ decision_id: 'abc' }, null);
  assert.strictEqual(r.passed, false);
});

// ── checkIdempotency (AMC-5) ───────────────────────────────────────
test('checkIdempotency: audit log kaydı yok → passed', () => {
  const lookup = () => false;
  const r = checkIdempotency('decision-1', lookup);
  assert.strictEqual(r.passed, true);
  assert.strictEqual(r.amc, 'AMC-5');
});

test('checkIdempotency: audit log kaydı zaten var → reddedilir', () => {
  const lookup = () => true;
  const r = checkIdempotency('decision-1', lookup);
  assert.strictEqual(r.passed, false);
});

test('checkIdempotency: lookup fonksiyonu enjekte edilmemiş (undefined) → reddedilir (fail-safe)', () => {
  const r = checkIdempotency('decision-1', undefined);
  assert.strictEqual(r.passed, false);
});

test('checkIdempotency: lookup doğru decision_id ile çağrılıyor', () => {
  let receivedId = null;
  const lookup = (id) => { receivedId = id; return false; };
  checkIdempotency('decision-42', lookup);
  assert.strictEqual(receivedId, 'decision-42');
});

// ── computePolicyHash (AMC-9) ──────────────────────────────────────
test('computePolicyHash: aynı girdi → aynı hash (deterministik)', () => {
  const h1 = computePolicyHash('config-content-v1', 'policy-engine-v1.7');
  const h2 = computePolicyHash('config-content-v1', 'policy-engine-v1.7');
  assert.strictEqual(h1, h2);
});

test('computePolicyHash: config içeriği değişirse hash değişir', () => {
  const h1 = computePolicyHash('config-a', 'v1.7');
  const h2 = computePolicyHash('config-b', 'v1.7');
  assert.notStrictEqual(h1, h2);
});

test('computePolicyHash: policy-engine versiyonu değişirse hash değişir', () => {
  const h1 = computePolicyHash('config-a', 'v1.7');
  const h2 = computePolicyHash('config-a', 'v1.8');
  assert.notStrictEqual(h1, h2);
});

test('computePolicyHash: 64 karakter hex string döner (sha256)', () => {
  const h = computePolicyHash('config-a', 'v1.7');
  assert.strictEqual(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});

// ── buildExecutionToken ────────────────────────────────────────────
test('buildExecutionToken: token alanları doğru dolduruluyor', () => {
  const envelope = { decision_id: 'decision-1', actor: 'user-1' };
  const nowFn = () => 1000;
  const token = buildExecutionToken(envelope, 'hash-abc', nowFn);
  assert.strictEqual(token.decision_id, 'decision-1');
  assert.strictEqual(token.actor, 'user-1');
  assert.strictEqual(token.policy_hash, 'hash-abc');
  assert.strictEqual(token.iat, 1000);
});

test('buildExecutionToken: TTL=60 saniye (60000ms) doğru hesaplanıyor', () => {
  const envelope = { decision_id: 'decision-1', actor: 'user-1' };
  const nowFn = () => 1000;
  const token = buildExecutionToken(envelope, 'hash-abc', nowFn);
  assert.strictEqual(token.expiration, 1000 + 60000);
});

test('buildExecutionToken: nowFn verilmezse gerçek Date.now kullanılır', () => {
  const envelope = { decision_id: 'decision-1', actor: 'user-1' };
  const before = Date.now();
  const token = buildExecutionToken(envelope, 'hash-abc');
  const after = Date.now();
  assert.ok(token.iat >= before && token.iat <= after);
});

// ── runExecutionGate (koordinasyon) ────────────────────────────────
test('runExecutionGate: tüm kontroller geçerse authorized=true ve token üretilir', () => {
  const envelope = { decision_id: 'd-1', actor: 'user-1' };
  const policyResult = { decision_id: 'd-1', approved: true };
  const deps = {
    auditLogLookupFn: () => false,
    configContent: 'config-content',
    policyEngineVersion: 'v1.7',
    nowFn: () => 5000,
  };
  const result = runExecutionGate(envelope, policyResult, deps);
  assert.strictEqual(result.authorized, true);
  assert.strictEqual(result.decision_id, 'd-1');
  assert.ok(result.token);
  assert.strictEqual(result.token.expiration, 5000 + 60000);
  assert.strictEqual(result.results.length, 3);
});

test('runExecutionGate: Policy Engine reddettiyse token üretilmez', () => {
  const envelope = { decision_id: 'd-1', actor: 'user-1' };
  const policyResult = { decision_id: 'd-1', approved: false };
  const deps = { auditLogLookupFn: () => false, configContent: 'c', policyEngineVersion: 'v1', nowFn: () => 1 };
  const result = runExecutionGate(envelope, policyResult, deps);
  assert.strictEqual(result.authorized, false);
  assert.strictEqual(result.token, null);
});

test('runExecutionGate: decision_id uyuşmazsa token üretilmez', () => {
  const envelope = { decision_id: 'd-1', actor: 'user-1' };
  const policyResult = { decision_id: 'd-2', approved: true };
  const deps = { auditLogLookupFn: () => false, configContent: 'c', policyEngineVersion: 'v1', nowFn: () => 1 };
  const result = runExecutionGate(envelope, policyResult, deps);
  assert.strictEqual(result.authorized, false);
  assert.strictEqual(result.token, null);
});

test('runExecutionGate: idempotency çakışması varsa token üretilmez (duplicate önleme)', () => {
  const envelope = { decision_id: 'd-1', actor: 'user-1' };
  const policyResult = { decision_id: 'd-1', approved: true };
  const deps = { auditLogLookupFn: () => true, configContent: 'c', policyEngineVersion: 'v1', nowFn: () => 1 };
  const result = runExecutionGate(envelope, policyResult, deps);
  assert.strictEqual(result.authorized, false);
  assert.strictEqual(result.token, null);
  const idempotencyResult = result.results.find((r) => r.amc === 'AMC-5');
  assert.strictEqual(idempotencyResult.passed, false);
});

test('runExecutionGate: reddedilse bile results dizisi tüm kontrolleri gösterir (audit için)', () => {
  const envelope = { decision_id: 'd-1', actor: 'user-1' };
  const policyResult = { decision_id: 'd-1', approved: false };
  const deps = { auditLogLookupFn: () => false, configContent: 'c', policyEngineVersion: 'v1', nowFn: () => 1 };
  const result = runExecutionGate(envelope, policyResult, deps);
  assert.strictEqual(result.results.length, 3);
});

console.log(`\n${passCount}/${passCount + failCount} test geçti.`);
if (failCount > 0) process.exit(1);
