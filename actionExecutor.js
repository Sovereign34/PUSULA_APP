// action-executor/actionExecutor.js
// Amaç:    PUSULA çekirdeğinin (Execution Gate) ürettiği token'ı tüketen TEK
//          genel giriş noktası. actionType'a göre ilgili domain
//          implementasyonuna yönlendirir (dispatch). Instagram/Meta ilk
//          somut implementasyon; yeni bir domain (ör. WhatsApp, pazaryeri
//          kampanyası) eklendiğinde ACTION_EXECUTORS tablosuna yeni bir satır
//          eklenir, mevcut implementasyonlara dokunulmaz.
//
// DOKUNMA / DÜRÜSTLÜK NOTU: Bu dosya YENİ, PUSULA-çekirdek konsolidasyon
// kararıyla (2026-08-22) eklendi. `meta/metaApi.js`'in kendisi HİÇ
// DEĞİŞTİRİLMEDİ — o dosyanın 19/19 testi (263/263'ün parçası, kullanıcının
// kendi codespace'inde önceden doğrulanmış) bozulmasın diye. Bu sadece onun
// üzerine ince bir dispatch katmanı. `runActionExecutor`'ın kendisi ve bu
// dosyanın testi (actionExecutor.test.js) HENÜZ kullanıcının kendi
// codespace'inde çalıştırılıp doğrulanmadı — "kullanıcı tarafından bağımsız
// doğrulandı" etiketini bu iki dosya için kullanma, ilk çalıştırma sonucunu
// bekle.

const metaApi = require('./meta/metaApi');

/**
 * actionType -> koordinasyon fonksiyonu eşlemesi. Her fonksiyon kendi
 * domain'inin token/payload şeklini bilir, dispatch katmanı bunu bilmez.
 */
const ACTION_EXECUTORS = {
  meta_campaign: metaApi.runMetaApiNode,
  // İkinci domain (örn. WhatsApp) geldiğinde buraya yeni bir satır eklenir:
  // whatsapp_message: whatsappApi.runWhatsAppNode,
};

/**
 * Genel Action Executor giriş noktası. Execution Gate'ten gelen actionType'a
 * göre ilgili domain implementasyonuna yönlendirir. Bilinmeyen actionType
 * fail-closed reddedilir (mevcut projedeki "tanımsız durum = DENY" ilkesiyle
 * tutarlı, bkz. POLICY_RULES.md §12).
 */
async function runActionExecutor(actionType, payload) {
  const executor = ACTION_EXECUTORS[actionType];
  if (!executor) {
    return {
      executed: false,
      stage: 'dispatch',
      reason: `bilinmeyen actionType: ${actionType}`,
    };
  }
  return executor(payload);
}

module.exports = { runActionExecutor, ACTION_EXECUTORS };
