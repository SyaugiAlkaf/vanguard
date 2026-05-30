#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Hearth — sovereign clinical chat on your own hardware. Vanguard runs
// in front of every prompt; MedGemma 4B answers the benign ones.
//
// Local HTTP + Server-Sent Events. No framework, no glossy SaaS, no
// cloud. Browser hits localhost:7777; server bridges to @qvac/sdk.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadModel,
  unloadModel,
  close,
  completion,
  QWEN3_1_7B_INST_Q4,
  MEDGEMMA_4B_IT_Q4_1,
} from "@qvac/sdk";
import { vanguardFirewall } from "../../src/plugin.mjs";
import { classify } from "../../src/classifier.mjs";
import { heuristicClassify } from "../../src/heuristics.mjs";
import { SignatureStore } from "../../src/mesh/store.mjs";
import { MeshSwarm } from "../../src/mesh/swarm.mjs";
import { makeSignature, signatureHash } from "../../src/mesh/signatures.mjs";
import { buildFormularyLookup } from "../../src/formulary.mjs";
import { loadVision, stubVision, NOT_MEDICAL_TOKEN } from "../../src/vision.mjs";
import { loadOcr, stubOcr, NOT_DOCUMENT_TOKEN } from "../../src/ocr.mjs";
import { triage } from "../../src/triage.mjs";
import { suggestQuestions } from "../../src/clinical_questions.mjs";
import { readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(__filename);
const REPO_ROOT = resolve(ROOT, "../..");
const PUBLIC_DIR = resolve(ROOT, "public");
const ADAPTER = resolve(REPO_ROOT, "artifacts/lora/adapter.gguf");
const MESH_SEED = resolve(REPO_ROOT, "data/mesh_seed.jsonl");
const MESH_STORAGE = process.env.HEARTH_MESH_STORAGE ?? resolve(REPO_ROOT, ".vanguard-mesh-hearth");
const PORT = Number(process.env.HEARTH_PORT ?? 7777);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let classifierModelId = null;
let hostModelId = null;
let firewall = null;
let meshStore = null;
let meshHandle = null;
let meshSwarm = null;
let meshSigCount = 0;
let vision = null;
let ocr = null;
let formulary = null;
const sessionLog = [];

function logEvent(event) {
  sessionLog.push({ ...event, ts: new Date().toISOString() });
  if (sessionLog.length > 1000) sessionLog.shift();
}

async function bootFormulary() {
  try {
    formulary = buildFormularyLookup();
    console.log(`[hearth] formulary loaded: ${formulary.formulary.length} medications, ${formulary.apoteks.length} apoteks`);
  } catch (e) {
    console.warn(`[hearth] formulary load failed (${e.message}); medication cards will not surface`);
    formulary = null;
  }
}

async function bootVision() {
  if (process.env.HEARTH_VISION !== "1") {
    console.log("[hearth] HEARTH_VISION not set — using stub vision (set HEARTH_VISION=1 to enable Qwen3-VL-2B)");
    vision = stubVision();
    return;
  }
  console.log("[hearth] loading vision model (Qwen3-VL-2B + mmproj, ~1.5 GB on first run)");
  try {
    vision = await loadVision({
      onProgress: (p) => process.stdout.write(`\r[hearth] vision: ${JSON.stringify(p)}`),
    });
    console.log("\n[hearth] vision ready");
  } catch (e) {
    console.warn(`\n[hearth] vision load failed (${e.message}); falling back to stub`);
    vision = stubVision();
  }
}

async function bootOcr() {
  if (process.env.HEARTH_OCR !== "1") {
    console.log("[hearth] HEARTH_OCR not set — using stub OCR (set HEARTH_OCR=1 to enable LightOnOCR-2-1B)");
    ocr = stubOcr();
    return;
  }
  console.log("[hearth] loading OCR model (LightOnOCR-2-1B + mmproj, ~1.5 GB on first run)");
  try {
    ocr = await loadOcr({
      onProgress: (p) => process.stdout.write(`\r[hearth] ocr: ${JSON.stringify(p)}`),
    });
    console.log("\n[hearth] ocr ready");
  } catch (e) {
    console.warn(`\n[hearth] OCR load failed (${e.message}); falling back to stub`);
    ocr = stubOcr();
  }
}

async function bootMesh() {
  if (process.env.HEARTH_NO_MESH === "1") {
    console.log("[hearth] HEARTH_NO_MESH=1 — skipping mesh layer");
    return;
  }
  try {
    meshStore = new SignatureStore(MESH_STORAGE);
    await meshStore.open();
    const existing = await meshStore.count();
    if (existing === 0) {
      // Auto-seed from data/mesh_seed.jsonl
      try {
        const seedText = readFileSync(MESH_SEED, "utf8");
        const rows = seedText.split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
        const ts = Date.now();
        for (const r of rows) {
          await meshStore.put({
            v: 1,
            sig: r.sig,
            label: r.label,
            transforms: r.vector ? [r.vector] : [],
            deviceId: "hearth-seed",
            ts,
            promptLen: r.promptLen ?? 0,
          });
        }
        console.log(`[hearth] seeded mesh with ${rows.length} signatures from ${MESH_SEED}`);
      } catch (e) {
        console.warn(`[hearth] mesh seed failed (${e.message}); mesh available but empty`);
      }
    } else {
      console.log(`[hearth] mesh already has ${existing} signatures`);
    }
    meshSigCount = await meshStore.count();

    // Opt-in live P2P: with HEARTH_MESH_SECRET set, join the Hyperswarm so a
    // signature this device learns propagates to the fleet and signatures
    // peers learn land here. Without it, the mesh is a local cache only.
    const secret = process.env.HEARTH_MESH_SECRET;
    if (secret) {
      meshSwarm = new MeshSwarm({
        store: meshStore,
        secret,
        deviceId: process.env.HEARTH_DEVICE_ID || "hearth",
      });
      meshSwarm.onSignature = (sig) => {
        meshSigCount += 1;
        logEvent({ kind: "mesh_recv", verdict: sig.label, blocked: true, promptLen: sig.promptLen ?? 0, latencyMs: 0 });
      };
      meshSwarm.onPeer = ({ total }) => console.log(`[hearth] mesh peer connected (${total} total)`);
      await meshSwarm.join();
      console.log(`[hearth] mesh swarm joined — fleet propagation live`);
    }

    meshHandle = {
      lookup: async (prompt) => meshStore.get(signatureHash(prompt)),
      count: () => meshSigCount,
      peerCount: () => (meshSwarm ? meshSwarm.peerCount() : 0),
      publish: async ({ prompt, label }) => {
        const sig = makeSignature({
          prompt,
          label,
          transforms: [],
          deviceId: process.env.HEARTH_DEVICE_ID || "hearth",
        });
        const existing = await meshStore.get(sig.sig);
        await meshStore.put(sig);
        if (!existing) meshSigCount += 1;
        if (meshSwarm) meshSwarm.broadcast(sig);
        return sig;
      },
    };
  } catch (e) {
    console.warn(`[hearth] mesh init failed (${e.message}); continuing without mesh layer`);
    meshStore = null;
    meshHandle = null;
    meshSwarm = null;
  }
}

async function bootModels() {
  await bootFormulary();
  await bootMesh();
  await bootVision();
  await bootOcr();

  if (process.env.HEARTH_NO_MODELS === "1") {
    console.log("[hearth] HEARTH_NO_MODELS=1 — skipping model load (UI dev mode)");
    classifierModelId = "dev-stub-classifier";
    hostModelId = "dev-stub-host";
    firewall = {
      completion: async () => ({ final: { contentText: "(dev mode — no host model)" } }),
    };
    return;
  }
  console.log("[hearth] loading classifier base (Qwen3-1.7B + Vanguard LoRA)");
  const t0 = Date.now();
  classifierModelId = await loadModel({
    modelSrc: QWEN3_1_7B_INST_Q4,
    modelType: "llm",
    // ctx_size lifted from the 1024 default so classifying a long OCR'd
    // document (the extracted text is the classifier input) does not overflow.
    modelConfig: { lora: ADAPTER, ctx_size: 4096 },
    onProgress: (p) =>
      process.stdout.write(`\r[hearth] classifier: ${JSON.stringify(p)}`),
  });
  console.log(`\n[hearth] classifier loaded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("[hearth] loading host (MedGemma 4B)");
  const t1 = Date.now();
  try {
    hostModelId = await loadModel({
      modelSrc: MEDGEMMA_4B_IT_Q4_1,
      modelType: "llm",
      // The host answers with multi-turn history (prior turns + an OCR'd
      // document or image findings) prepended. The default 1024-token window
      // overflows once a document and a few turns are in context, so give it
      // room for the conversation plus a 768-token reply.
      modelConfig: { ctx_size: 8192 },
      onProgress: (p) =>
        process.stdout.write(`\r[hearth] medgemma: ${JSON.stringify(p)}`),
    });
    console.log(`\n[hearth] medgemma loaded in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.warn(
      `\n[hearth] MedGemma load failed (${e.message}). Falling back to classifier model as host.`,
    );
    hostModelId = classifierModelId;
  }

  firewall = vanguardFirewall.attach({
    hostModelId,
    classifierModelId,
    onAudit: (e) => logEvent({ kind: "classify", phase: e.phase, verdict: e.verdict, promptLen: e.prompt?.length ?? 0 }),
  });
}

async function shutdown() {
  console.log("\n[hearth] shutting down…");
  try {
    if (meshSwarm) await meshSwarm.leave();
    if (meshStore) await meshStore.close();
    if (process.env.HEARTH_NO_MODELS !== "1") {
      if (ocr && ocr.modelId !== "stub-ocr") await ocr.unload?.();
      if (vision && vision.modelId !== "stub-vision") await vision.unload?.();
      if (hostModelId && hostModelId !== classifierModelId) await unloadModel({ modelId: hostModelId });
      if (classifierModelId) await unloadModel({ modelId: classifierModelId });
      await close();
    }
  } catch (e) {
    console.error("[hearth] shutdown error:", e);
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function setSseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
}

const HOST_SYSTEM_PROMPT = [
  "You are Hearth, a careful clinical assistant running locally on the patient's own hardware.",
  "Answer health questions clearly and kindly in plain language, formatted in Markdown.",
  "When the message includes findings from a local vision model that examined an image the patient uploaded, treat those findings as your own observations of the image and reason from them directly. Never tell the patient you cannot see or view the image — those findings are what the image shows.",
  "You are not a doctor and cannot diagnose or prescribe. For minor, self-limiting symptoms you MAY name common over-the-counter options the patient could consider (for example paracetamol/acetaminophen or ibuprofen for mild pain or fever), with brief general guidance — always say to follow the package directions, check with a pharmacist, and that this is not a prescription. Do not give specific doses for children, pregnancy, kidney/liver/stomach conditions, or when red-flag symptoms are present.",
  "For anything severe, sudden, or worsening, tell the patient to seek in-person medical care or emergency services.",
].join(" ");

function sse(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function handleStatic(req, res) {
  const pathname = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const fp = join(PUBLIC_DIR, pathname);
  // Use path.relative to defeat sibling-directory traversal: a string
  // startsWith(PUBLIC_DIR) check would allow /public_evil/x to pass.
  const { relative, isAbsolute } = await import("node:path");
  const rel = relative(PUBLIC_DIR, fp);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(fp);
    const mime = MIME[extname(fp)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" }).end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

// Precise, near-zero-false-positive classification: heuristic regex then
// the mesh signature lookup, without the LoRA. Used for the image
// description, which has already passed the NOT_MEDICAL gate and is benign
// machine-generated clinical text — running it through the LoRA produced
// false-positive INJECTION blocks on real lab reports. Explicit attack text
// an attacker embeds in an image is still caught by these layers.
async function heuristicMeshClassify(text) {
  const h = heuristicClassify(text);
  if (h) return { label: h.label, blocked: h.blocked, mode: "heuristic", latencyMs: 0, raw: h.reason };
  if (meshHandle) {
    const meshHit = await meshHandle.lookup(text);
    if (meshHit && meshHit.label) {
      return {
        label: meshHit.label,
        blocked: meshHit.label !== "SAFE",
        mode: "mesh",
        latencyMs: 0,
        raw: `mesh signature ${meshHit.sig?.slice?.(0, 16) ?? ""}...`,
      };
    }
  }
  return { label: "SAFE", blocked: false, mode: "heuristic-fallthrough", latencyMs: 0, raw: null };
}

async function handleAsk(req, res) {
  if (!firewall) {
    res.writeHead(503).end("models still loading");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const prompt = String(body?.prompt ?? "").trim();
  const imageDataUrl = String(body?.imageDataUrl ?? "");
  if (!prompt && !imageDataUrl) {
    res.writeHead(400).end("missing prompt");
    return;
  }
  const city = String(body?.city ?? "").trim();

  // Prior conversation turns, supplied by the client so the host model has
  // multi-turn memory (e.g. asking follow-up questions about a document
  // extracted via OCR, or an image described earlier). Each turn here was
  // already classified when it was first sent, so it is not re-classified;
  // it is bounded in count and size to keep the host context in budget.
  const HISTORY_CHAR_BUDGET = 6000;
  const cleanedHistory = (Array.isArray(body?.history) ? body.history : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  // Keep the most-recent turns within a character budget so prefill stays
  // well inside the host context window (8192) regardless of how long the
  // conversation grows or how large an attached document is.
  const priorTurns = [];
  let historyBudget = HISTORY_CHAR_BUDGET;
  for (let i = cleanedHistory.length - 1; i >= 0 && historyBudget > 0; i--) {
    historyBudget -= cleanedHistory[i].content.length;
    priorTurns.unshift(cleanedHistory[i]);
  }

  setSseHeaders(res);
  const t0 = Date.now();

  // Red-flag triage — scan the patient's own text for symptoms that
  // warrant urgent care. Emits a high-priority "triage" event before
  // any classifier or model runs.
  const triageHit = triage(prompt);
  if (triageHit) {
    sse(res, "triage", triageHit);
    logEvent({ kind: "triage", flag: triageHit.label, severity: triageHit.severity, promptLen: prompt.length });
  }

  // If an image came with the prompt: ask the vision model to describe
  // it, then feed the description through Vanguard alongside the user
  // text. This is the input-modality-reduction pattern — every input is
  // a text classify() call before any model decides what to do.
  let composedPrompt = prompt;
  let imageDescription = null;
  if (imageDataUrl && vision) {
    const m = imageDataUrl.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
    if (!m) {
      sse(res, "error", { message: "image data URL is not a recognized format" });
      sse(res, "done", { totalMs: Date.now() - t0 });
      res.end();
      return;
    }
    const mimeType = m[1];
    const bytes = Buffer.from(m[3], "base64");
    if (bytes.length > 5 * 1024 * 1024) {
      sse(res, "error", { message: "image too large (>5 MB)" });
      sse(res, "done", { totalMs: Date.now() - t0 });
      res.end();
      return;
    }
    try {
      imageDescription = await vision.describe(bytes, mimeType);
      // Vision-side rejection: non-medical content gets refused at the
      // image layer before Vanguard even sees the text. Keeps the
      // false-positive surface clean (screenshot-of-Hearth-UI etc.).
      if (imageDescription && imageDescription.trim().startsWith(NOT_MEDICAL_TOKEN)) {
        sse(res, "image_rejected", {
          reason: "not medical content",
          description: imageDescription,
        });
        sse(res, "done", { totalMs: Date.now() - t0 });
        logEvent({ kind: "image", verdict: "NOT_MEDICAL", blocked: true, promptLen: 0, latencyMs: 0 });
        res.end();
        return;
      }
      sse(res, "image_description", { text: imageDescription, bytes: bytes.length });
      composedPrompt = prompt
        ? `A local vision model examined an image the patient just uploaded and reported the following findings:\n\n${imageDescription}\n\nTreat those findings as what is in the image. The patient asks: ${prompt}`
        : `A local vision model examined an image the patient just uploaded and reported the following findings:\n\n${imageDescription}\n\nTreat those findings as what is in the image. Explain them to the patient in plain language.`;
    } catch (e) {
      sse(res, "error", { message: `vision describe failed: ${e.message}` });
      sse(res, "done", { totalMs: Date.now() - t0 });
      res.end();
      return;
    }
  }

  // Classify the patient's free-text prompt and the image description as
  // SEPARATE inputs. The prompt gets the full stack (heuristic, mesh, LoRA,
  // suspicion). The image description gets heuristic+mesh only: it already
  // passed the NOT_MEDICAL gate, so it is benign machine-generated clinical
  // text, and the LoRA false-positives on clinical prose (it blocked real
  // lab reports as INJECTION). The two are never concatenated, which also
  // stops benign questions like "what's inside it? explain to me" from being
  // misread as context extraction.
  const devMode = process.env.HEARTH_NO_MODELS === "1";
  const promptClassify = devMode
    ? heuristicMeshClassify
    : (t) => classify({ modelId: classifierModelId, prompt: t, mesh: meshHandle });

  let verdict = { label: "SAFE", blocked: false, mode: "none", latencyMs: 0, raw: null };
  try {
    if (prompt) verdict = await promptClassify(prompt);
    if (!verdict.blocked && imageDescription) {
      const dv = await heuristicMeshClassify(imageDescription);
      if (dv.blocked) verdict = dv;
    }
  } catch (e) {
    sse(res, "error", { message: `classify failed: ${e.message}` });
    sse(res, "done", { totalMs: Date.now() - t0 });
    res.end();
    return;
  }

  sse(res, "verdict", {
    label: verdict.label,
    blocked: verdict.blocked,
    mode: verdict.mode,
    latencyMs: verdict.latencyMs,
    raw: verdict.raw?.slice?.(0, 200) ?? null,
  });
  logEvent({
    kind: "ask",
    verdict: verdict.label,
    blocked: verdict.blocked,
    promptLen: composedPrompt.length,
    latencyMs: verdict.latencyMs ?? 0,
  });

  if (verdict.blocked) {
    // Teach the fleet: publish this attack's signature to the mesh so peer
    // devices block it without having to re-run the classifier.
    if (meshHandle?.publish) {
      const offending = prompt || imageDescription || "";
      if (offending.trim()) {
        meshHandle.publish({ prompt: offending, label: verdict.label }).catch(() => {});
      }
    }
    sse(res, "done", { totalMs: Date.now() - t0 });
    res.end();
    return;
  }

  // Dev mode: no host model loaded — emit a stub reply so the UI is
  // exercisable without the 60s model load.
  if (devMode) {
    const stubReply = "(dev mode — host model not loaded; pass HEARTH_NO_MODELS unset to enable real replies). Note: ivabradine and propranolol are sometimes discussed for POTS; naltrexone is investigated for Long COVID and ME/CFS.";
    sse(res, "reply", { text: stubReply });
    if (formulary) {
      try {
        const hits = formulary.lookup({ replyText: stubReply, city });
        if (hits.matched.length > 0) sse(res, "formulary", hits);
      } catch (_e) { /* non-fatal */ }
    }
    try {
      const qs = suggestQuestions(stubReply);
      if (qs) sse(res, "clinical_questions", qs);
    } catch (_e) { /* non-fatal */ }
    sse(res, "done", { totalMs: Date.now() - t0 });
    res.end();
    return;
  }

  try {
    // Already gated above. Call the host model directly. The firewall
    // plugin classifies a single last-user message, which for an image
    // turn would be the composed description+question — the exact
    // concatenation we deliberately classify as separate inputs instead.
    const run = await completion({
      modelId: hostModelId,
      history: [
        { role: "system", content: HOST_SYSTEM_PROMPT },
        ...priorTurns,
        { role: "user", content: composedPrompt },
      ],
      stream: true,
      // Allow longer replies for clinical questions — MedGemma often
      // produces structured multi-paragraph responses. The host LLM's
      // own EOS will stop earlier.
      generationParams: { predict: 768 },
    });

    let accumulated = "";
    let streamFailed = false;
    try {
      for await (const token of run.tokenStream) {
        accumulated += token;
        sse(res, "token", { text: token });
      }
    } catch (streamErr) {
      streamFailed = true;
      sse(res, "error", { message: `stream failed: ${streamErr.message}` });
      // run.final is almost certainly rejecting too. Don't await it.
      sse(res, "done", { totalMs: Date.now() - t0 });
      res.end();
      return;
    }

    const final = await run.final;
    // Emit reply with full accumulated text — clients that don't handle
    // token events can still rely on this.
    const replyText = accumulated || final?.contentText || final?.cacheableAssistantContent || "";
    sse(res, "reply", { text: replyText });

    // Surface medication cards if the reply mentions any known meds.
    if (formulary) {
      try {
        const hits = formulary.lookup({ replyText, city });
        if (hits.matched.length > 0) {
          sse(res, "formulary", hits);
        }
      } catch (e) {
        // formulary failures are non-fatal
        sse(res, "error", { message: `formulary lookup failed: ${e.message}` });
      }
    }

    // Surface "questions to ask your clinician" if the reply mentions
    // a topic with a curated template.
    try {
      const qs = suggestQuestions(replyText);
      if (qs) sse(res, "clinical_questions", qs);
    } catch (_e) { /* non-fatal */ }

    sse(res, "done", {
      totalMs: Date.now() - t0,
      hostMs: final?.stats?.totalDurationMs ?? null,
      tps: final?.stats?.tokensPerSecond ?? null,
      tokens: final?.stats?.generatedTokens ?? null,
    });
    res.end();
  } catch (e) {
    sse(res, "error", { message: e.message ?? String(e) });
    res.end();
  }
}

function handleStatus(req, res) {
  const status = {
    ready: !!firewall,
    classifierLoaded: !!classifierModelId,
    hostLoaded: !!hostModelId,
    hostIsClassifier: classifierModelId === hostModelId,
    meshActive: !!meshHandle,
    meshPeers: meshHandle?.peerCount ? meshHandle.peerCount() : 0,
    meshSignatures: meshSigCount,
    visionActive: !!vision && vision.modelId !== "stub-vision",
    ocrActive: !!ocr && ocr.modelId !== "stub-ocr",
    formularyActive: !!formulary,
    formularySize: formulary?.formulary?.length ?? 0,
    eventsLogged: sessionLog.length,
    blockedCount: sessionLog.filter((e) => e.blocked).length,
    allowedCount: sessionLog.filter((e) => e.kind === "ask" && !e.blocked).length,
  };
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(status));
}

async function handleOcr(req, res) {
  if (!ocr) {
    res.writeHead(503).end("ocr not ready");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const dataUrl = String(body?.imageDataUrl ?? "");
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp|gif|bmp|tiff));base64,(.+)$/i);
  if (!m) {
    res.writeHead(400).end("imageDataUrl missing or not a recognized image data URL");
    return;
  }
  const mimeType = m[1];
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length === 0) {
    res.writeHead(400).end("decoded image is empty");
    return;
  }
  if (bytes.length > 5 * 1024 * 1024) {
    res.writeHead(413).end("image too large (>5 MB)");
    return;
  }
  try {
    const extracted = await ocr.extract(bytes, mimeType);
    if (extracted && extracted.trim().startsWith(NOT_DOCUMENT_TOKEN)) {
      logEvent({ kind: "ocr", verdict: "NOT_DOCUMENT", blocked: true, promptLen: 0, latencyMs: 0 });
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          extracted,
          rejected: true,
          reason: "not a document with text content",
          verdict: { label: "NOT_DOCUMENT", blocked: true, mode: "ocr" },
          bytes: bytes.length,
          ocrActive: ocr.modelId !== "stub-ocr",
        }),
      );
      return;
    }
    let verdict;
    if (process.env.HEARTH_NO_MODELS === "1") {
      const { heuristicClassify } = await import("../../src/heuristics.mjs");
      const h = heuristicClassify(extracted);
      verdict = h
        ? { label: h.label, blocked: h.blocked, mode: "heuristic", latencyMs: 0 }
        : { label: "SAFE", blocked: false, mode: "heuristic-fallthrough", latencyMs: 0 };
    } else {
      verdict = await classify({
        modelId: classifierModelId,
        prompt: extracted,
        mesh: meshHandle,
      });
    }
    logEvent({
      kind: "ocr",
      verdict: verdict.label,
      blocked: verdict.blocked,
      promptLen: extracted.length,
      latencyMs: verdict.latencyMs ?? 0,
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        extracted,
        verdict: {
          label: verdict.label,
          blocked: verdict.blocked,
          mode: verdict.mode,
          latencyMs: verdict.latencyMs,
        },
        bytes: bytes.length,
        ocrActive: ocr.modelId !== "stub-ocr",
      }),
    );
  } catch (e) {
    res.writeHead(500).end(`ocr error: ${e.message}`);
  }
}

async function handleImage(req, res) {
  if (!vision) {
    res.writeHead(503).end("vision not ready");
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    res.writeHead(400).end("bad json");
    return;
  }
  const dataUrl = String(body?.imageDataUrl ?? "");
  const m = dataUrl.match(/^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!m) {
    res.writeHead(400).end("imageDataUrl missing or not a recognized image data URL");
    return;
  }
  const mimeType = m[1];
  const bytes = Buffer.from(m[3], "base64");
  if (bytes.length === 0) {
    res.writeHead(400).end("decoded image is empty");
    return;
  }
  if (bytes.length > 5 * 1024 * 1024) {
    res.writeHead(413).end("image too large (>5 MB)");
    return;
  }
  try {
    const description = await vision.describe(bytes, mimeType);
    if (description && description.trim().startsWith(NOT_MEDICAL_TOKEN)) {
      logEvent({ kind: "image", verdict: "NOT_MEDICAL", blocked: true, promptLen: 0, latencyMs: 0 });
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          description,
          rejected: true,
          reason: "not medical content",
          verdict: { label: "NOT_MEDICAL", blocked: true, mode: "vision" },
          bytes: bytes.length,
          visionActive: vision.modelId !== "stub-vision",
        }),
      );
      return;
    }
    let verdict;
    if (process.env.HEARTH_NO_MODELS === "1") {
      const { heuristicClassify } = await import("../../src/heuristics.mjs");
      const h = heuristicClassify(description);
      if (h) {
        verdict = { label: h.label, blocked: h.blocked, mode: "heuristic", latencyMs: 0, raw: h.reason };
      } else if (meshHandle) {
        const meshHit = await meshHandle.lookup(description);
        if (meshHit && meshHit.label) {
          verdict = {
            label: meshHit.label,
            blocked: meshHit.label !== "SAFE",
            mode: "mesh",
            latencyMs: 0,
          };
        }
      }
      if (!verdict) verdict = { label: "SAFE", blocked: false, mode: "heuristic-fallthrough", latencyMs: 0 };
    } else {
      verdict = await classify({
        modelId: classifierModelId,
        prompt: description,
        mesh: meshHandle,
      });
    }
    logEvent({
      kind: "image",
      verdict: verdict.label,
      blocked: verdict.blocked,
      promptLen: description.length,
      latencyMs: verdict.latencyMs ?? 0,
    });
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        description,
        verdict: {
          label: verdict.label,
          blocked: verdict.blocked,
          mode: verdict.mode,
          latencyMs: verdict.latencyMs,
        },
        bytes: bytes.length,
        visionActive: vision.modelId !== "stub-vision",
      }),
    );
  } catch (e) {
    res.writeHead(500).end(`vision error: ${e.message}`);
  }
}

function handleAuditTail(req, res) {
  const url = new URL(req.url, `http://localhost`);
  const n = Math.min(Number(url.searchParams.get("n") ?? 50), 500);
  const tail = sessionLog.slice(-n);
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(tail));
}

function router(req, res) {
  if (req.method === "POST" && req.url === "/api/ask") return handleAsk(req, res);
  if (req.method === "POST" && req.url === "/api/image") return handleImage(req, res);
  if (req.method === "POST" && req.url === "/api/ocr") return handleOcr(req, res);
  if (req.method === "GET" && req.url === "/api/status") return handleStatus(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/audit")) return handleAuditTail(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/formulary")) return handleFormularyLookup(req, res);
  if (req.method === "GET") return handleStatic(req, res);
  res.writeHead(405).end("method not allowed");
}

function handleFormularyLookup(req, res) {
  if (!formulary) {
    res.writeHead(503).end("formulary not loaded");
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const text = url.searchParams.get("text") ?? "";
  const city = url.searchParams.get("city") ?? "";
  if (!text) {
    res.writeHead(400).end("missing text param");
    return;
  }
  const out = formulary.lookup({ replyText: text, city });
  res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
}

const server = createServer(router);

// Start the listener FIRST so the UI shows a real "loading" state while
// models warm up — instead of "server unreachable" until everything's
// loaded. Routes that need models return 503 until ready.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`[hearth] listening on http://localhost:${PORT} (models loading…)`);
});

try {
  await bootModels();
  console.log(`\n[hearth] ready at http://localhost:${PORT}`);
  console.log(`[hearth] press Ctrl-C to shut down`);
} catch (e) {
  console.error(`\n[hearth] fatal during boot: ${e.message}`);
  console.error(`[hearth] shutting down cleanly…`);
  try { await shutdown(); } catch (_e) { /* shutdown errors logged inside */ }
  process.exit(1);
}
