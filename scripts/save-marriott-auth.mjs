import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const authDir = path.join(root, ".auth");
const authPath = path.join(authDir, "marriott.json");
await fs.mkdir(authDir, { recursive: true });

const launchOptions = { headless: false };
if (process.env.MARRIOTT_BROWSER_CHANNEL) {
  launchOptions.channel = process.env.MARRIOTT_BROWSER_CHANNEL;
}
const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({ locale: "en-US", timezoneId: "America/New_York" });
const page = await context.newPage();
await page.goto("https://www.marriott.com/en-us/hotels/osauu-four-points-flex-osaka-umeda/rooms/");
console.log("브라우저에서 Marriott에 로그인하고 로그인 완료 화면을 확인하세요.");
const prompt = readline.createInterface({ input, output });
await prompt.question("로그인 완료 후 Enter를 누르세요. 비밀번호는 이 터미널에 입력하지 마세요. ");
await prompt.close();

const signedIn = await page.locator('a[href*="/loyalty/myAccount/"]').count();
if (!signedIn) {
  await browser.close();
  throw new Error("로그인 상태를 확인하지 못했습니다.");
}
await context.storageState({ path: authPath });
await browser.close();
console.log(`로그인 상태를 ${authPath}에 저장했습니다. 이 파일은 저장소에 커밋하지 마세요.`);
console.log("수집 실행: MARRIOTT_AUTH_STATE=.auth/marriott.json npm run collect:full");
