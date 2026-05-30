// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  unloadModel,
  finetune,
  close,
  QWEN3_600M_INST_Q4,
  QWEN3_1_7B_INST_Q4,
  QWEN3_4B_Q4_K_M,
  QWEN3_4B_INST_Q4_K_M,
  LLAMA_3_2_1B_INST_Q4_0,
  MEDGEMMA_4B_IT_Q4_1,
} from "@qvac/sdk";

const BASES = {
  qwen3_600m: QWEN3_600M_INST_Q4,
  qwen3_1_7b: QWEN3_1_7B_INST_Q4,
  qwen3_4b: QWEN3_4B_Q4_K_M,
  qwen3_4b_inst: QWEN3_4B_INST_Q4_K_M,
  llama3_2_1b: LLAMA_3_2_1B_INST_Q4_0,
  medgemma_4b: MEDGEMMA_4B_IT_Q4_1,
};
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const argv = parseArgs(process.argv.slice(2));

const TRAIN = argv.train ?? "data/sft/train.jsonl";
const VAL = argv.val ?? "data/sft/val.jsonl";
const OUT = argv.out ?? "artifacts/lora";
const PROGRESS_LOG = argv.progress ?? "artifacts/training/progress.jsonl";
const EPOCHS = numberOpt(argv.epochs, 2);
const LR = numberOpt(argv.lr, 1e-4);
const LR_MIN = numberOpt(argv["lr-min"], 1e-5);
const CONTEXT = numberOpt(argv.context, 2048);
const LORA_RANK = numberOpt(argv["lora-rank"], 16);
const LORA_ALPHA = numberOpt(argv["lora-alpha"], 32);
const LORA_MODULES =
  argv["lora-modules"] ??
  "attn_q,attn_k,attn_v,attn_o,ffn_gate,ffn_up,ffn_down";
const BATCH = numberOpt(argv.batch, 16);
const MICRO_BATCH = numberOpt(argv["micro-batch"], 4);
const BASE_KEY = (argv.base ?? "llama3_2_1b").toString();
const BASE = BASES[BASE_KEY];
const CKPT_STEPS = numberOpt(argv["ckpt-steps"], 2000);
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

function numberOpt(v, dflt) {
  if (v == null) return dflt;
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

async function main() {
  await mkdir(dirname(PROGRESS_LOG), { recursive: true });
  await mkdir(OUT, { recursive: true });

  console.log(`[train] loading base model: ${BASE_KEY}`, BASE);
  const t0 = performance.now();
  const modelId = await loadModel({
    modelSrc: BASE,
    modelType: "llm",
    onProgress: (p) =>
      process.stdout.write(`\r[train] base load: ${JSON.stringify(p)}`),
  });
  console.log(`\n[train] base loaded in ${((performance.now() - t0) / 1000).toFixed(2)}s`);

  console.log(`[train] train file: ${resolve(TRAIN)}`);
  console.log(`[train] val file: ${resolve(VAL)}`);
  console.log(`[train] adapter out: ${resolve(OUT)}`);
  console.log(`[train] epochs=${EPOCHS} lr=${LR} lr_min=${LR_MIN} ctx=${CONTEXT} rank=${LORA_RANK} alpha=${LORA_ALPHA} batch=${BATCH} micro=${MICRO_BATCH}`);
  console.log(`[train] lora_modules=${LORA_MODULES}`);

  const handle = finetune({
    modelId,
    options: {
      trainDatasetDir: resolve(TRAIN),
      validation: { type: "dataset", path: resolve(VAL) },
      outputParametersDir: resolve(OUT),
      numberOfEpochs: EPOCHS,
      learningRate: LR,
      lrMin: LR_MIN,
      contextLength: CONTEXT,
      batchSize: BATCH,
      microBatchSize: MICRO_BATCH,
      loraRank: LORA_RANK,
      loraAlpha: LORA_ALPHA,
      loraModules: LORA_MODULES,
      assistantLossOnly: true,
      checkpointSaveDir: resolve("artifacts/training/checkpoints"),
      checkpointSaveSteps: CKPT_STEPS,
    },
  });

  let step = 0;
  for await (const progress of handle.progressStream) {
    step += 1;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      ...progress,
    });
    await writeFile(PROGRESS_LOG, line + "\n", { flag: "a" });
    process.stdout.write(
      `\r[train] step=${progress.global_steps ?? step} loss=${
        progress.loss?.toFixed?.(4) ?? progress.loss
      } eval=${progress.eval_loss?.toFixed?.(4) ?? "—"}      `,
    );
  }

  const result = await handle.result;
  console.log("\n[train] result:", JSON.stringify(result, null, 2));

  await unloadModel({ modelId });
  await close();
  console.log("[train] done. adapter at:", resolve(OUT));
}

main().catch((e) => {
  console.error("[train] error:", e);
  process.exit(1);
});
