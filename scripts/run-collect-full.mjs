import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const child = spawn(process.execPath, [path.join(root, "src/collect.mjs")], {
  cwd: root,
  env: { ...process.env, PLAYWRIGHT_HEADFUL: process.env.PLAYWRIGHT_HEADFUL ?? "1" },
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error(`수집 프로세스를 시작하지 못했습니다: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error(`수집 프로세스가 ${signal} 신호로 종료됐습니다.`);
  process.exitCode = code ?? 1;
});
