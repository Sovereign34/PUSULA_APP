// Konum: packages/pusula-gate/src/gate.mjs
// gate — PUSULA Karar Kapısı: precheck → Executor → doğrula → niyet bağla → politika → Critic → insan → eylem
// Amaç:    yorum için güvenli, denetlenebilir, fail-closed karar hattı (handle/process hiç istisna fırlatmaz)
// Bağlı:   precheck, validate, policy, reviewer, audit, intent-binding, effects (n8n/DB tarafı enjekte eder)
// Risk:    kapı atlanırsa kalibre edilmemiş AI çıktısı yayına gider; Executor=Critic ailesi olursa çapraz denetim kaybolur
// Dokunma: sayısal ayarlar yalnızca config'ten gelir; aşama sırası ve "hata = ret" kuralı değişmez; yeni aşama = test + KARAR BİLDİRİMİ
import { parseProposal, buildDecision } from './validate.mjs'
import { createPolicy } from './policy.mjs'
import { buildPrompt } from './prompts.mjs'
import { ACTIONS } from './actions.mjs'
import { withTimeout, sanitizeReason } from './util.mjs'
import { bindActionToIntent } from './intent-binding.mjs'
import { precheck, crisisReason } from './precheck.mjs'
import { createReviewer } from './reviewer.mjs'
import { createAudit } from './audit.mjs'
import { validateConfig } from './config.mjs'

const blocked = o => o === 'DENY' || o === 'BLOCK'
const validModel = m => m && typeof m.family === 'string' && m.family.trim() && typeof m.call === 'function'

export function createGate({ executor, critic, approver = async () => false, effects, getState = () => ({}),
                             extraRules = [], now = Date.now, config }) {
  // CORE.md §4: Executor ve Critic aynı model ailesinden OLAMAZ.
  if (!validModel(executor) || !validModel(critic) || executor.family.toLowerCase() === critic.family.toLowerCase())
    throw new Error('MODEL_FAMILY_RULE')
  const cfg = validateConfig(config)   // AMC-9: varsayılan yok, eksik/geçersiz ayar = kurulum hatası
  const audit = createAudit(now), policy = createPolicy(cfg.rate, extraRules), reviewer = createReviewer(critic.call, { timeoutMs: cfg.timeoutsMs.critic })
  const recent = {}, done = new Set(), busy = new Set()
  const st = () => ({ safeMode: false, ...getState(), now: now(), recent })
  const deny = (id, code, d) => { audit.append({ id, action: d?.action ?? null, outcome: 'DENIED', code }); return { status: 'DENIED', code } }

  async function propose(event, rev) {
    let raw
    try { raw = await withTimeout(executor.call(buildPrompt(event, rev)), cfg.timeoutsMs.model) } catch { return { code: 'EXECUTOR_ERROR' } }
    const p = parseProposal(raw)
    return p.ok ? { proposal: p.proposal } : { code: p.code }
  }
  function vet(proposal, intent) {
    const b = bindActionToIntent(proposal.action, proposal.params, intent)
    if (!b.ok) return { code: b.code, d: { action: proposal.action } }
    const d = buildDecision(proposal, st()), pol = policy.evaluate(d, st())
    return blocked(pol.outcome) ? { code: 'POLICY_' + pol.rule, d } : { d, pol }
  }
  async function critique(d, event) {
    if (!ACTIONS[d.action].review) return { clear: true }
    let rv = null
    try { rv = await reviewer.review(d, event) } catch { rv = null }   // istisna = veto
    return rv && rv.veto === false ? { clear: true } : { clear: false, reason: rv && typeof rv.reason === 'string' ? rv.reason : 'REVIEWER_NOT_CLEAR' }
  }
  async function approve(d, pol) {
    if (pol.outcome !== 'ASK_HUMAN') return 'NA'
    try { return (await approver(ACTIONS[d.action].summary(d.params), d.id)) === true ? 'YES' : 'NO' } catch { return 'NO' }
  }
  async function execute(d, id) {
    const eff = Object.hasOwn(effects, d.action) ? effects[d.action] : null
    if (!eff) return deny(id, 'NO_EFFECT', d)
    const slot = now(); (recent[d.action] ??= []).push(slot)   // hız sınırı yuvası eylemden ÖNCE, senkron ayrılır
    try { await withTimeout(eff(d.params, d), cfg.timeoutsMs.effect) } catch (e) {
      if (e?.message === 'TIMEOUT') return deny(id, 'EFFECT_TIMEOUT', d)   // yarım kalmış olabilir: yuva geri verilmez
      const i = recent[d.action].indexOf(slot); if (i >= 0) recent[d.action].splice(i, 1)
      return deny(id, 'EFFECT_ERROR', d)
    }
    return null
  }
  async function attempt(event, intent, rev, id) {
    const p = await propose(event, rev); if (!p.proposal) return { end: deny(id, p.code) }
    const v = vet(p.proposal, intent); if (v.code) return { end: deny(id, v.code, v.d) }
    const c = await critique(v.d, event)
    if (!c.clear) return { d: v.d, revise: { previous_action: v.d.action, previous_params: v.d.params, veto_reason: sanitizeReason(c.reason) } }
    const ap = await approve(v.d, v.pol); if (ap === 'NO') return { end: deny(id, 'HUMAN_DECLINED', v.d) }
    const pol = policy.evaluate(v.d, st())   // beklerken durum değişmiş olabilir: eylemden hemen önce yeniden kontrol
    if (blocked(pol.outcome)) return { end: deny(id, 'RECHECK_' + pol.rule, v.d) }
    if (pol.outcome === 'ASK_HUMAN' && ap !== 'YES') return { end: deny(id, 'NOT_APPROVED', v.d) }
    const fail = await execute(v.d, id); if (fail) return { end: fail }
    audit.append({ id, action: v.d.action, outcome: 'EXECUTED' })
    return { end: { status: 'EXECUTED', action: v.d.action } }
  }
  async function run(event, intent, id) {
    let rev = null
    for (let n = 0; n <= cfg.maxRevisions; n++) {
      const r = await attempt(event, intent, rev, id)
      if (r.end) return { ...r.end, attempts: n + 1 }
      if (n === cfg.maxRevisions) return deny(id, 'REVIEWER_VETO', r.d)   // 3 öneriden sonra fail-closed
      rev = { attempt: n + 1, ...r.revise }   // veto onay vermez; her öneri baştan denetlenir
      audit.append({ id, action: r.d.action, outcome: 'REVISED', code: 'REVIEWER_VETO', attempt: n + 1 })
    }
    return deny(id, 'REVISION_LIMIT')
  }
  async function escalate(id, crisis) {
    const reason = crisisReason(crisis)
    try { await withTimeout(effects.ESCALATE_TO_HUMAN({ reason }, { id }), cfg.timeoutsMs.effect) } catch { return deny(id, 'ESCALATION_FAILED') }
    audit.append({ id, action: 'ESCALATE_TO_HUMAN', outcome: 'ESCALATED', code: 'PRECHECK_' + reason })
    done.add(id); return { status: 'ESCALATED', reason }
  }
  async function processReview(input, trustedIntent = null) {
    const id = String(input?.id ?? '')
    if (!id) return deny('', 'NO_EXTERNAL_ID')
    if (done.has(id)) return { status: 'ALREADY_PROCESSED' }
    if (busy.has(id)) return deny(id, 'IN_PROGRESS')
    busy.add(id)
    try {
      const pre = precheck(input)
      if (!pre.ok) return deny(id, pre.code)
      if (pre.crisis.length) return await escalate(id, pre.crisis)   // kriz: model ÇAĞRILMAZ
      const res = await run(pre.event, trustedIntent, id)
      if (res.status === 'EXECUTED') done.add(id)
      return res
    } catch { return deny(id, 'GATE_ERROR') } finally { busy.delete(id) }
  }
  return { process: processReview, audit, internals: { policy, state: st } }
}
