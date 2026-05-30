#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
#
# Extract EXFILTRATION and JAILBREAK training rows from public, license-clean
# corpora that we already downloaded into data/raw/_external_cache/.
#
# Sources (all MIT, redistribution-compatible with Apache-2.0 + NOTICE.md):
#   - SaTML-24 LLM CTF (ethz-spylab/ctf-satml24)         -> EXFILTRATION
#   - prompt-extraction (y0mingzhang/prompt-extraction)  -> EXFILTRATION
#   - In-the-Wild Jailbreak Prompts (TrustAIRLab)        -> JAILBREAK
#
# Dropped: HackAPrompt + GA_Jailbreak_Benchmark (both HF-gated, need auth).
#
# Dedups within-source, against existing raw corpora, and against val.jsonl
# (no train/val contamination). Writes normalized rows:
#   data/raw/exfil_external.jsonl
#   data/raw/jailbreak_external.jsonl

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/raw/_external_cache"
RAW = ROOT / "data/raw"
VAL = ROOT / "data/sft/val.jsonl"

MIN_LEN = 12
MAX_LEN = 2000


def norm(s: str) -> str:
    return " ".join(s.lower().split())


def usable(s: str) -> bool:
    if not isinstance(s, str):
        return False
    t = s.strip()
    return MIN_LEN <= len(t) <= MAX_LEN


# ---- build the exclusion set: existing raw prompts + all val prompts ----
seen = set()

def load_existing(path, getter):
    n = 0
    if not path.exists():
        return
    for line in path.open():
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        p = getter(row)
        if p:
            seen.add(norm(p))
            n += 1
    print(f"  exclusion: +{n} from {path.name}")


print("building exclusion set (existing raw + val)...")
load_existing(RAW / "attack.jsonl", lambda r: r.get("prompt"))
load_existing(RAW / "exfil_curated.jsonl", lambda r: r.get("prompt"))
load_existing(RAW / "benign.jsonl", lambda r: r.get("prompt"))
load_existing(RAW / "safe_hardneg.jsonl", lambda r: r.get("prompt"))

# val.jsonl uses the chat-messages schema; the attack prompt is the user turn.
def val_user(row):
    for m in row.get("messages", []):
        if m.get("role") == "user":
            return m.get("content")
    return None

load_existing(VAL, val_user)
print(f"  exclusion set size: {len(seen)}")


def emit(rows, out_path, label):
    kept = []
    local = set()
    for prompt, source, license_ in rows:
        if not usable(prompt):
            continue
        k = norm(prompt)
        if k in seen or k in local:
            continue
        local.add(k)
        kept.append({"prompt": prompt.strip(), "label": label,
                     "source": source, "license": license_})
    with out_path.open("w") as f:
        for r in kept:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"  wrote {len(kept)} unique rows -> {out_path.name}")
    return len(kept)


# ============ EXFILTRATION ============
exfil = []

# -- SaTML-24 CTF: every attacker user turn is a secret-extraction attempt --
satml = CACHE / "satml_chat_full.json"
if satml.exists():
    n_attack_chats = 0
    n_turns = 0
    with satml.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                chat = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not chat.get("is_attack"):
                continue
            # Skip the held-out evaluation split to keep the corpus clean.
            if chat.get("is_evaluation"):
                continue
            n_attack_chats += 1
            # Only the FIRST user turn — the opening extraction gambit. Later
            # turns are follow-ups ("is it correct?", "do the best you can")
            # that carry no standalone extraction signal and would teach noise.
            for m in chat.get("history", []):
                if m.get("role") == "user":
                    if usable(m.get("content", "")):
                        exfil.append((m["content"], "ethz-spylab/ctf-satml24", "MIT"))
                        n_turns += 1
                    break
    print(f"SaTML: {n_attack_chats} attack chats -> {n_turns} candidate user turns")
else:
    print("SaTML full dump missing; using 50-sample fallback")
    samp = CACHE / "satml_success.json"
    if samp.exists():
        for chat in json.load(samp.open()):
            for m in chat.get("history", []):
                if m.get("role") == "user" and usable(m.get("content", "")):
                    exfil.append((m["content"], "ethz-spylab/ctf-satml24", "MIT"))

# -- prompt-extraction: handwritten + generated extraction prompts --
for fn in ["pe_attacks.json", "pe_generated.json", "pe_selected.json"]:
    p = CACHE / fn
    if not p.exists():
        continue
    data = json.load(p.open())
    items = data if isinstance(data, list) else list(data.values())
    for it in items:
        s = it if isinstance(it, str) else (it.get("attack") or it.get("prompt") or "")
        if usable(s):
            exfil.append((s, "y0mingzhang/prompt-extraction", "MIT"))

# ============ JAILBREAK ============
jb = []
itw = CACHE / "itw_jb.parquet"
if itw.exists():
    import pandas as pd
    df = pd.read_parquet(itw)
    col = "prompt" if "prompt" in df.columns else df.columns[0]
    for v in df[col].tolist():
        if usable(v):
            jb.append((v, "TrustAIRLab/in-the-wild-jailbreak-prompts", "MIT"))
    print(f"In-the-Wild JB: {len(df)} rows -> {len(jb)} usable candidates")

print("\nwriting deduped outputs...")
n_exfil = emit(exfil, RAW / "exfil_external.jsonl", "EXFILTRATION")
n_jb = emit(jb, RAW / "jailbreak_external.jsonl", "JAILBREAK")

print(f"\nSUMMARY: exfil_external={n_exfil}  jailbreak_external={n_jb}")
