// SPDX-License-Identifier: Apache-2.0
//
// safeCompletion / plugin API validation. No model load — exercises the
// argument validation, history handling, and error-throw paths.

import { safeCompletion } from "../src/safe-completion.mjs";
import { attach, vanguardFirewall, RequestRejectedByPolicyError } from "../src/plugin.mjs";
import { VanguardBlockedError } from "../src/errors.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function expectThrow(fn, matcher) {
  let thrown = null;
  try {
    await fn();
  } catch (e) {
    thrown = e;
  }
  assert(thrown !== null, "expected throw, got none");
  if (typeof matcher === "string") {
    assert(thrown.message.includes(matcher), `expected message to include ${JSON.stringify(matcher)}, got: ${thrown.message}`);
  } else if (matcher && typeof matcher === "function") {
    assert(matcher(thrown), `matcher rejected: ${thrown.message}`);
  }
}

// ===== safeCompletion validation =====
t("safeCompletion throws on missing history", async () => {
  await expectThrow(
    () => safeCompletion({ hostModelId: "h", classifierModelId: "c" }),
    "non-empty history array",
  );
});

t("safeCompletion throws on empty history", async () => {
  await expectThrow(
    () => safeCompletion({ hostModelId: "h", classifierModelId: "c", history: [] }),
    "non-empty history array",
  );
});

t("safeCompletion throws on history without user message", async () => {
  await expectThrow(
    () =>
      safeCompletion({
        hostModelId: "h",
        classifierModelId: "c",
        history: [{ role: "system", content: "be nice" }],
      }),
    "latest user message",
  );
});

t("safeCompletion throws on user message with empty content", async () => {
  await expectThrow(
    () =>
      safeCompletion({
        hostModelId: "h",
        classifierModelId: "c",
        history: [{ role: "user", content: "" }],
      }),
    "latest user message",
  );
});

// ===== plugin.attach validation =====
t("attach throws on missing ids", () => {
  let threw = false;
  try {
    attach({});
  } catch (e) {
    threw = e instanceof TypeError;
  }
  assert(threw, "expected TypeError");
});

t("attach throws on only hostModelId without classifier", () => {
  let threw = false;
  try {
    attach({ hostModelId: "h" });
  } catch (e) {
    threw = e instanceof TypeError;
  }
  assert(threw, "expected TypeError");
});

t("attach with modelId returns guarded.completion + classify + inspect", () => {
  const g = attach({ modelId: "stub" });
  assert(typeof g.completion === "function", "completion missing");
  assert(typeof g.classify === "function", "classify missing");
  assert(typeof g.inspect === "function", "inspect missing");
});

t("attach with paired host+classifier returns surface", () => {
  const g = attach({ hostModelId: "h", classifierModelId: "c" });
  assert(typeof g.completion === "function", "completion missing");
});

// ===== guardedCompletion history validation =====
t("guardedCompletion throws on missing user message in history", async () => {
  const g = attach({ modelId: "stub" });
  await expectThrow(
    () => g.completion({ history: [{ role: "system", content: "..." }] }),
    "user message",
  );
});

t("guardedCompletion throws on undefined history", async () => {
  const g = attach({ modelId: "stub" });
  await expectThrow(() => g.completion({}), "user message");
});

// ===== VanguardBlockedError shape =====
t("VanguardBlockedError carries verdict + confidence + reason", () => {
  const err = new VanguardBlockedError("INJECTION", 0.95, "ignore previous");
  assert(err.name === "VanguardBlockedError", err.name);
  assert(err.verdict === "INJECTION");
  assert(err.confidence === 0.95);
  assert(err.reason === "ignore previous");
  assert(err.message.includes("INJECTION"), err.message);
  assert(err.message.includes("0.95"), err.message);
});

// ===== RequestRejectedByPolicyError surface =====
t("RequestRejectedByPolicyError is the SDK's own export", () => {
  assert(typeof RequestRejectedByPolicyError === "function", "must be a constructor");
  // Construct one to confirm it works
  const err = new RequestRejectedByPolicyError("req-1", "completion", "model-x", "policy reason");
  assert(err instanceof Error, "must be Error subclass");
});

t("vanguardFirewall surface", () => {
  assert(typeof vanguardFirewall.attach === "function");
  assert(vanguardFirewall.labels && vanguardFirewall.labels.SAFE === "SAFE");
});

// Note: testing safeCompletion happy-path requires a real modelId because the
// SDK call hangs forever on fake ids. Multi-turn validation is covered by the
// unit-level history checks above, which exercise the validation path before
// any SDK call.

let pass = 0;
let fail = 0;
for (const c of tests) {
  try {
    await c.fn();
    console.log(`pass: ${c.name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL: ${c.name} -> ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
