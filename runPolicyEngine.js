// policy-engine/runPolicyEngine.js
// Amaç:    checks.js'teki 7 kontrol fonksiyonunu ARCHITECTURE.md §1.4'te
//          tanımlı sabit sırayla çağırır, tek bir approved/results çıktısına
//          birleştirir. execution-gate/gate.js'in checkPolicyEngineApproved
//          fonksiyonu bu çıktının .approved ve .decision_id alanlarını tüketir.
// Bağlı:   policy-engine/checks.js (7 fonksiyon), execution-gate/gate.js
//          (bu dosyanın çıktısını girdi olarak alır).
// AMC:     checks.js'teki tüm AMC kodları (AMC-1, AMC-3, AMC-4, AMC-8) —
//          bu dosya bir kontrol eklemez, sadece koordine eder.
// Risk:    Kontrol sırası ARCHITECTURE.md §1.4'ün 7 maddelik resmi listesiyle
//          [DÜZELTİLDİ] birebir eşleştirildi (bkz. Değişiklik notu) — audit
//          log'daki `policy_engine_result` dizisi artık §1.4'teki numaralarla
//          birebir okunabilir.
// DÜZELTME NOTU (aynı oturum): İlk taslakta `checkCriticApproved` yanlışlıkla
//          en başa konmuştu (checks.js'in export sırası izlenmişti). ARCHITECTURE.md
//          §1.4 yüklenince gerçek sıranın budget→pct→placement→creative→utm→
//          critic_approved→critic_checks_independent olduğu görüldü, düzeltildi.
//          `.every()` kullanıldığı için approve/reject KARARI ilk taslakta da
//          doğruydu — sadece `results` dizisinin okunabilirliği etkileniyordu.
//          Gerçek Policy Engine'in 30/30 test dosyasıyla (hâlâ bu ajana
//          yüklenmedi) karşılaştırılmadan repo'ya merge edilmemeli — AGENT.md Kural 1.

/**
 * checks.js'in 7 fonksiyonunu enjekte edilen input'tan besler. `checkFns`
 * parametresi test edilebilirlik için ayrılabilir (gerçek require yerine
 * mock geçilebilir) — gate.js/metaApi.js'teki client-enjeksiyon deseniyle
 * tutarlı, ama burada varsayılan olarak gerçek checks.js kullanılır.
 */
function buildPolicyChecks(input, config, checkFns) {
  const {
    critic_verdict,
    critic_checks,
    daily_budget_try,
    active_total_budget_try,
    placement,
    creative_uploaded,
    utm,
  } = input || {};

  // Sıra ARCHITECTURE.md §1.4'ün numaralı listesiyle (1-7) birebir eşleşir.
  return [
    checkFns.checkBudgetCap(daily_budget_try, active_total_budget_try, config),      // 1 — AMC-1
    checkFns.checkSingleCampaignPct(daily_budget_try, config),                        // 2 — AMC-1
    checkFns.checkPlacementLock(placement, config),                                   // 3 — AMC-4
    checkFns.checkCreativeUploaded(creative_uploaded),                                // 4 — AMC-8
    checkFns.checkUtmComplete(utm),                                                   // 5
    checkFns.checkCriticApproved(critic_verdict),                                     // 6 — AMC-3
    checkFns.checkCriticChecksIndependent(critic_checks),                             // 7 — AMC-3, AMC-4
  ];
}

/**
 * Koordinasyon fonksiyonu. `input.decision_id` sadece taşınır, doğrulanmaz
 * (execution-gate/gate.js'in checkDecisionIdMatch'i bunu envelope ile
 * karşılaştırıyor, duplicate kontrol burada tekrarlanmıyor — AGENT.md §27).
 * checkFns parametresi verilmezse gerçek checks.js kullanılır.
 */
function runPolicyEngine(input, config, checkFns) {
  const fns = checkFns || require('./checks');
  const results = buildPolicyChecks(input, config, fns);
  const approved = results.every((r) => r.passed);

  return {
    decision_id: input && input.decision_id,
    approved,
    results,
  };
}

module.exports = {
  buildPolicyChecks,
  runPolicyEngine,
};
