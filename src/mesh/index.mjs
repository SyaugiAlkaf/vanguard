// SPDX-License-Identifier: Apache-2.0
//
// Vanguard mesh — peer-to-peer signature propagation for fleets of a
// user's own devices. Drop a novel attack signature into the local store
// and it replicates across the swarm via Hyperswarm. Local lookup is a
// keyed Hyperbee get against the SHA-256 of the canonicalized prompt.

export { canonicalize, signatureHash, makeSignature } from "./signatures.mjs";
export { SignatureStore } from "./store.mjs";
export { MeshSwarm } from "./swarm.mjs";

import { SignatureStore } from "./store.mjs";
import { MeshSwarm } from "./swarm.mjs";
import { signatureHash, makeSignature } from "./signatures.mjs";

/**
 * High-level mesh handle. Opens a SignatureStore, optionally joins a
 * shared swarm, and exposes lookup + publish helpers.
 *
 * @param opts.storageDir  Path to persist the corestore on disk
 * @param opts.secret      Shared secret across peers (string)
 * @param opts.deviceId    Stable identifier for this device (string)
 * @param opts.online      Whether to actually join the swarm (default true)
 */
export async function startMesh({ storageDir, secret, deviceId, online = true }) {
  const store = new SignatureStore(storageDir);
  await store.open();
  let swarm = null;
  if (online && secret) {
    swarm = new MeshSwarm({ store, secret, deviceId });
    await swarm.join();
  }

  return {
    store,
    swarm,
    async publish({ prompt, label, transforms = [] }) {
      const sig = makeSignature({ prompt, label, transforms, deviceId });
      await store.put(sig);
      if (swarm) swarm.broadcast(sig);
      return sig;
    },
    async lookup(prompt) {
      const hash = signatureHash(prompt);
      const node = await store.get(hash);
      return node;
    },
    async count() {
      return store.count();
    },
    peerCount() {
      return swarm ? swarm.peerCount() : 0;
    },
    async close() {
      if (swarm) await swarm.leave();
      await store.close();
    },
  };
}
