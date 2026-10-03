// Konum: packages/pusula-gate/src/intent-binding.mjs
// Güvenilir intent/capability bağlayıcısı.
// Kritik güvenlik varsayımı: trustedIntent, kullanıcı metninden aynı LLM ile çıkarılmamalı;
// UI/uygulama katmanı veya ayrı, güvenilir bir kontrol akışı tarafından oluşturulmalıdır.
//
// Capability envelope artık action + parametre yetkisini birlikte taşır.
// Örnek:
// { capabilities: { MOVE: { params: { part:{enum:['head']}, speed:{min:1,max:10}, duration_ms:{min:100,max:500} } } } }

import { ACTIONS } from './actions.mjs'

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k)
const sameKeys = (a, b) => a.length === b.length && a.every(k => b.includes(k))

function validParamGrant(action, grant) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant))
    return { ok: false, code: 'BAD_ACTION_GRANT' }
  const spec = ACTIONS[action].params
  if (!grant.params || typeof grant.params !== 'object' || Array.isArray(grant.params))
    return { ok: false, code: 'MISSING_PARAM_GRANT' }
  if (!sameKeys(Object.keys(grant.params), Object.keys(spec)))
    return { ok: false, code: 'PARAM_GRANT_KEYS' }

  for (const [name, rule] of Object.entries(grant.params)) {
    const s = spec[name]
    if (!rule || typeof rule !== 'object' || Array.isArray(rule))
      return { ok: false, code: 'BAD_PARAM_GRANT' }

    if (s.t === 'enum') {
      if (!Array.isArray(rule.enum) || rule.enum.length === 0 ||
          !rule.enum.every(v => s.v.includes(v)) || new Set(rule.enum).size !== rule.enum.length)
        return { ok: false, code: 'BAD_PARAM_ENUM_GRANT' }
    } else if (s.t === 'int') {
      if (!Number.isInteger(rule.min) || !Number.isInteger(rule.max) ||
          rule.min < s.min || rule.max > s.max || rule.min > rule.max)
        return { ok: false, code: 'BAD_PARAM_RANGE_GRANT' }
    } else if (s.t === 'bool') {
      if (!Array.isArray(rule.values) || rule.values.length === 0 ||
          !rule.values.every(v => typeof v === 'boolean') || new Set(rule.values).size !== rule.values.length)
        return { ok: false, code: 'BAD_PARAM_BOOL_GRANT' }
    } else if (s.t === 'str') {
      if (!Number.isInteger(rule.maxLength) || rule.maxLength < 1 || rule.maxLength > s.max)
        return { ok: false, code: 'BAD_PARAM_STRING_GRANT' }
    }
  }
  return { ok: true }
}

export function validateTrustedIntent(trustedIntent) {
  if (!trustedIntent || typeof trustedIntent !== 'object' || Array.isArray(trustedIntent))
    return { ok: false, code: 'NO_TRUSTED_INTENT' }

  const keys = Object.keys(trustedIntent)
  if (!sameKeys(keys, ['capabilities'])) return { ok: false, code: 'BAD_TRUSTED_INTENT' }
  const capabilities = trustedIntent.capabilities
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities) || Object.keys(capabilities).length === 0)
    return { ok: false, code: 'EMPTY_TRUSTED_INTENT' }

  for (const [action, grant] of Object.entries(capabilities)) {
    if (!hasOwn(ACTIONS, action)) return { ok: false, code: 'UNKNOWN_TRUSTED_ACTION' }
    const v = validParamGrant(action, grant)
    if (!v.ok) return v
  }
  return { ok: true, capabilities }
}

export function bindActionToIntent(action, params, trustedIntent) {
  const v = validateTrustedIntent(trustedIntent)
  if (!v.ok) return v
  const grant = v.capabilities[action]
  if (!grant) return { ok: false, code: 'INTENT_MISMATCH' }

  const spec = ACTIONS[action].params
  for (const [name, rule] of Object.entries(grant.params)) {
    const value = params[name]
    const s = spec[name]
    if (s.t === 'enum' && !rule.enum.includes(value))
      return { ok: false, code: 'PARAM_INTENT_MISMATCH', param: name }
    if (s.t === 'int' && (value < rule.min || value > rule.max))
      return { ok: false, code: 'PARAM_INTENT_MISMATCH', param: name }
    if (s.t === 'bool' && !rule.values.includes(value))
      return { ok: false, code: 'PARAM_INTENT_MISMATCH', param: name }
    if (s.t === 'str' && value.length > rule.maxLength)
      return { ok: false, code: 'PARAM_INTENT_MISMATCH', param: name }
  }
  return { ok: true }
}
