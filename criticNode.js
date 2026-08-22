// critic/criticNode.js
// ARCHITECTURE.md §1.3 çıktı sözleşmesini üretir. `llmClient` enjekte edilir
// (executorNode.js/gate.js/metaApi.js deseniyle aynı) — gerçek GPT API bağlantısı
// kullanıcının kendi ortamında bağımsız doğrulanacak, burada mock client ile test
// edilir. Fail-closed: LLM çağrısı/parse/şema doğrulama zincirinin herhangi bir
// adımı başarısız olursa verdict üretilmez, Policy Engine'e hiçbir şey gitmez.
// Not: Critic'in Executor'dan farklı model ailesinden olması (AMC-3) deploy-zamanı
// bir config kararıdır (IG_ADS_CRITIC_MODEL_ID != IG_ADS_EXECUTOR_MODEL_ID) —
// bu dosyanın runtime kapsamı dışında, bkz. DEPENDENCIES.md §3.

const VALID_VERDICTS = ["approve", "reject", "request_revision"];
const CHECK_FIELDS = [
  "budget_target_coherence",
  "targeting_kvkk_risk",
  "forbidden_phrase_in_caption",
  "objective_placement_mismatch",
  "utm_format_valid",
];

function buildCriticPrompt(executorOutput) {
  const cb = executorOutput.campaign_brief;
  return [
    "Aşağıdaki Instagram kampanya brief'ini ARCHITECTURE.md §1.3 şemasına birebir",
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
function runCriticNode(executorOutput, llmClient) {
  const prompt = buildCriticPrompt(executorOutput);

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
