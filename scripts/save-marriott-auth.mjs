import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { launchMarriottSession } from "../src/marriott-browser.mjs";

const root = path.resolve(import.meta.dirname, "..");
const authDir = path.join(root, ".auth");
const authPath = path.join(authDir, "marriott.json");
await fs.mkdir(authDir, { recursive: true });

const env = { ...process.env, PLAYWRIGHT_HEADFUL: "1" };
const session = await launchMarriottSession({ env, cwd: root });
const { context } = session;
console.log(`Marriott login browser: ${JSON.stringify(session.diagnostics)}`);
const page = context.pages()[0] ?? await context.newPage();
await page.goto("https://www.marriott.com/en-us/hotels/osauu-four-points-flex-osaka-umeda/rooms/", {
  waitUntil: "commit",
  timeout: 45000
});
console.log("브라우저에서 Marriott에 로그인하고 로그인 완료 화면을 확인하세요.");
const prompt = readline.createInterface({ input, output });
await prompt.question("로그인 완료 후 Enter를 누르세요. 비밀번호는 이 터미널에 입력하지 마세요. ");
await prompt.close();

const signedIn = await page.locator('a[href*="/loyalty/myAccount/"]').count();
if (!signedIn) {
  await session.close();
  throw new Error("로그인 상태를 확인하지 못했습니다.");
}
if (!session.persistent) {
  await context.storageState({ path: authPath });
  await fs.chmod(authPath, 0o600);
  console.log(`로그인 상태를 ${authPath}에 저장했습니다. 이 파일은 저장소에 커밋하지 마세요.`);
} else {
  console.log(`로그인 상태를 전용 프로필 ${session.diagnostics.userDataDir}에 저장했습니다.`);
}
await session.close();
console.log(session.persistent
  ? "수집 실행: MARRIOTT_USER_DATA_DIR=.auth/marriott-profile npm run collect:full"
  : "수집 실행: MARRIOTT_AUTH_STATE=.auth/marriott.json npm run collect:full");
