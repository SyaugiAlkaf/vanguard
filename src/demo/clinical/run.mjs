#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Clinical demo — Vanguard guarding a local clinical LLM (MedGemma 4B Q4).
//
// Reads canonical scenarios from src/demo/clinical/scenarios.jsonl:
//   - "attack" rows: should be BLOCKED by Vanguard (INJECTION/JAILBREAK/EXFIL)
//   - "benign" rows: should PASS THROUGH and be answered cleanly
//
// Captures audit + session JSON under artifacts/clinical_demo/. Used in
// the Phase 4 demo video segment about clinical PI defense.

import {
  loadModel,
  unloadModel,
  close,
  MEDGEMMA_4B_IT_Q4_1,
  QWEN3_1_7B_INST_Q4,
} from "@qvac/sdk";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../../classifier.mjs";
import { safeCompletion } from "../../safe-completion.mjs";
import { VanguardBlockedError } from "../../errors.mjs";
import {
  openAuditLog,
  recordModelLoad,
  recordModelUnload,
  recordInference,
} from "../../../scripts/audit_log.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), "../../..");

const argv = parseArgs(process.argv.slice(2));
const SCENARIOS = argv.scenarios ?? resolve(ROOT, "src/demo/clinical/scenarios.jsonl");
const ADAPTER = argv.adapter ?? resolve(ROOT, "artifacts/lora/adapter.gguf");
const AUDIT = argv.audit ?? resolve(ROOT, "artifacts/clinical_demo/audit.jsonl");
const SESSION_OUT = argv.session ?? resolve(ROOT, "artifacts/clinical_demo/session.json");
const RUN_HOST = argv["run-host"] !== "false"; // pass --run-host false to skip MedGemma load (test classifier alone)

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

function loadScenarios(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

async function main() {
  mkdirSync(dirname(AUDIT), { recursive: true });
  const audit = openAuditLog(AUDIT);

  console.log("[clinical] loading classifier base (Qwen3-1.7B + Vanguard LoRA)");
  const t0 = performance.now();
  const classifierModelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: "llm",
    modelConfig: { lora: ADAPTER },
    onProgress: (p) => process.stdout.write(`\r[clinical] classifier load: ${JSON.stringify(p)}`),
  });
  console.log(`\n[clinical] classifier loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);
  recordModelLoad(audit, { modelId: classifierModelId, modelType: "llm", src: "QWEN3_1_7B_INST_Q4+vanguard-lora" });

  let hostModelId = null;
  if (RUN_HOST) {
    console.log("[clinical] loading host model (MedGemma 4B)");
    const tH = performance.now();
    try {
      hostModelId = await loadModel({
        modelSrc: MEDGEMMA_4B_IT_Q4_1,
        modelType: "llm",
        onProgress: (p) => process.stdout.write(`\r[clinical] medgemma load: ${JSON.stringify(p)}`),
      });
      console.log(`\n[clinical] medgemma loaded in ${((performance.now() - tH) / 1000).toFixed(2)}s`);
      recordModelLoad(audit, { modelId: hostModelId, modelType: "llm", src: "MEDGEMMA_4B_IT_Q4_1" });
    } catch (e) {
      console.warn(`\n[clinical] MedGemma load failed (${e.message}); continuing with classifier-only mode`);
      hostModelId = null;
    }
  }

  const scenarios = loadScenarios(SCENARIOS);
  console.log(`[clinical] running ${scenarios.length} scenarios...\n`);

  const session = {
    startedAt: new Date().toISOString(),
    classifierBase: "QWEN3_1_7B_INST_Q4",
    classifierAdapter: ADAPTER,
    hostBase: hostModelId ? "MEDGEMMA_4B_IT_Q4_1" : null,
    rows: [],
  };

  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i];
    const idx = String(i + 1).padStart(2, "0");
    console.log(`--- ${idx} [${s.role}/${s.label}] ${s.prompt.slice(0, 90)}${s.prompt.length > 90 ? "..." : ""}`);

    if (!hostModelId) {
      let verdict;
      try {
        verdict = await classify({ modelId: classifierModelId, prompt: s.prompt });
      } catch (e) {
        console.log(`    classifier ERROR: ${e.message}`);
        session.rows.push({ ...s, error: e.message, correct: false });
        continue;
      }
      const expectedBlock = s.role === "attack";
      const correct = expectedBlock ? verdict.blocked : !verdict.blocked;
      recordInference(audit, {
        modelId: classifierModelId,
        prompt: s.prompt,
        completion: verdict.raw,
        promptTokens: null,
        completionTokens: verdict.stats?.generatedTokens ?? null,
        ttftMs: verdict.stats?.timeToFirstToken ?? null,
        tps: verdict.stats?.tokensPerSecond ?? null,
        classifierVerdict: verdict.label,
        classifierConfidence: verdict.fallback ? 0 : 1,
        blocked: verdict.blocked,
      });
      console.log(`    classifier-only: verdict=${verdict.label} blocked=${verdict.blocked} mode=${verdict.mode} ${correct ? "PASS" : "MISS"}`);
      session.rows.push({
        ...s,
        verdict: verdict.label,
        blocked: verdict.blocked,
        mode: verdict.mode,
        correct,
        latencyMs: verdict.latencyMs,
      });
      continue;
    }

    try {
      const result = await safeCompletion({
        hostModelId,
        classifierModelId,
        history: [{ role: "user", content: s.prompt }],
        throwOnBlock: true,
        stream: false,
        auditLog: audit,
        generationParams: { predict: 256 },
      });
      // SAFE path — host model produced output
      const final = await result.completion.final;
      const reply = (final?.contentText ?? "").slice(0, 200);
      console.log(`    [PASSED] verdict=${result.verdict}`);
      console.log(`    medgemma: ${reply}${reply.length === 200 ? "..." : ""}`);
      session.rows.push({
        ...s,
        verdict: result.verdict,
        blocked: false,
        replyPreview: reply,
        correct: s.role === "benign",
      });
    } catch (e) {
      if (e instanceof VanguardBlockedError) {
        console.log(`    [BLOCKED] verdict=${e.verdict} reason=${e.reason}`);
        session.rows.push({
          ...s,
          verdict: e.verdict,
          blocked: true,
          reason: e.reason,
          correct: s.role === "attack",
        });
      } else {
        console.error(`    [ERROR] ${e.message}`);
        session.rows.push({ ...s, error: e.message, correct: false });
      }
    }
  }

  const pass = session.rows.filter((r) => r.correct).length;
  session.summary = {
    total: session.rows.length,
    pass,
    accuracy: pass / Math.max(1, session.rows.length),
    blocksOnAttack: session.rows.filter((r) => r.role === "attack" && r.blocked).length,
    passesOnBenign: session.rows.filter((r) => r.role === "benign" && !r.blocked).length,
  };
  session.endedAt = new Date().toISOString();

  mkdirSync(dirname(SESSION_OUT), { recursive: true });
  writeFileSync(SESSION_OUT, JSON.stringify(session, null, 2), "utf8");

  console.log(`\n=== Clinical demo summary ===`);
  console.log(`scenarios: ${session.summary.total}`);
  console.log(`pass: ${session.summary.pass} (${(session.summary.accuracy * 100).toFixed(1)}%)`);
  console.log(`attacks blocked: ${session.summary.blocksOnAttack}/${session.rows.filter((r) => r.role === "attack").length}`);
  console.log(`benign passed: ${session.summary.passesOnBenign}/${session.rows.filter((r) => r.role === "benign").length}`);
  console.log(`audit log: ${AUDIT}`);
  console.log(`session: ${SESSION_OUT}`);

  if (hostModelId) {
    await unloadModel({ modelId: hostModelId });
    recordModelUnload(audit, { modelId: hostModelId });
  }
  await unloadModel({ modelId: classifierModelId });
  recordModelUnload(audit, { modelId: classifierModelId });
  audit.close?.();
  await close();
}

main().catch((e) => {
  console.error("[clinical] error:", e);
  process.exit(1);
});
