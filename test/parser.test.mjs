import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleHotelPrices, nightsBetween } from "../src/parse-google-hotels.mjs";
import { buildGoogleHotelsUrl } from "../src/google-hotels-url.mjs";
import { buildMarriottAvailabilityUrl, parseMarriottRate } from "../src/marriott.mjs";

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

test("parses the member flexible rate and rejects the lower prepaid headline", () => {
  const text = `Currently Selected Room\nMoxy Sleeper, Guest room, 1 Queen\nRoom Details\nRates from\n114EUR Avg / Night\n229 Total Per Room\nHide Rates\nFlexible Rate\nMOST POPULAR\nFree cancellation before or on Apr 09, 2027\nMember Rate\n134EUR Avg / Night\n269 Total Per Room\nSelect\nNon-Member Rate\n139EUR Avg / Night\n278 Total Per Room\nSelect\nPrepay Non-refundable Non-changeable\nMember Rate\n114EUR Avg / Night\n229 Total Per Room`;
  assert.deepEqual(parseMarriottRate(text), {
    room: "Moxy Sleeper, Guest room, 1 Queen",
    rateName: "Member Flexible Rate",
    cancellation: "Free cancellation before or on Apr 09, 2027",
    nightlyAmount: 134,
    currency: "EUR",
    totalAmount: 269,
    taxesIncluded: false,
    prepaid: false
  });
});

test("does not treat a prepaid-only Marriott rate as comparable", () => {
  const text = `Currently Selected Room\nMoxy Sleeper, Guest room, 1 Queen\nRoom Details\nRates from\n114EUR Avg / Night\n229 Total Per Room\nPrepay Non-refundable Non-changeable`;
  assert.equal(parseMarriottRate(text), null);
});

test("builds a Marriott official availability link for the booked room", () => {
  const configured = {
    ...stay,
    marriott: { propertyCode: "BODOX", slug: "moxy-bordeaux", roomPoolCode: "genr" }
  };
  const url = new URL(buildMarriottAvailabilityUrl(configured));
  assert.equal(url.hostname, "www.marriott.com");
  assert.equal(url.searchParams.get("propertyCode"), "BODOX");
  assert.equal(url.searchParams.get("roomPoolCode"), "genr");
  assert.equal(url.searchParams.get("fromDate"), "04/10/2027");
});
