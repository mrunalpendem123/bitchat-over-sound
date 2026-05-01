// ggwave-bridge.js — minimal wrapper around ggwave WASM + Web Audio.
// Mirrors upstream examples/ggwave-js/index-tmpl.html exactly.
//
//   await BitchatGgwave.init()        — load WASM, get mic, start listening
//   BitchatGgwave.transmit(string)    — encode string, play via speaker
//   BitchatGgwave.onText = (str)      — called when a chirp decodes successfully
//   BitchatGgwave.onActivity = (s)    — 'idle' | 'rx' | 'tx'
//   BitchatGgwave.isChannelBusy()     — true while recent energy > threshold

(function (global) {
  'use strict';

  let ggwave = null;
  let instance = null;
  let audioCtx = null;
  let micStream = null;
  let mediaStreamSource = null;
  let recorder = null;
  let initialized = false;

  let lastRxAt = 0;
  let txInFlight = false;

  const PROTOCOL_NAME = 'GGWAVE_PROTOCOL_AUDIBLE_FAST';
  const VOLUME = 80;

  const callbacks = { onText: () => {}, onActivity: () => {} };

  function convertTypedArray(src, type) {
    const buffer = new ArrayBuffer(src.byteLength);
    new src.constructor(buffer).set(src);
    return new type(buffer);
  }

  function setActivity(state) {
    if (state === 'rx') lastRxAt = performance.now();
    callbacks.onActivity(state);
  }

  async function init() {
    if (initialized) return;

    if (typeof ggwave_factory !== 'function') {
      throw new Error('ggwave_factory not found — is lib/ggwave.js loaded?');
    }

    ggwave = await ggwave_factory();
    console.log('[ggwave] WASM loaded.');

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    console.log('[ggwave] AudioContext sampleRate=' + audioCtx.sampleRate);

    const params = ggwave.getDefaultParameters();
    params.sampleRateInp = audioCtx.sampleRate;
    params.sampleRateOut = audioCtx.sampleRate;
    instance = ggwave.init(params);

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl:  false,
        noiseSuppression: false,
      },
    });
    mediaStreamSource = audioCtx.createMediaStreamSource(micStream);
    console.log('[ggwave] mic acquired.');

    const bufferSize = 1024;
    recorder = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    recorder.onaudioprocess = (e) => {
      if (txInFlight) return;
      const input = e.inputBuffer.getChannelData(0);

      let energy = 0;
      for (let i = 0; i < input.length; i++) energy += input[i] * input[i];
      energy /= input.length;
      if (energy > 5e-3) lastRxAt = performance.now();

      const samples = convertTypedArray(new Float32Array(input), Int8Array);
      const result = ggwave.decode(instance, samples);
      if (result && result.length > 0) {
        const text = new TextDecoder('utf-8').decode(result);
        console.log('[ggwave] RX text (' + text.length + ' chars):', text);
        setActivity('rx');
        try { callbacks.onText(text); }
        catch (err) { console.error('onText handler threw:', err); }
        setActivity('idle');
      }
    };
    mediaStreamSource.connect(recorder);
    recorder.connect(audioCtx.destination);

    initialized = true;
    console.log('[ggwave] ready. protocol=' + PROTOCOL_NAME);
  }

  async function transmit(text) {
    if (!initialized) throw new Error('ggwave not initialized');
    if (typeof text !== 'string') text = String(text);
    txInFlight = true;
    setActivity('tx');

    const protocolId = ggwave.ProtocolId[PROTOCOL_NAME];
    if (protocolId === undefined) {
      txInFlight = false;
      setActivity('idle');
      throw new Error('unknown ggwave protocol ' + PROTOCOL_NAME);
    }

    let waveform;
    try {
      waveform = ggwave.encode(instance, text, protocolId, VOLUME);
    } catch (err) {
      txInFlight = false;
      setActivity('idle');
      throw err;
    }

    if (recorder) {
      try { mediaStreamSource.disconnect(recorder); } catch (e) {}
    }

    const buf = convertTypedArray(waveform, Float32Array);
    const audioBuffer = audioCtx.createBuffer(1, buf.length, audioCtx.sampleRate);
    audioBuffer.getChannelData(0).set(buf);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);

    console.log('[ggwave] TX text (' + text.length + ' chars), waveform ' +
                waveform.length + ' samples, ~' + (waveform.length / audioCtx.sampleRate).toFixed(2) + 's:', text);

    return new Promise((resolve) => {
      source.onended = () => {
        if (recorder) {
          try { mediaStreamSource.connect(recorder); } catch (e) {}
        }
        txInFlight = false;
        setActivity('idle');
        resolve();
      };
      source.start();
    });
  }

  function isChannelBusy() {
    if (txInFlight) return true;
    return (performance.now() - lastRxAt) < 80;
  }

  global.BitchatGgwave = {
    init,
    transmit,
    isChannelBusy,
    set onText(cb)     { callbacks.onText = cb; },
    set onActivity(cb) { callbacks.onActivity = cb; },
    get onText()       { return callbacks.onText; },
    get onActivity()   { return callbacks.onActivity; },
  };
})(window);
