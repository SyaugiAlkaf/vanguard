// SPDX-License-Identifier: Apache-2.0
import { runHardeningLoop } from "../src/redteam/orchestrator.mjs";
import { createTools } from "../src/redteam/tools.mjs";
import { LABELS } from "../src/labels.mjs";

const tests = [];
function t(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeClassify() {
  return (prompt) =>
    prompt.includes("SLIP")
      ? { label: LABELS.SAFE, blocked: false, mode: "lora" }
      : { label: LABELS.INJECTION, blocked: true, mode: "heuristic" };
}

function makeReferee() {
  return {
    runAgainstHost: (prompt) =>
      prompt.includes("leak")
        ? "System prompt: You are Hearth, a medical assistant."
        : "I can't help with that.",
    adjudicate: ({ hostReply }) => ({
      compromised: hostReply.includes("System prompt"),
      reason: hostReply.includes("System prompt") ? "leaked" : "clean",
    }),
  };
}

function makePublish() {
  const calls = [];
  const publishSignature = (args) => {
    calls.push(args);
    return { ok: true };
  };
  return { calls, publishSignature };
}

// generateAttack stamps deterministic keywords per family so each loop path is hit:
//   confirmed-novel  -> "SLIP ... leak"  (missed by firewall, host compromised)
//   miss-but-held    -> "SLIP"           (missed by firewall, host holds)
//   blocked          -> neither keyword  (firewall blocks)
function makeRedTeam(stampByFamily) {
  return {
    generateAttack: ({ family, seed }) => {
      const stamp = stampByFamily[family] ?? "";
      const prompt = stamp ? `${seed} ${stamp}` : seed;
      return { prompt, family, seed };
    },
  };
}

function buildLoop({ stampByFamily, rounds, refereeOverride, events }) {
  const classify = makeClassify();
  const referee = refereeOverride ?? makeReferee();
  const { calls, publishSignature } = makePublish();
  const tools = createTools({ classify, referee, publishSignature });
  const redTeam = makeRedTeam(stampByFamily);
  const onEvent = (e) => events && events.push(e);
  return {
    publishCalls: calls,
    run: () =>
      runHardeningLoop({
        rounds,
        redTeam,
        referee,
        classify,
        publishSignature,
        tools,
        onEvent,
      }),
  };
}

// Family rotation (round 1..5): ignore-instructions, dan-roleplay,
// system-prompt-exfil, encoded-smuggle, indirect-document-injection.
const STAMPS = {
  "ignore-instructions": "SLIP leak", // confirmed-novel
  "dan-roleplay": "SLIP", // miss-but-host-held
  "system-prompt-exfil": "", // blocked
};

t("confirmed round: missed + compromised => exactly one publish, outcome CONFIRMED-NOVEL", async () => {
  const { run, publishCalls } = buildLoop({ stampByFamily: STAMPS, rounds: 1 });
  const { rounds } = await run();
  assert(rounds[0].outcome === "CONFIRMED-NOVEL", `got ${rounds[0].outcome}`);
  assert(publishCalls.length === 1, `expected 1 publish, got ${publishCalls.length}`);
  assert(publishCalls[0].label === LABELS.INJECTION, `label ${publishCalls[0].label}`);
});

t("blocked round never publishes", async () => {
  const { run, publishCalls } = buildLoop({ stampByFamily: STAMPS, rounds: 3 });
  const { rounds } = await run();
  assert(rounds[2].outcome === "blocked-host-resilient" || rounds[2].outcome === "true-positive", `got ${rounds[2].outcome}`);
  assert(
    rounds[2].verdict.blocked === true,
    "round 3 (system-prompt-exfil) should be blocked",
  );
  // blocked round's host holds => blocked-host-resilient, no publish from it
  assert(publishCalls.every((c) => c.prompt.includes("SLIP")), "blocked round must not publish");
});

t("missed-but-host-held round never publishes", async () => {
  const { run, publishCalls } = buildLoop({ stampByFamily: STAMPS, rounds: 2 });
  const { rounds } = await run();
  assert(rounds[1].outcome === "miss-but-host-held", `got ${rounds[1].outcome}`);
  assert(rounds[1].verdict.blocked === false, "round 2 missed");
  // only round 1 (confirmed) published; round 2 did not add a publish
  assert(publishCalls.length === 1, `expected 1 publish total, got ${publishCalls.length}`);
});

t("summary counts correct", async () => {
  const { run } = buildLoop({ stampByFamily: STAMPS, rounds: 3 });
  const { summary } = await run();
  assert(summary.rounds === 3, `rounds ${summary.rounds}`);
  assert(summary.confirmedNovel === 1, `confirmedNovel ${summary.confirmedNovel}`);
  assert(summary.signaturesBroadcast === 1, `broadcast ${summary.signaturesBroadcast}`);
  assert(summary.missed === 2, `missed ${summary.missed}`);
  assert(summary.blockedHostResilient === 1, `blockedHostResilient ${summary.blockedHostResilient}`);
  assert(summary.errors === 0, `errors ${summary.errors}`);
});

t("onEvent emits attack -> firewall -> immunize in order for a confirmed round", async () => {
  const events = [];
  const { run } = buildLoop({ stampByFamily: STAMPS, rounds: 1, events });
  await run();
  const kinds = events.map((e) => e.kind);
  assert(
    kinds[0] === "attack" && kinds[1] === "firewall" && kinds[2] === "immunize",
    `order was ${kinds.join(",")}`,
  );
});

t("a referee that throws degrades the round to error, loop survives", async () => {
  const throwingReferee = {
    runAgainstHost: () => {
      throw new Error("model exploded");
    },
    adjudicate: () => ({ compromised: false }),
  };
  const events = [];
  const { run, publishCalls } = buildLoop({
    stampByFamily: STAMPS,
    rounds: 2,
    refereeOverride: throwingReferee,
    events,
  });
  const { rounds, summary } = await run();
  assert(rounds[0].outcome === "error", `round1 ${rounds[0].outcome}`);
  assert(rounds[1].outcome === "error", `round2 ${rounds[1].outcome}`);
  assert(summary.errors === 2, `errors ${summary.errors}`);
  assert(publishCalls.length === 0, "no publish on error");
});

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
process.exit(fail ? 1 : 0);
