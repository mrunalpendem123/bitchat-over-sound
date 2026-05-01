// crypto.js — Ed25519 sign / verify wrappers + lookup of pubkeys by short id.
// Depends on: nacl (TweetNaCl).

(function (global) {
  'use strict';

  // Sign a payload. Returns 64-byte detached signature.
  function sign(payload, secretKey) {
    return nacl.sign.detached(payload, secretKey);
  }

  // Verify signature. Returns boolean.
  function verify(payload, signature, publicKey) {
    try {
      return nacl.sign.detached.verify(payload, signature, publicKey);
    } catch (e) {
      return false;
    }
  }

  global.BitchatCrypto = { sign, verify };
})(window);
