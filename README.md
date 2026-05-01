# bitchat over sound

Acoustic mesh chat in the browser. No Wi-Fi, no Bluetooth — phones and laptops talk to each other by chirping audible tones at ~4.2 kHz over ggwave.

**Live:** https://bitchat-over-sound.vercel.app/

## How it works

- **Transport:** [ggwave](https://github.com/ggerganov/ggwave) (WASM) encodes bytes into audible chirps and decodes them from the mic. ~16 B/s, audible-fast protocol.
- **Identity & signing:** Ed25519 keypair per device via [TweetNaCl](https://github.com/dchest/tweetnacl-js). `shortId` = first 16 bits of the pubkey.
- **Packet:** 14-byte header + payload + 64-byte signature. Types: beacon, message, ack. TTL-based relay with random backoff so neighbors don't all rebroadcast at once.
- **Mesh:** every node beacons identity every 45 s, builds a peer table, dedupes by `msg_id`, and relays for others within TTL.
- **MAC:** simple energy-based carrier sense — wait for the channel to go idle before transmitting.

## Run it locally

It's a static page; just serve the directory.

```sh
python3 -m http.server 8080
open http://localhost:8080/bitchat.html
```

Mic access requires a secure context. `localhost` is exempt; over LAN you need HTTPS (use ngrok, cloudflared, or mkcert).

## Layout

```
bitchat.html              entry — loads React, Babel-standalone, ggwave, the protocol stack
app.jsx / main.jsx        chat UI
onboarding.jsx            display-name + mic-permission flow
lib/                      ggwave.js (WASM glue), nacl
protocol/
  ggwave-bridge.js        Web Audio <-> ggwave
  mac.js                  carrier-sense / channel busy
  packet.js               binary framing + Ed25519 sign/verify
  mesh.js                 peer table, beacons, relay
  chat.js                 send/receive chat messages
  identity.js             keypair + display name
  bitchat.js              top-level orchestrator
```

Built by Mrunal Pendem.
