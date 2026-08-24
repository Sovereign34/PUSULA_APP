// core/executor/executorNode.test.js
// [B18, Session 26 (devam 3)] platformConfig imzasına güncellendi — eski
// çağrılar platformConfig parametresi vermiyordu, bu yüzden validateExecutorOutput
// ve runExecutorNode her koşulda "eksik alan" hatası veriyordu. IG_PLATFORM_CONFIG
// fixture'ı eklendi, tüm çağrılara üçüncü/ikinci argüman olarak geçildi.
// assertPlatformConfig için ayrı bir test bloğu eklendi (daha önce hiç test
// edilmiyordu). Aşağıdaki mevcut testlerin davranışı DEĞİŞMEDİ — sadece
// platformConfig enjekte edildi.

const {
  buildExecutorPrompt,
  callExecutorModel,
  parseExecutorOutput,
  validateExecutorOutput,
  assertPlatformConfig,
  runExecutorNode,
} = require("./executorNode");

let pass = 0;
let fail = 0;

function assert(condition, message) {
  if (condition) {
    pass++;
  } else {
    fail++;
    console.error(`FAIL: ${message}`);
  }
}

// [B18] platformConfig fixture — IG-ADS-MODULE'ün kendi platformConfig'i
// (executorNode.js'in başındaki örnekle birebir).
const IG_PLATFORM_CONFIG = {
  platformName: "instagram",
  placementValue: "instagram_only",
  decisionType: "ig_campaign_brief",
  promptLabel: "Instagram",
};

const validRequest = {
  campaign_brief_request: {
    trigger_source: "manual",
    objective_hint: "hafta sonu trafiği",
    target_window: { start_date: "2026-08-20T00:00:00Z", end_date: "2026-08-27T00:00:00Z" },
    requested_by: "bari",
  },
};

function validOutputObj(overrides = {}) {
  return {
    decision_id: "123e4567-e89b-4a3d-9456-426614174000",
    decision_type: "ig_campaign_brief",
    executor_model: "claude-sonnet-5",
    campaign_brief: {
      objective: "TRAFFIC",
      daily_budget_try: 500,
      duration_days: 7,
      targeting: { age_min: 18, age_max: 45, locations: ["İstanbul"], interests: ["kahve"] },
      placement: "instagram_only",
      creative_brief: { caption_draft: "Yeni ürünümüz geldi!", visual_direction: "sıcak tonlar" },
      utm: { source: "instagram", medium: "paid", campaign: "hafta_sonu", content: "creative_1" },
    },
    reasoning_summary: "Hafta sonu trafiğini artırmak için hedeflenmiş kampanya",
    confidence: 0.85,
    requires_critic: false, // kasıtlı yanlış — runExecutorNode'un düzelttiğini test edeceğiz
    ...overrides,
  };
}

// --- assertPlatformConfig [B18, yeni] ---
assert(assertPlatformConfig(IG_PLATFORM_CONFIG).length === 0, "assertPlatformConfig: tam platformConfig hatasız");
assert(assertPlatformConfig(null).length === 4, "assertPlatformConfig: null tüm 4 alanı eksik saymalı");
assert(assertPlatformConfig(undefined).length === 4, "assertPlatformConfig: undefined tüm 4 alanı eksik saymalı");
assert(
  assertPlatformConfig({ ...IG_PLATFORM_CONFIG, promptLabel: "" }).includes("promptLabel"),
  "assertPlatformConfig: boş string eksik sayılmalı"
);
assert(
  assertPlatformConfig({ platformName: "instagram" }).length === 3,
  "assertPlatformConfig: kısmi obje kalan alanları listelemeli"
);
assert(
  assertPlatformConfig({ ...IG_PLATFORM_CONFIG, decisionType: 42 }).includes("decisionType"),
  "assertPlatformConfig: string olmayan alan eksik sayılmalı"
);

// --- buildExecutorPrompt ---
const prompt = buildExecutorPrompt(validRequest, IG_PLATFORM_CONFIG);
assert(typeof prompt === "string" && prompt.includes("manual"), "buildExecutorPrompt: trigger_source prompt'a giriyor");
assert(prompt.includes("hafta sonu trafiği"), "buildExecutorPrompt: objective_hint prompt'a giriyor");
assert(prompt.includes("Instagram"), "buildExecutorPrompt: platformConfig.promptLabel prompt'a giriyor [B18]");

// --- callExecutorModel (platformConfig'ten bağımsız — değişmedi) ---
assert(
  callExecutorModel(prompt, { complete: () => "{}" }).success === true,
  "callExecutorModel: geçerli client kabul edilmeli"
);
assert(callExecutorModel(prompt, null).success === false, "callExecutorModel: llmClient yoksa fail-closed");
assert(
  callExecutorModel(prompt, {}).success === false,
  "callExecutorModel: complete() fonksiyonu yoksa fail-closed"
);
assert(
  callExecutorModel(prompt, { complete: () => "" }).success === false,
  "callExecutorModel: boş yanıt fail-closed"
);
assert(
  callExecutorModel(prompt, {
    complete: () => {
      throw new Error("API timeout");
    },
  }).success === false,
  "callExecutorModel: client hata atarsa fail-closed"
);

// --- parseExecutorOutput (platformConfig'ten bağımsız — değişmedi) ---
assert(parseExecutorOutput('{"a":1}').success === true, "parseExecutorOutput: geçerli JSON kabul edilmeli");
assert(parseExecutorOutput("bozuk json{{{").success === false, "parseExecutorOutput: bozuk JSON fail-closed");
assert(parseExecutorOutput("").success === false, "parseExecutorOutput: boş string fail-closed");

// --- validateExecutorOutput [B18: platformConfig ikinci argüman] ---
assert(
  validateExecutorOutput(validOutputObj(), IG_PLATFORM_CONFIG).length === 0,
  "validateExecutorOutput: geçerli çıktı hatasız"
);
assert(validateExecutorOutput(null, IG_PLATFORM_CONFIG).length > 0, "validateExecutorOutput: null reddedilmeli");
assert(
  validateExecutorOutput(validOutputObj({ decision_id: "not-a-uuid" }), IG_PLATFORM_CONFIG).length > 0,
  "validateExecutorOutput: geçersiz UUID reddedilmeli"
);
assert(
  validateExecutorOutput(validOutputObj({ decision_type: "wrong_type" }), IG_PLATFORM_CONFIG).length > 0,
  "validateExecutorOutput: yanlış decision_type reddedilmeli (platformConfig.decisionType ile karşılaştırılır)"
);
assert(
  validateExecutorOutput(
    { ...validOutputObj(), campaign_brief: { ...validOutputObj().campaign_brief, objective: "AWARENESS" } },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: şema dışı objective reddedilmeli"
);
assert(
  validateExecutorOutput(
    { ...validOutputObj(), campaign_brief: { ...validOutputObj().campaign_brief, daily_budget_try: 0 } },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: daily_budget_try=0 reddedilmeli (sınır)"
);
assert(
  validateExecutorOutput(
    { ...validOutputObj(), campaign_brief: { ...validOutputObj().campaign_brief, daily_budget_try: -50 } },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: negatif daily_budget_try reddedilmeli"
);
assert(
  validateExecutorOutput(
    { ...validOutputObj(), campaign_brief: { ...validOutputObj().campaign_brief, placement: "facebook" } },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: platformConfig.placementValue dışı placement reddedilmeli"
);
assert(
  validateExecutorOutput(
    {
      ...validOutputObj(),
      campaign_brief: {
        ...validOutputObj().campaign_brief,
        targeting: { age_min: 45, age_max: 18, locations: ["İstanbul"], interests: [] },
      },
    },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: age_min > age_max reddedilmeli"
);
assert(
  validateExecutorOutput(
    {
      ...validOutputObj(),
      campaign_brief: { ...validOutputObj().campaign_brief, targeting: { age_min: 18, age_max: 45, locations: [], interests: [] } },
    },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: boş locations reddedilmeli"
);
assert(
  validateExecutorOutput(
    {
      ...validOutputObj(),
      campaign_brief: {
        ...validOutputObj().campaign_brief,
        utm: { source: "facebook", medium: "paid", campaign: "x", content: "y" },
      },
    },
    IG_PLATFORM_CONFIG
  ).length > 0,
  "validateExecutorOutput: utm.source platformConfig.platformName değilse reddedilmeli"
);
assert(
  validateExecutorOutput({ ...validOutputObj(), confidence: 1.5 }, IG_PLATFORM_CONFIG).length > 0,
  "validateExecutorOutput: confidence > 1.0 reddedilmeli"
);
assert(
  validateExecutorOutput({ ...validOutputObj(), confidence: -0.1 }, IG_PLATFORM_CONFIG).length > 0,
  "validateExecutorOutput: confidence < 0.0 reddedilmeli"
);
assert(
  validateExecutorOutput({ ...validOutputObj(), confidence: 0.0 }, IG_PLATFORM_CONFIG).length === 0,
  "validateExecutorOutput: confidence == 0.0 kabul edilmeli (sınır)"
);
assert(
  validateExecutorOutput({ ...validOutputObj(), confidence: 1.0 }, IG_PLATFORM_CONFIG).length === 0,
  "validateExecutorOutput: confidence == 1.0 kabul edilmeli (sınır)"
);

// --- runExecutorNode (koordinasyon) [B18: platformConfig üçüncü argüman] ---
const goodClient = { complete: () => JSON.stringify(validOutputObj()) };
const goodResult = runExecutorNode(validRequest, goodClient, IG_PLATFORM_CONFIG);
assert(goodResult.success === true, "runExecutorNode: geçerli akış başarılı olmalı");
assert(
  goodResult.output.requires_critic === true,
  "runExecutorNode: requires_critic LLM çıktısından bağımsız true'ya sabitlenmeli (defense in depth)"
);

const brokenClient = { complete: () => { throw new Error("down"); } };
const brokenResult = runExecutorNode(validRequest, brokenClient, IG_PLATFORM_CONFIG);
assert(brokenResult.success === false, "runExecutorNode: model çağrısı çökerse fail-closed");
assert(brokenResult.stage === "model_call", "runExecutorNode: hata aşaması model_call olarak işaretlenmeli");

const badJsonClient = { complete: () => "not json" };
const badJsonResult = runExecutorNode(validRequest, badJsonClient, IG_PLATFORM_CONFIG);
assert(badJsonResult.success === false, "runExecutorNode: bozuk JSON fail-closed");
assert(badJsonResult.stage === "parse", "runExecutorNode: hata aşaması parse olarak işaretlenmeli");

const invalidSchemaClient = { complete: () => JSON.stringify(validOutputObj({ decision_id: "bad" })) };
const invalidSchemaResult = runExecutorNode(validRequest, invalidSchemaClient, IG_PLATFORM_CONFIG);
assert(invalidSchemaResult.success === false, "runExecutorNode: şema ihlali fail-closed");
assert(invalidSchemaResult.stage === "validation", "runExecutorNode: hata aşaması validation olarak işaretlenmeli");

// --- runExecutorNode: platformConfig eksik/kısmi [B18, yeni testler] ---
const noConfigResult = runExecutorNode(validRequest, goodClient, null);
assert(noConfigResult.success === false, "runExecutorNode: platformConfig yoksa fail-closed");
assert(
  noConfigResult.stage === "platform_config",
  "runExecutorNode: platformConfig eksikse hata aşaması platform_config olmalı"
);

const partialConfigResult = runExecutorNode(validRequest, goodClient, { platformName: "instagram" });
assert(partialConfigResult.success === false, "runExecutorNode: kısmi platformConfig fail-closed");
assert(
  partialConfigResult.stage === "platform_config",
  "runExecutorNode: kısmi platformConfig'te de hata aşaması platform_config olmalı"
);
assert(
  partialConfigResult.errors[0].includes("placementValue"),
  "runExecutorNode: kısmi platformConfig hatasında eksik alan adı geçmeli"
);

console.log(`\n${pass}/${pass + fail} geçti`);
if (fail > 0) process.exit(1);
