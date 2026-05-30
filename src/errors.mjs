// SPDX-License-Identifier: Apache-2.0

export class VanguardBlockedError extends Error {
  constructor(verdict, confidence, reason) {
    super(`Vanguard blocked prompt: ${verdict} (confidence ${confidence.toFixed(2)})`);
    this.name = "VanguardBlockedError";
    this.verdict = verdict;
    this.confidence = confidence;
    this.reason = reason;
  }
}
