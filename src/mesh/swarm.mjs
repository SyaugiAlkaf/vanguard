// SPDX-License-Identifier: Apache-2.0
//
// MeshSwarm — Hyperswarm wrapper that connects peers on a shared "swarm
// topic" (32 bytes derived from a user-chosen secret) and gossips attack
// signatures between them. When a peer connects, both sides send their
// local signature set so the fleet converges; afterwards each newly
// detected signature is broadcast to every connected peer. A peer that
// receives a signature stores it locally, so the next matching prompt is
// blocked at the mesh layer (~10 ms) without ever reaching the LoRA.
//
// Network cable pulled = the mesh still defends from the local cache.

import Hyperswarm from "hyperswarm";
import { createHash } from "node:crypto";

function topicFromSecret(secret) {
  return createHash("sha256").update(`vanguard-mesh:${secret}`).digest();
}

export class MeshSwarm {
  constructor({ store, secret, deviceId, bootstrap = null, dht = null }) {
    if (!store) throw new TypeError("store required");
    if (!secret) throw new TypeError("secret required (shared across peers)");
    this.store = store;
    this.secret = secret;
    this.deviceId = deviceId ?? "?";
    // Optional DHT bootstrap override — point the fleet at a private/local DHT
    // so an air-gapped or NAT-isolated set of devices forms its own swarm
    // without the public bootstrap nodes. Default null = public Hyperswarm DHT.
    this.bootstrap = bootstrap;
    // Optional pre-built hyperdht node (e.g. firewalled:false for a directly
    // reachable device on a trusted LAN). Takes precedence over bootstrap.
    this.dht = dht;
    this.swarm = null;
    this._peers = new Set();
    this._sockets = new Set();
    this._seen = new Set(); // signature hashes already ingested (sync dedup guard)
    this._discovery = null;
    this.onPeer = null; // ({ remoteKey, total }) => void
    this.onSignature = null; // (sig) => void  — fired when a peer's signature lands
  }

  async join() {
    await this.store.open();
    const swarmOpts = this.dht ? { dht: this.dht } : this.bootstrap ? { bootstrap: this.bootstrap } : undefined;
    this.swarm = new Hyperswarm(swarmOpts);
    const topic = topicFromSecret(this.secret);

    this.swarm.on("connection", (socket, info) => {
      const remoteKey = info.publicKey.toString("hex").slice(0, 12);
      this.handleSocket(socket, remoteKey);
    });

    this._discovery = this.swarm.join(topic, { server: true, client: true });
    await this._discovery.flushed();
  }

  // Register a connected peer socket and wire up gossip. Transport-agnostic:
  // Hyperswarm's Noise stream (across real devices) and a plain duplex
  // socket (a direct local link, used by the demo) both flow through here.
  handleSocket(socket, remoteKey) {
    this._peers.add(remoteKey);
    this._sockets.add(socket);

    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        this._ingest(line).catch(() => {});
      }
    });
    socket.on("error", () => {}); // a dropped peer is not fatal
    socket.on("close", () => {
      this._peers.delete(remoteKey);
      this._sockets.delete(socket);
    });

    // Send our full local signature set so the new peer converges.
    this._syncTo(socket).catch(() => {});
    this.onPeer?.({ remoteKey, total: this._peers.size });
  }

  async _syncTo(socket) {
    for await (const sig of this.store.list()) {
      socket.write(JSON.stringify({ t: "sig", sig }) + "\n");
    }
  }

  async _ingest(line) {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.t === "sig" && msg.sig?.sig) {
      // Synchronous guard: two lines for the same signature can arrive
      // back-to-back and both pass an async store.get() before either
      // write lands. Check-and-claim the hash before any await.
      if (this._seen.has(msg.sig.sig)) return;
      this._seen.add(msg.sig.sig);
      const existing = await this.store.get(msg.sig.sig);
      if (!existing) {
        await this.store.put(msg.sig);
        this.onSignature?.(msg.sig);
      }
    }
  }

  // Broadcast a locally-detected signature to every connected peer.
  broadcast(sig) {
    if (!sig?.sig) return;
    const line = JSON.stringify({ t: "sig", sig }) + "\n";
    for (const socket of this._sockets) {
      try {
        socket.write(line);
      } catch {
        /* peer went away mid-write */
      }
    }
  }

  peerCount() {
    return this._peers.size;
  }

  async leave() {
    for (const socket of this._sockets) {
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
    }
    this._sockets.clear();
    if (this._discovery) await this._discovery.destroy();
    if (this.swarm) await this.swarm.destroy();
    this._discovery = null;
    this.swarm = null;
    this._peers.clear();
  }
}
