// core/critic/criticNode.js
// Amaç:    ARCHITECTURE.md §1.3 çıktı sözleşmesini üretir. Platform-agnostik
//          Core node — prompt'taki platform etiketi çağıran modülden
//          `platformConfig.promptLabel` ile enjekte edilir.
// Bağlı:   executor/executorNode.js (bu node'un girdisi Executor çıktısı),
//          policy-engine/runPolicyEngine.js (bu node'un çıktısını tüketir),
//          çağıran modülün platformConfig'i (executorNode.js ile aynı nesne).
// Risk:    platformConfig eksikse prompt platform belirtmeden üretilir —
//          bu durum LLM'in hangi platform için değerlendirme yaptığını
//          belirsizleştirir, fail-closed olarak durdurulur.
// Dokunma: platformConfig şeklini değiştirmeden önce executorNode.js'i ve
//          B18 KARAR BİLDİRİMİ'ni kontrol et — iki node aynı platformConfig
//          nesnesini kullanmalı.
//
// [B18, Session 26 bulgusu] Prompt metnindeki "Instagram kampanya brief'ini"
// ifadesi kod seviyesinden çıkarıldı, platformConfig.promptLabel'e taşındı.
// Bu dosyada validateCriticOutput zaten platform-agnostikti (check alan
// adları jenerik) — değişmedi.
//
// Not: Critic'in Executor'dan farklı model ailesinden olması (AMC-3) deploy-zamanı
// bir config kararıdır (IG_ADS_CRITIC_MODEL_ID != IG_ADS_EXECUTOR_MODEL_ID) —
// bu dosyanın runtime kapsamı dışında, bkz. DEPENDENCIES.md §3.
// Fail-closed: LLM çağrısı/parse/şema doğrulama zincirinin herhangi bir
// adımı başarısız olursa verdict üretilmez, Policy Engine'e hiçbir şey gitmez.

const VALID_VERDICTS = ["approve", "reject", "request_revision"];
const CHECK_FIELDS = [
  "budget_target_coherence",
  "targeting_kvkk_risk",
  "forbidden_phrase_in_caption",
  "objective_placement_mismatch",
  "utm_format_valid",
];

function buildCriticPrompt(executorOutput, platformConfig) {
  const cb = executorOutput.campaign_brief;
  return [
    `Aşağıdaki ${platformConfig.promptLabel} kampanya brief'ini ARCHITECTURE.md §1.3 şemasına birebir`,
    "uyan JSON formatında değerlendir. Sadece JSON döndür, başka metin ekleme.",
    "",
    `objective: ${cb.objective}`,
    `daily_budget_try: ${cb.daily_budget_try}`,
    `targeting: ${JSON.stringify(cb.targeting)}`,
    `placement: ${cb.placement}`,
    `caption_draft: ${cb.creative_brief.caption_draft}`,
    `utm: ${JSON.stringify(cb.utm)}`,
    `reasoning_summary: ${executorOutput.reasoning_summary}`,
  ].join("\n");
}

// llmClient: { complete(prompt) => string } enjekte edilir.
function callCriticModel(prompt, llmClient) {
  if (!llmClient || typeof llmClient.complete !== "function") {
    return { success: false, error: "llmClient enjekte edilmedi veya complete() fonksiyonu yok" };
  }
  try {
    const rawText = llmClient.complete(prompt);
    if (typeof rawText !== "string" || rawText.trim().length === 0) {
      return { success: false, error: "llmClient boş/geçersiz yanıt döndürdü" };
    }
    return { success: true, rawText };
  } catch (err) {
    return { success: false, error: `llmClient çağrısı hata verdi: ${err.message}` };
  }
}

function parseCriticOutput(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return { success: true, output: parsed };
  } catch (err) {
    return { success: false, error: `JSON parse hatası: ${err.message}` };
  }
}

// §1.3 şema doğrulaması — LLM çıktısına körü körüne güvenilmez.
// Zaten platform-agnostikti — B18 kapsamında değişiklik yok.
function validateCriticOutput(output) {
  const errors = [];
  if (output === null || typeof output !== "object") {
    return ["çıktı obje değil"];
  }
  if (!VALID_VERDICTS.includes(output.critic_verdict)) {
    errors.push(`critic_verdict geçersiz: "${output.critic_verdict}"`);
  }
  if (typeof output.critic_model !== "string" || output.critic_model.trim().length === 0) {
    errors.push("critic_model boş veya string değil");
  }
  const checks = output.checks;
  if (checks === null || typeof checks !== "object") {
    errors.push("checks obje değil");
  } else {
    for (const field of CHECK_FIELDS) {
      if (typeof checks[field] !== "boolean") {
        errors.push(`checks.${field} boolean değil`);
      }
    }
  }
  if (typeof output.notes !== "string") {
    errors.push("notes string değil");
  }
  return errors;
}

// Koordinasyon. Fail-closed: herhangi bir aşama başarısız olursa Policy Engine'e
// hiçbir çıktı gitmez (executorNode.js'in runExecutorNode deseniyle aynı).
// [B18] platformConfig eksikse fail-closed durur.
function runCriticNode(executorOutput, llmClient, platformConfig) {
  if (!platformConfig || typeof platformConfig.promptLabel !== "string" || !platformConfig.promptLabel) {
    return { success: false, stage: "platform_config", errors: ["platformConfig.promptLabel eksik"] };
  }

  const prompt = buildCriticPrompt(executorOutput, platformConfig);

  const modelResult = callCriticModel(prompt, llmClient);
  if (!modelResult.success) {
    return { success: false, stage: "model_call", errors: [modelResult.error] };
  }

  const parseResult = parseCriticOutput(modelResult.rawText);
  if (!parseResult.success) {
    return { success: false, stage: "parse", errors: [parseResult.error] };
  }

  const validationErrors = validateCriticOutput(parseResult.output);
  if (validationErrors.length > 0) {
    return { success: false, stage: "validation", errors: validationErrors };
  }

  return { success: true, stage: "done", output: parseResult.output };
}

module.exports = {
  buildCriticPrompt,
  callCriticModel,
  parseCriticOutput,
  validateCriticOutput,
  runCriticNode,
};
