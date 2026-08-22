// audit-log/auditLog.test.js
// Amaç:    auditLog.js'teki fonksiyonların geçerli/sınır/aşım/null
//          senaryolarıyla doğrulanması (IG-ADS-MODULE/checks.test.js ve
//          auditLog.test.js ile aynı desen — assert + custom runner,
//          harici test framework yok).
// Bağlı:   auditLog.js (test edilen dosya).
// AMC:     AMC-6.

const assert = require('assert');
const {
  computeRecordHash,
  resolvePreviousHash,
  checkRequiredAuditFields,
  buildAuditRecord,
  insertAuditRecord,
  runAuditLogNode,
} = require('./auditLog');

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name} — ${err.message}`);
    failed++;
  }
}

const baseInput = {
  decisionId: 'd1',
  decisionType: 'review_reply',
  triggerSource: 'google_review',
  quarantineAnalysis: { crisis_flag: false },
  crisisFlag: false,
  executorOutput: { text: 'draft' },
  criticVerdict: { verdict: 'approve' },
  policyDecision: { policy_decision: 'ALLOW' },
  finalOutcome: 'AUTO_APPLIED',
};

(async () => {
  // ---- computeRecordHash ----
  test('computeRecordHash: aynı girdi → aynı hash (deterministik)', () => {
    const input = { decisionId: 'd1', decisionType: 'x', triggerSource: 'y', quarantineAnalysis: {}, crisisFlag: false, executorOutput: {}, criticVerdict: {}, policyDecision: {}, finalOutcome: 'AUTO_APPLIED', previousHash: 'GENESIS' };
    assert.strictEqual(computeRecordHash(input), computeRecordHash(input));
  });
  test('computeRecordHash: farklı decisionId → farklı hash', () => {
    const h1 = computeRecordHash({ ...baseInput, previousHash: 'GENESIS' });
    const h2 = computeRecordHash({ ...baseInput, decisionId: 'd2', previousHash: 'GENESIS' });
    assert.notStrictEqual(h1, h2);
  });
  test('computeRecordHash: farklı previousHash → farklı hash (zincir kırılırsa tespit edilebilir)', () => {
    const h1 = computeRecordHash({ ...baseInput, previousHash: 'GENESIS' });
    const h2 = computeRecordHash({ ...baseInput, previousHash: 'abc123' });
    assert.notStrictEqual(h1, h2);
  });

  // ---- resolvePreviousHash ----
  await testAsync('resolvePreviousHash: ilk kayıt (null döner) → GENESIS', async () => {
    const dbClient = { getLastRecordHash: async () => null };
    const r = await resolvePreviousHash(dbClient);
    assert.strictEqual(r.previousHash, 'GENESIS');
    assert.strictEqual(r.chainBroken, false);
  });
  await testAsync('resolvePreviousHash: önceki hash var → onu döner', async () => {
    const dbClient = { getLastRecordHash: async () => 'prevhash123' };
    const r = await resolvePreviousHash(dbClient);
    assert.strictEqual(r.previousHash, 'prevhash123');
    assert.strictEqual(r.chainBroken, false);
  });
  await testAsync('resolvePreviousHash: dbClient enjekte edilmemiş → CHAIN_LOOKUP_FAILED + chainBroken', async () => {
    const r = await resolvePreviousHash(null);
    assert.strictEqual(r.previousHash, 'CHAIN_LOOKUP_FAILED');
    assert.strictEqual(r.chainBroken, true);
  });
  await testAsync('resolvePreviousHash: dbClient hata fırlatır → CHAIN_LOOKUP_FAILED + chainBroken (AMC-6 fail-closed ama kayıt yazılmaya devam)', async () => {
    const dbClient = { getLastRecordHash: async () => { throw new Error('DB down'); } };
    const r = await resolvePreviousHash(dbClient);
    assert.strictEqual(r.previousHash, 'CHAIN_LOOKUP_FAILED');
    assert.strictEqual(r.chainBroken, true);
  });

  // ---- checkRequiredAuditFields ----
  test('checkRequiredAuditFields: tam girdi → passed', () => {
    assert.strictEqual(checkRequiredAuditFields(baseInput).passed, true);
  });
  test('checkRequiredAuditFields: decisionId eksik → reddedilir', () => {
    const r = checkRequiredAuditFields({ ...baseInput, decisionId: undefined });
    assert.strictEqual(r.passed, false);
  });
  test('checkRequiredAuditFields: policyDecision null → reddedilir (CORE.md §4 — hiçbir zaman NULL olamaz)', () => {
    const r = checkRequiredAuditFields({ ...baseInput, policyDecision: null });
    assert.strictEqual(r.passed, false);
  });
  test('checkRequiredAuditFields: geçersiz finalOutcome → reddedilir', () => {
    const r = checkRequiredAuditFields({ ...baseInput, finalOutcome: 'MAYBE' });
    assert.strictEqual(r.passed, false);
  });
  test('checkRequiredAuditFields: executorOutput/criticVerdict eksik ama crisis dalı → yine de passed (şarta bağlı NULL)', () => {
    const r = checkRequiredAuditFields({ ...baseInput, executorOutput: undefined, criticVerdict: undefined, finalOutcome: 'HUMAN_QUEUE' });
    assert.strictEqual(r.passed, true);
  });

  // ---- buildAuditRecord ----
  test('buildAuditRecord: geçerli girdi → record üretir, hash/previous_hash/chain_broken dolu', () => {
    const { record, error } = buildAuditRecord({ ...baseInput, previousHash: 'GENESIS', chainBroken: false });
    assert.strictEqual(error, null);
    assert.strictEqual(record.decision_id, 'd1');
    assert.strictEqual(record.previous_hash, 'GENESIS');
    assert.strictEqual(record.chain_broken, false);
    assert.strictEqual(typeof record.record_hash, 'string');
  });
  test('buildAuditRecord: zorunlu alan eksik → record null + error dolu (fail-closed)', () => {
    const { record, error } = buildAuditRecord({ ...baseInput, decisionType: undefined });
    assert.strictEqual(record, null);
    assert.ok(error.includes('decisionType'));
  });
  test('buildAuditRecord: chainBroken=true taşınır (AMC-6 — sessizce geçilmez)', () => {
    const { record } = buildAuditRecord({ ...baseInput, previousHash: 'CHAIN_LOOKUP_FAILED', chainBroken: true });
    assert.strictEqual(record.chain_broken, true);
  });
  test('buildAuditRecord: previousHash verilmezse CHAIN_LOOKUP_FAILED\'e düşer', () => {
    const { record } = buildAuditRecord({ ...baseInput });
    assert.strictEqual(record.previous_hash, 'CHAIN_LOOKUP_FAILED');
  });

  // ---- insertAuditRecord ----
  await testAsync('insertAuditRecord: record null → criticalEscalation true (fail-closed)', async () => {
    const r = await insertAuditRecord(null, { insert: async () => {} });
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('insertAuditRecord: dbClient enjekte edilmemiş → criticalEscalation true', async () => {
    const r = await insertAuditRecord({ decision_id: 'd1' }, null);
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('insertAuditRecord: insert başarılı → inserted true', async () => {
    const r = await insertAuditRecord({ decision_id: 'd1' }, { insert: async () => {} });
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.criticalEscalation, false);
  });
  await testAsync('insertAuditRecord: insert hata fırlatır → criticalEscalation true, sessizce yutulmaz', async () => {
    const r = await insertAuditRecord({ decision_id: 'd1' }, { insert: async () => { throw new Error('conn lost'); } });
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
    assert.ok(r.error.includes('conn lost'));
  });

  // ---- runAuditLogNode (uçtan uca) ----
  await testAsync('runAuditLogNode: ilk kayıt (GENESIS) + başarılı insert → inserted true, criticalEscalation false', async () => {
    let stored = null;
    const dbClient = { getLastRecordHash: async () => null, insert: async (rec) => { stored = rec; } };
    const r = await runAuditLogNode(baseInput, dbClient);
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.criticalEscalation, false);
    assert.strictEqual(stored.previous_hash, 'GENESIS');
  });
  await testAsync('runAuditLogNode: previous_hash lookup başarısız olsa bile kayıt YİNE DE yazılır, criticalEscalation true (AMC-6)', async () => {
    let stored = null;
    const dbClient = { getLastRecordHash: async () => { throw new Error('DB down'); }, insert: async (rec) => { stored = rec; } };
    const r = await runAuditLogNode(baseInput, dbClient);
    assert.strictEqual(r.inserted, true, 'AMC-6: kayıt kaybı zincir kırılmasından daha kötü, yine de yazılmalı');
    assert.strictEqual(r.criticalEscalation, true);
    assert.strictEqual(stored.chain_broken, true);
  });
  await testAsync('runAuditLogNode: zorunlu alan eksik → hiç yazılmaz, criticalEscalation true', async () => {
    const dbClient = { getLastRecordHash: async () => null, insert: async () => { throw new Error('yazılmamalıydı'); } };
    const r = await runAuditLogNode({ ...baseInput, policyDecision: null }, dbClient);
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('runAuditLogNode: DB insert hatası → criticalEscalation true (sessizce yutulmaz)', async () => {
    const dbClient = { getLastRecordHash: async () => null, insert: async () => { throw new Error('yazma hatası'); } };
    const r = await runAuditLogNode(baseInput, dbClient);
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('runAuditLogNode: crisis dalı (executorOutput/criticVerdict null, HUMAN_QUEUE) → yine de yazılır', async () => {
    const dbClient = { getLastRecordHash: async () => 'prev', insert: async () => {} };
    const r = await runAuditLogNode({
      ...baseInput, executorOutput: null, criticVerdict: null, finalOutcome: 'HUMAN_QUEUE',
    }, dbClient);
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.criticalEscalation, false);
  });

  console.log(`\n${passed} geçti, ${failed} başarısız`);
  process.exit(failed > 0 ? 1 : 0);
})();
