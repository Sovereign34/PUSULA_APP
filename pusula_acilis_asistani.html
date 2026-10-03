// Amaç: pusula_acilis_asistani.html içindeki KR/CAT/INT kural verisini src/rules-data.mjs'e aktarır (tek kaynak).
import { readFileSync, writeFileSync } from 'node:fs'
const html = readFileSync(process.argv[2], 'utf8')
const cut = (a, b) => html.slice(html.indexOf(a), html.indexOf(b))
const src = cut('const KR=[', 'const PN=') + cut('const INT=[', 'const HIGH=')
const data = new Function(src + '; return { KR, CAT, INT }')()
data.INT = data.INT.map(i => i.slice(0, 3))   // cümle şablonları UI'a ait, kapıya gerekmez
writeFileSync(new URL('../src/rules-data.mjs', import.meta.url),
  '// Konum: packages/pusula-gate/src/rules-data.mjs\n// OTOMATİK ÜRETİLDİ (tools/extract-rules.mjs) — kaynak: pusula_acilis_asistani.html. TASLAK, kalibrasyon bekliyor.\n' +
  Object.entries(data).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)}\n`).join(''))
console.log('KR', data.KR.length, 'CAT', data.CAT.length, 'INT', data.INT.length)
