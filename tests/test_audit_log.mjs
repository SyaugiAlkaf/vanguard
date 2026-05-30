// SPDX-License-Identifier: Apache-2.0
//
// Audit log integrity: schema, sha256 hashing, null-safety, very-long inputs.

import { openAuditLog, sha256, SCHEMA_VERSION } from "../scripts/audit_log.mjs";
import { readFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function expectThrow(fn, matcher) {
  let thrown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  assert(thrown !== null, "expected throw");
  if (typeof matcher === "string") {
    assert(thrown.message.includes(matcher), thrown.message);
  }
}

const TMP_DIR = join(tmpdir(), `vanguard-audit-test-${Date.now()}`);
mkdirSync(TMP_DIR, { recursive: true });

function freshPath(name) {
  return join(TMP_DIR, `${name}-${Math.random().toString(36).slice(2)}.jsonl`);
}

function readLog(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

t("openAuditLog throws on missing path", () => {
  expectThrow(() => openAuditLog(""), "non-empty string");
  expectThrow(() => openAuditLog(null), "non-empty string");
  expectThrow(() => openAuditLog(undefined), "non-empty string");
});

t("openAuditLog writes session_start with schema_version", () => {
  const path = freshPath("session");
  const log = openAuditLog(path);
  log.close();
  const entries = readLog(path);
  assert(entries.length === 2, `expected 2 entries (start + end), got ${entries.length}`);
  assert(entries[0].event === "session_start", entries[0].event);
  assert(entries[0].schema_version === SCHEMA_VERSION, entries[0].schema_version);
  assert(entries[1].event === "session_end");
  assert(entries[0].session_id === entries[1].session_id, "session_ids differ");
});

t("recordInference hashes prompt + completion via sha256", () => {
  const path = freshPath("inference");
  const log = openAuditLog(path);
  log.recordInference({
    modelId: "m1",
    prompt: "hello world",
    completion: "OK",
    promptTokens: 2,
    completionTokens: 1,
    ttftMs: 50,
    tps: 20,
    classifierVerdict: "SAFE",
    classifierConfidence: 0.99,
    blocked: false,
  });
  log.close();
  const entries = readLog(path);
  const inf = entries.find((e) => e.event === "inference");
  assert(inf, "inference entry missing");
  assert(inf.prompt_sha256 === sha256("hello world"), "prompt hash wrong");
  assert(inf.completion_sha256 === sha256("OK"), "completion hash wrong");
  assert(inf.prompt_length_chars === 11, inf.prompt_length_chars);
  assert(inf.completion_length_chars === 2);
  assert(inf.blocked === false);
});

t("recordInference handles null prompt + null completion", () => {
  const path = freshPath("null-inference");
  const log = openAuditLog(path);
  log.recordInference({
    modelId: "m1",
    prompt: null,
    completion: undefined,
    classifierVerdict: "SAFE",
    blocked: false,
  });
  log.close();
  const entries = readLog(path);
  const inf = entries.find((e) => e.event === "inference");
  assert(inf.prompt_sha256 === sha256(""), "null prompt should hash empty string");
  assert(inf.prompt_length_chars === 0);
  assert(inf.completion_length_chars === 0);
});

t("recordInference handles very long prompt (200 KB)", () => {
  const path = freshPath("long-inference");
  const log = openAuditLog(path);
  const longPrompt = "x".repeat(200_000);
  log.recordInference({
    modelId: "m1",
    prompt: longPrompt,
    completion: "OK",
    classifierVerdict: "SAFE",
    blocked: false,
  });
  log.close();
  const entries = readLog(path);
  const inf = entries.find((e) => e.event === "inference");
  assert(inf.prompt_length_chars === 200_000);
  // Log line should be JSON-parseable even with 200KB prompt (because we only store hash + len)
  assert(inf.prompt_sha256 === sha256(longPrompt));
});

t("recordModelLoad + recordModelUnload event pair", () => {
  const path = freshPath("model-load");
  const log = openAuditLog(path);
  log.recordModelLoad({ modelId: "m1", modelType: "llm", src: "Qwen3-1.7B" });
  log.recordModelUnload({ modelId: "m1" });
  log.close();
  const entries = readLog(path);
  const load = entries.find((e) => e.event === "model_load");
  const unload = entries.find((e) => e.event === "model_unload");
  assert(load && load.model_id === "m1", "model_load missing or wrong id");
  assert(unload && unload.model_id === "m1", "model_unload missing or wrong id");
});

t("every entry shares the same session_id and schema_version", () => {
  const path = freshPath("session-id-consistency");
  const log = openAuditLog(path);
  log.recordModelLoad({ modelId: "m1", modelType: "llm", src: "x" });
  log.recordInference({ modelId: "m1", prompt: "p", completion: "c", classifierVerdict: "SAFE", blocked: false });
  log.recordModelUnload({ modelId: "m1" });
  log.close();
  const entries = readLog(path);
  const sid = entries[0].session_id;
  for (const e of entries) {
    assert(e.session_id === sid, `session_id mismatch on ${e.event}: ${e.session_id} != ${sid}`);
    assert(e.schema_version === SCHEMA_VERSION, `schema_version mismatch on ${e.event}`);
  }
});

t("openAuditLog creates parent directory if missing", () => {
  const nestedDir = join(TMP_DIR, "deep", "nested", "subdir");
  const path = join(nestedDir, "audit.jsonl");
  const log = openAuditLog(path);
  log.close();
  assert(existsSync(path), "nested file not created");
});

// Cleanup
try {
  rmSync(TMP_DIR, { recursive: true, force: true });
} catch {}

let pass = 0;
let fail = 0;
for (const c of tests) {
  try {
    c.fn();
    console.log(`pass: ${c.name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL: ${c.name} -> ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
