// Konum: packages/pusula-gate/src/policy.mjs
// policy — Policy Engine: saf, deterministik, AI ÇAĞRISI YOK (CORE.md §4)
// Amaç:    tüm kurallar çalışır, EN KISITLAYICI sonuç kazanır; kural yoksa/hata varsa DENY
// Bağlı:   gate, actions, content
// Risk:    kural atlanırsa yüksek riskli eylem insan onayı olmadan geçer; AI eklenirse CORE ihlali
// Dokunma: hız sınırları config'ten gelir (AMC-9), kodda sabit değer yok; eşikler TASLAK; kural eklerken test ekle
import { ACTIONS } from './actions.mjs'
import { textUnsafe, promiseUnsafe } from './content.mjs'
const RANK = { PERMIT: 0, ASK_HUMAN: 1, DENY: 2, BLOCK: 3 }
const TEXT_FIELDS = { DRAFT_REPLY: 'text', PUBLISH_REPLY: 'text' }
const textRule = fn => d => { const f = TEXT_FIELDS[d.action]; return f && fn(d.params[f]) ? 'DENY' : null }
const rateRule = rate => (d, s) => {
  const lim = rate.perAction[d.action] ?? rate.defaultLimit
  return (s.recent?.[d.action] ?? []).filter(t => s.now - t < rate.windowMs).length >= lim ? 'DENY' : null
}
const baseRules = rate => [
  { name: 'p1_status', ev: d => d.status !== 'VALIDATED' ? 'BLOCK' : null },
  { name: 'p2_high_needs_human', ev: d => ['HIGH', 'CRITICAL'].includes(d.risk) ? 'ASK_HUMAN' : null },
  { name: 'p3_safe_mode', ev: (d, s) => s.safeMode && d.action !== 'ESCALATE_TO_HUMAN' ? 'BLOCK' : null }, // PSC-8
  { name: 'p4_rate', ev: rateRule(rate) },
  { name: 'p5_content', ev: textRule(textUnsafe) },
  { name: 'p6_promise', ev: textRule(promiseUnsafe) },
  { name: 'allowlist', ev: d => Object.hasOwn(ACTIONS, d.action) ? 'PERMIT' : null },
]
function worstOf(rules, d, s) {
  let worst = null, rule = null
  for (const r of rules) {
    const o = r.ev(d, s)
    if (o === null || o === undefined) continue
    if (!(o in RANK)) return { outcome: 'DENY', rule: r.name + ':invalid_outcome' }
    if (worst === null || RANK[o] > RANK[worst]) { worst = o; rule = r.name }
  }
  return worst === null ? { outcome: 'DENY', rule: 'default_deny' } : { outcome: worst, rule }
}
export function createPolicy(rate, extraRules = []) {
  const rules = [...baseRules(rate), ...extraRules]
  return { evaluate(d, s) { try { return worstOf(rules, d, s) } catch { return { outcome: 'DENY', rule: 'exception' } } } }
}
