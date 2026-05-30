// SPDX-License-Identifier: Apache-2.0
import {
  loadModel,
  QWEN3_600M_INST_Q4,
  completion,
  unloadModel,
  close,
} from "@qvac/sdk";

const PROMPT = process.argv.slice(2).join(" ") ||
  "Reply with the single word: OK";

console.log("[smoke] loading model:", QWEN3_600M_INST_Q4);
const t0 = performance.now();

const modelId = await loadModel({
  modelSrc: QWEN3_600M_INST_Q4,
  modelType: "llm",
  onProgress: (p) => process.stdout.write(`\r[smoke] download/load: ${JSON.stringify(p)}`),
});

const tLoaded = performance.now();
console.log(`\n[smoke] model loaded in ${((tLoaded - t0) / 1000).toFixed(2)}s — id: ${modelId}`);

console.log(`[smoke] prompt: ${PROMPT}`);
const tInferStart = performance.now();
const result = completion({
  modelId,
  history: [{ role: "user", content: PROMPT }],
  stream: true,
});

let firstTokenAt = null;
let tokenCount = 0;
for await (const token of result.tokenStream) {
  if (firstTokenAt === null) firstTokenAt = performance.now();
  process.stdout.write(token);
  tokenCount++;
}
const tInferEnd = performance.now();

const ttft = firstTokenAt - tInferStart;
const totalInfer = tInferEnd - tInferStart;
const tps = tokenCount / (totalInfer / 1000);

console.log(
  `\n[smoke] TTFT: ${ttft.toFixed(0)}ms · tokens: ${tokenCount} · ` +
  `total: ${(totalInfer / 1000).toFixed(2)}s · tps: ${tps.toFixed(1)}`,
);

await unloadModel({ modelId });
await close();
console.log("[smoke] done.");
