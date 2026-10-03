// Konum: packages/pusula-gate/src/precheck.mjs
// precheck — ham yorum metnini YAPILANDIRILMIŞ olaya çeviren deterministik katman (karantina girişi)
// Amaç:    kriz ayıklama + kategori + niyet çıkarımı; Executor/Critic ham metni ASLA görmez
// Bağlı:   gate, rules-data (HTML'den üretilen KR/CAT/INT)
// Risk:    kriz kelimesi kaçarsa riskli yorum modele ve şablona düşer; olay şemasına metin sızarsa Dual-LLM ayrımı çöker
// Dokunma: KR/CAT TASLAK (kalibrasyon bekliyor); event alanları yalnızca enum/int olmalı
import { KR, CAT, INT } from './rules-data.mjs'
import { norm } from './util.mjs'
const MAX_TEXT = 5000
const PLATFORMS = ['Yemeksepeti', 'Getir', 'Trendyol Yemek', 'Google', 'Diğer']
const PRIORITY_CATS = ['alerjen', 'cig', 'hijyen']
const REASON_BY_KR = { saglik: 'crisis', yabanci: 'crisis', alerjik: 'allergen', hukuk: 'legal', basin: 'press' }
const REASON_ORDER = ['crisis', 'allergen', 'legal', 'press']
export const hit = (t, list) => !list ? undefined : list.split(',').find(p => {
  const end = p.endsWith('$'), q = (end ? p.slice(0, -1) : p).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(^|[^a-z0-9])' + q + (end ? '($|[^a-z0-9])' : '')).test(t)
})
function classify(y, puan) {
  const m = CAT.filter(c => c[2] && c[0] !== 'olumlu' && hit(y, c[2]))
  const pri = m.find(c => PRIORITY_CATS.includes(c[0]))
  if (pri) return pri[0]
  if (m.length > 1) return 'coklu'
  if (m.length) return m[0][0]
  if (puan >= 4 || (!puan && hit(y, CAT[0][2]))) return 'olumlu'
  return puan === 1 && y.length < 20 ? 'detaysiz' : 'genel'
}
const intents = y => {
  const r = INT.filter(i => hit(y, i[2])).map(i => i[0])
  if (y.includes('?') || hit(y, 'neden,nasil,ne zaman,niye')) r.push('soru')
  return r
}
export const crisisReason = ids => REASON_ORDER.find(r => ids.some(id => REASON_BY_KR[id] === r)) ?? 'crisis'
export function precheck(input) {
  const text = input?.text
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { ok: false, code: 'BAD_TEXT' }
  const rating = input.rating ?? 0
  if (!Number.isInteger(rating) || rating < 0 || rating > 5) return { ok: false, code: 'BAD_RATING' }
  const y = norm(text)
  const crisis = KR.filter(k => hit(y, k[2])).map(k => k[0])
  if (crisis.length) return { ok: true, crisis }
  const platform = PLATFORMS.includes(input.platform) ? input.platform : 'Diğer'
  return { ok: true, crisis: [], event: { category: classify(y, rating), intents: intents(y), rating, platform } }
}
