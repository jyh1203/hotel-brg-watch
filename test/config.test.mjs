import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync(new URL("../config/stays.json", import.meta.url), "utf8"));

test("booking baselines have internally consistent nightly totals", () => {
  assert.ok(config.stays.length > 0);
  for (const stay of config.stays) {
    if (Array.isArray(stay.booked.nightly)) {
      const nightlyTotal = stay.booked.nightly.reduce((sum, value) => sum + value, 0);
      assert.ok(Math.abs(nightlyTotal - stay.booked.roomSubtotal) < 0.01, `${stay.id} nightly subtotal`);
      assert.equal(stay.booked.nightly.length, Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000));
    } else {
      assert.equal(stay.booked.nightly, null, `${stay.id} nightly breakdown must be null when unknown`);
    }
    assert.ok(Math.abs(stay.booked.roomSubtotal + stay.booked.taxesAndFees - stay.booked.total) < 0.02, `${stay.id} grand total`);
    const estimatedTotal = stay.booked.roomSubtotal * (1 + stay.allInEstimate.percent) + stay.allInEstimate.fixed;
    assert.ok(Math.abs(estimatedTotal - stay.booked.total) < 0.02, `${stay.id} all-in estimate model`);
    assert.match(stay.marriott.propertyCode, /^[A-Z0-9]+$/);
    assert.ok(stay.marriott.slug);
    assert.ok(stay.marriott.roomPoolCode);
  }
});

test("Bilbao rebooking baseline uses the confirmed EUR 473 total without inventing nightly prices", () => {
  const bilbao = config.stays.find((stay) => stay.id === "bilbao-ercilla");
  assert.equal(bilbao.booked.roomSubtotal, 473);
  assert.equal(bilbao.booked.taxesAndFees, 0);
  assert.equal(bilbao.booked.total, 473);
  assert.equal(bilbao.booked.nightly, null);
});

test("public config does not contain confirmation numbers", () => {
  assert.ok(config.stays.every((stay) => !("confirmation" in stay.booked)));
});

test("Osaka is excluded from the active watch list", () => {
  assert.equal(config.stays.some((stay) => stay.id === "osaka-four-points-flex"), false);
});

test("Barcelona uses the live Classic King room pool", () => {
  const barcelona = config.stays.find((stay) => stay.id === "barcelona-four-points");
  assert.equal(barcelona.marriott.roomPoolCode, "d000000002");
});
