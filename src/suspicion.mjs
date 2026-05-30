// SPDX-License-Identifier: Apache-2.0
//
// Tier-1.5 soft-suspicion scan. Individually-weak attack signals that, when
// several co-occur, suggest an attack the hard heuristics missed and the LoRA
// may under-call. Used to escalate a SAFE verdict to "suspicious" — never as
// a standalone blocker. Tuned so a single benign mention does not trip it.

const SOFT_MARKERS = {
  promptTarget: /\b(?:system\s+prompt|your\s+instructions?|initial\s+prompt|original\s+(?:prompt|instructions?)|the\s+prompt\s+you\s+were\s+given|hidden\s+(?:context|instructions?)|developer\s+(?:message|instructions?))\b/i,
  revealVerb: /\b(?:repeat|reveal|print|output|verbatim|word\s+for\s+word|spell\s+(?:out|it)|list\s+(?:them|all|every)|disclose|divulge)\b/i,
  secrecy: /\b(?:secret|confidential|concealed|hidden|protected)\s+(?:word|phrase|code|token|password|passphrase|key|string|value|instructions?)\b/i,
  override: /\b(?:ignore|disregard|forget|override|bypass)\b.{0,30}\b(?:previous|prior|above|earlier|all|your|the|safety|rules?|instructions?)\b/i,
  encodeTrick: /\b(?:base64|rot13|morse|reverse(?:d)?|acrostic|first\s+(?:letter|character)\s+of\s+each|encode|cipher)\b/i,
  persona: /\b(?:pretend|act\s+as|roleplay|you\s+are\s+now|imagine\s+you|from\s+now\s+on)\b/i,
};

/**
 * Returns { score, categories[] }. score = number of distinct soft-marker
 * categories present. Caller decides what to do with it.
 */
export function suspicionScan(prompt) {
  const text = String(prompt ?? "");
  const categories = [];
  for (const [name, re] of Object.entries(SOFT_MARKERS)) {
    if (re.test(text)) categories.push(name);
  }
  return { score: categories.length, categories };
}

// A prompt is "suspicious" when at least this many distinct categories fire.
export const SUSPICION_THRESHOLD = 2;

export function isSuspicious(prompt) {
  return suspicionScan(prompt).score >= SUSPICION_THRESHOLD;
}

// Best-guess 4-class label for an escalated suspicious prompt, from which soft
// categories fired. Extraction-flavoured markers -> EXFILTRATION; manipulation
// markers -> INJECTION.
export function suspicionLabel(categories) {
  const set = new Set(categories);
  if (set.has("promptTarget") || set.has("secrecy") || set.has("encodeTrick") || set.has("revealVerb")) {
    return "EXFILTRATION";
  }
  return "INJECTION";
}
