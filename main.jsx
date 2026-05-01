// main.jsx — orchestrator. Wires React UI to the real Bitchat protocol.

const { useState: useStateM, useEffect: useEffectM, useRef: useRefM } = React;

function fmtTime(d = new Date()) {
  return d.toTimeString().slice(0, 5);
}

const SELF_AVATAR = (name) => (name && name[0] || '?').toUpperCase();
const PEER_AVATAR = (name) => (name && name[0] || '?').toUpperCase();
const CHANNEL_NAME = '#mesh';

function App() {
  const theme = useTheme();
  const [messages, setMessages] = useStateM([]);
  const [peers, setPeers] = useStateM([]);          // [{peerId, displayName, shortId, hops, lastHeard}]
  const [activity, setActivity] = useStateM('idle');// 'idle' | 'listening' | 'tx' | 'rx'
  const [transmitting, setTransmitting] = useStateM(false);
  const [tweaksOpen, setTweaksOpen] = useStateM(false);
  const [user, setUser] = useStateM(() => {
    try {
      const asName = new URLSearchParams(location.search).get('as');
      if (asName) return { name: asName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) };
      return JSON.parse(localStorage.getItem('bitchat.user') || 'null');
    } catch { return null; }
  });
  const [stackError, setStackError] = useStateM(null);
  const scrollRef = useRefM(null);

  useEffectM(() => { window.__setTweaksOpen = setTweaksOpen; }, []);

  // Wire callbacks to UI. NOTE: we do NOT call Bitchat.start() from here —
  // the AudioContext can only be created from a user-gesture handler, so
  // Bitchat.start() is invoked inside Onboarding's "Enable mic" click.
  // If the user has onboarded previously, we wait for their first interaction
  // (any click) to start the protocol.
  useEffectM(() => {
    if (!window.Bitchat) return;

    Bitchat.onMessage = (m) => {
      setMessages(prev => [...prev, { ...m, id: m.msgId, justArrived: true }]);
      setTimeout(() => {
        setMessages(prev => prev.map(x => x.id === m.msgId ? { ...x, justArrived: false } : x));
      }, 500);
    };
    Bitchat.onSelfSent = (m) => {
      setMessages(prev => [...prev, { ...m, id: m.msgId }]);
    };
    Bitchat.onPeers = (p) => setPeers(p);
    Bitchat.onActivity = (s) => {
      setActivity(s);
      if (s === 'tx') setTransmitting(true);
      else if (s === 'idle' || s === 'listening' || s === 'rx') setTransmitting(false);
    };
  }, []);

  // For returning users (already onboarded), defer Bitchat.start to first click.
  useEffectM(() => {
    if (!user) return;
    if (window.Bitchat?.isStarted) return;

    const boot = async () => {
      window.removeEventListener('click', boot);
      window.removeEventListener('keydown', boot);
      try {
        await Bitchat.start({ displayName: user.name });
      } catch (err) {
        console.error('Bitchat boot failed:', err);
        setStackError(err.message || String(err));
      }
    };
    window.addEventListener('click', boot, { once: true });
    window.addEventListener('keydown', boot, { once: true });
    return () => {
      window.removeEventListener('click', boot);
      window.removeEventListener('keydown', boot);
    };
  }, [user]);

  useEffectM(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  const intense = theme.soundIntensity;
  const liveChirp = activity === 'tx' || activity === 'rx';

  const send = async (text) => {
    if (!Bitchat.isStarted) {
      console.warn('Protocol not started yet');
      return;
    }
    try { await Bitchat.send(text); }
    catch (err) { console.error('send failed:', err); }
  };

  const me = Bitchat.identity || { displayName: user?.name || 'you', shortId: '----', peerId: 0 };
  const memberCount = peers.length + 1;

  return (
    <div style={{
      width: '100%', height: '100%',
      background: theme.c.bg,
      color: theme.c.text,
      fontFamily: theme.tone.fontBody,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <ChannelHeader theme={theme}
                     channel={CHANNEL_NAME}
                     memberCount={memberCount}
                     activity={activity}
                     liveChirp={liveChirp} />
      <MeshRail theme={theme}
                peers={peers.map(p => ({
                  id: p.shortId, name: p.displayName, avatar: PEER_AVATAR(p.displayName),
                  signal: p.hops <= 1 ? 3 : (p.hops === 2 ? 2 : 1),
                }))}
                self={{ name: me.displayName, avatar: SELF_AVATAR(me.displayName) }} />
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        padding: '24px 22px',
        display: 'flex', flexDirection: 'column', gap: 14,
        backgroundImage: theme.soundIntensity === 'extreme'
          ? `radial-gradient(circle at 50% 120%, ${theme.c.accent}22, transparent 60%)`
          : 'none',
      }}>
        <DayDivider theme={theme} label="today · via acoustic mesh" />
        {stackError && <ErrorBanner theme={theme} error={stackError} />}
        {messages.length === 0 && !stackError && (
          <EmptyState theme={theme} memberCount={memberCount} />
        )}
        {messages.map(m => <Bubble key={m.id} msg={m} theme={theme} intense={intense}/>)}
        <div style={{ height: 4 }} />
      </div>
      <Composer theme={theme} onSend={send} transmitting={transmitting} intense={intense} />
      {!user && <Onboarding theme={theme} onDone={(u) => {
        localStorage.setItem('bitchat.user', JSON.stringify(u));
        setUser(u);
      }} />}
      {tweaksOpen && <TweaksPanel theme={theme} user={user}
        onReset={() => {
          localStorage.removeItem('bitchat.user');
          if (window.Bitchat) Bitchat.reset();
        }}
        onClose={() => { setTweaksOpen(false); window.parent.postMessage({type:'__deactivate_edit_mode'}, '*'); }} />}
    </div>
  );
}

function DayDivider({ theme, label }) {
  const { c, tone } = theme;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      color: c.dim, fontFamily: tone.fontMono, fontSize: 10.5, letterSpacing: 0.6,
      margin: '4px 0 8px',
    }}>
      <div style={{ flex: 1, height: 1, background: c.border }}/>
      <span>{label}</span>
      <div style={{ flex: 1, height: 1, background: c.border }}/>
    </div>
  );
}

function EmptyState({ theme, memberCount }) {
  const { c, tone } = theme;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 10, padding: '40px 12px', color: c.dim,
      fontFamily: tone.fontMono, fontSize: 12, textAlign: 'center',
      letterSpacing: 0.4,
    }}>
      <div style={{ fontSize: 28, opacity: 0.5 }}>~∿~</div>
      <div>{memberCount === 1 ? 'listening for nearby nodes…' : 'channel is quiet — say something'}</div>
      <div style={{ fontSize: 10, opacity: 0.7 }}>
        open this page on another device on the same air to mesh
      </div>
    </div>
  );
}

function ErrorBanner({ theme, error }) {
  const { c, tone } = theme;
  return (
    <div style={{
      padding: '12px 14px', borderRadius: 12,
      background: '#FF6B5C22', border: '1px solid #FF6B5C66',
      color: '#B44B3F', fontFamily: tone.fontMono, fontSize: 11.5,
      letterSpacing: 0.3,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>STACK ERROR</div>
      <div>{error}</div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        check console · most likely a mic permission or ggwave load issue
      </div>
    </div>
  );
}

function TweaksPanel({ theme, onClose, onReset, user }) {
  const { c, tone, setTweak } = theme;
  const Row = ({ label, children }) => (
    <div>
      <div style={{ fontFamily: tone.fontMono, fontSize: 10, color: c.dim, letterSpacing: 0.6, marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
  const pillStyle = (selected) => ({
    padding: '6px 10px', fontSize: 12, fontFamily: tone.fontBody,
    background: selected ? c.accent : 'transparent',
    color: selected ? '#fff' : c.text,
    border: `1px solid ${selected ? c.accent : c.border}`,
    borderRadius: 999, cursor: 'pointer',
  });

  const accents = ['#5E8BFF','#FF7A3D','#30D158','#D9C7A7','#B24BFF','#0A0C0E'];
  const tonesList = ['clean','warm','terminal'];
  const intensities = ['subtle','central','extreme'];

  return (
    <div style={{
      position: 'absolute', top: 20, right: 20,
      width: 280, padding: 18,
      background: c.card,
      border: `1px solid ${c.border}`,
      borderRadius: 18,
      boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
      display: 'flex', flexDirection: 'column', gap: 16,
      zIndex: 10, fontFamily: tone.fontBody,
    }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: c.text }}>Tweaks</div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: c.dim, cursor: 'pointer', fontSize: 16,
        }}>×</button>
      </div>
      <Row label="TONE">
        <div style={{ display: 'flex', gap: 6 }}>
          {tonesList.map(t => (
            <button key={t} onClick={() => setTweak('tone', t)} style={pillStyle(theme.tone === tones[t])}>{t}</button>
          ))}
        </div>
      </Row>
      <Row label="ACCENT">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {accents.map(a => (
            <button key={a} onClick={() => setTweak('accent', a)} style={{
              width: 28, height: 28, borderRadius: '50%',
              background: a, border: theme.accent === a ? `2px solid ${c.text}` : `1px solid ${c.border}`,
              cursor: 'pointer', padding: 0,
            }}/>
          ))}
        </div>
      </Row>
      <Row label="APPEARANCE">
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={pillStyle(!theme.dark)} onClick={() => setTweak('dark', false)}>light</button>
          <button style={pillStyle(theme.dark)} onClick={() => setTweak('dark', true)}>dark</button>
        </div>
      </Row>
      <Row label="SOUND MOTIF">
        <div style={{ display: 'flex', gap: 6 }}>
          {intensities.map(i => (
            <button key={i} onClick={() => setTweak('soundIntensity', i)} style={pillStyle(theme.soundIntensity === i)}>{i}</button>
          ))}
        </div>
      </Row>
      {user && (
        <Row label="SESSION">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontFamily: tone.fontMono, fontSize: 11, color: c.text }}>
              @{user.name}
            </span>
            <button onClick={onReset} style={{
              ...pillStyle(false), fontSize: 11, padding: '4px 10px',
            }}>reset & wipe key</button>
          </div>
        </Row>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
