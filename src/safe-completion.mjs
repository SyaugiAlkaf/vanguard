// SPDX-License-Identifier: Apache-2.0
import { completion } from "@qvac/sdk";
import { classify } from "./classifier.mjs";
import { VanguardBlockedError } from "./errors.mjs";
import { LABELS } from "./labels.mjs";

export async function safeCompletion({
  hostModelId,
  classifierModelId,
  history,
  stream = false,
  throwOnBlock = false,
  auditLog,
  ...completionOpts
}) {
  if (!Array.isArray(history) || history.length === 0) {
    throw new TypeError("safeCompletion requires a non-empty history array");
  }
  // Iterate from the end — zero allocation, half the wall time of
  // [...history].reverse().find().
  let lastUser = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") { lastUser = history[i]; break; }
  }
  if (!lastUser?.content) {
    throw new TypeError("safeCompletion requires the latest user message to have content");
  }

  const verdict = await classify({
    modelId: classifierModelId,
    prompt: lastUser.content,
  });

  // confidence: 1 when the classifier returned a parsable verdict, 0
  // when it fell back. classify() returns `fallback: true` on parse-fail.
  const confidence = verdict.fallback ? 0 : 1;

  if (auditLog?.recordInference) {
    auditLog.recordInference({
      modelId: classifierModelId,
      prompt: lastUser.content,
      completion: verdict.label,
      promptTokens: null,
      completionTokens: null,
      ttftMs: null,
      tps: null,
      classifierVerdict: verdict.label,
      classifierConfidence: confidence,
      blocked: verdict.blocked,
    });
  }

  if (verdict.blocked) {
    if (throwOnBlock) {
      throw new VanguardBlockedError(verdict.label, confidence, verdict.raw);
    }
    return {
      blocked: true,
      verdict: verdict.label,
      raw: verdict.raw,
      latencyMs: verdict.latencyMs,
    };
  }

  const result = completion({
    modelId: hostModelId,
    history,
    stream,
    ...completionOpts,
  });
  return {
    blocked: false,
    verdict: verdict.label,
    classifierLatencyMs: verdict.latencyMs,
    completion: result,
  };
}
