// bitchat.js — top-level orchestrator. Boots ggwave + MAC + chat.
//
//   await Bitchat.start({ displayName })   — request mic, init ggwave, listen
//   Bitchat.send(text)                     — broadcast a chat message
//   Bitchat.identity                       — { displayName, shortId }
//   Bitchat.onMessage   = (msg) => {}      — incoming chat from a peer
//   Bitchat.onSelfSent  = (msg) => {}      — confirmation of a local send queued
//   Bitchat.onPeers     = (peers) => {}    — peer list changed
//   Bitchat.onActivity  = (state) => {}    — radio state ('idle'|'listening'|'transmitting'|'rx'|'tx')

(function (global) {
  'use strict';

  const callbacks = {
    onMessage:  () => {},
    onSelfSent: () => {},
    onPeers:    () => {},
    onActivity: () => {},
  };

  let mac = null;
  let chat = null;
  let started = false;

  function urlAsName() {
    try {
      const v = new URLSearchParams(location.search).get('as');
      return v ? v.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) : null;
    } catch (e) { return null; }
  }

  async function start({ displayName }) {
    if (started) return Bitchat;

    const name = urlAsName() || displayName || 'anon';
    const shortId = BitchatChatCodec.shortIdFromName(name);

    Bitchat.identity = { displayName: name, shortId };
    console.log('[bitchat] identity', { name, shortId, asParam: urlAsName() });

    BitchatGgwave.onActivity = (s) => callbacks.onActivity(s);
    await BitchatGgwave.init();

    mac = new BitchatMAC(BitchatGgwave);
    mac.onState = (s) => {
      if (s === 'transmitting') callbacks.onActivity('tx');
      else if (s === 'listening' || s === 'backoff') callbacks.onActivity('listening');
      else callbacks.onActivity('idle');
    };

    chat = new BitchatChat({ ggwave: BitchatGgwave, mac, displayName: name });
    chat.onMessage  = (m) => callbacks.onMessage(m);
    chat.onSelfSent = (m) => callbacks.onSelfSent(m);
    chat.onPeers    = (p) => callbacks.onPeers(p);

    started = true;
    return Bitchat;
  }

  async function send(text) {
    if (!started) throw new Error('Bitchat not started');
    if (!text || !text.trim()) return;
    await chat.sendChat(text.trim());
  }

  function reset() {
    try { localStorage.removeItem('bitchat.user'); } catch (e) {}
    location.reload();
  }

  const Bitchat = {
    start, send, reset,
    identity: null,
    set onMessage(cb)  { callbacks.onMessage = cb; },
    set onSelfSent(cb) { callbacks.onSelfSent = cb; },
    set onPeers(cb)    { callbacks.onPeers = cb; },
    set onActivity(cb) { callbacks.onActivity = cb; },
    get isStarted()    { return started; },
  };

  global.Bitchat = Bitchat;
})(window);
