// onboarding.jsx — first-run: explain web-only acoustic mesh, capture name, enable mic

const { useState: useStateO, useEffect: useEffectO, useRef: useRefO } = React;

function Onboarding({ theme, onDone }) {
  const { c, tone } = theme;
  const [step, setStep] = useStateO(0); // 0 intro, 1 name, 2 mic
  const [name, setName] = useStateO('');
  const [micState, setMicState] = useStateO('idle'); // idle | asking | granted | denied
  const inputRef = useRefO(null);

  useEffectO(() => {
    if (step === 1) setTimeout(() => inputRef.current?.focus(), 300);
  }, [step]);

  const next = () => setStep(s => s + 1);
  const finish = () => onDone({ name: name.trim() || 'anon', micState });

  const askMic = async () => {
    setMicState('asking');
    try {
      // CRITICAL: this must run inside the click handler so the browser
      // accepts AudioContext.resume() as a user-gesture event.
      // Bitchat.start() creates the AudioContext, requests the mic, and
      // initializes ggwave — all in one call — so it counts as one gesture.
      const displayName = (name || '').trim() || 'anon';
      if (window.Bitchat && !window.Bitchat.isStarted) {
        await window.Bitchat.start({ displayName });
      }
      setMicState('granted');
      setTimeout(finish, 600);
    } catch (e) {
      console.error('mic / protocol boot failed:', e);
      setMicState('denied');
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: c.bg,
      display: 'flex', flexDirection: 'column',
      zIndex: 20,
      fontFamily: tone.fontBody,
      animation: 'fadeIn 400ms ease',
    }}>
      {/* top meta */}
      <div style={{
        padding: '22px 22px 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontFamily: tone.fontMono, fontSize: 10, color: c.dim, letterSpacing: 0.6,
      }}>
        <span>BITCHAT · v0.1 · WEB PROTOTYPE</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {[0,1,2].map(i => (
            <span key={i} style={{
              width: i === step ? 18 : 6, height: 6,
              borderRadius: 3,
              background: i <= step ? c.accent : c.border,
              transition: 'width 300ms, background 300ms',
            }}/>
          ))}
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '40px 28px 28px' }}>
        {step === 0 && <IntroStep theme={theme} onNext={next} />}
        {step === 1 && <NameStep theme={theme} name={name} setName={setName} onNext={next} inputRef={inputRef} />}
        {step === 2 && <MicStep theme={theme} micState={micState} onAsk={askMic} onSkip={finish} />}
      </div>

      <div style={{
        padding: '14px 22px', borderTop: `1px solid ${c.border}`,
        fontFamily: tone.fontMono, fontSize: 10, color: c.dim,
        letterSpacing: 0.5, display: 'flex', justifyContent: 'space-between',
      }}>
        <span>runs in your browser · no servers · no accounts</span>
        <span>ggwave WASM · 4.2 kHz</span>
      </div>
    </div>
  );
}

function IntroStep({ theme, onNext }) {
  const { c, tone } = theme;
  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
        <LogoChirp color={c.accent} dim={c.dim} />
        <div>
          <h1 style={{
            fontSize: 36, margin: 0, lineHeight: 1.02,
            fontFamily: tone.fontBody, fontWeight: 600,
            color: c.text, letterSpacing: -0.8,
          }}>
            messages<br/>
            <span style={{ color: c.accent }}>made of sound.</span>
          </h1>
          <p style={{
            marginTop: 18, fontSize: 15, lineHeight: 1.5,
            color: c.dim, maxWidth: 340,
          }}>
            bitchat is a peer-to-peer mesh that sends chat over the air — literally.
            Your browser chirps; nearby browsers listen. No wifi, bluetooth, or servers.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Fact theme={theme} k="01" label="Open this page on a few laptops in the same room." />
          <Fact theme={theme} k="02" label="Turn the volume up. Messages travel at ~16 bytes/s." />
          <Fact theme={theme} k="03" label="Every send is a tiny song at 4.2 kHz." />
        </div>
      </div>
      <PrimaryButton theme={theme} onClick={onNext}>Start listening →</PrimaryButton>
    </>
  );
}

function NameStep({ theme, name, setName, onNext, inputRef }) {
  const { c, tone } = theme;
  const canGo = name.trim().length >= 1;
  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
        <div style={{
          fontFamily: tone.fontMono, fontSize: 10, color: c.dim,
          letterSpacing: 0.6,
        }}>STEP 02 · IDENTITY</div>
        <div>
          <h2 style={{
            fontSize: 30, margin: 0, lineHeight: 1.05,
            fontFamily: tone.fontBody, fontWeight: 600,
            color: c.text, letterSpacing: -0.6,
          }}>
            What should others<br/>call you?
          </h2>
          <p style={{ marginTop: 12, fontSize: 14, color: c.dim, lineHeight: 1.5, maxWidth: 320 }}>
            Pick a handle — anything. It's broadcast with every chirp so peers in the room can tell you apart.
          </p>
        </div>

        <div style={{
          background: c.card, border: `1px solid ${c.border}`,
          borderRadius: tone.radius,
          padding: '4px 4px 4px 18px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontFamily: tone.fontMono, color: c.dim, fontSize: 14 }}>@</span>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value.slice(0, 16))}
            onKeyDown={e => e.key === 'Enter' && canGo && onNext()}
            placeholder="your-handle"
            maxLength={16}
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontFamily: tone.fontBody, fontSize: 18, color: c.text,
              padding: '14px 0', fontWeight: 500,
            }}
          />
          <span style={{
            fontFamily: tone.fontMono, fontSize: 10, color: c.dim,
            padding: '0 12px',
          }}>{name.length}/16</span>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 14px',
          background: c.card, border: `1px dashed ${c.border}`,
          borderRadius: tone.radius - 4,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: `linear-gradient(135deg, ${c.accent}, ${c.accent}88)`,
            display: 'grid', placeItems: 'center',
            color: '#fff', fontWeight: 600, fontSize: 13,
          }}>
            {(name.trim()[0] || '?').toUpperCase()}
          </div>
          <div style={{ flex: 1, fontSize: 13, color: c.text, fontFamily: tone.fontBody }}>
            <span style={{ fontWeight: 500 }}>{name.trim() || 'your-handle'}</span>
            <div style={{ fontFamily: tone.fontMono, fontSize: 10, color: c.dim, letterSpacing: 0.3, marginTop: 2 }}>
              node id · {generateId(name)}
            </div>
          </div>
          <span style={{
            fontFamily: tone.fontMono, fontSize: 9, color: c.dim,
            letterSpacing: 0.5,
          }}>preview</span>
        </div>
      </div>
      <PrimaryButton theme={theme} onClick={onNext} disabled={!canGo}>Continue →</PrimaryButton>
    </>
  );
}

function MicStep({ theme, micState, onAsk, onSkip }) {
  const { c, tone } = theme;
  return (
    <>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
        <div style={{
          fontFamily: tone.fontMono, fontSize: 10, color: c.dim,
          letterSpacing: 0.6,
        }}>STEP 03 · LISTEN</div>
        <div>
          <h2 style={{
            fontSize: 30, margin: 0, lineHeight: 1.05,
            fontFamily: tone.fontBody, fontWeight: 600,
            color: c.text, letterSpacing: -0.6,
          }}>
            Let your browser<br/>hear the room.
          </h2>
          <p style={{ marginTop: 12, fontSize: 14, color: c.dim, lineHeight: 1.5, maxWidth: 340 }}>
            Mic access lets you receive messages from nearby laptops.
            Audio never leaves this tab — everything is decoded locally.
          </p>
        </div>

        <div style={{
          display: 'grid', gap: 10,
          padding: '16px', background: c.card,
          border: `1px solid ${c.border}`, borderRadius: tone.radius,
        }}>
          <Row2 theme={theme} k="•" label="Decoded locally in your browser (ggwave WASM)." />
          <Row2 theme={theme} k="•" label="No audio is uploaded, stored, or transcribed." />
          <Row2 theme={theme} k="•" label="You can mute anytime — chat still works, you just won't receive." />
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', borderRadius: tone.radius,
          background: micState === 'granted' ? `${c.accent}14` : 'transparent',
          border: `1px solid ${micState === 'granted' ? c.accent : c.border}`,
          transition: 'all 300ms',
        }}>
          <MicIcon state={micState} color={c.accent} dim={c.dim} />
          <div style={{ flex: 1, fontSize: 13, fontFamily: tone.fontMono, letterSpacing: 0.3, color: c.text }}>
            {micState === 'idle'    && <>microphone · not requested</>}
            {micState === 'asking'  && <>waiting for browser permission…</>}
            {micState === 'granted' && <>✓ listening. ready to receive chirps.</>}
            {micState === 'denied'  && <>denied — you can still send, but won't hear peers.</>}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onSkip} style={{
          flex: '0 0 auto', padding: '0 20px', height: 52,
          background: 'transparent', color: c.text,
          border: `1px solid ${c.border}`, borderRadius: 14,
          fontFamily: tone.fontBody, fontSize: 14, fontWeight: 500,
          cursor: 'pointer',
        }}>Skip for now</button>
        <PrimaryButton theme={theme} onClick={micState === 'granted' ? onSkip : onAsk}>
          {micState === 'granted' ? 'Enter chat →' : 'Enable microphone'}
        </PrimaryButton>
      </div>
    </>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────

function LogoChirp({ color, dim }) {
  const [t, setT] = useStateO(0);
  useEffectO(() => {
    let raf; const loop = () => { setT(x => x + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const bars = 40;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 56, width: '100%' }}>
      {Array.from({length: bars}).map((_, i) => {
        const phase = (t * 0.06) - i * 0.22;
        const h = 0.3 + Math.abs(Math.sin(phase)) * 0.7;
        const fade = 1 - Math.abs(i - bars/2) / (bars/2) * 0.3;
        return (
          <div key={i} style={{
            flex: 1, height: `${h * 100}%`,
            background: color, opacity: fade, borderRadius: 2,
          }}/>
        );
      })}
    </div>
  );
}

function Fact({ theme, k, label }) {
  const { c, tone } = theme;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span style={{
        fontFamily: tone.fontMono, fontSize: 10,
        color: c.accent, letterSpacing: 0.5,
        marginTop: 4, minWidth: 18,
      }}>{k}</span>
      <span style={{ color: c.text, fontSize: 14, lineHeight: 1.45 }}>{label}</span>
    </div>
  );
}

function Row2({ theme, k, label }) {
  const { c, tone } = theme;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <span style={{ color: c.accent, marginTop: 1 }}>{k}</span>
      <span style={{ color: c.text, fontSize: 13, lineHeight: 1.5 }}>{label}</span>
    </div>
  );
}

function PrimaryButton({ theme, onClick, children, disabled }) {
  const { c, tone } = theme;
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: '100%', height: 52,
      background: disabled ? c.border : c.accent,
      color: disabled ? c.dim : '#fff',
      border: 'none', borderRadius: 14,
      fontFamily: tone.fontBody, fontSize: 15, fontWeight: 600,
      cursor: disabled ? 'default' : 'pointer',
      boxShadow: disabled ? 'none' : `0 10px 30px ${c.accent}33`,
      transition: 'all 200ms',
    }}>{children}</button>
  );
}

function MicIcon({ state, color, dim }) {
  const on = state === 'granted';
  const asking = state === 'asking';
  return (
    <div style={{
      position: 'relative', width: 36, height: 36,
      display: 'grid', placeItems: 'center',
      background: on ? `${color}22` : 'transparent',
      borderRadius: '50%',
      transition: 'background 300ms',
    }}>
      {asking && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: `2px solid ${color}`,
          animation: 'chirpRing 1.2s ease-out infinite',
        }}/>
      )}
      <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
        <rect x="4" y="1" width="8" height="12" rx="4" fill={on ? color : dim}/>
        <path d="M1 9c0 4 3 7 7 7s7-3 7-7M8 16v3" stroke={on ? color : dim} strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  );
}

function generateId(name) {
  // tiny deterministic 4-hex from name
  let h = 2166136261;
  for (const ch of (name || 'anon')) h = ((h ^ ch.charCodeAt(0)) * 16777619) >>> 0;
  const hex = h.toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 2)}·${hex.slice(2, 4)}`;
}

Object.assign(window, { Onboarding, generateId });
