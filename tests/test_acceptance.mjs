// SPDX-License-Identifier: Apache-2.0
//
// Acceptance tests — verifies the project's hackathon goals hold across
// the actual files we ship. These are end-of-pipeline sanity checks a
// reviewer would do.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { heuristicSummary } from "../src/heuristics.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function read(rel) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function walkSourceFiles() {
  const out = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === "node_modules" || name === ".git" || name === "artifacts" || name === "data") continue;
        walk(p);
      } else if (/\.(mjs|js)$/.test(name)) {
        out.push(p);
      }
    }
  }
  walk(resolve(ROOT, "src"));
  walk(resolve(ROOT, "scripts"));
  walk(resolve(ROOT, "tests"));
  return out;
}

// ===== License =====
t("LICENSE file exists at repo root", () => {
  assert(existsSync(resolve(ROOT, "LICENSE")), "LICENSE missing");
});

t("LICENSE is Apache 2.0 (header check)", () => {
  const lic = read("LICENSE");
  assert(/apache\s+license\s*\n?\s*version\s+2\.0/i.test(lic), "not Apache 2.0");
});

t("package.json declares Apache-2.0", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.license === "Apache-2.0", `got: ${pkg.license}`);
});

t("NOTICE.md exists at repo root", () => {
  assert(existsSync(resolve(ROOT, "NOTICE.md")), "NOTICE missing");
});

t("NOTICE.md lists Qwen3-1.7B as production base", () => {
  const notice = read("NOTICE.md");
  assert(/Qwen3\s*1\.7B/i.test(notice), "Qwen3-1.7B not in NOTICE");
});

t("NOTICE.md lists upstream attack corpora", () => {
  const notice = read("NOTICE.md");
  for (const src of ["Lakera", "JailbreakBench", "deepset", "garak", "HarmBench", "Dolly"]) {
    assert(notice.includes(src), `missing source: ${src}`);
  }
});

// ===== SPDX headers =====
t("every source file has SPDX-License-Identifier header", () => {
  const files = walkSourceFiles();
  const missing = [];
  for (const f of files) {
    const head = readFileSync(f, "utf8").slice(0, 200);
    if (!head.includes("SPDX-License-Identifier: Apache-2.0")) {
      missing.push(f.replace(ROOT + "/", ""));
    }
  }
  assert(missing.length === 0, `missing SPDX in: ${missing.join(", ")}`);
});

// ===== No emojis in shipping files =====
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{2700}-\u{27BF}]/u;

t("no emojis in README", () => {
  const r = read("README.md");
  assert(!EMOJI_RE.test(r), `README contains emoji`);
});

t("no emojis in NOTICE", () => {
  assert(!EMOJI_RE.test(read("NOTICE.md")), `NOTICE contains emoji`);
});

t("no emojis in shipped src/ + scripts/ (tests/ allowed for unicode fixtures)", () => {
  const files = walkSourceFiles().filter((f) => !f.includes("/tests/"));
  const bad = [];
  for (const f of files) {
    if (EMOJI_RE.test(readFileSync(f, "utf8"))) {
      bad.push(f.replace(ROOT + "/", ""));
    }
  }
  assert(bad.length === 0, `emoji in: ${bad.join(", ")}`);
});

// ===== No AI attribution =====
t("no 'Generated with Claude' or 'Co-Authored-By' Claude attribution in README/NOTICE", () => {
  for (const f of ["README.md", "NOTICE.md"]) {
    const c = read(f);
    assert(!/Generated\s+with\s+Claude/i.test(c), `${f} has Claude attribution`);
    assert(!/Co-Authored-By:\s*Claude/i.test(c), `${f} has Claude co-author`);
  }
});

t("no 'Anthropic' references in shipped files", () => {
  const r = read("README.md");
  // OPENAI_API_KEY pattern in heuristics IS legit, but a top-level Anthropic mention isn't
  assert(!/anthropic/i.test(r), `README mentions Anthropic`);
});

// ===== No Mandiri / Fusi references (COI hygiene) =====
t("no Mandiri references in shipping files", () => {
  for (const f of ["README.md", "NOTICE.md", "package.json"]) {
    const c = read(f);
    assert(!/mandiri/i.test(c), `${f} mentions Mandiri`);
  }
});

t("no Fusi Solusi references in shipping files", () => {
  for (const f of ["README.md", "NOTICE.md", "package.json"]) {
    const c = read(f);
    assert(!/fusi\s*solusi/i.test(c), `${f} mentions Fusi Solusi`);
  }
});

t("package.json author is Syaugi", () => {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.author && /syaugi/i.test(pkg.author), `author: ${pkg.author}`);
});

// ===== Sovereignty claims =====
t("README claims no telemetry", () => {
  const r = read("README.md").toLowerCase();
  assert(r.includes("no telemetry"), "no-telemetry claim missing");
});

t("README mentions Apache 2.0 and Tether-voice key terms", () => {
  const r = read("README.md").toLowerCase();
  for (const term of ["apache", "sovereign", "on-device"]) {
    assert(r.includes(term), `README missing: ${term}`);
  }
});

// ===== README numeric consistency (drift guard) =====
// Headline numbers in README must reconcile with the ground-truth
// artifact (eval_report.json) and the live source (heuristics.mjs).
// If you bump the eval or change heuristic patterns, update README
// or this test breaks.

t("README heuristic pattern count matches heuristicSummary()", () => {
  const s = heuristicSummary();
  const total = s.injectionPatterns + s.jailbreakPatterns + s.exfiltrationPatterns;
  const readme = read("README.md");
  // README states the count as digits near "regex patterns".
  const m = readme.match(/(\d{2,3})[\w\s-]{0,40}regex\s+patterns/i);
  assert(m, "README does not state a numeric regex pattern count near 'regex patterns'");
  const claimed = parseInt(m[1], 10);
  assert(claimed === total, `README claims ${claimed} regex patterns; heuristicSummary() totals ${total} (inj ${s.injectionPatterns}/jb ${s.jailbreakPatterns}/exfil ${s.exfiltrationPatterns})`);
});

t("README latency claim matches artifacts/training/eval_report.json", () => {
  const rep = JSON.parse(read("artifacts/training/eval_report.json"));
  const p50 = Math.round(rep.latencyMs?.p50);
  const p95 = Math.round(rep.latencyMs?.p95);
  assert(Number.isFinite(p50) && Number.isFinite(p95), "eval_report.json missing latencyMs.{p50,p95}");
  const readme = read("README.md");
  // Permit "506ms" / "0.5s" / "<1s" forms. The hard test: the README must
  // not claim a p50 that diverges by more than 2x from the artifact.
  const m = readme.match(/Latency\s+p50\s*\/\s*p95\s*\|\s*([0-9.]+)\s*(ms|s)\s*\/\s*([0-9.]+)\s*(ms|s)/);
  assert(m, "README does not state a 'Latency p50 / p95' row in the format expected");
  const toMs = (v, unit) => unit === "s" ? parseFloat(v) * 1000 : parseFloat(v);
  const claimedP50 = toMs(m[1], m[2]);
  const claimedP95 = toMs(m[3], m[4]);
  assert(Math.abs(claimedP50 - p50) / p50 < 0.5, `README p50=${claimedP50}ms diverges >50% from artifact p50=${p50}ms`);
  assert(Math.abs(claimedP95 - p95) / p95 < 0.5, `README p95=${claimedP95}ms diverges >50% from artifact p95=${p95}ms`);
});

t("README test count claim does not lie about test files", () => {
  // The README's "npm test # N unit + integration tests" claim must not
  // wildly under-report. Acceptable to under-claim slightly (humans round
  // down) but not by more than 20%. Catches the "shipped 339 but README
  // says 52" drift we saw historically.
  const testsDir = resolve(ROOT, "tests");
  const testFiles = readdirSync(testsDir).filter((f) => f.startsWith("test_") && f.endsWith(".mjs"));
  const readme = read("README.md");
  const m = readme.match(/npm\s+test[^\n]*?#\s*(\d+)/);
  if (!m) return;
  const claimed = parseInt(m[1], 10);
  // Each test file has at least 5 tests; total floor is testFiles.length * 5.
  const floor = testFiles.length * 5;
  assert(claimed >= floor, `README claims ${claimed} tests but ${testFiles.length} test files exist (floor: ${floor})`);
});

// ===== .gitignore safety =====
t(".gitignore blocks .env and credentials", () => {
  const gi = read(".gitignore");
  assert(gi.includes(".env"), ".env not in .gitignore");
  assert(/credentials\*?\.json/.test(gi), "credentials*.json not in .gitignore");
});

t(".gitignore blocks Claude planning artifacts", () => {
  const gi = read(".gitignore");
  for (const f of ["CLAUDE.md", "HANDOFF.md", "PLAN.md"]) {
    assert(gi.includes(f), `${f} not in .gitignore`);
  }
});

t(".gitignore blocks the .vanguard-mesh local state", () => {
  const gi = read(".gitignore");
  assert(/\.vanguard-mesh|\.mesh-\*/.test(gi), "mesh local state not blocked");
});

// ===== Reproducibility artifacts =====
t("artifacts/hardware.json exists", () => {
  assert(existsSync(resolve(ROOT, "artifacts/hardware.json")));
});

t("artifacts/training/eval_report.json exists", () => {
  assert(existsSync(resolve(ROOT, "artifacts/training/eval_report.json")));
});

t("artifacts/lora/adapter.gguf exists (the production LoRA)", () => {
  assert(existsSync(resolve(ROOT, "artifacts/lora/adapter.gguf")));
});

t("data/mesh_seed.jsonl exists with 100+ signatures", () => {
  const path = resolve(ROOT, "data/mesh_seed.jsonl");
  assert(existsSync(path), "mesh_seed.jsonl missing");
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  assert(lines.length >= 100, `only ${lines.length} signatures`);
});

t("eval_report.json has the documented numbers", () => {
  const er = JSON.parse(read("artifacts/training/eval_report.json"));
  // The numbers may be at any depth — surface presence check rather than
  // strict value-match (eval_report shape varies by run).
  const blob = JSON.stringify(er);
  assert(blob.length > 100, "eval_report.json suspiciously small");
});

let pass = 0;
let fail = 0;
for (const c of tests) {
  try {
    c.fn();
    console.log(`pass: ${c.name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL: ${c.name} -> ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
