// Konum: packages/pusula-gate/src/content.mjs
// content — çıktı metni için deterministik güvenlik süzgeci (AI YOK)
// Amaç:    iletişim bilgisi/URL/telefon sızıntısı ve yasak vaat ifadelerini yakalamak
// Bağlı:   policy
// Risk:    kaçırılan kalıp = müşteriye zararlı/vaat içeren cevap; fazla sıkı = sürekli ret
// Dokunma: PROMISES listesi TASLAK — gerçek vakalarla kalibre edilene kadar "kesin" sunulmaz
import { norm } from './util.mjs'
const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ai|ru|tr|xyz)\b)/i
const PHONE_RE = /\d[\d\s-]{6,}\d/
const WORDS = ['password', 'şifre', 'sifre', 'kredi kart', 'credit card', 'ignore previous', 'ignore all', 'system prompt']
const INVISIBLE = /[\p{Cf}\p{Mn}\u00ad\u034f\u115f\u1160\u17b4\u17b5\u180e\u3164\uffa0]/gu
const SPOKEN_URL_RE = /\b(nokta|dot|dat)\s*(com|net|org|io|ai|ru|tr|xyz)\b/
const SPOKEN_MAIL_RE = /\b(at|et|ret)\s*(gmail|hotmail|yahoo|outlook|icloud|proton)\b|\b(gmail|hotmail|yahoo|outlook|icloud|proton)\s*(nokta|dot)\s*com\b/
const CONF = { а:'a', е:'e', о:'o', р:'p', с:'c', х:'x', у:'y', і:'i', ѕ:'s', ј:'j', ԁ:'d', ɡ:'g', α:'a', ο:'o', ρ:'p', ν:'v', τ:'t', ι:'i', κ:'k', ε:'e', υ:'u', χ:'x' }
const fold = s => s.replace(/./gu, ch => CONF[ch] ?? ch)
const PROMISES = ['iade edece', 'iade yapaca', 'iade ver', 'paranizi geri', 'ucretsiz', 'tazmin', 'garanti', 'kesinlikle yok',
  'capraz bulas olmaz', 'zarar vermez', 'bir daha olmayacak', 'sozumuz var']
const prep = t => fold(norm(String(t).normalize('NFKC').replace(INVISIBLE, '')))
export const textUnsafe = t => {
  const n = prep(t), squashed = n.replace(/[^\p{L}\p{N}@]/gu, '')
  return URL_RE.test(n) || n.includes('@') || PHONE_RE.test(n) || SPOKEN_URL_RE.test(n) || SPOKEN_MAIL_RE.test(n) ||
    WORDS.some(w => n.includes(norm(w)) || squashed.includes(norm(w).replace(/[^\p{L}\p{N}]/gu, '')))
}
export const promiseUnsafe = t => { const n = prep(t); return PROMISES.some(p => n.includes(p)) }
