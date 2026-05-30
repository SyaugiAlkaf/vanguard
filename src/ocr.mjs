// SPDX-License-Identifier: Apache-2.0
//
// OCR describer wrapper. Loads LightOnOCR-2-1B-ocr-soup + mmproj via
// @qvac/sdk. Used for medical documents where exact text extraction
// matters more than free-form description: lab reports, prescription
// labels, vital signs printouts, discharge summaries.
//
// Like the vision describer, the extracted text is routed back through
// Vanguard's classifier before any host model sees it — modality
// reduction stays consistent.
//
// Opt-in via HEARTH_OCR=1 because the model + mmproj are ~1.5 GB on
// first download.

import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

const DEFAULT_PROMPT =
  "Extract all readable text from this document. Return the text verbatim, " +
  "preserving structure (line breaks, table layout if visible). Do not " +
  "interpret, summarize, or add commentary. If the image is not a document " +
  "with text content, respond with exactly: NOT_DOCUMENT";

export const NOT_DOCUMENT_TOKEN = "NOT_DOCUMENT";

/**
 * Loads LightOnOCR-2-1B. Returns a handle with
 * extract(imageBytes, mimeType, optionalPrompt) -> string.
 */
export async function loadOcr({ onProgress } = {}) {
  let sdk;
  try {
    sdk = await import("@qvac/sdk");
  } catch (e) {
    throw new Error(`@qvac/sdk not available: ${e.message}`);
  }
  const ocrConst = sdk.OCR_0_6B_MULTIMODAL_Q4_K_M;
  const mmprojConst = sdk.MMPROJ_OCR_0_6B_MULTIMODAL_F16;
  if (!ocrConst || !mmprojConst) {
    throw new Error(
      "QVAC SDK does not expose OCR_0_6B_MULTIMODAL_Q4_K_M + mmproj — upgrade @qvac/sdk.",
    );
  }

  const modelId = await sdk.loadModel({
    modelSrc: ocrConst,
    modelType: "llm",
    modelConfig: {
      projectionModelSrc: mmprojConst,
      // OCR inputs are document images with lots of text content; bump
      // context so multi-page or dense documents fit.
      ctx_size: 4096,
    },
    onProgress: onProgress ?? (() => {}),
  });

  async function extract(imageBytes, mimeType, prompt) {
    const ext = (mimeType ?? "image/png").split("/")[1] ?? "png";
    const tmpPath = join(tmpdir(), `hearth-ocr-${randomBytes(8).toString("hex")}.${ext}`);
    writeFileSync(tmpPath, imageBytes);
    try {
      const run = sdk.completion({
        modelId,
        history: [
          {
            role: "user",
            content: prompt ?? DEFAULT_PROMPT,
            attachments: [{ path: tmpPath }],
          },
        ],
        stream: false,
        generationParams: { predict: 400, reasoning_budget: 0 },
      });
      const final = await run.final;
      return final?.contentText ?? final?.cacheableAssistantContent ?? "";
    } finally {
      try { unlinkSync(tmpPath); } catch (_e) { /* best effort */ }
    }
  }

  async function unload() {
    try {
      await sdk.unloadModel({ modelId });
    } catch (_e) { /* swallow */ }
  }

  return { modelId, extract, unload, defaultPrompt: DEFAULT_PROMPT };
}

/**
 * Stub for builds without OCR enabled. Returns a sentinel string so the
 * pipeline still functions; UI shows the same message it shows for
 * stub vision.
 */
export function stubOcr() {
  return {
    modelId: "stub-ocr",
    defaultPrompt: DEFAULT_PROMPT,
    async extract() {
      return "(OCR is not enabled; set HEARTH_OCR=1 to enable LightOnOCR-2-1B on first run, ~1.5 GB download)";
    },
    async unload() { /* nothing to do */ },
  };
}
