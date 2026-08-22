// action-executor/actionExecutor.test.js
// Amaç:    actionExecutor.js'teki dispatch mantığının birim testleri.
// Bağlı:   actionExecutor.js, meta/metaApi.js
// Risk:    Bu dosya geçmeden gerçek n8n'e deploy edilmez (AGENT.md Kural 8).
// DÜRÜSTLÜK NOTU: Bu dosya (ve actionExecutor.js) YENİ — henüz kullanıcının
//          kendi codespace'inde çalıştırılıp bağımsız doğrulanmadı. Aşağıdaki
//          sonuçlar sadece bu ajanın yerel çalıştırmasını yansıtır.

const assert = require('assert');
const { runActionExecutor, ACTION_EXECUTORS } = require('./actionExecutor');

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
  test('ACTION_EXECUTORS tablosunda meta_campaign kayıtlı', () => {
    assert.strictEqual(typeof ACTION_EXECUTORS.meta_campaign, 'function');
  });

  await testAsync('bilinmeyen actionType fail-closed reddedilir, hiçbir executor çağrılmaz', async () => {
    const r = await runActionExecutor('whatsapp_message', { anything: true });
    assert.strictEqual(r.executed, false);
    assert.strictEqual(r.stage, 'dispatch');
    assert.ok(r.reason.includes('whatsapp_message'));
  });

  await testAsync('meta_campaign, token süresi dolmuşsa metaApi zincirinden gelen fail-closed sonucu aynen döner', async () => {
    const r = await runActionExecutor('meta_campaign', {
      token: { expiration: 500, policy_hash: 'abc' },
      campaignBrief: { name: 'T', objective: 'CONVERSIONS', daily_budget: 500 },
      currentPolicyHash: 'abc',
      httpClient: async () => ({ status: 200 }),
      now: 1000,
    });
    assert.strictEqual(r.executed, false);
    assert.strictEqual(r.stage, 'ttl');
  });

  await testAsync('meta_campaign, geçerli token + başarılı API çağrısıyla executed:true döner', async () => {
    const r = await runActionExecutor('meta_campaign', {
      token: { expiration: 2000, policy_hash: 'abc' },
      campaignBrief: {
        name: 'T',
        objective: 'CONVERSIONS',
        daily_budget: 500,
        targeting: { age_min: 18, age_max: 45, locations: ['TR-34'] },
      },
      currentPolicyHash: 'abc',
      httpClient: async () => ({ status: 200, id: 'camp_123' }),
      now: 1000,
    });
    assert.strictEqual(r.executed, true);
    assert.strictEqual(r.stage, 'ad_set_api');
  });

  console.log(`\n${passed} geçti, ${failed} başarısız (toplam ${passed + failed})`);
  if (failed > 0) process.exitCode = 1;
})();
