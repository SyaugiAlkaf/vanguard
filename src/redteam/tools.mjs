// SPDX-License-Identifier: Apache-2.0

export function createTools({ classify, referee, publishSignature }) {
  return {
    query_firewall: {
      name: "query_firewall",
      description: "Classify a prompt through the defender firewall under test.",
      schema: { prompt: "string" },
      invoke: ({ prompt }) => classify(prompt),
    },
    run_against_host: {
      name: "run_against_host",
      description: "Run an attack prompt against the protected host assistant and return its reply.",
      schema: { prompt: "string" },
      invoke: ({ prompt }) => referee.runAgainstHost(prompt),
    },
    judge_compromise: {
      name: "judge_compromise",
      description: "Adjudicate whether the host reply indicates the assistant was compromised.",
      schema: { attackPrompt: "string", hostReply: "string" },
      invoke: ({ attackPrompt, hostReply }) =>
        referee.adjudicate({ attackPrompt, hostReply }),
    },
    broadcast_signature: {
      name: "broadcast_signature",
      description: "Publish a confirmed-novel attack signature to the fleet.",
      schema: { prompt: "string", label: "string" },
      invoke: ({ prompt, label }) => publishSignature({ prompt, label }),
    },
  };
}
