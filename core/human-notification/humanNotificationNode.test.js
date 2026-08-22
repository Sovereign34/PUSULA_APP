// core/human-notification/humanNotificationNode.test.js
// Amaç:    humanNotificationNode.js'in birim testleri — checks.test.js/
//          gate.test.js ile aynı desen (geçerli/sınır/aşım/null).
// Bağlı:   humanNotificationNode.js
// AMC:     AMC-8, AMC-4 (bkz. kaynak dosya)
// Risk:    Bu testler geçmeden node'a güvenilmez.
// Dokunma: humanNotificationNode.js değişirse burası da güncellenmeli.

const assert = require("assert");
const {
  checkCreativeUploaded,
  buildApprovalRequestMessage,
  parseApprovalReply,
  checkDecisionIdMatch,
  checkApprovalTimeoutExpired,
  runHumanNotificationNode,
} = require("./humanNotificationNode");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL: ${name}\n  ${e.message}`);
  }
}

const DID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_DID = "999e4567-e89b-12d3-a456-426614174999";

// --- checkCreativeUploaded ---
test("checkCreativeUploaded: geçerli URL -> true", () => {
  assert.strictEqual(checkCreativeUploaded("https://cdn.example.com/x.jpg"), true);
});
test("checkCreativeUploaded: null -> false (fail-closed)", () => {
  assert.strictEqual(checkCreativeUploaded(null), false);
});
test("checkCreativeUploaded: undefined -> false", () => {
  assert.strictEqual(checkCreativeUploaded(undefined), false);
});
test("checkCreativeUploaded: boş string -> false", () => {
  assert.strictEqual(checkCreativeUploaded(""), false);
});
test("checkCreativeUploaded: sadece boşluk -> false", () => {
  assert.strictEqual(checkCreativeUploaded("   "), false);
});
test("checkCreativeUploaded: sayı verilirse -> false", () => {
  assert.strictEqual(checkCreativeUploaded(123), false);
});

// --- buildApprovalRequestMessage ---
test("buildApprovalRequestMessage: decision_id mesaja işleniyor", () => {
  const msg = buildApprovalRequestMessage({ decision_id: DID });
  assert.ok(msg.includes(`ONAYLA ${DID}`));
  assert.ok(msg.includes(`REDDET ${DID}`));
});
test("buildApprovalRequestMessage: decision_id eksikse hata", () => {
  assert.throws(() => buildApprovalRequestMessage({}));
});
test("buildApprovalRequestMessage: envelope null ise hata", () => {
  assert.throws(() => buildApprovalRequestMessage(null));
});

// --- parseApprovalReply ---
test("parseApprovalReply: geçerli ONAYLA", () => {
  const r = parseApprovalReply(`ONAYLA ${DID}`);
  assert.deepStrictEqual(r, { action: "approve", decisionId: DID });
});
test("parseApprovalReply: geçerli REDDET", () => {
  const r = parseApprovalReply(`REDDET ${DID}`);
  assert.deepStrictEqual(r, { action: "reject", decisionId: DID });
});
test("parseApprovalReply: küçük harf onayla da kabul (case-insensitive anahtar kelime)", () => {
  const r = parseApprovalReply(`onayla ${DID}`);
  assert.strictEqual(r.action, "approve");
});
test("parseApprovalReply: serbest metin -> unrecognized", () => {
  const r = parseApprovalReply("evet tamam onaylıyorum");
  assert.strictEqual(r.action, "unrecognized");
});
test("parseApprovalReply: emoji -> unrecognized", () => {
  const r = parseApprovalReply("👍");
  assert.strictEqual(r.action, "unrecognized");
});
test("parseApprovalReply: decision_id eksik -> unrecognized", () => {
  const r = parseApprovalReply("ONAYLA");
  assert.strictEqual(r.action, "unrecognized");
});
test("parseApprovalReply: null girdi -> unrecognized", () => {
  const r = parseApprovalReply(null);
  assert.strictEqual(r.action, "unrecognized");
});
test("parseApprovalReply: kısa/geçersiz uuid -> unrecognized", () => {
  const r = parseApprovalReply("ONAYLA 12345");
  assert.strictEqual(r.action, "unrecognized");
});

// --- checkDecisionIdMatch ---
test("checkDecisionIdMatch: birebir eşleşme -> true", () => {
  assert.strictEqual(checkDecisionIdMatch(DID, DID), true);
});
test("checkDecisionIdMatch: case-insensitive eşleşme -> true", () => {
  assert.strictEqual(checkDecisionIdMatch(DID.toUpperCase(), DID), true);
});
test("checkDecisionIdMatch: farklı id -> false (AMC-4)", () => {
  assert.strictEqual(checkDecisionIdMatch(OTHER_DID, DID), false);
});
test("checkDecisionIdMatch: null parsed -> false", () => {
  assert.strictEqual(checkDecisionIdMatch(null, DID), false);
});
test("checkDecisionIdMatch: expected eksik -> false", () => {
  assert.strictEqual(checkDecisionIdMatch(DID, null), false);
});

// --- checkApprovalTimeoutExpired ---
test("checkApprovalTimeoutExpired: 1 saat sonra, 24s limit -> false", () => {
  const sent = "2026-08-16T00:00:00.000Z";
  const now = "2026-08-16T01:00:00.000Z";
  assert.strictEqual(checkApprovalTimeoutExpired(sent, now, 24), false);
});
test("checkApprovalTimeoutExpired: tam 24 saat -> true (sınır dahil)", () => {
  const sent = "2026-08-16T00:00:00.000Z";
  const now = "2026-08-17T00:00:00.000Z";
  assert.strictEqual(checkApprovalTimeoutExpired(sent, now, 24), true);
});
test("checkApprovalTimeoutExpired: 25 saat sonra -> true", () => {
  const sent = "2026-08-16T00:00:00.000Z";
  const now = "2026-08-17T01:00:00.000Z";
  assert.strictEqual(checkApprovalTimeoutExpired(sent, now, 24), true);
});
test("checkApprovalTimeoutExpired: geçersiz tarih -> hata (sessiz geçme yok)", () => {
  assert.throws(() => checkApprovalTimeoutExpired("gecersiz", "2026-08-16T00:00:00.000Z"));
});

// --- runHumanNotificationNode (koordinasyon) ---
test("runHumanNotificationNode: kreatif yok -> blocked_no_creative (AMC-8)", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: null,
  });
  assert.strictEqual(r.status, "blocked_no_creative");
});
test("runHumanNotificationNode: kreatif var, yanıt yok -> mesaj gönderilir, awaiting_response", () => {
  let sentMessage = null;
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    sendMessageFn: (msg) => { sentMessage = msg; },
  });
  assert.strictEqual(r.status, "awaiting_response");
  assert.ok(sentMessage.includes(DID));
});
test("runHumanNotificationNode: sendMessageFn enjekte edilmemiş -> hata (fail-closed)", () => {
  assert.throws(() => runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
  }));
});
test("runHumanNotificationNode: geçerli ONAYLA, timeout içinde -> human_approved", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    incomingReply: `ONAYLA ${DID}`,
    sentAtIso: "2026-08-16T00:00:00.000Z",
    nowIso: "2026-08-16T01:00:00.000Z",
  });
  assert.strictEqual(r.status, "human_approved");
});
test("runHumanNotificationNode: geçerli REDDET -> human_rejected", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    incomingReply: `REDDET ${DID}`,
    sentAtIso: "2026-08-16T00:00:00.000Z",
    nowIso: "2026-08-16T01:00:00.000Z",
  });
  assert.strictEqual(r.status, "human_rejected");
});
test("runHumanNotificationNode: timeout dolmuş, geç gelen ONAYLA bile -> human_timeout", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    incomingReply: `ONAYLA ${DID}`,
    sentAtIso: "2026-08-16T00:00:00.000Z",
    nowIso: "2026-08-17T02:00:00.000Z",
  });
  assert.strictEqual(r.status, "human_timeout");
});
test("runHumanNotificationNode: yanlış decision_id -> unrecognized_or_mismatched (AMC-4)", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    incomingReply: `ONAYLA ${OTHER_DID}`,
    sentAtIso: "2026-08-16T00:00:00.000Z",
    nowIso: "2026-08-16T01:00:00.000Z",
  });
  assert.strictEqual(r.status, "unrecognized_or_mismatched");
});
test("runHumanNotificationNode: serbest metin yanıt -> unrecognized_or_mismatched", () => {
  const r = runHumanNotificationNode({
    decisionEnvelope: { decision_id: DID },
    creativeRef: "https://cdn.example.com/x.jpg",
    incomingReply: "tamam onaylıyorum",
    sentAtIso: "2026-08-16T00:00:00.000Z",
    nowIso: "2026-08-16T01:00:00.000Z",
  });
  assert.strictEqual(r.status, "unrecognized_or_mismatched");
});

console.log(`\n${passed}/${passed + failed} test geçti.`);
if (failed > 0) process.exit(1);
