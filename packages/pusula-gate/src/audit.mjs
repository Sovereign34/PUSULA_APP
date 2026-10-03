// Konum: packages/pusula-gate/src/audit.mjs
// audit — yalnızca-ekleme, hash zincirli denetim izi (bellek içi; üretimde Postgres'e yazılır)
// Amaç:    her gate kararını kurcalanamaz biçimde kaydetmek; ham yorum/PII KAYDEDİLMEZ
// Bağlı:   gate
// Risk:    zincir bozulursa denetim izi güvenilmez; kayda metin girerse KVKK riski
// Dokunma: alanlar yalnızca id/action/outcome/code; silme talebi için crypto-shredding ayrı tasarlanır (B10)
import { createHash } from 'node:crypto'
const sha = o => createHash('sha256').update(JSON.stringify(o)).digest('hex')
export function createAudit(now = Date.now) {
  const entries = []
  const append = rec => {
    const body = { seq: entries.length, t: now(), prev: entries.length ? entries.at(-1).hash : 'GENESIS', ...rec }
    entries.push(Object.freeze({ ...body, hash: sha(body) }))
  }
  const verify = () => { let prev = 'GENESIS'
    return entries.every((e, i) => { const { hash, ...body } = e; const ok = e.seq === i && e.prev === prev && sha(body) === hash; prev = hash; return ok }) }
  return { append, verify, entries: () => entries.slice() }
}
