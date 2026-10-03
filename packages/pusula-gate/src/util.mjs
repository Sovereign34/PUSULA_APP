// Konum: packages/pusula-gate/src/util.mjs
// util — küçük yardımcılar (donmuş nesne, zaman aşımı, TR normalizasyonu, gerekçe temizliği)
// Amaç:    gate'in ortak, yan etkisiz yardımcıları
// Bağlı:   tüm src/* modülleri
// Risk:    sanitizeReason zayıflarsa Critic gerekçesi üzerinden Executor'a talimat sızar
// Dokunma: sanitizeReason değişirse test/gate.test.mjs "gerekçe" testlerini çalıştır
export const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze) } return o }
export const withTimeout = (p, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('TIMEOUT')), ms)
  Promise.resolve(p).then(v => { clearTimeout(t); res(v) }, e => { clearTimeout(t); rej(e) })
})
export const norm = s => (s || '').toLocaleLowerCase('tr').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
export const sanitizeReason = r => {
  if (typeof r !== 'string') return 'REVIEWER_VETO'
  const c = r.normalize('NFKC').replace(/[^\p{L}\p{N} _.,;:'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!c || /(https?|www\.|@|ignore|system prompt|instruction|talimat)/i.test(c)) return 'REVIEWER_VETO'
  return c
}
