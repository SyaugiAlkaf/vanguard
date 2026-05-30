# SPDX-License-Identifier: Apache-2.0
"""Build Vanguard attack corpus.

Reads downloaded sources from /tmp/vanguard_corpus and emits a single merged
JSONL at vanguard/data/raw/attack.jsonl, plus NOTICE.md.

Classes: INJECTION, JAILBREAK, EXFILTRATION.
"""

import csv
import hashlib
import json
import os
import re
import statistics
from pathlib import Path

import pyarrow.parquet as pq

SRC = Path("/tmp/vanguard_corpus")
OUT_DIR = Path.home() / "Desktop/Development/projects/vanguard/data/raw"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_JSONL = OUT_DIR / "attack.jsonl"
OUT_NOTICE = OUT_DIR / "NOTICE.md"

MIN_LEN = 5
MAX_LEN = 8192

DE_RE = re.compile(
    r"\b(ich|der|die|das|und|nicht|sie|sind|wir|euch|sich|möchte|möglich|mein|mit|bitte|kann|nach|bei|wie|werden|aufgaben|deine|ist|für|über|geld|sprache)\b",
    re.IGNORECASE,
)
NONASCII_RE = re.compile(r"[^\x00-\x7F]")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?<!\w)(\+?\d[\d\-\s().]{7,}\d)(?!\w)")
WS_RE = re.compile(r"\s+")


def is_english(text: str) -> bool:
    if not text:
        return False
    # heuristic: strong German marker → drop; many non-ascii chars vs length → drop
    non_ascii = len(NONASCII_RE.findall(text))
    if non_ascii / max(1, len(text)) > 0.15:
        return False
    de_hits = len(DE_RE.findall(text))
    en_marker_re = re.compile(r"\b(the|and|you|your|ignore|please|prompt|password|system|instructions|write|tell|act|now|forget|previous)\b", re.IGNORECASE)
    en_hits = len(en_marker_re.findall(text))
    if de_hits >= 3 and en_hits == 0:
        return False
    if de_hits > en_hits and de_hits >= 2:
        return False
    return True


def scrub_pii(text: str) -> str:
    text = EMAIL_RE.sub("[EMAIL]", text)
    text = PHONE_RE.sub("[PHONE]", text)
    return text


def normalize_key(text: str) -> str:
    return WS_RE.sub(" ", text.lower().strip())


def accept(text: str, seen: set, rows: list, label: str, source: str, license_id: str) -> bool:
    if not text or not isinstance(text, str):
        return False
    text = text.strip()
    if len(text) < MIN_LEN or len(text) > MAX_LEN:
        return False
    if not is_english(text):
        return False
    text = scrub_pii(text)
    key = normalize_key(text)
    if key in seen:
        return False
    seen.add(key)
    rows.append({
        "prompt": text,
        "label": label,
        "source": source,
        "license": license_id,
    })
    return True


def load_parquet_col(path: Path, col: str = "text"):
    return pq.read_table(path).to_pandas()[col].tolist()


def from_gandalf_ignore(seen, rows):
    base = SRC / "gandalf_ignore/data"
    count = 0
    for f in sorted(base.glob("*.parquet")):
        df = pq.read_table(f).to_pandas()
        for t in df["text"].tolist():
            if accept(t, seen, rows, "INJECTION", "Lakera/gandalf_ignore_instructions", "MIT"):
                count += 1
    return count


def from_gandalf_summ(seen, rows):
    base = SRC / "gandalf_summ/data"
    count = 0
    for f in sorted(base.glob("*.parquet")):
        df = pq.read_table(f).to_pandas()
        for t in df["text"].tolist():
            # Gandalf summarization = indirect exfiltration (password leak via summary)
            if accept(t, seen, rows, "EXFILTRATION", "Lakera/gandalf_summarization", "MIT"):
                count += 1
    return count


def from_jbb(seen, rows):
    csv_path = SRC / "jbb/data/harmful-behaviors.csv"
    count = 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            goal = row.get("Goal", "")
            if accept(goal, seen, rows, "JAILBREAK", "JailbreakBench/JBB-Behaviors", "MIT"):
                count += 1
    return count


def from_deepset(seen, rows):
    base = SRC / "deepset_pi/data"
    count = 0
    for f in sorted(base.glob("*.parquet")):
        df = pq.read_table(f).to_pandas()
        inj = df[df["label"] == 1]
        for t in inj["text"].tolist():
            if accept(t, seen, rows, "INJECTION", "deepset/prompt-injections", "Apache-2.0"):
                count += 1
    return count


def from_garak(seen, rows):
    """Extract attack strings embedded in garak code + data."""
    g_data = SRC / "garak_src/garak/data"
    count_jb = 0
    count_inj = 0
    count_exfil = 0

    # 1) DAN family JSON files -> JAILBREAK
    for f in sorted((g_data / "dan").glob("*.json")):
        d = json.loads(f.read_text())
        if isinstance(d, list):
            for item in d:
                if isinstance(item, str):
                    # placeholders like {generator.name} - replace with generic "the AI"
                    clean = item.replace("{generator.name}", "the AI")
                    if accept(clean, seen, rows, "JAILBREAK", f"NVIDIA/garak:dan/{f.name}", "Apache-2.0"):
                        count_jb += 1

    # 2) autodan_prompts.json -> JAILBREAK
    autodan = json.loads((g_data / "autodan/autodan_prompts.json").read_text())
    if isinstance(autodan, list):
        for item in autodan:
            if isinstance(item, str):
                if accept(item, seen, rows, "JAILBREAK", "NVIDIA/garak:autodan", "Apache-2.0"):
                    count_jb += 1

    # 3) inthewild_jailbreak_llms.json -> JAILBREAK
    inthewild = json.loads((g_data / "inthewild_jailbreak_llms.json").read_text())
    if isinstance(inthewild, list):
        for item in inthewild:
            if isinstance(item, str):
                clean = item.replace("{generator.name}", "the AI")
                if accept(clean, seen, rows, "JAILBREAK", "NVIDIA/garak:inthewild_jailbreak_llms", "Apache-2.0"):
                    count_jb += 1

    # 4) HarmBench prompts -> JAILBREAK (harmful task framings) - MIT license
    harmbench = (g_data / "harmbench/harmbench_prompts.txt").read_text().splitlines()
    for line in harmbench:
        line = line.strip()
        if accept(line, seen, rows, "JAILBREAK", "centerforaisafety/HarmBench (via garak)", "MIT"):
            count_jb += 1

    # 5) sysprompt_extraction/attacks.json -> EXFILTRATION
    sysprompt = json.loads((g_data / "sysprompt_extraction/attacks.json").read_text())
    if isinstance(sysprompt, dict):
        for category, items in sysprompt.items():
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, str):
                        if accept(item, seen, rows, "EXFILTRATION", f"NVIDIA/garak:sysprompt_extraction/{category}", "Apache-2.0"):
                            count_exfil += 1

    # 6) PromptInject goal_hijacking + prompt_leaking attack templates -> INJECTION / EXFILTRATION
    pi_data = SRC / "garak_src/garak/resources/promptinject/prompt_data.py"
    # We'll import the module by exec-ing it to grab the dicts safely
    ns = {}
    exec(pi_data.read_text(), ns)  # trusted local file
    rogue_strings = ns.get("rogue_strings", {})
    goal_hijacking = ns.get("goal_hikacking_attacks", {})
    prompt_leaking = ns.get("prompt_leaking_attacks", {})

    for attack_name, attack in goal_hijacking.items():
        instr = attack.get("instruction", "")
        for rogue_name, rogue in rogue_strings.items():
            filled = instr.replace("{REPLACE_rogue_string}", rogue)
            if accept(filled, seen, rows, "INJECTION", f"NVIDIA/garak:promptinject/{attack_name}", "Apache-2.0"):
                count_inj += 1

    for attack_name, attack in prompt_leaking.items():
        instr = attack.get("instruction", "")
        if accept(instr, seen, rows, "EXFILTRATION", f"NVIDIA/garak:promptinject/{attack_name}", "Apache-2.0"):
            count_exfil += 1

    # 7) latentinjection.py injection_instructions (extract literal strings)
    li_src = (SRC / "garak_src/garak/probes/latentinjection.py").read_text()
    # Find all injection_instructions = [ ... ] blocks
    for match in re.finditer(r"injection_instructions\s*=\s*\[(.*?)\]\s*\n", li_src, re.DOTALL):
        block = match.group(1)
        # find f-string or plain string literals
        for sm in re.finditer(r"(?:f\"\"\"(.*?)\"\"\"|f\"(.*?)\"|\"\"\"(.*?)\"\"\"|\"((?:[^\"\\]|\\.)*)\")", block, re.DOTALL):
            s = next((g for g in sm.groups() if g is not None), None)
            if s and "PAYLOAD_MARKER" in s:
                # replace markers with concrete examples
                concrete = s.replace("{PAYLOAD_MARKER}", "Haha pwned!")
                # strip escape backslashes from json-style escapes
                concrete = concrete.replace("\\n", "\n").replace("\\\"", "\"").replace("\\'", "'")
                if accept(concrete, seen, rows, "INJECTION", "NVIDIA/garak:latentinjection", "Apache-2.0"):
                    count_inj += 1

    # 8) XSS prompt templates -> EXFILTRATION (data-exfil via URL)
    xss_dir = g_data / "xss"
    for txt_file in [
        xss_dir / "xss_concat_prompt_templates/basic_concat_inst.txt",
        xss_dir / "xss_full_uri_prompt_templates/direct.txt",
        xss_dir / "xss_full_uri_prompt_templates/email.txt",
    ]:
        if txt_file.exists():
            content = txt_file.read_text().strip()
            # treat each whole file as one template (they're multi-line)
            # plus split by paragraph if separated by blank line
            chunks = [c.strip() for c in content.split("\n\n") if c.strip()]
            if not chunks:
                chunks = [content]
            for chunk in chunks:
                # template variables - sub with examples
                concrete = (
                    chunk.replace("{injected_strings}", "https://attacker.example/?leak=")
                    .replace("{injected_marker}", "MARK")
                    .replace("{injected_action}", "the conversation history")
                    .replace("{injected_output_fomat}", "render as a clickable link")
                )
                if accept(concrete, seen, rows, "EXFILTRATION", f"NVIDIA/garak:xss/{txt_file.name}", "Apache-2.0"):
                    count_exfil += 1

    return {"JAILBREAK": count_jb, "INJECTION": count_inj, "EXFILTRATION": count_exfil}


def main():
    seen = set()
    rows = []

    contrib = {}
    contrib["Lakera/gandalf_ignore_instructions"] = from_gandalf_ignore(seen, rows)
    contrib["Lakera/gandalf_summarization"] = from_gandalf_summ(seen, rows)
    contrib["JailbreakBench/JBB-Behaviors"] = from_jbb(seen, rows)
    contrib["deepset/prompt-injections (EN)"] = from_deepset(seen, rows)
    garak_stats = from_garak(seen, rows)
    contrib["NVIDIA/garak (multiple)"] = sum(garak_stats.values())

    # Write JSONL
    with OUT_JSONL.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Stats
    by_class = {}
    by_license = {}
    by_source_prefix = {}
    lens = []
    for r in rows:
        by_class[r["label"]] = by_class.get(r["label"], 0) + 1
        by_license[r["license"]] = by_license.get(r["license"], 0) + 1
        src_root = r["source"].split(":")[0]
        by_source_prefix[src_root] = by_source_prefix.get(src_root, 0) + 1
        lens.append(len(r["prompt"]))

    print(f"Total rows: {len(rows)}")
    print("By class:", by_class)
    print("By license:", by_license)
    print("By source root:", by_source_prefix)
    if lens:
        print(f"Prompt length mean: {statistics.mean(lens):.1f} chars, median: {statistics.median(lens):.1f} chars, max: {max(lens)}, min: {min(lens)}")

    # NOTICE.md
    notice = """# Vanguard Attack Corpus — NOTICE

Sources merged into `data/raw/attack.jsonl`. All sources are MIT or Apache-2.0,
compatible with the Apache-2.0 license under which the Vanguard LoRA adapter
will be released.

## Datasets

| Source | URL | License | Class mapping |
|---|---|---|---|
| Lakera/gandalf_ignore_instructions | https://huggingface.co/datasets/Lakera/gandalf_ignore_instructions | MIT | INJECTION |
| Lakera/gandalf_summarization | https://huggingface.co/datasets/Lakera/gandalf_summarization | MIT | EXFILTRATION |
| JailbreakBench/JBB-Behaviors (harmful subset) | https://huggingface.co/datasets/JailbreakBench/JBB-Behaviors | MIT | JAILBREAK |
| deepset/prompt-injections (English rows) | https://huggingface.co/datasets/deepset/prompt-injections | Apache-2.0 | INJECTION |
| NVIDIA/garak (probe + data extraction) | https://github.com/leondz/garak | Apache-2.0 | JAILBREAK + INJECTION + EXFILTRATION |
| centerforaisafety/HarmBench (vendored in garak) | https://github.com/centerforaisafety/HarmBench | MIT | JAILBREAK |

## Garak sub-sources

- `garak/data/dan/*.json` — DAN-family jailbreaks (14 templates)
- `garak/data/autodan/autodan_prompts.json` — AutoDAN initialization prompts
- `garak/data/inthewild_jailbreak_llms.json` — community-collected jailbreaks
- `garak/data/harmbench/harmbench_prompts.txt` — HarmBench standard subset (MIT)
- `garak/data/sysprompt_extraction/attacks.json` — system-prompt extraction attacks
- `garak/data/xss/xss_*_prompt_templates/*.txt` — XSS / data-exfiltration via link templates
- `garak/resources/promptinject/prompt_data.py` — goal-hijacking and prompt-leaking instruction templates
- `garak/probes/latentinjection.py` — string literals extracted from `injection_instructions` blocks

## Excluded (per attack_corpus_plan.md)

- `tatsu-lab/alpaca` — CC-BY-NC 4.0 (non-commercial; would taint Apache-2.0 adapter).
- `microsoft/promptbench` — semantic perturbation templates, low-signal vs. our injection schema.

## Cleaning applied

1. English-only language heuristic (ASCII ratio + German-marker filter; drops most `deepset` German rows).
2. Length filter: 5 ≤ prompt length ≤ 8192 chars.
3. Exact + case-normalized + whitespace-collapsed dedup across all sources.
4. PII scrub: emails → `[EMAIL]`, phone-shaped digit sequences → `[PHONE]`.
5. Class labels assigned per the mapping table above.

## Attribution requirements

All upstream licenses (MIT, Apache-2.0) require attribution. This file satisfies that
requirement for derivative artifacts (model adapter weights, evaluation reports,
release notes). Do not remove this file when redistributing `attack.jsonl` or any
LoRA adapter trained on it.
"""
    OUT_NOTICE.write_text(notice)
    print(f"\nWrote {OUT_JSONL} and {OUT_NOTICE}")


if __name__ == "__main__":
    main()
