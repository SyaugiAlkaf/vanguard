// SPDX-License-Identifier: Apache-2.0
//
// SignatureStore — append-only log of attack signatures backed by Hyperbee
// over a Hypercore. Each entry is keyed by its SHA-256 signature hash so
// duplicate broadcasts deduplicate automatically.
//
// Persistent on disk under <storageDir>/. Survives process restart.

import Corestore from "corestore";
import Hyperbee from "hyperbee";
import { mkdirSync } from "node:fs";

export class SignatureStore {
  constructor(storageDir) {
    this.storageDir = storageDir;
    this.corestore = null;
    this.core = null;
    this.db = null;
    this._opened = false;
  }

  async open() {
    if (this._opened) return;
    mkdirSync(this.storageDir, { recursive: true });
    this.corestore = new Corestore(this.storageDir);
    await this.corestore.ready();
    this.core = this.corestore.get({ name: "vanguard-signatures" });
    await this.core.ready();
    this.db = new Hyperbee(this.core, {
      keyEncoding: "utf-8",
      valueEncoding: "json",
    });
    await this.db.ready();
    this._opened = true;
  }

  async put(signature) {
    await this.open();
    if (!signature?.sig) throw new TypeError("signature.sig required");
    await this.db.put(signature.sig, signature);
  }

  async get(sigHash) {
    await this.open();
    const node = await this.db.get(sigHash);
    return node?.value ?? null;
  }

  async *list() {
    await this.open();
    for await (const node of this.db.createReadStream()) {
      yield node.value;
    }
  }

  async count() {
    await this.open();
    let n = 0;
    for await (const _ of this.list()) n++;
    return n;
  }

  async key() {
    await this.open();
    return this.core.key.toString("hex");
  }

  async discoveryKey() {
    await this.open();
    return this.core.discoveryKey.toString("hex");
  }

  async close() {
    if (this.db) await this.db.close?.();
    if (this.core) await this.core.close?.();
    if (this.corestore) await this.corestore.close?.();
    this._opened = false;
  }
}
