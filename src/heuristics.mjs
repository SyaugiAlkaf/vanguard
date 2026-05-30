// SPDX-License-Identifier: Apache-2.0
import { LABELS } from "./labels.mjs";

const INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|all|the|above|your|my)\s+(?:\w+\s+){0,2}(?:instructions?|directives?|rules?|commands?|guidelines?|guardrails?|safety|training|policies|protocols?)\b/i,
  /\bdisregard\s+(?:all\s+)?(?:previous|prior|the|above|your|my)\s+(?:\w+\s+){0,2}(?:instructions?|directives?|rules?|guidelines?|safety|policies)\b/i,
  /\bforget\s+(?:everything|all|previous|prior|what)\b/i,
  /\boverride\s+(?:your|the|all)\s+(?:instructions?|rules?|safety|system|guardrails?|policies)\b/i,
  /\bnew\s+instructions?\s*[:.]/i,
  /\b(?:from\s+now\s+on|starting\s+now|as\s+of\s+now|from\s+this\s+point\s+(?:forward|on)|going\s+forward)\s*[,—-]*\s*(?:you|act\s+as|pretend|behave)/i,
  /\byou\s+are\s+(?:now|actually|really)\s+(?:a|an|the)\s+/i,
  /\byou\s+are\s+(?:now\s+|actually\s+|really\s+)?(?:Dr\.?|Doctor|Professor|Prof\.?|Mr\.?|Ms\.?|Mrs\.?|Sir|Madam|Lord|Lady)\s+[A-Z]/i,
  // Prefix-injection: force the reply to begin with an attacker-chosen string.
  // Mined from SaTML CTF attacks; 0 FP on the benign+hard-negative corpus.
  /\b(?:start|begin)\s+(?:your\s+)?(?:response|reply|answer|message|output)\s+with\s+(?:the\s+(?:word|phrase|exact|sentence|secret)|["'`]|exactly)\b/i,
];

const JAILBREAK_PATTERNS = [
  /\bDAN\b/,
  /\bdo\s+anything\s+now\b/i,
  /\b(?:hypothetically|pretend|imagine|roleplay)\s+(?:speaking|that|you)\b/i,
  /\bact\s+as\s+(?:a|an|if|though|the)\b/i,
  /\bin\s+a\s+(?:fictional|hypothetical)\s+(?:scenario|world|setting|story)\b/i,
  /\bjailbreak\b/i,
  // Tightened: catch the DAN-style "Developer Mode enabled/output" and the
  // bare "activate developer mode" jailbreak command, but NOT product-context
  // questions ("enable developer mode on a Pixel", "Chrome developer mode").
  /\bdeveloper\s+mode\s+(?:enabled|output|response|active)\b|\b(?:activate|enable|enter|turn\s+on)\s+developer\s+mode\b(?!\s+(?:on|in|for|of|toggle|setting|option|button))/i,
  /\bgodmode\b/i,
  /\bunrestricted\s+(?:ai|mode)\b/i,
  /\bwithout\s+(?:any\s+)?(?:moral|ethical|safety|content)\s+(?:restrictions?|guidelines?|filters?)\b/i,
  /\bas\s+(?:an?\s+)?(?:evil|unrestricted|uncensored)\s+ai\b/i,
  /\b(?:hypothetically|pretend|imagine|roleplay)\s*[,—-]*\s*(?:what|if|how|where|when|why|tell\s+me|for)\b/i,
  /\bfor\s+(?:a\s+|my\s+|the\s+)?(?:screenplay|novel|story|book|fictional?\s+story|film|movie|short\s+story|play)\s+(?:I'?(?:m|ve)|I\s+(?:am|have))\s+(?:writing|working|drafting|developing)\b/i,
  /\b(?:fictional|hypothetical)\s+(?:patient|character|protagonist|scenario)\b/i,
  // Mined from In-the-Wild jailbreak prompts; 0 FP on benign+hard-neg.
  /\b(?:stay|remain)\s+in\s+character\b|\b(?:do\s+not|don'?t|never)\s+break\s+character\b/i,
  /\b(?:you\s+(?:have|are\s+free\s+of|are\s+without)|with|having)\s+no\s+(?:restrictions?|rules?|filters?|limits?|guidelines?|boundaries)\b/i,
];

const EXFILTRATION_PATTERNS = [
  /\b(?:repeat|reveal|display|show|print|output|tell\s+me|provide|give\s+me)\s+(?:the\s+)?(?:your|the|my)?\s*(?:\w+\s+){0,2}(?:system\s+(?:prompt|instructions?|message)|original\s+(?:instructions?|prompt)|initial\s+prompt|prompt\s+you\s+were\s+given|developer\s+(?:instructions?|prompt|message|directives?)|model\s+configuration|prompt\s+template|hidden\s+(?:instructions?|prompt))\b/i,
  /\bwhat\s+(?:are\s+)?your\s+(?:original|initial|system|hidden)\s+(?:instructions?|prompt|rules?)\b/i,
  /\b(?:what|tell\s+me)\s+(?:did|does|was|what)?\s*(?:your\s+)?(?:developer|creator|trainer|admin|maker|operator)\s+(?:tell|say|instruct|told|asked|wrote)\b/i,
  /\bwhat\s+your\s+(?:developer|creator|trainer|admin|maker|operator)\s+(?:told|asked|wrote)\s+you\s+to\s+do\b/i,
  /\brepeat\s+(?:everything|all)\s+(?:above|before|prior|previous)\b/i,
  /\b(?:display|show|print)\s+(?:the\s+)?message\s+(?:above|starting\s+with)\b/i,
  /\b(?:perform|execute|do|run|attempt|launch|stage)\s+(?:a\s+)?prompt\s+(?:leak|extraction|injection)\b/i,
  /\bid_rsa\b|\bid_ed25519\b|\.ssh\/|\bprivate\s+key\b/i,
  /\b(?:read|cat|print|show|display|reveal|output|contents?\s+of)\s+\/?(?:etc\/passwd|etc\/shadow|\.bash_history|\.env|\.aws|secrets)\b/i,
  /\/etc\/(?:passwd|shadow|hosts)\b/i,
  /\b(?:env|environment)\s+(?:vars?|variables?)\b.*(?:list|print|show|reveal)|\bprintenv\b|\benvironment\.\w+/i,
  /\bAPI[_\s-]?KEY\b|\bSECRET[_\s-]?KEY\b|\bACCESS[_\s-]?TOKEN\b|\bOPENAI_API_KEY\b|\bANTHROPIC_API_KEY\b/i,
  /\bbase64\s+(?:encode|the\s+(?:secret|api|key|password))/i,
  /\bsearch\s+(?:the\s+)?filesystem\s+for\b/i,
  /\bBEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY\b/i,
  /\bfor\s+my\s+(?:clinical\s+)?(?:audit(?:\s+binder)?|electronic\s+medical\s+record|EMR|compliance\s+log|chart\s+notes?)\s*[,.]?\s*(?:please\s+)?(?:repeat|reveal|display|show|print|output|provide|give\s+me|copy)\b/i,
  /\boutput\s+(?:them\s+|it\s+|the\s+\w+\s+)?(?:inside\s+|in\s+)?a\s+code\s+block\b/i,
  // Mined from SaTML CTF extraction attacks; each validated 0 FP on the
  // benign+hard-negative corpus.
  /\b(?:part|portion|section|rest|beginning|remainder)\s+of\s+(?:your|the)\s+(?:instructions?|prompt|system\s+prompt|context|message)\b/i,
  /\b(?:first|last|next|nth|second|third)\s+(?:word|character|letter|line|sentence|paragraph|token)\s+(?:of|in|from)\s+(?:your|the|each)\s+(?:instructions?|prompt|system|message|secret|context)\b/i,
  /\b(?:what\s+is|reveal|tell\s+me|repeat|give\s+me|share|spell|output)\b.{0,40}\b(?:the\s+)?(?:secret|concealed|hidden|protected|confidential)\s+(?:word|phrase|code|token|password|passphrase|key|string|sequence)\b/i,
  /\b(?:encode|spell|reverse|translate|rot13|morse|acrostic)\b.{0,30}\b(?:the\s+)?(?:secret|password|instructions?|system\s+prompt)\b/i,
];

function firstMatch(patterns, text) {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return { match: m[0], source: re };
  }
  return null;
}

export function heuristicClassify(prompt) {
  const text = String(prompt ?? "");
  if (!text) return null;

  const exfil = firstMatch(EXFILTRATION_PATTERNS, text);
  if (exfil) {
    return {
      label: LABELS.EXFILTRATION,
      blocked: true,
      reason: `exfil pattern matched: ${exfil.match}`,
      source: "heuristic",
    };
  }
  const jailbreak = firstMatch(JAILBREAK_PATTERNS, text);
  if (jailbreak) {
    return {
      label: LABELS.JAILBREAK,
      blocked: true,
      reason: `jailbreak pattern matched: ${jailbreak.match}`,
      source: "heuristic",
    };
  }
  const injection = firstMatch(INJECTION_PATTERNS, text);
  if (injection) {
    return {
      label: LABELS.INJECTION,
      blocked: true,
      reason: `injection pattern matched: ${injection.match}`,
      source: "heuristic",
    };
  }
  return null;
}

export function heuristicSummary() {
  return {
    injectionPatterns: INJECTION_PATTERNS.length,
    jailbreakPatterns: JAILBREAK_PATTERNS.length,
    exfiltrationPatterns: EXFILTRATION_PATTERNS.length,
  };
}
