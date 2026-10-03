// Konum: packages/pusula-gate/src/config.mjs
// config — kapının tüm sayısal ayarları dışarıdan gelir; VARSAYILAN YOK (AMC-9, B18 ilkesi)
// Amaç:    maxRevisions, hız sınırları ve zaman aşımlarını doğrulayıp dondurmak
// Bağlı:   gate, policy, reviewer
// Risk:    geçersiz/eksik ayar sessizce varsayılana düşerse limitler fark edilmeden gevşer
// Dokunma: eksik veya geçersiz ayar = kurulum hatası (CONFIG_INVALID); değerler TASLAK, Faz 7'de kalibre edilir
import { ACTIONS } from './actions.mjs'
import { deepFreeze } from './util.mjs'
const posInt = v => Number.isInteger(v) && v > 0
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const rateOk = r => isObj(r) && posInt(r.windowMs) && posInt(r.defaultLimit) && isObj(r.perAction) &&
  Object.entries(r.perAction).every(([k, v]) => Object.hasOwn(ACTIONS, k) && posInt(v))
const timeoutsOk = t => isObj(t) && ['model', 'critic', 'effect'].every(k => posInt(t[k]))
const revisionsOk = n => Number.isInteger(n) && n >= 0 && n <= 5
export function validateConfig(c) {
  if (!isObj(c) || !revisionsOk(c.maxRevisions) || !rateOk(c.rate) || !timeoutsOk(c.timeoutsMs)) throw new Error('CONFIG_INVALID')
  return deepFreeze({ maxRevisions: c.maxRevisions, rate: { ...c.rate, perAction: { ...c.rate.perAction } }, timeoutsMs: { ...c.timeoutsMs } })
}
