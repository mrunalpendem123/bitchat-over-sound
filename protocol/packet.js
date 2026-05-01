// packet.js — Binary packet format for bitchat-over-sound.
//
// Layout (header is 14 bytes, then variable payload, then 64-byte signature):
//
//   [0]      version_type   (upper 4 = version=1, lower 4 = type)
//   [1-4]    msg_id         (random uint32, big-endian)
//   [5-6]    src_id         (uint16, derived from sender pubkey)
//   [7-8]    dst_id         (uint16, 0xFFFF = broadcast)
//   [9]      ttl            (starts at 5)
//   [10]     hop_count      (starts at 0, incremented on relay)
//   [11-12]  payload_len    (uint16, big-endian)
//   [13]     reserved       (0)
//   [14..N]  payload        (text bytes for chat, or beacon body)
//   [N+1..]  signature      (64-byte Ed25519 of [header+payload])
//
// To keep ggwave packets small we only sign messages, beacons, and broadcasts.
// ACKs are unsigned — they are tiny and replay-resistant via msg_id.

(function (global) {
  'use strict';

  const VERSION = 1;

  const TYPE = {
    MESSAGE:   0x0,  // group/broadcast chat (signed)
    BEACON:    0x1,  // discovery (signed, carries display name + pubkey)
    ACK:       0x2,  // ack of a previously seen msg_id (unsigned)
    KEYANN:    0x3,  // pubkey announcement, longer payload
  };

  const BROADCAST = 0xFFFF;
  const HEADER_LEN = 14;
  const SIG_LEN = 64;

  function makeMsgId() {
    return Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
  }

  // Beacons and ACKs ride without an Ed25519 sig: a beacon claiming a pubkey
  // proves nothing on its own, but messages signed by that key are still
  // verified, so a forged beacon at worst pollutes a peer table entry.
  // This keeps beacon packets under ggwave's ~140-byte (b64) ceiling.
  function isUnsigned(type) {
    return type === TYPE.ACK || type === TYPE.BEACON;
  }

  // Encode a packet (header + payload). Caller appends signature.
  function encodeUnsigned({ type, msgId, srcId, dstId, ttl, hopCount, payload }) {
    const payloadBytes = (typeof payload === 'string')
      ? new TextEncoder().encode(payload)
      : (payload || new Uint8Array(0));

    const buf = new Uint8Array(HEADER_LEN + payloadBytes.length);
    buf[0] = (VERSION << 4) | (type & 0x0F);
    buf[1] = (msgId >>> 24) & 0xFF;
    buf[2] = (msgId >>> 16) & 0xFF;
    buf[3] = (msgId >>> 8) & 0xFF;
    buf[4] = msgId & 0xFF;
    buf[5] = (srcId >>> 8) & 0xFF;
    buf[6] = srcId & 0xFF;
    buf[7] = (dstId >>> 8) & 0xFF;
    buf[8] = dstId & 0xFF;
    buf[9] = ttl & 0xFF;
    buf[10] = hopCount & 0xFF;
    buf[11] = (payloadBytes.length >>> 8) & 0xFF;
    buf[12] = payloadBytes.length & 0xFF;
    buf[13] = 0;
    buf.set(payloadBytes, HEADER_LEN);
    return buf;
  }

  // Sign and append the signature.
  function encodeAndSign(fields, secretKey) {
    const unsigned = encodeUnsigned(fields);
    const sig = nacl.sign.detached(unsigned, secretKey);
    const out = new Uint8Array(unsigned.length + SIG_LEN);
    out.set(unsigned, 0);
    out.set(sig, unsigned.length);
    return out;
  }

  // Decode raw bytes into a packet object. Returns null on malformed.
  // The caller is responsible for sig verification (needs sender pubkey lookup).
  function decode(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    if (bytes.length < HEADER_LEN) return null;
    const version = (bytes[0] >> 4) & 0x0F;
    const type = bytes[0] & 0x0F;
    if (version !== VERSION) return null;
    const msgId = (bytes[1] << 24 | bytes[2] << 16 | bytes[3] << 8 | bytes[4]) >>> 0;
    const srcId = (bytes[5] << 8) | bytes[6];
    const dstId = (bytes[7] << 8) | bytes[8];
    const ttl = bytes[9];
    const hopCount = bytes[10];
    const payloadLen = (bytes[11] << 8) | bytes[12];

    const unsigned = isUnsigned(type);
    const expectedTotal = HEADER_LEN + payloadLen + (unsigned ? 0 : SIG_LEN);
    if (bytes.length < expectedTotal) return null;

    const payload = bytes.slice(HEADER_LEN, HEADER_LEN + payloadLen);
    const signedBlob = bytes.slice(0, HEADER_LEN + payloadLen);
    const signature = unsigned ? null : bytes.slice(HEADER_LEN + payloadLen, HEADER_LEN + payloadLen + SIG_LEN);

    return {
      version, type, msgId, srcId, dstId, ttl, hopCount,
      payload, signedBlob, signature, raw: bytes,
    };
  }

  // Verify a decoded packet's signature using the provided pubkey.
  function verify(pkt, publicKey) {
    if (isUnsigned(pkt.type)) return true;
    if (!pkt.signature) return false;
    try {
      return nacl.sign.detached.verify(pkt.signedBlob, pkt.signature, publicKey);
    } catch (e) {
      return false;
    }
  }

  // Re-encode a packet with decremented TTL and incremented hop count, for relay.
  // Reuses the original signature (signature is over header excluding ttl/hop... but here
  // we DO include ttl/hop in the signed bytes, so we'd need to re-sign, which we can't
  // because we don't have the source's secret key. Solution: signature covers the
  // whole header EXCEPT ttl and hop_count — see signedBlobForSig).
  //
  // For simplicity in v1, we sign the *original* header where ttl/hop_count are zeroed
  // out before signing. Then a relayer can change those fields and the signature still
  // verifies if the verifier also zeroes them before checking.
  function buildRelay(pkt) {
    const newTtl = Math.max(0, pkt.ttl - 1);
    const newHop = (pkt.hopCount + 1) & 0xFF;
    // Reconstruct: keep payload + signature unchanged, only swap ttl/hop bytes.
    const out = new Uint8Array(pkt.raw.length);
    out.set(pkt.raw, 0);
    out[9] = newTtl;
    out[10] = newHop;
    return out;
  }

  // Helper: returns the bytes that should be signed (header with ttl/hop zeroed + payload).
  // Both signer and verifier must use this same canonical form.
  function canonicalSignedBytes(pktOrFields) {
    let bytes;
    if (pktOrFields.signedBlob) {
      bytes = new Uint8Array(pktOrFields.signedBlob);
    } else {
      bytes = encodeUnsigned(pktOrFields);
    }
    bytes[9] = 0;   // ttl
    bytes[10] = 0;  // hop
    return bytes;
  }

  function encodeAndSignCanonical(fields, secretKey) {
    const unsigned = encodeUnsigned(fields);
    if (isUnsigned(fields.type)) return unsigned;
    const canon = new Uint8Array(unsigned);
    const realTtl = canon[9];
    const realHop = canon[10];
    canon[9] = 0; canon[10] = 0;
    const sig = nacl.sign.detached(canon, secretKey);
    const out = new Uint8Array(unsigned.length + SIG_LEN);
    out.set(unsigned, 0);
    out.set(sig, unsigned.length);
    out[9] = realTtl;
    out[10] = realHop;
    return out;
  }

  function verifyCanonical(pkt, publicKey) {
    if (isUnsigned(pkt.type)) return true;
    if (!pkt.signature) return false;
    const canon = canonicalSignedBytes(pkt);
    try {
      return nacl.sign.detached.verify(canon, pkt.signature, publicKey);
    } catch (e) {
      return false;
    }
  }

  // Beacon payload format: [pubkey (32 bytes)][display_name (utf8)]
  function encodeBeaconPayload(publicKey, displayName) {
    const nameBytes = new TextEncoder().encode(displayName.slice(0, 24));
    const out = new Uint8Array(32 + nameBytes.length);
    out.set(publicKey, 0);
    out.set(nameBytes, 32);
    return out;
  }

  function decodeBeaconPayload(payload) {
    if (payload.length < 32) return null;
    const publicKey = payload.slice(0, 32);
    const displayName = new TextDecoder().decode(payload.slice(32));
    return { publicKey, displayName };
  }

  global.BitchatPacket = {
    VERSION, TYPE, BROADCAST, HEADER_LEN, SIG_LEN,
    makeMsgId,
    encodeAndSign: encodeAndSignCanonical,
    decode,
    verify: verifyCanonical,
    buildRelay,
    encodeBeaconPayload, decodeBeaconPayload,
  };
})(window);
