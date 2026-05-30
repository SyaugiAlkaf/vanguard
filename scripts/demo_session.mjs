// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  unloadModel,
  close,
  QWEN3_1_7B_INST_Q4,
  QWEN3_600M_INST_Q4,
} from "@qvac/sdk";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classifier.mjs";
import { LABELS } from "../src/labels.mjs";
import {
  openAuditLog,
  recordModelLoad,
  recordModelUnload,
  recordInference,
} from "./audit_log.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const BASES = {
  qwen3_600m: QWEN3_600M_INST_Q4,
  qwen3_1_7b: QWEN3_1_7B_INST_Q4,
};

const argv = parseArgs(process.argv.slice(2));
const BASE_KEY = (argv.base ?? "qwen3_1_7b").toString();
const ADAPTER = argv.adapter ?? null;
const PROMPTS_FILE = argv.prompts ?? resolve(ROOT, "tests/demo_prompts.jsonl");
const AUDIT_OUT = argv.audit ?? resolve(ROOT, "artifacts/audit.jsonl");
const SESSION_OUT = argv.session ?? resolve(ROOT, "artifacts/demo_session.json");

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      out[k] = v;
    }
  }
  return out;
}

function loadPrompts(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function main() {
  const base = BASES[BASE_KEY];
  if (!base) throw new Error(`Unknown --base ${BASE_KEY}`);
  mkdirSync(dirname(AUDIT_OUT), { recursive: true });
  const audit = openAuditLog(AUDIT_OUT);

  console.log(`[demo] base: ${BASE_KEY}`);
  if (ADAPTER) console.log(`[demo] adapter: ${ADAPTER}`);

  const loadCfg = { modelSrc: base, modelType: "llm", onProgress: () => {} };
  if (ADAPTER) loadCfg.modelConfig = { lora: ADAPTER };

  const t0 = performance.now();
  const modelId = await loadModel(loadCfg);
  const loadMs = performance.now() - t0;
  recordModelLoad(audit, {
    modelId,
    modelType: "llm",
    src: BASE_KEY,
    deviceInfo: { platform: process.platform, arch: process.arch, node: process.version },
  });
  console.log(`[demo] model loaded in ${(loadMs / 1000).toFixed(2)}s`);

  const prompts = loadPrompts(PROMPTS_FILE);
  console.log(`[demo] running ${prompts.length} prompts...`);

  const session = { base: BASE_KEY, adapter: ADAPTER, startedAt: new Date().toISOString(), prompts: [] };

  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    let verdict;
    try {
      verdict = await classify({ modelId, prompt: p.prompt, maxTokens: 60 });
    } catch (e) {
      console.error(`[demo] ${String(i + 1).padStart(2, "0")} ERROR ${e.message}`);
      session.prompts.push({
        prompt: p.prompt,
        expected: p.expected,
        got: "ERROR",
        blocked: false,
        correct: false,
        latencyMs: 0,
        ttftMs: null,
        tps: null,
        error: e.message,
      });
      continue;
    }
    const correct = verdict.label === p.expected;
    recordInference(audit, {
      modelId,
      prompt: p.prompt,
      completion: verdict.raw,
      promptTokens: null,
      completionTokens: verdict.stats?.generatedTokens ?? null,
      ttftMs: verdict.stats?.timeToFirstToken ?? null,
      tps: verdict.stats?.tokensPerSecond ?? null,
      classifierVerdict: verdict.label,
      classifierConfidence: verdict.fallback ? 0 : 1,
      blocked: verdict.blocked,
    });
    const flag = correct ? "PASS" : "MISS";
    console.log(
      `[demo] ${String(i + 1).padStart(2, "0")} ${flag} expected=${p.expected.padEnd(12)} got=${verdict.label.padEnd(12)} (${verdict.latencyMs.toFixed(0)}ms · ${verdict.stats?.timeToFirstToken?.toFixed?.(0) ?? "?"}ms ttft)`,
    );
    session.prompts.push({
      prompt: p.prompt,
      expected: p.expected,
      got: verdict.label,
      blocked: verdict.blocked,
      correct,
      latencyMs: verdict.latencyMs,
      ttftMs: verdict.stats?.timeToFirstToken ?? null,
      tps: verdict.stats?.tokensPerSecond ?? null,
    });
  }

  await unloadModel({ modelId });
  recordModelUnload(audit, { modelId });
  audit.close?.();

  const pass = session.prompts.filter((p) => p.correct).length;
  session.summary = {
    total: session.prompts.length,
    pass,
    accuracy: pass / session.prompts.length,
    meanLatencyMs:
      session.prompts.reduce((s, p) => s + p.latencyMs, 0) / session.prompts.length,
    meanTtftMs:
      session.prompts.reduce((s, p) => s + (p.ttftMs ?? 0), 0) / session.prompts.length,
  };
  session.endedAt = new Date().toISOString();

  writeFileSync(SESSION_OUT, JSON.stringify(session, null, 2), "utf8");
  console.log(
    `\n[demo] session: ${session.summary.pass}/${session.summary.total} pass (${(session.summary.accuracy * 100).toFixed(1)}%) · mean latency ${session.summary.meanLatencyMs.toFixed(0)}ms · mean TTFT ${session.summary.meanTtftMs.toFixed(0)}ms`,
  );
  console.log(`[demo] audit log: ${AUDIT_OUT}`);
  console.log(`[demo] session: ${SESSION_OUT}`);

  await close();
}

main().catch((e) => {
  console.error("[demo] error:", e);
  process.exit(1);
});
