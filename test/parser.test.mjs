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
  assert.equal(url.searchParams.get("curr"), "KRW");
  assert.ok(url.searchParams.get("ts").length > 30);
});

test("separates headline, free-cancel and exact candidates", () => {
  const text = `Sponsored·Featured options\nBooking.com\n€123\nVisit site\nMoxy Sleeper Room\n1 double bed\n€124\nVisit site\nMoxy Sleeper Room\n1 double bed · Free cancellation until Apr 9\n€140\nVisit site\nAll options\nBooking.com\n€123\nVisit site\nBluepillow\n€125\nVisit site\nTrack this hotel`;
  const parsed = parseGoogleHotelPrices(text, stay, "EUR");
  assert.equal(parsed.lowestProvider.totalAmount, 246);
  assert.equal(parsed.freeCancellation.totalAmount, 280);
  assert.equal(parsed.exactCandidate.totalAmount, 280);
  assert.equal(parsed.exactCandidate.currency, "EUR");
});

test("parses Japanese-yen prices in the booked currency", () => {
  const osaka = {
    ...stay,
    checkIn: "2026-09-17",
    checkOut: "2026-09-21",
    booked: { currency: "JPY" },
    match: { roomPatterns: ["small double", "single"], requireFreeCancellation: true }
  };
  const text = `Sponsored·Featured options\nSmall Double Room\n1 single bed · Free cancellation\n¥15,000\nVisit site\nAll options\nBooking.com\n¥14,000\nVisit site\nTrack this hotel`;
  const parsed = parseGoogleHotelPrices(text, osaka, "JPY");
  assert.equal(parsed.lowestProvider.totalAmount, 56000);
  assert.equal(parsed.exactCandidate.totalAmount, 60000);
});
