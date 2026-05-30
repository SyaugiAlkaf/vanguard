// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  unloadModel,
  close,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4,
} from "@qvac/sdk";
import { existsSync, statSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { classify } from "./classifier.mjs";
import { safeCompletion } from "./safe-completion.mjs";
import { heuristicClassify } from "./heuristics.mjs";
import { LABELS } from "./labels.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "..");

const BASES = {
  qwen3_600m: QWEN3_600M_INST_Q4,
  qwen3_1_7b: QWEN3_1_7B_INST_Q4,
};

const USAGE = `usage: vanguard <command> [options]

commands:
  guard    <prompt>          classify a single prompt and print verdict
  ask      <prompt>          run safeCompletion: classify then complete if SAFE
  version                    print version

options:
  --adapter <gguf-path>      path to Vanguard LoRA adapter (default: artifacts/lora/adapter.gguf)
  --base <key>               base model (default: qwen3_1_7b; available: ${Object.keys(BASES).join(", ")})
  --json                     output as JSON

env:
  VANGUARD_SKIP_MODEL=1      run guard via heuristic only, no model load (dev/CI shortcut)
`;

function parseArgs(args) {
  const out = { command: args[0], _: [], flags: {} };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
      out.flags[k] = v;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function readPackageVersion() {
  try {
    const pkgPath = resolve(ROOT, "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function resolveAdapter(adapter) {
  if (!adapter || adapter === "true") return null;
  if (!existsSync(adapter)) {
    process.stderr.write(`error: adapter path does not exist: ${adapter}\n`);
    process.exit(2);
  }
  const st = statSync(adapter);
  if (st.isDirectory()) {
    process.stderr.write(
      `error: adapter path is a directory, expected a .gguf file: ${adapter}\n` +
        `hint: try --adapter ${adapter.replace(/\/$/, "")}/adapter.gguf\n`,
    );
    process.exit(2);
  }
  return adapter;
}

function resolveBase(key) {
  if (!key || key === "true") key = "qwen3_1_7b";
  const base = BASES[key];
  if (!base) {
    process.stderr.write(
      `error: unknown --base ${key}. available: ${Object.keys(BASES).join(", ")}\n`,
    );
    process.exit(2);
  }
  return base;
}

async function loadHost({ base, adapter }) {
  const cfg = {
    modelSrc: base,
    modelType: "llm",
    onProgress: (p) => process.stderr.write(`\r[vanguard] loading: ${JSON.stringify(p)}`),
  };
  const adapterPath = resolveAdapter(adapter);
  if (adapterPath) cfg.modelConfig = { lora: adapterPath };
  const id = await loadModel(cfg);
  process.stderr.write("\n");
  return id;
}

async function cmdGuard({ prompt, base, adapter, asJson }) {
  if (!prompt) {
    process.stderr.write("error: prompt required\n");
    process.exit(2);
  }
  if (process.env.VANGUARD_SKIP_MODEL === "1") {
    const h = heuristicClassify(prompt);
    const verdict = h
      ? { label: h.label, blocked: h.blocked, raw: h.reason, latencyMs: 0, mode: "heuristic" }
      : { label: LABELS.SAFE, blocked: false, raw: "no heuristic match", latencyMs: 0, mode: "heuristic-fallthrough" };
    if (asJson) {
      process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
    } else {
      const sym = verdict.blocked ? "[block]" : "[allow]";
      process.stdout.write(`${sym} ${verdict.label} · ${verdict.latencyMs.toFixed(0)}ms\n`);
    }
    return;
  }
  const modelId = await loadHost({ base, adapter });
  const verdict = await classify({ modelId, prompt });
  if (asJson) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + "\n");
  } else {
    const sym = verdict.label === LABELS.SAFE ? "[allow]" : "[block]";
    process.stdout.write(`${sym} ${verdict.label} · ${verdict.latencyMs.toFixed(0)}ms\n`);
  }
  await unloadModel({ modelId });
  await close();
}

async function cmdAsk({ prompt, base, adapter, asJson }) {
  if (!prompt) {
    process.stderr.write("error: prompt required\n");
    process.exit(2);
  }
  const classifierModelId = await loadHost({ base, adapter });
  const hostModelId = classifierModelId;
  const result = await safeCompletion({
    hostModelId,
    classifierModelId,
    history: [{ role: "user", content: prompt }],
    stream: false,
  });
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          blocked: result.blocked,
          verdict: result.verdict,
          classifierLatencyMs: result.classifierLatencyMs ?? null,
          raw: result.raw ?? null,
        },
        null,
        2,
      ) + "\n",
    );
  } else if (result.blocked) {
    process.stdout.write(`[block] ${result.verdict} · ${result.latencyMs?.toFixed?.(0) ?? "?"}ms\n`);
  } else {
    const final = await result.completion.final;
    process.stdout.write(`[allow] ${result.verdict} · ${result.classifierLatencyMs.toFixed(0)}ms\n`);
    process.stdout.write(final.contentText ?? final.cacheableAssistantContent ?? "");
    process.stdout.write("\n");
  }
  await unloadModel({ modelId: classifierModelId });
  await close();
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const cmd = parsed.command;
  const base = resolveBase(parsed.flags.base);
  const adapter = parsed.flags.adapter ?? resolve(ROOT, "artifacts/lora/adapter.gguf");
  const asJson = parsed.flags.json === "true";
  const prompt = parsed._.join(" ");

  if (!cmd || cmd === "help" || cmd === "--help") {
    process.stdout.write(USAGE);
    return;
  }
  if (cmd === "version") {
    process.stdout.write(`vanguard ${readPackageVersion()}\n`);
    return;
  }
  if (cmd === "guard") {
    await cmdGuard({ prompt, base, adapter, asJson });
    return;
  }
  if (cmd === "ask") {
    await cmdAsk({ prompt, base, adapter, asJson });
    return;
  }
  process.stderr.write(`unknown command: ${cmd}\n${USAGE}`);
  process.exit(2);
}

main().catch((e) => {
  console.error("[vanguard] error:", e);
  process.exit(1);
});
