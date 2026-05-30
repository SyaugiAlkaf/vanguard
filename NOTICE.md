# Vanguard — Third-Party Notices

Vanguard is licensed under Apache 2.0. It depends on the following third-party software, models, and datasets. Each is used in accordance with its license.

## Runtime dependencies

| Package | License | Source |
|---|---|---|
| `@qvac/sdk` (and transitive `@qvac/*` packages) | Apache-2.0 | https://github.com/tetherto/qvac |
| `zod` | MIT | https://github.com/colinhacks/zod |
| `which-runtime` | MIT | https://github.com/holepunchto/which-runtime |
| `fast-safe-stringify` | MIT | https://github.com/davidmarkclements/fast-safe-stringify |

The full transitive dependency tree is reflected in `package-lock.json`. Of the 209 packages installed, the upstream license stack is dominated by MIT and Apache-2.0; none of the runtime dependencies carry copyleft (GPL/LGPL/AGPL) terms.

## Base model (classifier)

The shipping detector LoRA at `artifacts/lora/adapter.gguf` is trained on Qwen3 1.7B. The smaller bases are kept supported for reproducibility and quick-smoke options.

| Model | Source | License | Used for |
|---|---|---|---|
| Qwen3 1.7B Instruct (Q4_0 GGUF) | https://huggingface.co/unsloth/Qwen3-1.7B-GGUF | Apache-2.0 | **Production adapter base** |
| Qwen3 0.6B Instruct (Q4_0 GGUF) | https://huggingface.co/unsloth/Qwen3-0.6B-GGUF | Apache-2.0 | smoke test, CLI fallback |
| Llama 3.2 1B Instruct (Q4_0 GGUF) | https://huggingface.co/unsloth/Llama-3.2-1B-Instruct-GGUF | Meta Llama 3.2 Community License | early-iteration baseline (not in shipping path; finetuning not supported on this arch by current SDK) |

## Hearth-loaded models (host + vision + OCR)

The Hearth reference app (`apps/hearth/`) loads additional models for the patient-facing clinical surface. None are bundled with the repo; the QVAC SDK fetches them from the model registry on first use.

| Model | Source | License | Used for |
|---|---|---|---|
| MedGemma 4B IT (Q4_1 GGUF) | https://huggingface.co/google/medgemma-4b-it | Google Health-AI Developer Foundations Terms of Use | Host LLM in Hearth — answers benign clinical queries after Vanguard verdict |
| Qwen3-VL 2B Instruct (Q4_K_M GGUF + mmproj) | https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF | Apache-2.0 | Vision describer for image uploads (opt-in via `HEARTH_VISION=1`) |
| LightOnOCR 2-1B ocr-soup (Q4_K_M GGUF + mmproj) | https://huggingface.co/noctrex/LightOnOCR-2-1B-ocr-soup-GGUF | Apache-2.0 (verify HF card before redistribution) | Document text extraction for OCR endpoint (opt-in via `HEARTH_OCR=1`) |

Vanguard does not bundle these models. The QVAC SDK fetches them from the QVAC model registry on first use. Distributing a derivative work that includes the model weights carries the model's own licensing obligations.

## Training datasets

The 4-class classifier is fine-tuned on a corpus assembled from the following public sources. Source records are preserved in `data/raw/NOTICE.md` for full attribution.

### Attack corpus (`data/raw/attack.jsonl`)

| Source | License | Class mapping |
|---|---|---|
| Lakera / gandalf_ignore_instructions | MIT | INJECTION |
| Lakera / gandalf_summarization | MIT | EXFILTRATION |
| JailbreakBench / JBB-Behaviors (harmful subset) | MIT | JAILBREAK |
| deepset / prompt-injections (English rows only) | Apache-2.0 | INJECTION |
| NVIDIA / garak (DAN, AutoDAN, sysprompt extraction, XSS, PromptInject, latent injection, HarmBench) | Apache-2.0 | mixed |
| Center for AI Safety / HarmBench (via garak) | MIT | JAILBREAK |

### Curated EXFILTRATION supplement (`data/raw/exfil_curated.jsonl`)

108 high-quality EXFILTRATION-class examples drawn from canonical published security research patterns (system-prompt extraction, secret/key/file exfiltration, RAG corpus dumping, conversation-history exfiltration, encoded/steganographic exfiltration). License: Apache-2.0. Source: vanguard-curated.

### External diversity corpora (`data/raw/exfil_external.jsonl`, `data/raw/jailbreak_external.jsonl`)

Added to broaden the two weak detector classes (EXFILTRATION recall and JAILBREAK stylistic coverage). Extracted via `scripts/fetch_external_corpora.py`, deduplicated within-source, against the existing corpus, and against `data/sft/val.jsonl` (no train/val contamination).

| Source | License | Class mapping | Extraction |
|---|---|---|---|
| ETH Zurich SPY Lab / SaTML-24 LLM CTF (`ethz-spylab/ctf-satml24`) | MIT | EXFILTRATION | First attacker turn of each non-evaluation attack chat (each is a system-prompt-secret-extraction attempt by construction) |
| y0mingzhang / prompt-extraction | MIT | EXFILTRATION | Handwritten + generated system-prompt-extraction prompts (`attacks.json`, `generated.json`, `selected.json`) |
| TrustAIRLab / in-the-wild-jailbreak-prompts (Shen et al., CCS'24) | MIT | JAILBREAK | Real jailbreak prompts scraped from Reddit/Discord/web (2023-12 snapshot), length-bounded and deduped |

Evaluated and rejected for v5: `hackaprompt/hackaprompt-dataset` and `GeneralAnalysis/GA_Jailbreak_Benchmark` — both are HuggingFace access-gated (require authenticated download), so they are not redistributable here. They remain candidates if access is granted.

### Benign baseline (`data/raw/benign.jsonl`)

| Source | License |
|---|---|
| databricks / databricks-dolly-15k (stratified subset) | CC-BY-SA-3.0 |
| Curated benign queries (coding, math, casual, domain tasks, meta-questions, productivity, cooking, travel, fitness, finance basics, science, language) | Apache-2.0 |

## License compatibility

All upstream sources are MIT, Apache-2.0, or CC-BY-SA-3.0. None are GPL-family or non-commercial. Apache-2.0 (Vanguard's own license) is compatible with all of the above for redistribution.

Alpaca (CC-BY-NC) was evaluated and rejected for license incompatibility with commercial distribution of the trained adapter. Dolly-15k was used as the benign baseline substitute.

## Attribution requirements

When redistributing Vanguard or any derivative artifacts (trained adapter weights, evaluation reports, release builds), retain:

- `LICENSE` (Apache-2.0)
- This `NOTICE.md`
- `data/raw/NOTICE.md` (upstream dataset attributions)

## Trademark disclaimer

"Vanguard" used as a name for this project is unrelated to The Vanguard Group, Inc. (the U.S. asset manager). This project is a security primitive for local large language models, not a financial product, not an investment advisory, and has no affiliation with The Vanguard Group.
