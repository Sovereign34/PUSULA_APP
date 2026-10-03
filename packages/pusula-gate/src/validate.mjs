// Konum: packages/pusula-gate/src/validate.mjs
// validate — model çıktısı = güvenilmeyen girdi
// Amaç:    yalnızca {action, params} kabul eder; id/status/risk alanlarını MOTOR üretir
// Bağlı:   gate, actions
// Risk:    gevşetilirse model kendi risk/onay alanını yazabilir (Policy Engine bypass)
// Dokunma: yeni alan kabulü = güvenlik incelemesi
import { randomUUID } from 'node:crypto'
import { ACTIONS } from './actions.mjs'
const MAX_RAW = 4096
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const CTRL = /[\u0000-\u001f\u007f]/
const same = (a, b) => a.length === b.length && a.every(k => b.includes(k))
const fail = code => ({ ok: false, code })

function checkParam(s, v) {
  if (s.t === 'enum') return s.v.includes(v) ? null : 'PARAM_ENUM'
  if (s.t === 'int') return Number.isInteger(v) && v >= s.min && v <= s.max ? null : 'PARAM_RANGE'
  if (s.t === 'bool') return typeof v === 'boolean' ? null : 'PARAM_BOOL'
  return typeof v === 'string' && v.trim().length >= 1 && v.length <= s.max && !CTRL.test(v) ? null : 'PARAM_STRING'
}
function parseJson(raw) {
  try { return JSON.parse(raw, (k, v) => { if (BAD_KEYS.has(k)) throw new Error('BAD_KEY'); return v }) }
  catch (e) { return { __err: e.message === 'BAD_KEY' ? 'FORBIDDEN_KEY' : 'NOT_JSON' } }
}
export function parseProposal(raw) {
  if (typeof raw !== 'string') return fail('NOT_STRING')
  if (raw.length > MAX_RAW) return fail('TOO_LARGE')
  const obj = parseJson(raw)
  if (obj?.__err) return fail(obj.__err)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('NOT_OBJECT')
  if (!same(Object.keys(obj), ['action', 'params'])) return fail('UNEXPECTED_FIELDS')
  if (typeof obj.action !== 'string' || !Object.hasOwn(ACTIONS, obj.action)) return fail('UNKNOWN_ACTION')
  return parseParams(obj)
}
function parseParams(obj) {
  if (!obj.params || typeof obj.params !== 'object' || Array.isArray(obj.params)) return fail('BAD_PARAMS')
  const spec = ACTIONS[obj.action].params
  if (!same(Object.keys(obj.params), Object.keys(spec))) return fail('PARAM_KEYS')
  for (const [k, s] of Object.entries(spec)) { const c = checkParam(s, obj.params[k]); if (c) return fail(c) }
  return { ok: true, proposal: { action: obj.action, params: { ...obj.params } } }
}
export function buildDecision(proposal, state) {
  const spec = ACTIONS[proposal.action]
  return { schema_version: '1.0', id: randomUUID(), created_at: new Date(state.now).toISOString(),
    action: proposal.action, intent: spec.intent, risk: spec.risk, params: proposal.params,
    context: { actor: 'executor' }, status: 'VALIDATED' }
}
