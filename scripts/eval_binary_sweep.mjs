// SPDX-License-Identifier: Apache-2.0
// Sweep Stage-1 (binary SAFE/ATTACK) checkpoints on the binary val to find
// the best attack-recall checkpoint (subject to acceptable FP).
import { loadModel, unloadModel, close, QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STAGE1_SYSTEM_PROMPT } from "../src/cascade.mjs";
import { completion } from "@qvac/sdk";

const VAL = resolve("data/sft/val_cascade_stage1.jsonl");
const CKPTS = (process.argv[2] ?? "100,200,300").split(",");
const rows = readFileSync(VAL, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
  const m = JSON.parse(l).messages;
  return { prompt: m.find((x) => x.role === "user").content, truth: m.find((x) => x.role === "assistant").content.trim().toUpperCase() };
});

for (const step of CKPTS) {
  const adapter = resolve(`artifacts/training/checkpoints_cascade_s1/checkpoint_step_${String(step).padStart(8, "0")}/model.gguf`);
  const modelId = await loadModel({ modelSrc: QWEN3_1_7B_INST_Q4, modelType: "llm", modelConfig: { lora: adapter } });
  let tp = 0, fn = 0, fp = 0, tn = 0;
  for (const r of rows) {
    const run = completion({ modelId, history: [{ role: "system", content: STAGE1_SYSTEM_PROMPT }, { role: "user", content: r.prompt.slice(0, 2400) }], stream: false, generationParams: { predict: 6, reasoning_budget: 0 } });
    const out = ((await run.final)?.contentText ?? "").toUpperCase();
    const pred = /\bATTACK\b/.test(out) ? "ATTACK" : /\bSAFE\b/.test(out) ? "SAFE" : "ATTACK";
    if (r.truth === "ATTACK") { pred === "ATTACK" ? tp++ : fn++; }
    else { pred === "ATTACK" ? fp++ : tn++; }
  }
  const recall = tp / (tp + fn);
  const fpr = fp / (fp + tn);
  const precision = tp / (tp + fp || 1);
  console.log(`step ${step}: attack-recall=${(recall * 100).toFixed(1)}% FP=${(fpr * 100).toFixed(1)}% attack-precision=${(precision * 100).toFixed(1)}%`);
  await unloadModel({ modelId });
}
await close();
