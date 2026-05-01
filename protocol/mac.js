// mac.js — CSMA-style MAC layer.
// Listens before talking, backs off on busy channel.
// Wraps BitchatGgwave so the rest of the stack just calls mac.send(bytes).

(function (global) {
  'use strict';

  const CARRIER_SENSE_MS = 100;
  const BACKOFF_MIN_MS   = 300;
  const BACKOFF_MAX_MS   = 2500;
  const POLL_MS          = 30;
  const MAX_ATTEMPTS     = 30;   // a single ggwave chirp can run >30s

  function rand(a, b) { return a + Math.random() * (b - a); }
  function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

  class AcousticMAC {
    constructor(ggwave) {
      this.ggwave = ggwave;
      this.queue = [];          // [{bytes, resolve, reject, priority}]
      this.running = false;
      this.callbacks = { onState: () => {} };
    }

    send(payload, { priority = 0 } = {}) {
      return new Promise((resolve, reject) => {
        const item = { payload, resolve, reject, priority };
        // Higher priority first
        let i = 0;
        while (i < this.queue.length && this.queue[i].priority >= priority) i++;
        this.queue.splice(i, 0, item);
        this._kick();
      });
    }

    _setState(s) { this.callbacks.onState(s); }

    set onState(cb) { this.callbacks.onState = cb; }

    async _kick() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.queue.length > 0) {
          const item = this.queue.shift();
          await this._sendOne(item);
        }
      } finally {
        this.running = false;
        this._setState('idle');
      }
    }

    async _sendOne(item) {
      const { payload, resolve, reject } = item;
      let attempt = 0;
      const maxAttempts = MAX_ATTEMPTS;
      while (attempt < maxAttempts) {
        // 1. Listen for CARRIER_SENSE_MS to see if channel is clear
        this._setState('listening');
        const start = performance.now();
        let busy = false;
        while (performance.now() - start < CARRIER_SENSE_MS) {
          if (this.ggwave.isChannelBusy()) { busy = true; break; }
          await sleep(POLL_MS);
        }
        if (busy) {
          attempt++;
          this._setState('backoff');
          // Cap exponential growth so we don't sleep forever on a long chirp.
          const factor = Math.pow(1.4, Math.min(attempt - 1, 5));
          const wait = rand(BACKOFF_MIN_MS, BACKOFF_MAX_MS) * factor;
          await sleep(wait);
          continue;
        }
        // 2. Channel quiet — transmit
        this._setState('transmitting');
        try {
          await this.ggwave.transmit(payload);
          resolve();
          return;
        } catch (err) {
          reject(err);
          return;
        }
      }
      // Gave up
      reject(new Error('CSMA gave up after ' + maxAttempts + ' attempts'));
    }
  }

  global.BitchatMAC = AcousticMAC;
})(window);
