// meta-api/metaApi.test.js
// Amaç:    metaApi.js'teki 5 fonksiyonun birim testleri — TEST_MATRIX.md'ye
//          Bölüm 1c olarak işlenecek (checkpoint sonrası).
// Bağlı:   metaApi.js
// AMC:     AMC-4, AMC-7, AMC-8 (bkz. metaApi.js başlığı)
// Risk:    Bu dosya geçmeden gerçek n8n'e deploy edilmez (AGENT.md Kural 8).
// Dokunma: Yeni bir AMC kontrolü eklenirse buraya da geçerli/sınır/aşım/null
//          seti eklenmeli.

const assert = require('assert');
const {
  checkTokenNotExpired,
  checkPolicyHashMatch,
  buildCampaignPayload,
  callMetaApiWithBackoff,
  runMetaApiNode,
} = require('./metaApi');

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

// ---- Ana çalıştırıcı — tüm testler sırayla awaitlenir, özet en son basılır ----
(async () => {
  test('checkTokenNotExpired: geçerli token geçer', () => {
    const r = checkTokenNotExpired({ expiration: 2000 }, 1000);
    assert.strictEqual(r.passed, true);
  });
  test('checkTokenNotExpired: sınır — tam expiration anında geçer', () => {
    const r = checkTokenNotExpired({ expiration: 1000 }, 1000);
    assert.strictEqual(r.passed, true);
  });
  test('checkTokenNotExpired: sınır — 1ms sonrası reddedilir', () => {
    const r = checkTokenNotExpired({ expiration: 1000 }, 1001);
    assert.strictEqual(r.passed, false);
  });
  test('checkTokenNotExpired: null token reddedilir (fail-closed)', () => {
    const r = checkTokenNotExpired(null, 1000);
    assert.strictEqual(r.passed, false);
  });

  test('checkPolicyHashMatch: eşleşen hash geçer', () => {
    const r = checkPolicyHashMatch({ policy_hash: 'abc' }, 'abc');
    assert.strictEqual(r.passed, true);
  });
  test('checkPolicyHashMatch: uyuşmayan hash reddedilir', () => {
    const r = checkPolicyHashMatch({ policy_hash: 'abc' }, 'xyz');
    assert.strictEqual(r.passed, false);
  });
  test('checkPolicyHashMatch: currentPolicyHash null ise fail-closed reddedilir', () => {
    const r = checkPolicyHashMatch({ policy_hash: 'abc' }, null);
    assert.strictEqual(r.passed, false);
  });
  test('checkPolicyHashMatch: token.policy_hash eksikse reddedilir', () => {
    const r = checkPolicyHashMatch({}, 'abc');
    assert.strictEqual(r.passed, false);
  });

  test('buildCampaignPayload: geçerli brief → PAUSED + instagram sabit', () => {
    const { payload, error } = buildCampaignPayload({
      name: 'Test', objective: 'CONVERSIONS', daily_budget: 500,
    });
    assert.strictEqual(error, null);
    assert.strictEqual(payload.status, 'PAUSED');
    assert.deepStrictEqual(payload.publisher_platforms, ['instagram']);
  });
  test('buildCampaignPayload: brief PAUSED dışını istese bile PAUSED zorlanır (AMC-8)', () => {
    const { payload } = buildCampaignPayload({
      name: 'Test', objective: 'CONVERSIONS', daily_budget: 500, status: 'ACTIVE',
    });
    assert.strictEqual(payload.status, 'PAUSED');
  });
  test('buildCampaignPayload: eksik daily_budget reddedilir', () => {
    const { error } = buildCampaignPayload({ name: 'Test', objective: 'CONVERSIONS' });
    assert.ok(error);
  });
  test('buildCampaignPayload: null brief reddedilir', () => {
    const { error } = buildCampaignPayload(null);
    assert.ok(error);
  });

  await testAsync('callMetaApiWithBackoff: 2xx ilk denemede başarılı', async () => {
    const r = await callMetaApiWithBackoff({}, async () => ({ status: 200, body: {} }));
    assert.strictEqual(r.success, true);
  });
  await testAsync('callMetaApiWithBackoff: 4xx retry yapmadan başarısız döner', async () => {
    let calls = 0;
    const r = await callMetaApiWithBackoff({}, async () => { calls++; return { status: 400 }; });
    assert.strictEqual(r.success, false);
    assert.strictEqual(calls, 1);
  });
  await testAsync('callMetaApiWithBackoff: 429 backoff ile retry eder, sonra başarılı', async () => {
    let calls = 0;
    const r = await callMetaApiWithBackoff({}, async () => {
      calls++;
      return calls < 2 ? { status: 429 } : { status: 200 };
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls, 2);
  });
  await testAsync('callMetaApiWithBackoff: maxAttempts aşılırsa başarısız', async () => {
    const r = await callMetaApiWithBackoff({}, async () => ({ status: 500 }), 2);
    assert.strictEqual(r.success, false);
  });

  await testAsync('runMetaApiNode: her aşama geçerse Meta API çağrılır', async () => {
    const r = await runMetaApiNode({
      token: { expiration: 2000, policy_hash: 'abc' },
      campaignBrief: { name: 'T', objective: 'CONVERSIONS', daily_budget: 500 },
      currentPolicyHash: 'abc',
      httpClient: async () => ({ status: 200 }),
      now: 1000,
    });
    assert.strictEqual(r.executed, true);
  });
  await testAsync('runMetaApiNode: TTL dolmuşsa API HİÇ çağrılmaz (fail-closed)', async () => {
    let called = false;
    const r = await runMetaApiNode({
      token: { expiration: 500, policy_hash: 'abc' },
      campaignBrief: { name: 'T', objective: 'CONVERSIONS', daily_budget: 500 },
      currentPolicyHash: 'abc',
      httpClient: async () => { called = true; return { status: 200 }; },
      now: 1000,
    });
    assert.strictEqual(r.executed, false);
    assert.strictEqual(r.stage, 'ttl');
    assert.strictEqual(called, false);
  });
  await testAsync('runMetaApiNode: hash uyuşmazsa API HİÇ çağrılmaz (fail-closed)', async () => {
    let called = false;
    const r = await runMetaApiNode({
      token: { expiration: 2000, policy_hash: 'abc' },
      campaignBrief: { name: 'T', objective: 'CONVERSIONS', daily_budget: 500 },
      currentPolicyHash: 'xyz',
      httpClient: async () => { called = true; return { status: 200 }; },
      now: 1000,
    });
    assert.strictEqual(r.executed, false);
    assert.strictEqual(r.stage, 'policy_hash');
    assert.strictEqual(called, false);
  });

  console.log(`\n${passed} geçti, ${failed} başarısız (toplam ${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
})();
