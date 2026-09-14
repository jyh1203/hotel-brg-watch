import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { friendlyLaunchError, marriottBrowserConfig } from "../src/marriott-browser.mjs";
import { classifyMarriottSnapshot, normalizeMarriottFailureState } from "../src/marriott.mjs";

const snapshot = (bodyText = "", selectors = {}) => ({
  bodyText,
  bodyLength: bodyText.length,
  selectors: {
    dateInput: false,
    viewRates: false,
    roomCards: false,
    rateCards: false,
    login: false,
    cookieConsent: false,
    ...selectors
  }
});

test("builds a dedicated persistent Chrome configuration", () => {
  const config = marriottBrowserConfig({
    MARRIOTT_BROWSER_CHANNEL: "chrome",
    MARRIOTT_USER_DATA_DIR: ".auth/marriott-profile",
    MARRIOTT_AUTH_STATE: ".auth/marriott.json",
    PLAYWRIGHT_HEADFUL: "1"
  }, "/tmp/project");
  assert.equal(config.channel, "chrome");
  assert.equal(config.headless, false);
  assert.equal(config.userDataDir, path.resolve("/tmp/project/.auth/marriott-profile"));
  assert.equal(config.authStatePath, path.resolve("/tmp/project/.auth/marriott.json"));
});

test("accepts an explicitly connected Chrome CDP session", () => {
  const config = marriottBrowserConfig({
    MARRIOTT_CDP_URL: "ws://192.0.2.1:9224/devtools/browser/example",
    MARRIOTT_BROWSER_CHANNEL: "chrome",
    MARRIOTT_USER_DATA_DIR: ".auth/marriott-profile"
  }, "/tmp/project");
  assert.equal(config.cdpUrl, "ws://192.0.2.1:9224/devtools/browser/example");
  assert.equal(config.channel, "chrome");
});

test("classifies Marriott loading and blocking states", () => {
  assert.equal(classifyMarriottSnapshot(snapshot("", {})), "blank-document");
  assert.equal(classifyMarriottSnapshot(snapshot("Access Denied")), "blocked");
  assert.equal(classifyMarriottSnapshot(snapshot("Verify you are human")), "captcha");
  assert.equal(classifyMarriottSnapshot(snapshot("Rooms", { dateInput: true })), "booking-form");
  assert.equal(classifyMarriottSnapshot(snapshot("Rooms", { roomCards: true, viewRates: true })), "room-page-partial");
  assert.equal(classifyMarriottSnapshot(snapshot("Select a Room and Rate", { rateCards: true })), "rate-list");
  assert.equal(classifyMarriottSnapshot(snapshot("Sign in to your account", { login: true })), "login-required");
  assert.equal(normalizeMarriottFailureState({ detectedState: "login-required", authMethod: "storage-state" }), "session-expired");
  assert.equal(normalizeMarriottFailureState({ detectedState: "login-required", authMethod: "none" }), "login-required");
});

test("classifies a locked dedicated profile with an actionable error", () => {
  const error = friendlyLaunchError(new Error("user data directory is already in use: SingletonLock"), {
    userDataDir: "/tmp/marriott-profile"
  });
  assert.match(error.message, /전용 Chrome 프로필.*사용 중/);
  assert.match(error.message, /\/tmp\/marriott-profile/);
});
