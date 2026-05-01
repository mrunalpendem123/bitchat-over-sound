// app.jsx — bitchat over sound. 1:1 chat web prototype.
// Sound IS the transport. The UI feels every chirp.

const { useState, useEffect, useRef, useMemo, useCallback } = React;

// ─── TWEAKABLE DEFAULTS ──────────────────────────────────────────────
const TWEAKS = /*EDITMODE-BEGIN*/{
  "tone": "warm",
  "accent": "#5E8BFF",
  "dark": false,
  "soundIntensity": "central",
  "showDebug": false
}/*EDITMODE-END*/;

// ─── TOKENS ──────────────────────────────────────────────────────────
const tones = {
  clean: {
    bgLight: '#F6F7F9', bgDark: '#0E1116',
    cardLight: '#FFFFFF', cardDark: '#161A21',
    textLight: '#0B0F14', textDark: '#E8ECF2',
    dimLight: '#6A7380', dimDark: '#8691A0',
    borderLight: 'rgba(11,15,20,0.08)', borderDark: 'rgba(232,236,242,0.08)',
    fontBody: '"Inter Tight", "SF Pro Display", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
    radius: 16,
    myBubbleLight: null, // uses accent
    theirBubbleLight: '#EEF1F6',
    theirBubbleDark: '#1E242E',
  },
  warm: {
    bgLight: '#F4EFE6', bgDark: '#1A1510',
    cardLight: '#FFFBF4', cardDark: '#221C14',
    textLight: '#1A1510', textDark: '#F4EFE6',
    dimLight: '#8A7D6B', dimDark: '#A89780',
    borderLight: 'rgba(26,21,16,0.08)', borderDark: 'rgba(244,239,230,0.08)',
    fontBody: '"Instrument Sans", "Inter Tight", system-ui, sans-serif',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
    radius: 22,
    myBubbleLight: null,
    theirBubbleLight: '#EDE5D6',
    theirBubbleDark: '#2A2319',
  },
  terminal: {
    bgLight: '#ECEEE8', bgDark: '#06080A',
    cardLight: '#FFFFFF', cardDark: '#0B0E11',
    textLight: '#0A0C0E', textDark: '#CFF7D0',
    dimLight: '#5B6268', dimDark: '#5E8A66',
    borderLight: 'rgba(10,12,14,0.12)', borderDark: 'rgba(90,250,120,0.14)',
    fontBody: '"JetBrains Mono", ui-monospace, monospace',
    fontMono: '"JetBrains Mono", ui-monospace, monospace',
    radius: 4,
    myBubbleLight: null,
    theirBubbleLight: '#E6EBE4',
    theirBubbleDark: '#0F1512',
  },
};

function useTheme() {
  const [t, setT] = useState(TWEAKS);
  useEffect(() => {
    const handle = (e) => {
      if (e.data?.type === '__activate_edit_mode') window.__setTweaksOpen?.(true);
      if (e.data?.type === '__deactivate_edit_mode') window.__setTweaksOpen?.(false);
    };
    window.addEventListener('message', handle);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handle);
  }, []);
  const tone = tones[t.tone] || tones.warm;
  const dark = t.dark;
  return {
    ...t,
    tone,
    c: {
      bg: dark ? tone.bgDark : tone.bgLight,
      card: dark ? tone.cardDark : tone.cardLight,
      text: dark ? tone.textDark : tone.textLight,
      dim: dark ? tone.dimDark : tone.dimLight,
      border: dark ? tone.borderDark : tone.borderLight,
      theirs: dark ? tone.theirBubbleDark : tone.theirBubbleLight,
      mine: t.accent,
      accent: t.accent,
    },
    setTweak: (k, v) => {
      setT((prev) => {
        const next = { ...prev, [k]: v };
        window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [k]: v } }, '*');
        return next;
      });
    },
  };
}

// ─── AUDIO CHIRP SIMULATION ──────────────────────────────────────────
// We don't run ggwave here; we simulate its feel with WebAudio FM chirps
// and timing derived from message length.
function useChirp() {
  const ctxRef = useRef(null);
  const getCtx = () => {
    if (!ctxRef.current) {
      try { ctxRef.current = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    return ctxRef.current;
  };
  const chirp = useCallback((duration = 0.9, dir = 'up', volume = 0.04) => {
    const ctx = getCtx(); if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // ggwave-ish: stepped tones ~ 1.5kHz - 4.5kHz
    const steps = Math.max(4, Math.floor(duration * 12));
    const stepDur = duration / steps;
    for (let i = 0; i < steps; i++) {
      const r = Math.random();
      const freq = 1500 + r * 3000;
      osc.frequency.setValueAtTime(freq, now + i * stepDur);
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.03);
    gain.gain.linearRampToValueAtTime(volume, now + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now); osc.stop(now + duration + 0.05);
  }, []);
  return chirp;
}

// ─── WAVEFORM BAR (live) ─────────────────────────────────────────────
// Animated stepped bars. When active, bars jitter to feel like transmission.
function Waveform({ active, progress = 0, color, dim, bars = 48, height = 40, intense = 'central' }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf; const loop = () => { setTick(t => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  const seed = useMemo(() => Array.from({ length: bars }, (_, i) => Math.sin(i * 1.7) * 0.5 + 0.5), [bars]);
  const amp = intense === 'subtle' ? 0.35 : intense === 'extreme' ? 1 : 0.7;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height, width: '100%' }}>
      {seed.map((base, i) => {
        const p = progress;
        const reached = i / bars <= p;
        let h;
        if (active) {
          // sparkling amplitude
          const noise = Math.sin(tick * 0.3 + i * 0.6) * 0.5 + 0.5;
          const peak = Math.sin(tick * 0.1 - i * 0.2) * 0.5 + 0.5;
          h = (0.25 + base * 0.3 + noise * 0.35 * amp + peak * 0.3 * amp);
        } else {
          h = 0.2 + base * 0.3;
        }
        h = Math.max(0.1, Math.min(1, h));
        return (
          <div key={i} style={{
            flex: 1, height: `${h * 100}%`, borderRadius: 2,
            background: reached || !progress ? color : dim,
            opacity: active ? 1 : 0.5,
            transition: 'background 120ms',
          }} />
        );
      })}
    </div>
  );
}

// ─── SIGNAL DOT (peer signal strength) ───────────────────────────────
function Signal({ strength = 3, color, dim, size = 14 }) {
  // 1..4 bars
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: size }}>
      {[1,2,3,4].map(i => (
        <div key={i} style={{
          width: 3, height: `${25 * i}%`,
          background: i <= strength ? color : dim,
          opacity: i <= strength ? 1 : 0.3,
          borderRadius: 1,
        }} />
      ))}
    </div>
  );
}

// ─── CHIRP RING (sending pulse) ──────────────────────────────────────
function ChirpRings({ active, color }) {
  return (
    <div style={{ position: 'relative', width: 56, height: 56, pointerEvents: 'none' }}>
      {active && [0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: `2px solid ${color}`,
          animation: `chirpRing 1.2s ease-out ${i * 0.35}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── MESSAGE BUBBLE ──────────────────────────────────────────────────
function Bubble({ msg, theme, intense }) {
  const { c, tone } = theme;
  const mine = msg.from === 'me';
  const bg = mine ? c.mine : c.theirs;
  const fg = mine ? '#fff' : c.text;
  const r = tone.radius;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: mine ? 'flex-end' : 'flex-start',
      gap: 4, maxWidth: '78%',
      alignSelf: mine ? 'flex-end' : 'flex-start',
    }}>
      {!mine && msg.sender && (
        <div style={{
          fontSize: 10.5, color: c.dim, fontFamily: tone.fontMono,
          letterSpacing: 0.5, padding: '0 4px',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ color: c.text, fontWeight: 600 }}>{msg.sender}</span>
          {msg.senderShortId && (
            <span style={{ opacity: 0.7 }}>· {msg.senderShortId}</span>
          )}
        </div>
      )}
      <div style={{
        background: bg,
        color: fg,
        padding: msg.transmitting ? '10px 14px 12px' : '10px 14px',
        borderRadius: r,
        borderTopRightRadius: mine ? 6 : r,
        borderTopLeftRadius: mine ? r : 6,
        fontSize: 15, lineHeight: 1.42,
        fontFamily: tone.fontBody,
        wordBreak: 'break-word',
        boxShadow: mine ? `0 6px 20px ${c.mine}33` : 'none',
        transition: 'all 200ms',
        animation: msg.justArrived ? 'bubbleIn 400ms cubic-bezier(.2,.8,.3,1.2)' : 'none',
      }}>
        {msg.text}
        {msg.transmitting && (
          <div style={{ marginTop: 8, height: 18 }}>
            <Waveform
              active
              progress={msg.progress}
              color={mine ? 'rgba(255,255,255,0.9)' : c.accent}
              dim={mine ? 'rgba(255,255,255,0.3)' : c.dim}
              bars={32} height={18} intense={intense}
            />
          </div>
        )}
      </div>
      <div style={{
        fontSize: 10.5, color: c.dim, fontFamily: tone.fontMono,
        letterSpacing: 0.4, display: 'flex', gap: 6, alignItems: 'center',
      }}>
        {msg.transmitting ? (
          <>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: c.accent, animation: 'pulseDot 0.8s infinite' }}/>
            TRANSMITTING · {Math.round((msg.progress || 0) * 100)}%
          </>
        ) : msg.receiving ? (
          <>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
              background: c.accent, animation: 'pulseDot 0.8s infinite' }}/>
            DECODING · {Math.round((msg.progress || 0) * 100)}%
          </>
        ) : (
          <>
            {msg.time} · {msg.bytes}B · {msg.hops || 1}hop
          </>
        )}
      </div>
    </div>
  );
}

// ─── CHANNEL HEADER (group chat) ────────────────────────────────────
function ChannelHeader({ theme, channel, memberCount, activity, liveChirp }) {
  const { c, tone } = theme;
  const status = (() => {
    switch (activity) {
      case 'tx':         return { color: '#FF7A3D', label: 'TRANSMITTING' };
      case 'rx':         return { color: '#5E8BFF', label: 'RECEIVING' };
      case 'listening':  return { color: '#FFD60A', label: 'LISTENING' };
      default:           return { color: '#30D158', label: 'IDLE · LIVE' };
    }
  })();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '18px 22px',
      borderBottom: `1px solid ${c.border}`,
      background: c.card,
      position: 'relative',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12,
        background: `linear-gradient(135deg, ${c.accent}, ${c.accent}88)`,
        display: 'grid', placeItems: 'center',
        color: '#fff', fontWeight: 700, fontFamily: tone.fontMono,
        fontSize: 14, letterSpacing: 0.5,
      }}>#</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: tone.fontBody, fontSize: 16, fontWeight: 600, color: c.text,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {channel}
          <span style={{
            fontSize: 9.5, fontFamily: tone.fontMono, letterSpacing: 0.5,
            padding: '2px 6px', borderRadius: 4,
            background: c.border, color: c.dim,
          }}>
            {memberCount} {memberCount === 1 ? 'NODE' : 'NODES'}
          </span>
        </div>
        <div style={{
          fontFamily: tone.fontMono, fontSize: 11, color: c.dim,
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 2,
          letterSpacing: 0.3,
        }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: status.color,
            animation: liveChirp ? 'pulseDot 0.6s infinite' : 'pulseDot 1.6s infinite',
          }}/>
          {status.label} · ggwave audible-fast
        </div>
      </div>
      <div style={{ position: 'relative', width: 40, height: 40, display:'grid', placeItems:'center' }}>
        <ChirpRings active={liveChirp} color={c.accent} />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute' }}>
          <path d="M3 12c4-6 14-6 18 0M6 14c3-3 9-3 12 0M9 16c1.5-1.2 4.5-1.2 6 0"
                stroke={liveChirp ? c.accent : c.dim} strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  );
}

// ─── HEADER ──────────────────────────────────────────────────────────
function Header({ theme, peer, liveChirp }) {
  const { c, tone } = theme;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '18px 22px',
      borderBottom: `1px solid ${c.border}`,
      background: c.card,
      position: 'relative',
    }}>
      <div style={{ position: 'relative' }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: `linear-gradient(135deg, ${c.accent}, ${c.accent}88)`,
          display: 'grid', placeItems: 'center',
          color: '#fff', fontWeight: 600, fontFamily: tone.fontBody,
          fontSize: 15,
        }}>
          {peer.avatar}
        </div>
        <div style={{
          position: 'absolute', bottom: -2, right: -2,
          width: 14, height: 14, borderRadius: '50%',
          background: '#30D158', border: `2px solid ${c.card}`,
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: tone.fontBody, fontSize: 16, fontWeight: 600, color: c.text,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {peer.name}
          <span style={{
            fontSize: 9.5, fontFamily: tone.fontMono, letterSpacing: 0.5,
            padding: '2px 6px', borderRadius: 4,
            background: c.border, color: c.dim,
          }}>
            {peer.id}
          </span>
        </div>
        <div style={{
          fontFamily: tone.fontMono, fontSize: 11, color: c.dim,
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 2,
          letterSpacing: 0.3,
        }}>
          <Signal strength={peer.signal} color={c.accent} dim={c.dim} size={10} />
          {peer.distance}m · {peer.signal * 25}% signal · via {peer.via}
        </div>
      </div>
      <div style={{ position: 'relative', width: 40, height: 40, display:'grid', placeItems:'center' }}>
        <ChirpRings active={liveChirp} color={c.accent} />
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ position: 'absolute' }}>
          <path d="M8 5v14l11-7-11-7z" fill={liveChirp ? c.accent : c.dim}/>
        </svg>
      </div>
    </div>
  );
}

// ─── MESH STATUS RAIL ───────────────────────────────────────────────
function MeshRail({ theme, peers, self }) {
  const { c, tone } = theme;
  return (
    <div style={{
      padding: '12px 22px', borderBottom: `1px solid ${c.border}`,
      background: c.bg, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontFamily: tone.fontMono, fontSize: 10.5, color: c.dim, letterSpacing: 0.6,
      }}>
        <span>MESH · 4.2kHz ACOUSTIC · {peers.length + 1} NODES</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#30D158',
            animation: 'pulseDot 1.4s infinite' }}/>
          LISTENING
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
        <PeerChip theme={theme} peer={self} isSelf />
        {peers.map(p => <PeerChip key={p.id} theme={theme} peer={p} />)}
      </div>
    </div>
  );
}

function PeerChip({ theme, peer, isSelf }) {
  const { c, tone } = theme;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 12px 6px 6px',
      background: c.card, borderRadius: 999,
      border: `1px solid ${c.border}`,
      flexShrink: 0,
      fontFamily: tone.fontMono, fontSize: 11,
    }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%',
        background: isSelf
          ? `repeating-linear-gradient(45deg, ${c.accent}, ${c.accent} 2px, ${c.accent}88 2px, ${c.accent}88 4px)`
          : `linear-gradient(135deg, ${c.accent}, ${c.accent}88)`,
        display: 'grid', placeItems: 'center',
        color: '#fff', fontWeight: 600, fontSize: 10, fontFamily: tone.fontBody,
      }}>
        {peer.avatar}
      </div>
      <span style={{ color: c.text, fontWeight: 500 }}>{isSelf ? 'you' : peer.name.toLowerCase()}</span>
      {!isSelf && <Signal strength={peer.signal} color={c.accent} dim={c.dim} size={10} />}
      {isSelf && <span style={{ color: c.dim }}>· host</span>}
    </div>
  );
}

// ─── COMPOSER ────────────────────────────────────────────────────────
function Composer({ theme, onSend, transmitting, intense }) {
  const { c, tone } = theme;
  const [text, setText] = useState('');
  const submit = () => {
    const v = text.trim(); if (!v || transmitting) return;
    onSend(v); setText('');
  };
  return (
    <div style={{
      padding: '14px 22px 18px',
      borderTop: `1px solid ${c.border}`,
      background: c.card,
    }}>
      {transmitting && (
        <div style={{
          padding: '10px 14px', marginBottom: 10,
          background: c.bg, borderRadius: tone.radius,
          border: `1px solid ${c.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{ flex: 1, height: 24 }}>
            <Waveform active color={c.accent} dim={c.dim} bars={60} height={24} intense={intense} />
          </div>
          <span style={{ fontFamily: tone.fontMono, fontSize: 10.5, color: c.dim, letterSpacing: 0.5 }}>
            CHIRPING…
          </span>
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 10,
        background: c.bg, borderRadius: tone.radius + 2,
        padding: '4px 4px 4px 16px',
        border: `1px solid ${c.border}`,
      }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder={transmitting ? 'transmitting…' : 'type to chirp →'}
          disabled={transmitting}
          style={{
            flex: 1, border: 'none', outline: 'none', background: 'transparent',
            fontFamily: tone.fontBody, fontSize: 15, color: c.text,
            padding: '12px 0',
          }}
        />
        <button onClick={submit} disabled={transmitting || !text.trim()} style={{
          height: 40, padding: '0 18px', border: 'none',
          borderRadius: tone.radius - 2,
          background: text.trim() && !transmitting ? c.accent : c.border,
          color: text.trim() && !transmitting ? '#fff' : c.dim,
          fontFamily: tone.fontBody, fontSize: 14, fontWeight: 600,
          cursor: text.trim() && !transmitting ? 'pointer' : 'default',
          display: 'flex', alignItems: 'center', gap: 8,
          transition: 'all 200ms',
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 3v18M12 3l-4 4M12 3l4 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              transform="rotate(90 12 12)"/>
          </svg>
          Chirp
        </button>
      </div>
      <div style={{
        marginTop: 10, fontFamily: tone.fontMono, fontSize: 10, color: c.dim,
        letterSpacing: 0.5, display: 'flex', justifyContent: 'space-between',
      }}>
        <span>ggwave · normal · 16 bytes/s</span>
        <span>⌘ enter to send · no internet required</span>
      </div>
    </div>
  );
}

Object.assign(window, { Bubble, Header, ChannelHeader, MeshRail, Composer, Waveform, ChirpRings, Signal, useChirp, useTheme, tones });
