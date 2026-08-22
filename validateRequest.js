// trigger/validateRequest.js
// ARCHITECTURE.md §1.1 girdi sözleşmesini doğrular — Executor'a (LLM) malformed
// girdi sızmasın diye, zincirin en erken/en ucuz noktasında fail-closed kontrol.
// Hiçbir AMC koduna doğrudan bağlı değil (veri bütünlüğü kontrolü), ama projenin
// "bir üst node'un çıktısına körü körüne güvenme" ilkesiyle (checks.js madde 6,
// checkCriticChecksIndependent emsali) tutarlı.

const VALID_TRIGGER_SOURCES = ["manual", "scheduled", "performance_alert"];

function checkTriggerSource(source) {
  if (typeof source !== "string" || !VALID_TRIGGER_SOURCES.includes(source)) {
    return `trigger_source geçersiz: "${source}" — beklenen: ${VALID_TRIGGER_SOURCES.join(" | ")}`;
  }
  return null;
}

function checkObjectiveHint(hint) {
  if (typeof hint !== "string" || hint.trim().length === 0) {
    return "objective_hint boş veya string değil";
  }
  return null;
}

function checkTargetWindow(window) {
  if (window === null || typeof window !== "object") {
    return "target_window obje değil";
  }
  const { start_date, end_date } = window;
  const start = new Date(start_date);
  const end = new Date(end_date);
  if (typeof start_date !== "string" || isNaN(start.getTime())) {
    return `target_window.start_date geçersiz ISO 8601: "${start_date}"`;
  }
  if (typeof end_date !== "string" || isNaN(end.getTime())) {
    return `target_window.end_date geçersiz ISO 8601: "${end_date}"`;
  }
  if (start.getTime() >= end.getTime()) {
    return "target_window.start_date, end_date'ten önce olmalı";
  }
  return null;
}

function checkRequestedBy(requestedBy) {
  if (typeof requestedBy !== "string" || requestedBy.trim().length === 0) {
    return "requested_by boş veya string değil — bu modülde her zaman insan tetikler (§1.1 notu)";
  }
  return null;
}

// Koordinasyon — fail-closed: herhangi bir alan geçersizse Executor'a hiç geçilmez.
function runTriggerValidation(request) {
  if (request === null || typeof request !== "object" || request.campaign_brief_request === undefined) {
    return { valid: false, errors: ["campaign_brief_request alanı eksik veya obje değil"] };
  }
  const r = request.campaign_brief_request;
  const checks = [
    checkTriggerSource(r.trigger_source),
    checkObjectiveHint(r.objective_hint),
    checkTargetWindow(r.target_window),
    checkRequestedBy(r.requested_by),
  ];
  const errors = checks.filter((e) => e !== null);
  return { valid: errors.length === 0, errors };
}

module.exports = {
  checkTriggerSource,
  checkObjectiveHint,
  checkTargetWindow,
  checkRequestedBy,
  runTriggerValidation,
};
