import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const contextOptions = {
  locale: "en-US",
  timezoneId: "America/New_York",
  viewport: { width: 1365, height: 900 }
};

export function marriottBrowserConfig(env = process.env, cwd = process.cwd()) {
  const cdpUrl = env.MARRIOTT_CDP_URL?.trim() || null;
  const channel = env.MARRIOTT_BROWSER_CHANNEL?.trim() || null;
  const userDataDir = env.MARRIOTT_USER_DATA_DIR?.trim()
    ? path.resolve(cwd, env.MARRIOTT_USER_DATA_DIR)
    : null;
  const authStatePath = env.MARRIOTT_AUTH_STATE?.trim()
    ? path.resolve(cwd, env.MARRIOTT_AUTH_STATE)
    : null;
  return {
    cdpUrl,
    channel,
    userDataDir,
    authStatePath,
    headless: env.PLAYWRIGHT_HEADFUL !== "1",
    platform: `${process.platform}-${process.arch}`,
    executable: channel ? null : chromium.executablePath()
  };
}

export function friendlyLaunchError(error, config) {
  const message = String(error?.message ?? error);
  if (/Missing X server|DISPLAY|ozone_platform_x11/i.test(message)) {
    return new Error("headful Chrome을 실행할 화면이 없습니다. Linux/WSL에서는 xvfb-run -a npm run collect:full을 사용하세요.");
  }
  if (/executable.*doesn.t exist|channel.*not found|chrome.*not found/i.test(message)) {
    return new Error(`지정 브라우저를 찾지 못했습니다 (channel=${config.channel ?? "bundled-chromium"}). Chrome 설치 또는 MARRIOTT_BROWSER_CHANNEL 값을 확인하세요.`);
  }
  if (/SingletonLock|profile.*in use|user data directory is already in use/i.test(message)) {
    return new Error(`Marriott 전용 Chrome 프로필이 다른 프로세스에서 사용 중입니다 (${config.userDataDir}). 해당 프로필 창을 닫고 다시 실행하세요.`);
  }
  return error;
}

async function importStorageState(context, authStatePath) {
  if (!authStatePath) return { imported: false, reason: "not-configured" };
  const raw = JSON.parse(await fs.readFile(authStatePath, "utf8"));
  const cookies = Array.isArray(raw.cookies) ? raw.cookies : [];
  if (!cookies.length) return { imported: false, reason: "no-cookies" };
  const existing = await context.cookies("https://www.marriott.com/");
  if (existing.length) return { imported: false, reason: "profile-has-cookies", count: existing.length };
  await context.addCookies(cookies);
  return { imported: true, reason: "profile-bootstrap", count: cookies.length };
}

export async function launchMarriottSession({ env = process.env, cwd = process.cwd() } = {}) {
  const config = marriottBrowserConfig(env, cwd);
  const launchOptions = { headless: config.headless };
  if (config.channel) launchOptions.channel = config.channel;

  try {
    if (config.cdpUrl) {
      const browser = await chromium.connectOverCDP(config.cdpUrl);
      const context = browser.contexts()[0];
      if (!context) throw new Error("CDP Chrome에서 기본 브라우저 컨텍스트를 찾지 못했습니다.");
      return {
        context,
        browser,
        persistent: true,
        authImport: { imported: false, reason: "cdp-profile" },
        diagnostics: {
          platform: config.platform,
          headless: false,
          channel: "external-chrome-cdp",
          executable: null,
          persistent: true,
          authMethod: "cdp-profile",
          userDataDir: null,
          browserVersion: browser.version()
        },
        // The external Chrome belongs to the user's dedicated login profile.
        // The collection entry point terminates its own process after all data
        // has been flushed, which disconnects CDP without closing that Chrome.
        close: async () => {}
      };
    }
    if (config.authStatePath) await fs.access(config.authStatePath);
    if (config.userDataDir) {
      await fs.mkdir(config.userDataDir, { recursive: true, mode: 0o700 });
      const context = await chromium.launchPersistentContext(config.userDataDir, {
        ...launchOptions,
        ...contextOptions
      });
      const authImport = await importStorageState(context, config.authStatePath);
      return {
        context,
        browser: context.browser(),
        persistent: true,
        authImport,
        diagnostics: {
          platform: config.platform,
          headless: config.headless,
          channel: config.channel,
          executable: config.executable,
          persistent: true,
          authMethod: "persistent-profile",
          userDataDir: config.userDataDir,
          browserVersion: context.browser()?.version() ?? null
        },
        close: () => context.close()
      };
    }

    const browser = await chromium.launch(launchOptions);
    const options = { ...contextOptions };
    if (config.authStatePath) options.storageState = config.authStatePath;
    const context = await browser.newContext(options);
    return {
      context,
      browser,
      persistent: false,
      authImport: { imported: false, reason: config.authStatePath ? "storage-state" : "not-configured" },
      diagnostics: {
        platform: config.platform,
        headless: config.headless,
        channel: config.channel,
        executable: config.executable,
        persistent: false,
        authMethod: config.authStatePath ? "storage-state" : "none",
        userDataDir: null,
        browserVersion: browser.version()
      },
      close: () => browser.close()
    };
  } catch (error) {
    throw friendlyLaunchError(error, config);
  }
}
