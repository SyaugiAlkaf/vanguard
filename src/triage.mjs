// SPDX-License-Identifier: Apache-2.0
//
// Red-flag triage. Scans patient text (the user's prompt, not the
// model's reply) for symptoms that warrant urgent care. When a match
// fires, Hearth surfaces a banner urging the patient to call emergency
// services or seek immediate clinical evaluation.
//
// Patterns are curated from MERCK Manual, NHS triage references, and
// AHA Scientific Statement on POTS (red-flag carve-outs).
//
// IMPORTANT: this is layered safety information, not a diagnosis. False
// positives are acceptable (better safe than sorry). False negatives are
// possible — the absence of a banner does not mean "you are fine."

const RED_FLAGS = [
  {
    label: "cardiac emergency",
    patterns: [
      /\bchest\s+(?:pain|pressure|tightness|heaviness|discomfort|ache)\b/i,
      /\b(?:crush(?:ing|ed)?|squeez(?:ing|ed)?|tight(?:ness|ening)?|press(?:ing|ure)|heavy|heaviness|elephant)\s+(?:feeling\s+|sensation\s+)?(?:on\s+|in\s+)?(?:my\s+|the\s+)?chest\b/i,
      /\bchest\s+(?:feels|is)\s+(?:crush(?:ed|ing)?|squeez(?:ed|ing)?|tight|heavy|pressing|like\s+(?:an?\s+)?elephant)/i,
      /\b(?:left|both)\s+arm\s+(?:pain|numbness|tingling|weakness)\b/i,
      /\bjaw\s+(?:pain|ache)\s+with\s+(?:chest|sweat)/i,
      /\b(?:passing\s+out|fainted|collapse).{0,40}\b(?:chest|breath)/i,
      /\bheart\s+attack\b/i,
      /\b(?:my\s+)?heart\s+(?:hurts?|aches?|aching|hurting)\b/i,
      /\bmy\s+heart\s+(?:ick|icky|sick)\b/i,
      /\bmy\s+heart\s+feels\s+(?:wrong|off|sick|weird|bad|funny|icky|sakit)\b/i,
      /\bmy\s+heart\s+(?:is|feels)\s+sakit\b/i,
    ],
    severity: "emergency",
    action:
      "These symptoms can indicate a heart attack. Call your local emergency number now — 118 (Ambulan, Indonesia) or 119 (PSC, Indonesia), 911 in the US. Time matters.",
  },
  {
    label: "possible stroke",
    patterns: [
      /\b(?:sudden|abrupt)\s+(?:severe|worst)\s+headache\b/i,
      /\bthunderclap\s+headache\b/i,
      /\bworst\s+headache\s+of\s+my\s+life\b/i,
      /\b(?:slurred|trouble)\s+speech\s+(?:and|with|plus)\s+(?:weakness|numbness|droop)/i,
      /\bone[-\s]sided\s+(?:weakness|numbness|facial\s+droop|paralysis)\b/i,
      /\bfacial\s+droop\b/i,
      /\bsudden\s+(?:vision|sight)\s+(?:loss|change|blur)/i,
    ],
    severity: "emergency",
    action:
      "These symptoms can indicate a stroke. Call your local emergency number immediately — 118/119 in Indonesia, 911 in the US. Note the exact time symptoms started — that affects treatment options.",
  },
  {
    label: "anaphylaxis or severe allergic reaction",
    patterns: [
      /\bthroat\s+(?:swelling|closing|tightening)\b/i,
      /\b(?:can(?:'?t|not)\s+(?:breathe|swallow))\b/i,
      /\bsevere\s+(?:allergic\s+reaction|wheezing|hives)\b/i,
      /\banaphylaxis\b/i,
    ],
    severity: "emergency",
    action:
      "If you have an epinephrine auto-injector (EpiPen) use it now. Then call emergency services — 118/119 in Indonesia, 911 in the US. Anaphylaxis can progress rapidly.",
  },
  {
    label: "severe shortness of breath",
    patterns: [
      /\b(?:can(?:'?t|not)\s+(?:catch|get)\s+my\s+breath)\b/i,
      /\bunable\s+to\s+speak\s+(?:in\s+)?(?:full|complete)\s+sentences\b/i,
      /\bblue\s+lips\b/i,
      /\bturning\s+blue\b/i,
      /\bsevere\s+(?:shortness\s+of\s+breath|dyspnea)\b/i,
    ],
    severity: "emergency",
    action:
      "Severe difficulty breathing is a medical emergency. Call 118/119 (Indonesia) or 911 (US) immediately. Do not drive yourself.",
  },
  {
    label: "suicidality or self-harm",
    patterns: [
      /\bi\s+(?:want|am\s+going)\s+to\s+(?:kill|end|hurt)\s+(?:myself|my\s+life)\b/i,
      /\bsuicidal\b/i,
      /\bplanning\s+to\s+(?:kill|end|hurt)\s+myself\b/i,
      /\bno\s+reason\s+to\s+(?:live|go\s+on)\b/i,
      /\boverdose\b/i,
    ],
    severity: "emergency",
    action:
      "Please reach out for help right now. In Indonesia: Yayasan Pulih +62-21-78842580 or Into The Light @intothelightid; you can also call 119 ext 8 (Kemenkes mental health hotline). In the US: 988 (Suicide & Crisis Lifeline). You are not alone. This is the moment to call.",
  },
  {
    label: "acute abdomen",
    patterns: [
      /\b(?:rigid|hard|board[-\s]like)\s+(?:abdomen|belly|stomach)\b/i,
      /\bsevere\s+(?:abdominal|stomach|belly)\s+pain\s+(?:with|and)\s+(?:fever|vomit|blood)/i,
      /\bvomit(?:ing)?\s+blood\b/i,
      /\bblood\s+in\s+(?:stool|vomit)\b/i,
    ],
    severity: "urgent",
    action:
      "Severe abdominal pain with these features may need surgical evaluation. Go to the nearest emergency department (UGD) tonight. Do not eat or drink while you wait to be seen.",
  },
  {
    label: "possible meningitis",
    patterns: [
      /\b(?:stiff|rigid)\s+neck\b/i,
      /\bneck\s+pain\s+(?:with|and)\s+(?:fever|headache|rash)/i,
      /\bfever\s+(?:and|with)\s+(?:stiff|rigid)\s+neck/i,
    ],
    severity: "urgent",
    action:
      "Fever with neck stiffness can indicate meningitis. Go to the nearest emergency department (UGD) immediately. Treatment delays are dangerous.",
  },
  {
    label: "obstetric emergency",
    patterns: [
      /\bpregnan(?:t|cy)\s+(?:with|and).{0,40}\b(?:bleeding|severe\s+pain|contractions)/i,
      /\bsevere\s+(?:bleeding|pain)\s+(?:in|during)\s+pregnancy/i,
      /\blost\s+(?:my|the)\s+baby\b/i,
    ],
    severity: "urgent",
    action:
      "These symptoms in pregnancy need immediate obstetric evaluation. Go to the nearest hospital with obstetric capability (RSUD with OB services or your OB-GYN's hospital).",
  },
  {
    label: "cauda equina symptoms",
    patterns: [
      /\bsevere\s+back\s+pain\s+(?:with|and)\s+(?:leg\s+weakness|saddle|bladder|incontinence)/i,
      /\bsaddle\s+(?:numbness|anesthesia)\b/i,
      /\bsudden\s+(?:bladder|bowel)\s+(?:incontinence|loss\s+of\s+control)\b/i,
    ],
    severity: "urgent",
    action:
      "These are cauda equina red flags — a surgical emergency. Go to the nearest emergency department (UGD) immediately. Delay can cause permanent paralysis.",
  },
];

/**
 * Scan a user prompt for red-flag clinical signs. Returns the first
 * match or null. We deliberately stop at the first match — surfacing
 * one clear banner is better than overwhelming the patient with three.
 */
export function triage(text) {
  if (typeof text !== "string" || !text) return null;
  for (const flag of RED_FLAGS) {
    for (const p of flag.patterns) {
      const m = text.match(p);
      if (m) {
        return {
          label: flag.label,
          severity: flag.severity,
          action: flag.action,
          hit: m[0],
        };
      }
    }
  }
  return null;
}

export function triageSummary() {
  return {
    total_categories: RED_FLAGS.length,
    total_patterns: RED_FLAGS.reduce((s, f) => s + f.patterns.length, 0),
    severities: [...new Set(RED_FLAGS.map((f) => f.severity))],
  };
}
