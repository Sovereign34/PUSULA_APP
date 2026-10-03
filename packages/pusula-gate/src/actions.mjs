// Konum: packages/pusula-gate/src/actions.mjs
// actions — kapının tanıdığı TÜM eylemler (kayıt dışı eylem = ret)
// Amaç:    risk, niyet ve parametre sınırlarını sabitlemek; model bunları beyan edemez
// Bağlı:   validate, policy, intent-binding, prompts
// Risk:    yeni eylem eklemek = yeni saldırı yüzeyi; PUBLISH_REPLY yanlış riskle kaydedilirse insan onayı atlanır
// Dokunma: eylem eklerken policy kuralları + trustedIntent örnekleri + testler birlikte güncellenir
import { deepFreeze } from './util.mjs'
export const TONES = ['s', 'n', 'r']
export const ESC_REASONS = ['crisis', 'allergen', 'legal', 'press', 'low_confidence', 'other']
const reply = { tone: { t: 'enum', v: TONES }, text: { t: 'str', max: 600 } }
export const ACTIONS = deepFreeze({
  DRAFT_REPLY:       { intent: 'WRITE_DATA',     risk: 'MEDIUM', review: true,  params: reply, summary: () => 'Cevap taslağı kaydedilecek' },
  PUBLISH_REPLY:     { intent: 'EXECUTE_ACTION', risk: 'HIGH',   review: true,  params: reply, summary: () => 'Cevap platformda yayınlanacak' },
  ESCALATE_TO_HUMAN: { intent: 'TRIGGER_EVENT',  risk: 'LOW',    review: false, params: { reason: { t: 'enum', v: ESC_REASONS } }, summary: p => `İnsana devir: ${p.reason}` },
  SET_PRIORITY:      { intent: 'MODIFY_STATE',   risk: 'LOW',    review: false, params: { level: { t: 'enum', v: ['high', 'medium', 'low'] } }, summary: p => `Öncelik: ${p.level}` },
})
