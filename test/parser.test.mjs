import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleHotelPrices, nightsBetween } from "../src/parse-google-hotels.mjs";
import { buildGoogleHotelsUrl } from "../src/google-hotels-url.mjs";

const stay = {
  hotel: "Moxy Bordeaux", city: { name: "Bordeaux", googleEntityId: "/m/01b85" },
  checkIn: "2027-04-10", checkOut: "2027-04-12", adults: 2,
  match: { roomPatterns: ["moxy sleeper", "double"], requireFreeCancellation: true }
};

test("counts nights and encodes configured dates", () => {
  assert.equal(nightsBetween(stay.checkIn, stay.checkOut), 2);
  const url = new URL(buildGoogleHotelsUrl(stay));
  assert.equal(url.searchParams.get("q"), "Moxy Bordeaux");
  assert.ok(url.searchParams.get("ts").length > 30);
});

test("separates headline, free-cancel and exact candidates", () => {
  const text = `Sponsored·Featured options\nBooking.com\n₩195,905\nVisit site\nMoxy Sleeper Room\n1 double bed\n₩195,908\nVisit site\nMoxy Sleeper Room\n1 double bed · Free cancellation until Apr 9\n₩228,453\nVisit site\nAll options\nBooking.com\n₩195,905\nVisit site\nBluepillow\n₩196,639\nVisit site\nTrack this hotel`;
  const parsed = parseGoogleHotelPrices(text, stay);
  assert.equal(parsed.lowestProvider.totalKrw, 391810);
  assert.equal(parsed.freeCancellation.totalKrw, 456906);
  assert.equal(parsed.exactCandidate.totalKrw, 456906);
});
