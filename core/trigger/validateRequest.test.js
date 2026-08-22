const {
  checkTriggerSource,
  checkObjectiveHint,
  checkTargetWindow,
  checkRequestedBy,
  runTriggerValidation,
} = require("./validateRequest");

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

const validRequest = {
  campaign_brief_request: {
    trigger_source: "manual",
    objective_hint: "hafta sonu trafiği",
    target_window: { start_date: "2026-08-20T00:00:00Z", end_date: "2026-08-27T00:00:00Z" },
    requested_by: "bari",
  },
};

// --- checkTriggerSource ---
assert(checkTriggerSource("manual") === null, "trigger_source: manual geçerli");
assert(checkTriggerSource("scheduled") === null, "trigger_source: scheduled geçerli");
assert(checkTriggerSource("performance_alert") === null, "trigger_source: performance_alert geçerli");
assert(checkTriggerSource("webhook") !== null, "trigger_source: şema dışı değer reddedilmeli");
assert(checkTriggerSource(null) !== null, "trigger_source: null reddedilmeli");
assert(checkTriggerSource(undefined) !== null, "trigger_source: undefined reddedilmeli");
assert(checkTriggerSource(123) !== null, "trigger_source: sayı reddedilmeli");

// --- checkObjectiveHint ---
assert(checkObjectiveHint("yeni ürün lansmanı") === null, "objective_hint: dolu string geçerli");
assert(checkObjectiveHint("") !== null, "objective_hint: boş string reddedilmeli");
assert(checkObjectiveHint("   ") !== null, "objective_hint: sadece boşluk reddedilmeli");
assert(checkObjectiveHint(null) !== null, "objective_hint: null reddedilmeli");
assert(checkObjectiveHint(42) !== null, "objective_hint: sayı reddedilmeli");

// --- checkTargetWindow ---
assert(
  checkTargetWindow({ start_date: "2026-08-20T00:00:00Z", end_date: "2026-08-27T00:00:00Z" }) === null,
  "target_window: geçerli aralık kabul edilmeli"
);
assert(checkTargetWindow(null) !== null, "target_window: null reddedilmeli");
assert(checkTargetWindow("2026-08-20") !== null, "target_window: string (obje değil) reddedilmeli");
assert(
  checkTargetWindow({ start_date: "geçersiz-tarih", end_date: "2026-08-27T00:00:00Z" }) !== null,
  "target_window: geçersiz start_date reddedilmeli"
);
assert(
  checkTargetWindow({ start_date: "2026-08-20T00:00:00Z", end_date: "geçersiz-tarih" }) !== null,
  "target_window: geçersiz end_date reddedilmeli"
);
assert(
  checkTargetWindow({ start_date: "2026-08-27T00:00:00Z", end_date: "2026-08-20T00:00:00Z" }) !== null,
  "target_window: start >= end reddedilmeli (sınır ihlali)"
);
assert(
  checkTargetWindow({ start_date: "2026-08-20T00:00:00Z", end_date: "2026-08-20T00:00:00Z" }) !== null,
  "target_window: start == end reddedilmeli (sınır)"
);

// --- checkRequestedBy ---
assert(checkRequestedBy("bari") === null, "requested_by: dolu string geçerli");
assert(checkRequestedBy("") !== null, "requested_by: boş string reddedilmeli — insan tetikleyici zorunlu");
assert(checkRequestedBy(null) !== null, "requested_by: null reddedilmeli");

// --- runTriggerValidation (koordinasyon, fail-closed) ---
assert(runTriggerValidation(validRequest).valid === true, "runTriggerValidation: geçerli istek kabul edilmeli");
assert(runTriggerValidation(validRequest).errors.length === 0, "runTriggerValidation: geçerli istekte hata olmamalı");

assert(runTriggerValidation(null).valid === false, "runTriggerValidation: null istek reddedilmeli (fail-closed)");
assert(runTriggerValidation({}).valid === false, "runTriggerValidation: campaign_brief_request eksikse reddedilmeli");
assert(
  runTriggerValidation({ campaign_brief_request: {} }).valid === false,
  "runTriggerValidation: boş campaign_brief_request reddedilmeli"
);

const multiError = runTriggerValidation({
  campaign_brief_request: { trigger_source: "bad", objective_hint: "", target_window: null, requested_by: "" },
});
assert(multiError.valid === false, "runTriggerValidation: çoklu hata reddedilmeli");
assert(multiError.errors.length === 4, "runTriggerValidation: 4 alanın hepsi hatalıysa 4 hata dönmeli");

console.log(`\n${pass}/${pass + fail} geçti`);
if (fail > 0) process.exit(1);
