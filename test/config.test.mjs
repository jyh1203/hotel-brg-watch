import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = JSON.parse(fs.readFileSync(new URL("../config/stays.json", import.meta.url), "utf8"));

test("booking baselines have internally consistent nightly totals", () => {
  assert.equal(config.stays.length, 5);
  for (const stay of config.stays) {
    const nightlyTotal = stay.booked.nightly.reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(nightlyTotal - stay.booked.roomSubtotal) < 0.01, `${stay.id} nightly subtotal`);
    assert.ok(Math.abs(stay.booked.roomSubtotal + stay.booked.taxesAndFees - stay.booked.total) < 0.02, `${stay.id} grand total`);
    assert.equal(stay.booked.nightly.length, Math.round((Date.parse(stay.checkOut) - Date.parse(stay.checkIn)) / 86400000));
  }
});

test("public config does not contain confirmation numbers", () => {
  assert.ok(config.stays.every((stay) => !("confirmation" in stay.booked)));
});
