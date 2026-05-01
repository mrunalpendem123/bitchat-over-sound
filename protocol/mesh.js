// mesh.js — Mesh + discovery layer.
//
// Responsibilities:
// - Maintain a peer table (peerId -> {pubkey, displayName, lastHeard, hops})
// - Periodically beacon our own identity
// - On received packet:
//     * verify signature (using known pubkey for that src)
//     * dedup against seen-set
//     * if for us / broadcast → emit to app
//     * if TTL > 0 → schedule a relay (cancellable if a neighbor relays first)
// - Send: build packet, sign, hand to MAC

(function (global) {
  'use strict';

  const SEEN_TTL_MS         = 10 * 60 * 1000;  // remember msg_ids for 10 min
  const PEER_TIMEOUT_MS     = 90 * 1000;       // drop peers not heard in 90s
  const BEACON_INTERVAL_MS  = 45 * 1000;       // chirp identity every 45s
  const RELAY_BACKOFF_MIN_MS = 400;
  const RELAY_BACKOFF_MAX_MS = 2200;
  const SWEEP_INTERVAL_MS   = 5000;
  const PEER_TABLE_MAX      = 128;
  const SEEN_SET_MAX        = 512;

  function rand(a, b) { return a + Math.random() * (b - a); }

  class Mesh {
    constructor({ identity, mac, ggwave }) {
      this.identity = identity;
      this.mac = mac;
      this.ggwave = ggwave;

      this.myPeerId = BitchatIdentity.peerIdFromPubkey(identity.publicKey);

      // peerId -> { peerId, publicKey, displayName, shortId, lastHeard, hops, signal }
      this.peers = new Map();
      // msgId -> timestamp (for dedup)
      this.seen = new Map();
      // msgId -> setTimeout handle (relays we have scheduled)
      this.pendingRelays = new Map();

      this.callbacks = {
        onMessage:   () => {},   // (msg) for chat messages we should display
        onPeers:     () => {},   // (peers[]) when peer table changes
        onSelfSent:  () => {},   // (msg) right after our own send queues
      };

      this.ggwave.onPacket = (bytes) => this._onPacketReceived(bytes);

      this._startTimers();
    }

    set onMessage(cb)  { this.callbacks.onMessage = cb; }
    set onPeers(cb)    { this.callbacks.onPeers = cb; }
    set onSelfSent(cb) { this.callbacks.onSelfSent = cb; }

    // ─── Public: send a chat message ─────────────────────────────────
    async sendChat(text) {
      const msgId = BitchatPacket.makeMsgId();
      const fields = {
        type: BitchatPacket.TYPE.MESSAGE,
        msgId,
        srcId: this.myPeerId,
        dstId: BitchatPacket.BROADCAST,
        ttl: 5,
        hopCount: 0,
        payload: text,
      };
      const wire = BitchatPacket.encodeAndSign(fields, this.identity.secretKey);
      this.seen.set(msgId, Date.now());
      this._trimSeen();

      const localMsg = {
        msgId, from: 'me', text,
        time: this._fmtTime(),
        bytes: new TextEncoder().encode(text).length,
        hops: 1,
        sender: this.identity.displayName,
        senderShortId: BitchatIdentity.shortIdFromPubkey(this.identity.publicKey),
      };
      this.callbacks.onSelfSent(localMsg);

      try {
        await this.mac.send(wire, { priority: 1 });
      } catch (e) {
        console.error('mesh send failed:', e);
      }
    }

    // ─── Public: send a beacon now ───────────────────────────────────
    async sendBeacon() {
      const payload = BitchatPacket.encodeBeaconPayload(
        this.identity.publicKey,
        this.identity.displayName
      );
      const wire = BitchatPacket.encodeAndSign({
        type: BitchatPacket.TYPE.BEACON,
        msgId: BitchatPacket.makeMsgId(),
        srcId: this.myPeerId,
        dstId: BitchatPacket.BROADCAST,
        ttl: 1,           // beacons don't relay
        hopCount: 0,
        payload,
      }, this.identity.secretKey);
      try {
        await this.mac.send(wire, { priority: 0 });
      } catch (e) {
        // Probably channel busy — try again next beacon interval
      }
    }

    // ─── Internal ────────────────────────────────────────────────────
    _onPacketReceived(bytes) {
      const pkt = BitchatPacket.decode(bytes);
      if (!pkt) return;
      if (pkt.srcId === this.myPeerId) return;  // ignore our own echo

      // BEACON: learn the peer's pubkey from the payload, then verify
      if (pkt.type === BitchatPacket.TYPE.BEACON) {
        const body = BitchatPacket.decodeBeaconPayload(pkt.payload);
        if (!body) return;
        if (!BitchatPacket.verify(pkt, body.publicKey)) return;
        this._learnPeer(pkt.srcId, body.publicKey, body.displayName, pkt.hopCount);
        return;
      }

      // MESSAGE: must know the sender's pubkey already (from beacon or first message)
      let peer = this.peers.get(pkt.srcId);
      if (!peer) {
        // Unknown peer — defer until we get their beacon. Drop for now.
        return;
      }
      if (!BitchatPacket.verify(pkt, peer.publicKey)) {
        return;
      }

      // Dedup
      if (this.seen.has(pkt.msgId)) {
        // We already saw this — if we had a pending relay, cancel it.
        const handle = this.pendingRelays.get(pkt.msgId);
        if (handle) {
          clearTimeout(handle);
          this.pendingRelays.delete(pkt.msgId);
        }
        return;
      }
      this.seen.set(pkt.msgId, Date.now());
      this._trimSeen();

      // Touch peer
      peer.lastHeard = Date.now();
      peer.hops = pkt.hopCount + 1;
      this._emitPeers();

      if (pkt.type === BitchatPacket.TYPE.MESSAGE) {
        const text = new TextDecoder().decode(pkt.payload);
        this.callbacks.onMessage({
          msgId: pkt.msgId,
          from: 'them',
          text,
          time: this._fmtTime(),
          bytes: pkt.payload.length,
          hops: pkt.hopCount + 1,
          senderPeerId: pkt.srcId,
          sender: peer.displayName,
          senderShortId: peer.shortId,
        });
      }

      // Relay if TTL allows
      if (pkt.ttl > 0) {
        const wait = rand(RELAY_BACKOFF_MIN_MS, RELAY_BACKOFF_MAX_MS);
        const handle = setTimeout(async () => {
          this.pendingRelays.delete(pkt.msgId);
          // Re-check: if we've heard a relay during the wait, the seen-set
          // entry would still be there but pendingRelays would be cleared above.
          // Either way, send.
          const relayBytes = BitchatPacket.buildRelay(pkt);
          try { await this.mac.send(relayBytes, { priority: 0 }); } catch (e) {}
        }, wait);
        this.pendingRelays.set(pkt.msgId, handle);
      }
    }

    _learnPeer(peerId, publicKey, displayName, hopCount) {
      let p = this.peers.get(peerId);
      const shortId = BitchatIdentity.shortIdFromPubkey(publicKey);
      if (!p) {
        if (this.peers.size >= PEER_TABLE_MAX) {
          // Evict oldest
          let oldestId = null, oldestTs = Infinity;
          for (const [id, info] of this.peers) {
            if (info.lastHeard < oldestTs) { oldestTs = info.lastHeard; oldestId = id; }
          }
          if (oldestId) this.peers.delete(oldestId);
        }
        p = { peerId, publicKey, displayName, shortId,
              lastHeard: Date.now(), hops: hopCount + 1, signal: 3 };
        this.peers.set(peerId, p);
      } else {
        p.publicKey = publicKey;
        p.displayName = displayName;
        p.shortId = shortId;
        p.lastHeard = Date.now();
        p.hops = hopCount + 1;
      }
      this._emitPeers();
    }

    _emitPeers() {
      const list = Array.from(this.peers.values())
        .filter(p => p.peerId !== this.myPeerId)
        .sort((a, b) => b.lastHeard - a.lastHeard);
      this.callbacks.onPeers(list);
    }

    _trimSeen() {
      if (this.seen.size <= SEEN_SET_MAX) return;
      const cutoff = Date.now() - SEEN_TTL_MS;
      for (const [id, ts] of this.seen) {
        if (ts < cutoff) this.seen.delete(id);
      }
    }

    _startTimers() {
      // Beacon
      this._beaconTimer = setInterval(() => this.sendBeacon(), BEACON_INTERVAL_MS);
      setTimeout(() => this.sendBeacon(), 2000); // first beacon shortly after boot

      // Sweep stale peers
      this._sweepTimer = setInterval(() => {
        const cutoff = Date.now() - PEER_TIMEOUT_MS;
        let changed = false;
        for (const [id, p] of this.peers) {
          if (p.lastHeard < cutoff) { this.peers.delete(id); changed = true; }
        }
        if (changed) this._emitPeers();

        // Also trim seen-set
        const seenCutoff = Date.now() - SEEN_TTL_MS;
        for (const [id, ts] of this.seen) {
          if (ts < seenCutoff) this.seen.delete(id);
        }
      }, SWEEP_INTERVAL_MS);
    }

    stop() {
      clearInterval(this._beaconTimer);
      clearInterval(this._sweepTimer);
    }

    _fmtTime() {
      return new Date().toTimeString().slice(0, 5);
    }
  }

  global.BitchatMesh = Mesh;
})(window);
