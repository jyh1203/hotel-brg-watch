import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const history = JSON.parse(await fs.readFile(path.join(root, "data/history.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "config/stays.json"), "utf8"));
await fs.writeFile(path.join(root, "site/data.json"), `${JSON.stringify({ ...history, config }, null, 2)}\n`);
console.log(`Built dashboard data with ${history.runs.length} run(s).`);
