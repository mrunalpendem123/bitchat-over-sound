// chat.js — text-based mesh chat over ggwave.
//
// One ggwave chirp carries one ASCII string:
//
//   B1|<msgId>|<ttl>|<short>|<name>|<text>
//
// Discovery is implicit: any sender we hear becomes a peer. Dedup by msgId.
// If TTL > 0, schedule a relay (cancellable if a neighbour relays first).

(function (global) {
  'use strict';

  const VERSION              = 'B1';
  const SEP                  = '|';
  const DEFAULT_TTL          = 4;
  const SEEN_TTL_MS          = 5 * 60 * 1000;
  const PEER_TIMEOUT_MS      = 90 * 1000;
  const RELAY_BACKOFF_MIN_MS = 400;
  const RELAY_BACKOFF_MAX_MS = 2200;
  const SWEEP_INTERVAL_MS    = 5000;

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeMsgId() {
    return Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
  }

  // Derive a stable 4-hex short id from a name. Two windows opened with
  // the same ?as= would collide, but the convention is to use distinct names.
  function shortIdFromName(name) {
    let h = 5381;
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0').slice(0, 4).toUpperCase();
  }

  function encode({ msgId, ttl, short, name, text }) {
    const safeName = String(name || 'anon').replace(/\|/g, '_').slice(0, 16);
    const safeText = String(text || '');
    return [VERSION, msgId, String(ttl), short, safeName, safeText].join(SEP);
  }

  function decode(str) {
    if (typeof str !== 'string') return null;
    const parts = str.split(SEP);
    if (parts.length < 6) return null;
    if (parts[0] !== VERSION) return null;
    const msgId = parts[1];
    const ttl   = parseInt(parts[2], 10);
    const short = parts[3];
    const name  = parts[4];
    const text  = parts.slice(5).join(SEP);  // text may contain '|'
    if (!msgId || isNaN(ttl) || !short) return null;
    return { msgId, ttl, short, name, text };
  }

  class Chat {
    constructor({ ggwave, mac, displayName }) {
      this.ggwave = ggwave;
      this.mac = mac;
      this.displayName = displayName || 'anon';
      this.shortId = shortIdFromName(this.displayName);

      this.seen = new Map();          // msgId -> ts
      this.peers = new Map();         // short -> { short, name, lastHeard, hops }
      this.pendingRelays = new Map(); // msgId -> setTimeout

      this.callbacks = {
        onMessage:  () => {},
        onPeers:    () => {},
        onSelfSent: () => {},
      };

      this.ggwave.onText = (str) => this._onText(str);
      this._sweepTimer = setInterval(() => this._sweep(), SWEEP_INTERVAL_MS);
    }

    set onMessage(cb)  { this.callbacks.onMessage = cb; }
    set onPeers(cb)    { this.callbacks.onPeers = cb; }
    set onSelfSent(cb) { this.callbacks.onSelfSent = cb; }

    async sendChat(text) {
      const msgId = makeMsgId();
      const wire = encode({
        msgId, ttl: DEFAULT_TTL,
        short: this.shortId,
        name: this.displayName,
        text,
      });
      this.seen.set(msgId, Date.now());

      this.callbacks.onSelfSent({
        msgId, from: 'me', text,
        time: this._fmtTime(),
        bytes: text.length,
        hops: 1,
        sender: this.displayName,
        senderShortId: this.shortId,
      });

      try {
        await this.mac.send(wire, { priority: 1 });
      } catch (e) {
        console.error('chat send failed:', e);
      }
    }

    _onText(str) {
      const m = decode(str);
      if (!m) {
        console.log('[chat] non-protocol text dropped:', str.slice(0, 60));
        return;
      }
      // Ignore our own echoes
      if (m.short === this.shortId) return;
      // Dedup; if we already saw it and had a pending relay, cancel it
      if (this.seen.has(m.msgId)) {
        const h = this.pendingRelays.get(m.msgId);
        if (h) { clearTimeout(h); this.pendingRelays.delete(m.msgId); }
        return;
      }
      this.seen.set(m.msgId, Date.now());

      // Update peer table — implicit discovery
      const existing = this.peers.get(m.short);
      const peer = existing || { short: m.short };
      peer.name = m.name || peer.name || 'anon';
      peer.lastHeard = Date.now();
      peer.hops = 1;
      this.peers.set(m.short, peer);
      this._emitPeers();

      // Surface message (skip empty pings)
      if (m.text && m.text.length > 0) {
        this.callbacks.onMessage({
          msgId: m.msgId,
          from: 'them',
          text: m.text,
          time: this._fmtTime(),
          bytes: m.text.length,
          hops: 1,
          sender: peer.name,
          senderShortId: peer.short,
        });
      }

      // Relay if TTL > 0
      if (m.ttl > 0) {
        const wait = rand(RELAY_BACKOFF_MIN_MS, RELAY_BACKOFF_MAX_MS);
        const handle = setTimeout(async () => {
          this.pendingRelays.delete(m.msgId);
          const relay = encode({ ...m, ttl: m.ttl - 1 });
          try { await this.mac.send(relay, { priority: 0 }); } catch (e) {}
        }, wait);
        this.pendingRelays.set(m.msgId, handle);
      }
    }

    _emitPeers() {
      const list = Array.from(this.peers.values())
        .filter(p => p.short !== this.shortId)
        .sort((a, b) => b.lastHeard - a.lastHeard)
        .map(p => ({
          shortId: p.short,
          displayName: p.name,
          hops: p.hops,
          lastHeard: p.lastHeard,
        }));
      this.callbacks.onPeers(list);
    }

    _sweep() {
      const now = Date.now();
      const peerCutoff = now - PEER_TIMEOUT_MS;
      let changed = false;
      for (const [k, v] of this.peers) {
        if (v.lastHeard < peerCutoff) { this.peers.delete(k); changed = true; }
      }
      if (changed) this._emitPeers();

      const seenCutoff = now - SEEN_TTL_MS;
      for (const [k, ts] of this.seen) {
        if (ts < seenCutoff) this.seen.delete(k);
      }
    }

    stop() {
      clearInterval(this._sweepTimer);
    }

    _fmtTime() {
      return new Date().toTimeString().slice(0, 5);
    }
  }

  global.BitchatChat = Chat;
  global.BitchatChatCodec = { encode, decode, makeMsgId, shortIdFromName, VERSION };
})(window);
