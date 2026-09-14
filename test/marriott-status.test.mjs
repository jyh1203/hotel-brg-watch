import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { latestSuccessfulMarriott, marriottStatusLabel } from "../site/marriott-status.js";
import { isMarriottRateRequestUrl, safeNetworkEntry, sanitizeDiagnosticUrl, sanitizePageHtml } from "../src/marriott-artifacts.mjs";

const validator = (result) => result?.marriott?.status === "ok" ? result.marriott : null;

test("keeps the last successful Marriott rate when a later attempt fails", () => {
  const runs = [
    { capturedAt: "2026-09-01T00:00:00Z", results: [{ id: "madrid", marriott: { status: "ok", totalAmount: 760 } }] },
    { capturedAt: "2026-09-02T00:00:00Z", results: [{ id: "madrid", marriott: { status: "blocked" } }] }
  ];
  const latest = latestSuccessfulMarriott(runs, "madrid", validator);
  assert.equal(latest.rate.totalAmount, 760);
  assert.equal(latest.run.capturedAt, "2026-09-01T00:00:00Z");
  assert.equal(latest.stale, true);
  assert.equal(marriottStatusLabel("session-expired"), "로그인 세션 갱신 필요");
  assert.equal(marriottStatusLabel("blocked"), "공식 사이트 접근 제한");
});

test("diagnostics drop headers and request bodies and redact sensitive URLs", () => {
  const entry = safeNetworkEntry({
    method: "POST",
    resourceType: "xhr",
    status: 200,
    url: "https://www.marriott.com/rates?token=secret&room=king",
    headers: { Authorization: "Bearer secret", Cookie: "secret" },
    postData: "password=secret"
  });
  assert.deepEqual(Object.keys(entry).sort(), ["method", "resourceType", "status", "url"]);
  assert.doesNotMatch(JSON.stringify(entry), /Bearer|Cookie|password=secret/);
  assert.match(entry.url, /token=%5Bredacted%5D/);
  assert.equal(sanitizeDiagnosticUrl("https://www.marriott.com/?session=abc"), "https://www.marriott.com/?session=%5Bredacted%5D");
  assert.doesNotMatch(sanitizePageHtml('<script>token="secret"</script><input type="hidden" value="secret">'), /secret/);
});

test("diagnostic URLs strip third-party query data", () => {
  assert.equal(
    sanitizeDiagnosticUrl("https://analytics.example/pixel?email_hash=secret&session=abc"),
    "https://analytics.example/[redacted]"
  );
  assert.equal(
    sanitizeDiagnosticUrl("https://tracking.example/activity;user=secret;session=private?x=1"),
    "https://tracking.example/[redacted]"
  );
});

test("successful rate metadata keeps only Marriott reservation requests", () => {
  assert.equal(isMarriottRateRequestUrl("https://www.marriott.com/reservation/rateListMenu.mi?roomPoolCode=doub"), true);
  assert.equal(isMarriottRateRequestUrl("https://www.marriott.com/search/availabilityCalendar.mi"), true);
  assert.equal(isMarriottRateRequestUrl("https://googleads.example/activity;type=reservation"), false);
});

test("collect:full uses a cross-platform Node wrapper and keeps the Madrid second View Rates flow", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["collect:full"], "node scripts/run-collect-full.mjs");
  assert.doesNotMatch(packageJson.scripts["collect:full"], /^[A-Z_]+=/);
  const source = fs.readFileSync(new URL("../src/marriott.mjs", import.meta.url), "utf8");
  assert.match(source, /calendarViewRates/);
  assert.match(source, /confirming specific dates/);
});
