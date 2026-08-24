// core/executor/executorNode.js
// Amaç:    ARCHITECTURE.md §1.2 çıktı sözleşmesini üretir. Platform-agnostik
//          Core node — platforma özgü sözlük (prompt etiketi, decision_type,
//          placement, utm.source) çağıran modülden `platformConfig` ile
//          enjekte edilir; Core kendi başına hiçbir platform bilmez.
// Bağlı:   critic/criticNode.js (bu node'un çıktısını girdi olarak alır),
//          çağıran modülün kendi platformConfig sabitleri (IG-ADS-MODULE
//          için örn. { platformName:'instagram', placementValue:'instagram_only',
//          decisionType:'ig_campaign_brief', promptLabel:'Instagram' }).
// Risk:    platformConfig eksik/yanlış geçilirse yanlış platform etiketli
//          brief üretilir veya validasyon her zaman false döner (fail-closed
//          olduğu için sessizce yanlış onay VERMEZ, ama görevi durdurur) —
//          çağıran modül platformConfig'i her çağrıda açıkça vermeli.
// Dokunma: platformConfig şeklini değiştirmeden önce criticNode.js'in
//          buildCriticPrompt'unu ve B18 KARAR BİLDİRİMİ'ni kontrol et.
//
// [B18, Session 26 bulgusu] Instagram'a özgü sabitler ("Instagram kampanya
// brief'i", "ig_campaign_brief", placement="instagram_only", utm.source=
// "instagram") kod seviyesinden çıkarıldı, platformConfig parametresine
// taşındı. Varsayılan değer YOK — platformConfig verilmezse görev durur
// (Core'un kendi başına platform varsayması B18'in engellemek istediği
// tam da bu davranış). Mevcut IG-ADS-MODULE test dosyaları bu imza
// değişikliğiyle güncellenmeden repo'ya merge edilmemeli (bkz. AGENT.md
// §12 "önce test dosyasıyla karşılaştır" ilkesi, runPolicyEngine.js'teki
// aynı uyarı).
//
// Fail-closed: LLM çağrısı/parse/şema doğrulama zincirinin herhangi bir adımı
// başarısız olursa brief üretilmez, Critic'e hiçbir şey gitmez.

const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_OBJECTIVES = ["TRAFFIC", "ENGAGEMENT", "CONVERSIONS"];

function assertPlatformConfig(platformConfig) {
  const required = ["platformName", "placementValue", "decisionType", "promptLabel"];
  const missing = required.filter((k) => !platformConfig || typeof platformConfig[k] !== "string" || !platformConfig[k]);
  return missing;
}

function buildExecutorPrompt(request, platformConfig) {
  const r = request.campaign_brief_request;
  return [
    "Aşağıdaki kampanya talebi için ARCHITECTURE.md §1.2 şemasına birebir uyan",
    `JSON formatında bir ${platformConfig.promptLabel} kampanya brief'i üret. Sadece JSON döndür,`,
    "başka metin ekleme.",
    "",
    `trigger_source: ${r.trigger_source}`,
    `objective_hint: ${r.objective_hint}`,
    `target_window: ${r.target_window.start_date} - ${r.target_window.end_date}`,
    `requested_by: ${r.requested_by}`,
  ].join("\n");
}

// llmClient: { complete(prompt) => string } enjekte edilir.
function callExecutorModel(prompt, llmClient) {
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

function parseExecutorOutput(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return { success: true, output: parsed };
  } catch (err) {
    return { success: false, error: `JSON parse hatası: ${err.message}` };
  }
}

// §1.2 şema doğrulaması — LLM çıktısına körü körüne güvenilmez.
// [B18] decision_type/placement/utm.source artık platformConfig'ten okunur.
function validateExecutorOutput(output, platformConfig) {
  const errors = [];
  if (output === null || typeof output !== "object") {
    return ["çıktı obje değil"];
  }
  if (typeof output.decision_id !== "string" || !UUIDV4_RE.test(output.decision_id)) {
    errors.push("decision_id geçerli UUIDv4 değil");
  }
  if (output.decision_type !== platformConfig.decisionType) {
    errors.push(`decision_type "${platformConfig.decisionType}" olmalı`);
  }
  if (typeof output.executor_model !== "string" || output.executor_model.trim().length === 0) {
    errors.push("executor_model boş veya string değil");
  }
  const cb = output.campaign_brief;
  if (cb === null || typeof cb !== "object") {
    errors.push("campaign_brief obje değil");
  } else {
    errors.push(...validateCampaignBrief(cb, platformConfig));
  }
  if (typeof output.reasoning_summary !== "string" || output.reasoning_summary.trim().length === 0) {
    errors.push("reasoning_summary boş veya string değil");
  }
  if (typeof output.confidence !== "number" || output.confidence < 0.0 || output.confidence > 1.0) {
    errors.push("confidence 0.0-1.0 aralığında bir sayı değil");
  }
  return errors;
}

// [B18] validateExecutorOutput'tan ayrıştırıldı — 20 satır kuralı (§2.1),
// campaign_brief alt-obje kontrolleri artık platformConfig kullanıyor.
function validateCampaignBrief(cb, platformConfig) {
  const errors = [];
  if (!VALID_OBJECTIVES.includes(cb.objective)) {
    errors.push(`campaign_brief.objective geçersiz: "${cb.objective}"`);
  }
  if (typeof cb.daily_budget_try !== "number" || cb.daily_budget_try <= 0) {
    errors.push("campaign_brief.daily_budget_try geçerli pozitif sayı değil");
  }
  if (!Number.isInteger(cb.duration_days) || cb.duration_days <= 0) {
    errors.push("campaign_brief.duration_days geçerli pozitif tamsayı değil");
  }
  const t = cb.targeting;
  if (t === null || typeof t !== "object") {
    errors.push("campaign_brief.targeting obje değil");
  } else {
    if (!Number.isInteger(t.age_min) || !Number.isInteger(t.age_max) || t.age_min > t.age_max) {
      errors.push("campaign_brief.targeting.age_min/age_max geçersiz");
    }
    if (!Array.isArray(t.locations) || t.locations.length === 0) {
      errors.push("campaign_brief.targeting.locations boş veya dizi değil");
    }
    if (!Array.isArray(t.interests)) {
      errors.push("campaign_brief.targeting.interests dizi değil");
    }
  }
  if (cb.placement !== platformConfig.placementValue) {
    errors.push(`campaign_brief.placement "${platformConfig.placementValue}" olmalı (MASTER_PLAN §3.2)`);
  }
  const crb = cb.creative_brief;
  if (
    crb === null ||
    typeof crb !== "object" ||
    typeof crb.caption_draft !== "string" ||
    typeof crb.visual_direction !== "string"
  ) {
    errors.push("campaign_brief.creative_brief eksik/geçersiz");
  }
  const utm = cb.utm;
  if (
    utm === null ||
    typeof utm !== "object" ||
    utm.source !== platformConfig.platformName ||
    utm.medium !== "paid" ||
    typeof utm.campaign !== "string" ||
    utm.campaign.trim().length === 0 ||
    typeof utm.content !== "string" ||
    utm.content.trim().length === 0
  ) {
    errors.push("campaign_brief.utm eksik/geçersiz (MASTER_PLAN §3.2a)");
  }
  return errors;
}

// Koordinasyon. requires_critic LLM çıktısından BAĞIMSIZ olarak kod seviyesinde
// true'ya sabitlenir — buildCampaignPayload'daki publisher_platforms sabitlemesiyle
// aynı savunma mantığı (defense in depth, Executor'ın çıktısına güvenilmez).
// [B18] platformConfig eksikse fail-closed durur — Core kendi başına platform
// varsaymaz.
function runExecutorNode(request, llmClient, platformConfig) {
  const missing = assertPlatformConfig(platformConfig);
  if (missing.length > 0) {
    return { success: false, stage: "platform_config", errors: [`platformConfig eksik alan(lar): ${missing.join(", ")}`] };
  }

  const prompt = buildExecutorPrompt(request, platformConfig);

  const modelResult = callExecutorModel(prompt, llmClient);
  if (!modelResult.success) {
    return { success: false, stage: "model_call", errors: [modelResult.error] };
  }

  const parseResult = parseExecutorOutput(modelResult.rawText);
  if (!parseResult.success) {
    return { success: false, stage: "parse", errors: [parseResult.error] };
  }

  const validationErrors = validateExecutorOutput(parseResult.output, platformConfig);
  if (validationErrors.length > 0) {
    return { success: false, stage: "validation", errors: validationErrors };
  }

  const output = { ...parseResult.output, requires_critic: true };
  return { success: true, stage: "done", output };
}

module.exports = {
  buildExecutorPrompt,
  callExecutorModel,
  parseExecutorOutput,
  validateExecutorOutput,
  validateCampaignBrief,
  assertPlatformConfig,
  runExecutorNode,
};
