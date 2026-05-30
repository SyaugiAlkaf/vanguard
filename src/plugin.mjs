// SPDX-License-Identifier: Apache-2.0
//
// Vanguard plugin — the integration surface for the QVAC ecosystem.
//
// Vanguard sits in front of a host LLM and blocks prompts that the
// heuristic + LoRA classifier flags as attacks. It throws QVAC's native
// `RequestRejectedByPolicyError` so downstream consumers can catch a
// well-known error type without learning Vanguard's vocabulary.
//
// Usage:
//
//   import { loadModel, completion, QWEN3_1_7B_INST_Q4 } from "@qvac/sdk";
//   import { vanguardFirewall } from "vanguard";
//
//   const modelId = await loadModel({
//     modelSrc: QWEN3_1_7B_INST_Q4,
//     modelType: "llm",
//     modelConfig: { lora: "/path/to/vanguard/adapter.gguf" },
//   });
//
//   const guarded = vanguardFirewall.attach({ modelId });
//
//   try {
//     const run = await guarded.completion({
//       history: [{ role: "user", content: "..." }],
//     });
//     const final = await run.final;
//     console.log(final.contentText);
//   } catch (e) {
//     if (e instanceof RequestRejectedByPolicyError) {
//       console.log("blocked:", e.reason);
//     }
//   }

import { completion } from "@qvac/sdk";
import { RequestRejectedByPolicyError } from "@qvac/sdk";
import { classify } from "./classifier.mjs";
import { LABELS } from "./labels.mjs";

const KIND = "completion";

let _requestSeq = 0;
function nextRequestId() {
  _requestSeq += 1;
  return `vanguard-${Date.now().toString(36)}-${_requestSeq.toString(36)}`;
}

function lastUserMessage(history) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user" && typeof history[i].content === "string") {
      return history[i].content;
    }
  }
  return null;
}

function buildReason(verdict) {
  const tag = verdict.mode === "heuristic" ? "heuristic" : "classifier";
  return `Vanguard ${tag} verdict: ${verdict.label}`;
}

const DEFAULT_HOST_PREDICT = 512;

/**
 * Apply the firewall to a single shared modelId. Returns an object with:
 *   - completion(params): wraps @qvac/sdk completion(). Throws
 *     RequestRejectedByPolicyError on block. If caller did not pass
 *     generationParams.predict, injects a soft default of 512 to keep host
 *     replies from overflowing context. Override by passing your own
 *     generationParams.
 *   - classify(prompt): expose the bare classifier verdict (no throw).
 *   - inspect(prompt): same as classify but with extra telemetry.
 */
export function attach({ modelId, hostModelId, classifierModelId, onAudit }) {
  if (!modelId && !(hostModelId && classifierModelId)) {
    throw new TypeError(
      "attach requires { modelId } OR { hostModelId, classifierModelId }",
    );
  }
  const host = hostModelId ?? modelId;
  const classifierId = classifierModelId ?? modelId;

  async function inspect(prompt) {
    const v = await classify({ modelId: classifierId, prompt });
    return v;
  }

  async function guardedCompletion(params) {
    const requestId = nextRequestId();
    const userPrompt = lastUserMessage(params.history);
    if (!userPrompt) {
      throw new TypeError(
        "guarded completion requires history with a user message",
      );
    }
    const verdict = await classify({ modelId: classifierId, prompt: userPrompt });
    if (typeof onAudit === "function") {
      try {
        onAudit({
          phase: "classify",
          requestId,
          prompt: userPrompt,
          verdict,
        });
      } catch (_) {
        /* swallow audit errors */
      }
    }
    if (verdict.blocked) {
      throw new RequestRejectedByPolicyError(
        requestId,
        KIND,
        classifierId,
        buildReason(verdict),
      );
    }
    const gen = params.generationParams ?? {};
    const bounded =
      gen.predict == null ? { ...gen, predict: DEFAULT_HOST_PREDICT } : gen;
    return completion({
      ...params,
      modelId: host,
      generationParams: bounded,
    });
  }

  return {
    completion: guardedCompletion,
    classify: inspect,
    inspect,
  };
}

export const vanguardFirewall = Object.freeze({
  attach,
  labels: LABELS,
});

export { RequestRejectedByPolicyError } from "@qvac/sdk";
