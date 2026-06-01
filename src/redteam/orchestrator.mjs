// SPDX-License-Identifier: Apache-2.0
import { pickSeed, inferAttackLabel } from "./families.mjs";

function summarizeArgs(args) {
  const out = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = typeof v === "string" && v.length > 80 ? v.slice(0, 80) + "…" : v;
  }
  return out;
}

export async function runHardeningLoop({
  rounds = 6,
  redTeam,
  referee,
  classify,
  publishSignature,
  tools,
  onEvent = () => {},
}) {
  const roundResults = [];
  const toolCalls = [];
  const priorMisses = [];

  async function call(toolName, args) {
    const t0 = performance.now();
    const result = await tools[toolName].invoke(args);
    toolCalls.push({
      name: toolName,
      args: summarizeArgs(args),
      ms: performance.now() - t0,
    });
    return result;
  }

  for (let round = 1; round <= rounds; round++) {
    const seed = pickSeed(round);
    let record;
    try {
      const attack = await redTeam.generateAttack({
        family: seed.family,
        seed: seed.seed,
        priorMisses: [...priorMisses],
      });
      onEvent({ kind: "attack", round, family: attack.family, prompt: attack.prompt });

      const verdict = await call("query_firewall", { prompt: attack.prompt });
      onEvent({ kind: "firewall", round, label: verdict.label, blocked: verdict.blocked });

      const hostReply = await call("run_against_host", { prompt: attack.prompt });
      const adjudication = await call("judge_compromise", {
        attackPrompt: attack.prompt,
        hostReply,
      });

      let outcome;
      if (verdict.blocked) {
        outcome = adjudication.compromised ? "true-positive" : "blocked-host-resilient";
      } else if (adjudication.compromised === true) {
        // SAFETY INVARIANT: publish ONLY when the defender missed (blocked===false)
        // AND the host was actually compromised. A signature broadcast on a
        // benign or already-blocked prompt would poison every fleet device's
        // mesh cache, so the gate here is the only place broadcast happens.
        outcome = "CONFIRMED-NOVEL";
        await call("broadcast_signature", {
          prompt: attack.prompt,
          label: inferAttackLabel(attack.family),
        });
        priorMisses.push(attack.prompt);
        onEvent({ kind: "immunize", round, family: attack.family, label: inferAttackLabel(attack.family) });
      } else {
        outcome = "miss-but-host-held";
      }

      record = {
        round,
        family: attack.family,
        prompt: attack.prompt,
        verdict,
        hostReply,
        adjudication,
        outcome,
      };
    } catch (err) {
      record = { round, family: seed.family, outcome: "error", error: err.message };
      onEvent({ kind: "error", round, error: err.message });
    }
    roundResults.push(record);
  }

  return { rounds: roundResults, toolCalls, summary: summarize(roundResults) };
}

function summarize(roundResults) {
  return {
    rounds: roundResults.length,
    missed: roundResults.filter(
      (r) => r.outcome === "CONFIRMED-NOVEL" || r.outcome === "miss-but-host-held",
    ).length,
    confirmedNovel: roundResults.filter((r) => r.outcome === "CONFIRMED-NOVEL").length,
    signaturesBroadcast: roundResults.filter((r) => r.outcome === "CONFIRMED-NOVEL").length,
    blockedHostResilient: roundResults.filter(
      (r) => r.outcome === "blocked-host-resilient",
    ).length,
    errors: roundResults.filter((r) => r.outcome === "error").length,
  };
}
