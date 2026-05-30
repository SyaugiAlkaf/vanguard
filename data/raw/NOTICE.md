# Vanguard Attack Corpus — NOTICE

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

## v5 external diversity corpora

Added in the v5 retrain to broaden EXFILTRATION recall and JAILBREAK style coverage. Stored in `data/raw/exfil_external.jsonl` and `data/raw/jailbreak_external.jsonl`; produced by `scripts/fetch_external_corpora.py` (deduped against the existing corpus and against `data/sft/val.jsonl`).

| Source | URL | License | Class mapping |
|---|---|---|---|
| ethz-spylab/ctf-satml24 (SaTML-24 LLM CTF) | https://huggingface.co/datasets/ethz-spylab/ctf-satml24 | MIT | EXFILTRATION |
| y0mingzhang/prompt-extraction | https://github.com/y0mingzhang/prompt-extraction | MIT | EXFILTRATION |
| TrustAIRLab/in-the-wild-jailbreak-prompts | https://huggingface.co/datasets/TrustAIRLab/in-the-wild-jailbreak-prompts | MIT | JAILBREAK |

Rejected (HF access-gated, not redistributable): hackaprompt/hackaprompt-dataset, GeneralAnalysis/GA_Jailbreak_Benchmark.

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
