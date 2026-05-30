// SPDX-License-Identifier: Apache-2.0
// Plugin shape tests — no model load required.
import { vanguardFirewall, attach, RequestRejectedByPolicyError, LABELS } from "../src/index.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

t("vanguardFirewall exports the expected surface", () => {
  assert(typeof vanguardFirewall.attach === "function", "attach is a function");
  assert(vanguardFirewall.labels === LABELS, "labels reference is shared");
});

t("attach requires modelId or paired host+classifier ids", () => {
  let threw = false;
  try {
    attach({});
  } catch (e) {
    threw = true;
    assert(e instanceof TypeError, "should be TypeError");
  }
  assert(threw, "expected throw");
});

t("attach with single modelId returns guarded surface", () => {
  const g = attach({ modelId: "stub-model-id" });
  assert(typeof g.completion === "function", "completion is a function");
  assert(typeof g.classify === "function", "classify is a function");
  assert(typeof g.inspect === "function", "inspect is a function");
});

t("attach with paired host/classifier ids returns surface", () => {
  const g = attach({ hostModelId: "host", classifierModelId: "cls" });
  assert(typeof g.completion === "function", "completion is a function");
});

t("RequestRejectedByPolicyError re-exported from SDK", () => {
  assert(typeof RequestRejectedByPolicyError === "function", "is a constructor");
  const e = new RequestRejectedByPolicyError("req", "completion", "model", "test reason");
  assert(e.reason === "test reason", "reason carried");
  assert(e.kind === "completion", "kind carried");
});

let pass = 0;
let fail = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`pass: ${name}`);
    pass++;
  } catch (e) {
    console.error(`FAIL: ${name} -- ${e.message}`);
    fail++;
  }
}
console.log(`\n${pass}/${tests.length} passed`);
if (fail > 0) process.exit(1);
