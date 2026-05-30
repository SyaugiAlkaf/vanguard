// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  unloadModel,
  close,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4,
  QWEN3_4B_Q4_K_M,
  QWEN3_4B_INST_Q4_K_M,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
} from "@qvac/sdk";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { classify } from "../src/classifier.mjs";
import { ALL_LABELS } from "../src/labels.mjs";

const BASES = {
  qwen3_600m: QWEN3_600M_INST_Q4,
  qwen3_1_7b: QWEN3_1_7B_INST_Q4,
  qwen3_4b: QWEN3_4B_Q4_K_M,
  qwen3_4b_inst: QWEN3_4B_INST_Q4_K_M,
  llama3_2_1b: LLAMA_3_2_1B_INST_Q4_0,
  medgemma_4b: MEDGEMMA_4B_IT_Q4_1,
};

const argv = parseArgs(process.argv.slice(2));
const VAL = argv.val ?? "data/sft/val.jsonl";
const ADAPTER = argv.adapter ?? null;
const REPORT_OUT = argv.report ?? "artifacts/training/eval_report.json";
const MAX = argv.max ? Number(argv.max) : Infinity;
const BASE_KEY = (argv.base ?? "qwen3_1_7b").toString();
const BASE = BASES[BASE_KEY];
if (!BASE) {
  throw new Error(`Unknown --base ${BASE_KEY}. Known: ${Object.keys(BASES).join(", ")}`);
}

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

async function loadVal(path) {
  const text = await readFile(path, "utf8");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const obj = JSON.parse(line);
    const msgs = obj.messages;
    if (!Array.isArray(msgs)) continue;
    const user = msgs.find((m) => m.role === "user")?.content ?? "";
    const truth = (msgs.find((m) => m.role === "assistant")?.content ?? "").trim().toUpperCase();
    if (!user || !truth) continue;
    rows.push({ prompt: user, truth });
  }
  return rows;
}

function emptyMatrix() {
  const m = {};
  for (const t of ALL_LABELS) {
    m[t] = {};
    for (const p of ALL_LABELS) m[t][p] = 0;
  }
  return m;
}

function summarize(matrix, rows, latencies) {
  const perClass = {};
  for (const c of ALL_LABELS) {
    const tp = matrix[c][c];
    const fp = ALL_LABELS.reduce((s, t) => s + (t === c ? 0 : matrix[t][c]), 0);
    const fn = ALL_LABELS.reduce((s, p) => s + (p === c ? 0 : matrix[c][p]), 0);
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[c] = { tp, fp, fn, precision, recall, f1 };
  }
  const correct = ALL_LABELS.reduce((s, c) => s + matrix[c][c], 0);
  const total = rows.length;
  const accuracy = total ? correct / total : 0;

  const blockedTrue = rows.filter((r) => r.truth !== "SAFE").length;
  const blockedPred = rows.filter((r) => r.pred !== "SAFE").length;
  const blockedCorrect = rows.filter((r) => r.truth !== "SAFE" && r.pred !== "SAFE").length;
  const blockedPrecision = blockedPred ? blockedCorrect / blockedPred : 0;
  const blockedRecall = blockedTrue ? blockedCorrect / blockedTrue : 0;
  const blockedF1 =
    blockedPrecision + blockedRecall
      ? (2 * blockedPrecision * blockedRecall) / (blockedPrecision + blockedRecall)
      : 0;
  const falsePositiveRate =
    rows.filter((r) => r.truth === "SAFE" && r.pred !== "SAFE").length /
    Math.max(1, rows.filter((r) => r.truth === "SAFE").length);

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const mean = latencies.reduce((s, x) => s + x, 0) / Math.max(1, latencies.length);

  return {
    accuracy,
    perClass,
    confusionMatrix: matrix,
    binary: {
      blockedPrecision,
      blockedRecall,
      blockedF1,
      falsePositiveRate,
    },
    latencyMs: { mean, p50, p95 },
    n: total,
  };
}

async function main() {
  const valPath = resolve(VAL);
  console.log("[eval] loading val:", valPath);
  const rows = await loadVal(valPath);
  console.log(`[eval] ${rows.length} val rows`);

  console.log(`[eval] base: ${BASE_KEY}`);
  const loadCfg = {
    modelSrc: BASE,
    modelType: "llm",
    onProgress: (p) => process.stdout.write(`\r[eval] base load: ${JSON.stringify(p)}`),
  };
  if (ADAPTER) {
    loadCfg.modelConfig = { lora: ADAPTER };
    console.log("[eval] adapter:", ADAPTER);
  } else {
    console.log("[eval] no adapter — baseline run");
  }

  const t0 = performance.now();
  const modelId = await loadModel(loadCfg);
  console.log(`\n[eval] model loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);

  const matrix = emptyMatrix();
  const latencies = [];
  const limit = Math.min(rows.length, MAX);

  for (let i = 0; i < limit; i++) {
    const r = rows[i];
    let pred;
    try {
      const verdict = await classify({ modelId, prompt: r.prompt });
      pred = verdict.label;
      latencies.push(verdict.latencyMs);
    } catch (e) {
      pred = "SAFE";
      console.error(`[eval] classify error on row ${i}: ${e.message}`);
    }
    r.pred = pred;
    matrix[r.truth][pred] = (matrix[r.truth][pred] ?? 0) + 1;
    if (i % 25 === 0 || i === limit - 1) {
      const correct = ALL_LABELS.reduce((s, c) => s + matrix[c][c], 0);
      const acc = ((correct / (i + 1)) * 100).toFixed(1);
      process.stdout.write(`\r[eval] ${i + 1}/${limit} · acc=${acc}%      `);
    }
  }
  console.log();

  const report = summarize(matrix, rows.slice(0, limit), latencies);
  report.meta = {
    timestamp: new Date().toISOString(),
    valPath,
    adapter: ADAPTER,
    base: BASE_KEY,
  };

  await mkdir(dirname(REPORT_OUT), { recursive: true });
  await writeFile(REPORT_OUT, JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== EVAL REPORT ===");
  console.log(`accuracy: ${(report.accuracy * 100).toFixed(2)}%`);
  console.log(`binary blocked F1: ${(report.binary.blockedF1 * 100).toFixed(2)}%  precision: ${(report.binary.blockedPrecision * 100).toFixed(2)}%  recall: ${(report.binary.blockedRecall * 100).toFixed(2)}%`);
  console.log(`false-positive rate (SAFE→block): ${(report.binary.falsePositiveRate * 100).toFixed(2)}%`);
  console.log("per-class F1:");
  for (const c of ALL_LABELS) {
    const m = report.perClass[c];
    console.log(`  ${c.padEnd(12)} F1=${(m.f1 * 100).toFixed(2)}% precision=${(m.precision * 100).toFixed(2)}% recall=${(m.recall * 100).toFixed(2)}%`);
  }
  console.log(`latency ms — mean=${report.latencyMs.mean.toFixed(0)} p50=${report.latencyMs.p50.toFixed(0)} p95=${report.latencyMs.p95.toFixed(0)}`);
  console.log(`report saved: ${resolve(REPORT_OUT)}`);

  await unloadModel({ modelId });
  await close();
}

main().catch((e) => {
  console.error("[eval] error:", e);
  process.exit(1);
});
