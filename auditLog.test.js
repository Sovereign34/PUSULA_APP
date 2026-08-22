// audit-log/auditLog.test.js
// Amaç:    auditLog.js'teki 4 fonksiyonun birim testleri — TEST_MATRIX.md'ye
//          işlenecek (checkpoint sonrası).
// Bağlı:   auditLog.js
// AMC:     AMC-6
// Risk:    Bu dosya geçmeden gerçek n8n'e deploy edilmez (AGENT.md Kural 8).

const assert = require('assert');
const {
  computeRecordHash,
  resolvePreviousHash,
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

(async () => {
  // ---- computeRecordHash ----
  test('computeRecordHash: aynı girdi → aynı hash (deterministik)', () => {
    const input = { decisionId: 'd1', campaignBrief: { a: 1 }, criticVerdict: {}, policyEngineResult: {}, metaApiResponse: {} };
    assert.strictEqual(computeRecordHash(input), computeRecordHash(input));
  });
  test('computeRecordHash: farklı girdi → farklı hash', () => {
    const h1 = computeRecordHash({ decisionId: 'd1', campaignBrief: {}, criticVerdict: {}, policyEngineResult: {}, metaApiResponse: {} });
    const h2 = computeRecordHash({ decisionId: 'd2', campaignBrief: {}, criticVerdict: {}, policyEngineResult: {}, metaApiResponse: {} });
    assert.notStrictEqual(h1, h2);
  });

  // ---- buildAuditRecord ----
  test('buildAuditRecord: geçerli input → record + record_hash dolu', () => {
    const { record, error } = buildAuditRecord({
      decisionId: 'd1', actor: 'executor-v1', inputContextHash: 'ich1',
      campaignBrief: { name: 'T' }, metaApiResponse: { id: '123' },
    }, '2026-08-16T00:00:00Z');
    assert.strictEqual(error, null);
    assert.strictEqual(record.decision_id, 'd1');
    assert.ok(record.audit.record_hash);
    assert.strictEqual(record.created_at, '2026-08-16T00:00:00Z');
  });
  test('buildAuditRecord: eksik alan yoksa varsayılan human_final_approval/ai_disclosure_applied atanır', () => {
    const { record } = buildAuditRecord({ decisionId: 'd1', actor: 'a', inputContextHash: 'ich' });
    assert.deepStrictEqual(record.human_final_approval, { approved: false, timestamp: null });
    assert.strictEqual(record.ai_disclosure_applied, false);
  });
  test('buildAuditRecord: actor eksikse reddedilir (fail-closed)', () => {
    const { error } = buildAuditRecord({ decisionId: 'd1', inputContextHash: 'ich' });
    assert.ok(error);
  });
  test('buildAuditRecord: inputContextHash eksikse reddedilir', () => {
    const { error } = buildAuditRecord({ decisionId: 'd1', actor: 'a' });
    assert.ok(error);
  });
  test('buildAuditRecord: null input reddedilir', () => {
    const { error } = buildAuditRecord(null);
    assert.ok(error);
  });

  // ---- insertAuditRecord ----
  await testAsync('insertAuditRecord: başarılı yazma', async () => {
    const r = await insertAuditRecord({ decision_id: 'd1' }, { insert: async () => {} });
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.criticalEscalation, false);
  });
  await testAsync('insertAuditRecord: DB hatası → criticalEscalation true (sessizce yutulmaz)', async () => {
    const r = await insertAuditRecord({ decision_id: 'd1' }, { insert: async () => { throw new Error('conn refused'); } });
    assert.strictEqual(r.inserted, false);
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('insertAuditRecord: null record → criticalEscalation true', async () => {
    const r = await insertAuditRecord(null, { insert: async () => {} });
    assert.strictEqual(r.criticalEscalation, true);
  });

  // ---- runAuditLogNode (koordinasyon) ----
  await testAsync('runAuditLogNode: geçerli input uçtan uca yazılır', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd1', actor: 'a', inputContextHash: 'ich', metaApiResponse: { id: '123' } },
      { insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(inserted.decision_id, 'd1');
  });
  await testAsync('runAuditLogNode: build hatası DB\'ye hiç gitmez ama criticalEscalation true döner', async () => {
    let called = false;
    const r = await runAuditLogNode(
      { decisionId: 'd1' }, // actor/inputContextHash eksik
      { insert: async () => { called = true; } },
    );
    assert.strictEqual(r.criticalEscalation, true);
    assert.strictEqual(called, false);
  });
  await testAsync('runAuditLogNode: Meta API başarısız olsa bile audit YAZILIR (AMC-6)', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd1', actor: 'a', inputContextHash: 'ich', metaApiResponse: { error: '4xx' } },
      { insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.deepStrictEqual(inserted.meta_api_response, { error: '4xx' });
  });

  // ---- computeRecordHash (previousHash dahil, R-IG-22) ----
  test('computeRecordHash: farklı previousHash → farklı hash (aynı içerik olsa bile)', () => {
    const base = { decisionId: 'd1', campaignBrief: {}, criticVerdict: {}, policyEngineResult: {}, metaApiResponse: {} };
    const h1 = computeRecordHash({ ...base, previousHash: 'GENESIS' });
    const h2 = computeRecordHash({ ...base, previousHash: 'someHash123' });
    assert.notStrictEqual(h1, h2);
  });

  // ---- resolvePreviousHash (R-IG-22) ----
  await testAsync('resolvePreviousHash: hiç kayıt yoksa (null döner) → GENESIS, chainBroken false', async () => {
    const r = await resolvePreviousHash({ getLastRecordHash: async () => null });
    assert.strictEqual(r.previousHash, 'GENESIS');
    assert.strictEqual(r.chainBroken, false);
  });
  await testAsync('resolvePreviousHash: önceki kayıt varsa → onun hash\'i, chainBroken false', async () => {
    const r = await resolvePreviousHash({ getLastRecordHash: async () => 'abc123' });
    assert.strictEqual(r.previousHash, 'abc123');
    assert.strictEqual(r.chainBroken, false);
  });
  await testAsync('resolvePreviousHash: lookup fonksiyonu yoksa → CHAIN_LOOKUP_FAILED, chainBroken true (fail-closed)', async () => {
    const r = await resolvePreviousHash({});
    assert.strictEqual(r.previousHash, 'CHAIN_LOOKUP_FAILED');
    assert.strictEqual(r.chainBroken, true);
  });
  await testAsync('resolvePreviousHash: dbClient null → CHAIN_LOOKUP_FAILED, chainBroken true', async () => {
    const r = await resolvePreviousHash(null);
    assert.strictEqual(r.chainBroken, true);
  });
  await testAsync('resolvePreviousHash: lookup hata fırlatırsa → CHAIN_LOOKUP_FAILED, chainBroken true', async () => {
    const r = await resolvePreviousHash({ getLastRecordHash: async () => { throw new Error('DB down'); } });
    assert.strictEqual(r.previousHash, 'CHAIN_LOOKUP_FAILED');
    assert.strictEqual(r.chainBroken, true);
  });

  // ---- buildAuditRecord (previous_hash/chain_broken alanları) ----
  test('buildAuditRecord: previousHash verilirse audit.previous_hash\'e işlenir', () => {
    const { record } = buildAuditRecord({
      decisionId: 'd1', actor: 'a', inputContextHash: 'ich', previousHash: 'abc123', chainBroken: false,
    });
    assert.strictEqual(record.audit.previous_hash, 'abc123');
    assert.strictEqual(record.audit.chain_broken, false);
  });
  test('buildAuditRecord: chainBroken true ise audit.chain_broken true taşınır', () => {
    const { record } = buildAuditRecord({
      decisionId: 'd1', actor: 'a', inputContextHash: 'ich', previousHash: 'CHAIN_LOOKUP_FAILED', chainBroken: true,
    });
    assert.strictEqual(record.audit.chain_broken, true);
  });
  test('buildAuditRecord: previousHash hiç verilmezse CHAIN_LOOKUP_FAILED\'e düşer (fail-closed varsayılan)', () => {
    const { record } = buildAuditRecord({ decisionId: 'd1', actor: 'a', inputContextHash: 'ich' });
    assert.strictEqual(record.audit.previous_hash, 'CHAIN_LOOKUP_FAILED');
  });

  // ---- runAuditLogNode (uçtan uca zincir) ----
  await testAsync('runAuditLogNode: genesis kaydı doğru zincirlenir, criticalEscalation false', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd1', actor: 'a', inputContextHash: 'ich' },
      { getLastRecordHash: async () => null, insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.criticalEscalation, false);
    assert.strictEqual(inserted.audit.previous_hash, 'GENESIS');
  });
  await testAsync('runAuditLogNode: ikinci kayıt öncekinin hash\'ine zincirlenir', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd2', actor: 'a', inputContextHash: 'ich2' },
      { getLastRecordHash: async () => 'prevHash999', insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(inserted.audit.previous_hash, 'prevHash999');
  });
  await testAsync('runAuditLogNode: zincir lookup başarısız olsa bile kayıt YİNE DE yazılır (AMC-6 > zincir)', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd3', actor: 'a', inputContextHash: 'ich3' },
      { getLastRecordHash: async () => { throw new Error('DB down'); }, insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(inserted.audit.chain_broken, true);
  });
  await testAsync('runAuditLogNode: zincir kırıksa criticalEscalation true (yazma başarılı olsa bile, sessizce geçilmez)', async () => {
    const r = await runAuditLogNode(
      { decisionId: 'd3', actor: 'a', inputContextHash: 'ich3' },
      { getLastRecordHash: async () => { throw new Error('DB down'); }, insert: async () => {} },
    );
    assert.strictEqual(r.criticalEscalation, true);
  });
  await testAsync('runAuditLogNode: lookup fonksiyonu enjekte edilmemiş dbClient → yine de yazılır + chainBroken true', async () => {
    let inserted = null;
    const r = await runAuditLogNode(
      { decisionId: 'd4', actor: 'a', inputContextHash: 'ich4' },
      { insert: async (rec) => { inserted = rec; } },
    );
    assert.strictEqual(r.inserted, true);
    assert.strictEqual(r.chainBroken, true);
    assert.strictEqual(inserted.audit.previous_hash, 'CHAIN_LOOKUP_FAILED');
  });

  console.log(`\n${passed} geçti, ${failed} başarısız (toplam ${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
})();
