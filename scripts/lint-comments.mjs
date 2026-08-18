// 注释密度检查，判据见 CLAUDE.md「注释准入」。超阈值只报不改，留人判断。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const THRESHOLD = 0.15;
const ROOTS = ["src", "test"];

function files(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(files(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

function count(path) {
  let comment = 0;
  let code = 0;
  let block = false;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (block) {
      comment++;
      if (line.includes("*/")) block = false;
    } else if (line.startsWith("/*")) {
      comment++;
      if (!line.includes("*/")) block = true;
    } else if (line.startsWith("//")) {
      comment++;
    } else {
      code++;
    }
  }
  return { comment, code };
}

let total = { comment: 0, code: 0 };
const rows = [];
for (const root of ROOTS) {
  let paths = [];
  try {
    paths = files(root);
  } catch {
    continue;
  }
  for (const path of paths) {
    const c = count(path);
    total.comment += c.comment;
    total.code += c.code;
    if (c.code > 0) rows.push({ path, ratio: c.comment / (c.comment + c.code), ...c });
  }
}

if (total.code === 0) {
  console.log("no sources yet");
  process.exit(0);
}

rows.sort((a, b) => b.ratio - a.ratio);
for (const r of rows.slice(0, 10)) {
  console.log(`${(r.ratio * 100).toFixed(1).padStart(5)}%  ${r.comment}/${r.comment + r.code}  ${r.path}`);
}

const ratio = total.comment / (total.comment + total.code);
console.log(`\ntotal ${(ratio * 100).toFixed(1)}% (threshold ${THRESHOLD * 100}%)`);
process.exit(ratio > THRESHOLD ? 1 : 0);
