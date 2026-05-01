// identity.js — Ed25519 keypair, short ID derivation, persistence.
// Depends on: nacl (TweetNaCl), nacl.util.

(function (global) {
  'use strict';

  const STORAGE_KEY_BASE = 'bitchat.identity.v1';

  // Per-window identity. Open ?as=alice in one tab and ?as=bob in another
  // and they get distinct keypairs even though they share localStorage.
  function urlAsName() {
    try {
      const v = new URLSearchParams(location.search).get('as');
      return v ? v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) : null;
    } catch (e) { return null; }
  }
  function storageKey() {
    const a = urlAsName();
    return a ? `${STORAGE_KEY_BASE}.${a}` : STORAGE_KEY_BASE;
  }

  function bytesToHex(b) {
    return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  }

  function hexToBytes(h) {
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  // Short ID = first 4 bytes of the public key, formatted "XX·XX"
  function shortIdFromPubkey(pub) {
    const a = pub[0].toString(16).padStart(2, '0');
    const b = pub[1].toString(16).padStart(2, '0');
    const c = pub[2].toString(16).padStart(2, '0');
    const d = pub[3].toString(16).padStart(2, '0');
    return (a + b + '·' + c + d).toUpperCase();
  }

  // 16-bit numeric peer ID for compact packet headers
  function peerIdFromPubkey(pub) {
    return (pub[0] << 8) | pub[1];
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return {
        publicKey: hexToBytes(obj.pub),
        secretKey: hexToBytes(obj.sec),
        displayName: obj.displayName || 'anon',
        createdAt: obj.createdAt,
      };
    } catch (e) {
      return null;
    }
  }

  function save(identity) {
    const obj = {
      pub: bytesToHex(identity.publicKey),
      sec: bytesToHex(identity.secretKey),
      displayName: identity.displayName,
      createdAt: identity.createdAt,
    };
    localStorage.setItem(storageKey(), JSON.stringify(obj));
  }

  function generate(displayName) {
    const kp = nacl.sign.keyPair();
    return {
      publicKey: kp.publicKey,
      secretKey: kp.secretKey,
      displayName: displayName || 'anon',
      createdAt: Date.now(),
    };
  }

  function getOrCreate(displayName) {
    const preferred = urlAsName() || displayName;
    let id = load();
    if (!id) {
      id = generate(preferred);
      save(id);
    } else if (preferred && id.displayName !== preferred) {
      id.displayName = preferred;
      save(id);
    }
    return id;
  }

  function reset() {
    localStorage.removeItem(storageKey());
  }

  global.BitchatIdentity = {
    generate, load, save, getOrCreate, reset,
    shortIdFromPubkey, peerIdFromPubkey,
    bytesToHex, hexToBytes,
    urlAsName,
  };
})(window);
