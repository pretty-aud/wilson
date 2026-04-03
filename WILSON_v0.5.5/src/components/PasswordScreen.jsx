import { useState, useEffect, useRef, useCallback } from 'react'

const TYPING_WORD = 'PASSWORD';
const LETTER_INTERVAL = 80;
const INCORRECT_DISPLAY_MS = 1200;
const MAX_INPUT_LENGTH = 12;

// Startup logo timing
const LOGO_FADE_IN_MS = 1200;
const LOGO_FADE_OUT_MS = 500;

async function verifyPassword(input) {
  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input })
    });
    const data = await res.json();
    return data.valid;
  } catch { return input.toUpperCase() === 'MUTINY'; }
}

export default function PasswordScreen({ onSuccess, onAnimationComplete, isRevealing }) {
  // Phases: 'logo-in' → 'logo-hold' → 'logo-out' → 'idle' → 'splitting' → ...
  const [phase, setPhase] = useState('logo-in');
  const [logoOpacity, setLogoOpacity] = useState(0);
  const [typedLetters, setTypedLetters] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [showIncorrect, setShowIncorrect] = useState(false);
  const [bgVisible, setBgVisible] = useState(true);
  const [panelsVisible, setPanelsVisible] = useState(true);
  const inputStarted = useRef(false);
  const phaseRef = useRef(phase);
  const revealStarted = useRef(false);
  const logoStarted = useRef(false);
  const audioRef = useRef(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Logo fade-in + audio playback
  useEffect(() => {
    if (phase !== 'logo-in') return;
    if (logoStarted.current) return;
    logoStarted.current = true;

    // Start fade-in on next frame so the CSS transition triggers
    requestAnimationFrame(() => {
      setLogoOpacity(1);
    });

    // Play audio — Use Web Audio API for precise ended callback
    const playChime = async () => {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') await ctx.resume();
        const resp = await fetch('/PetalStudios_Chime_V2.wav');
        const arrayBuf = await resp.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuf);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.82;
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        source.start(0);
        audioRef.current = { source, ctx };
        // When chime ends, fade out logo
        source.onended = () => {
          if (phaseRef.current === 'logo-in' || phaseRef.current === 'logo-hold') {
            setPhase('logo-out');
            setLogoOpacity(0);
          }
        };
      } catch {
        // Audio failed — use fallback timing
        setTimeout(() => {
          if (phaseRef.current === 'logo-in' || phaseRef.current === 'logo-hold') {
            setPhase('logo-out');
            setLogoOpacity(0);
          }
        }, 3800);
      }
    };
    playChime();

    // After fade-in completes, move to hold phase
    setTimeout(() => {
      if (phaseRef.current === 'logo-in') {
        setPhase('logo-hold');
      }
    }, LOGO_FADE_IN_MS);

    // Safety fallback
    setTimeout(() => {
      if (phaseRef.current === 'logo-in' || phaseRef.current === 'logo-hold') {
        setPhase('logo-out');
        setLogoOpacity(0);
      }
    }, LOGO_FADE_IN_MS + 4000);

    return () => {};
  }, [phase]);

  // Logo fade-out → idle
  useEffect(() => {
    if (phase !== 'logo-out') return;
    const t = setTimeout(() => setPhase('idle'), LOGO_FADE_OUT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase 0 → 1: split after 1s
  useEffect(() => {
    if (phase !== 'idle') return;
    const t = setTimeout(() => setPhase('splitting'), 1000);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase 1 → 2: type after split done
  useEffect(() => {
    if (phase !== 'splitting') return;
    const t = setTimeout(() => { setPhase('typing'); setTypedLetters(0); }, 1600);
    return () => clearTimeout(t);
  }, [phase]);

  // Phase 2: type letters
  useEffect(() => {
    if (phase !== 'typing') return;
    if (typedLetters >= TYPING_WORD.length) {
      const t = setTimeout(() => setPhase('ready'), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setTypedLetters(prev => prev + 1), LETTER_INTERVAL);
    return () => clearTimeout(t);
  }, [phase, typedLetters]);

  // Phase 6: Reveal — use ref guard to prevent StrictMode double-fire
  useEffect(() => {
    if (!isRevealing) return;
    if (revealStarted.current) return;
    revealStarted.current = true;

    setPhase('revealing');

    const t1 = setTimeout(() => {
      setBgVisible(false);
      setPanelsVisible(false);
    }, 1000);

    const t2 = setTimeout(() => {
      setPhase('done');
      if (onAnimationComplete) onAnimationComplete();
    }, 1800);

    return () => {};
  }, [isRevealing, onAnimationComplete]);

  // Keyboard (password input)
  const verifyingRef = useRef(false);
  const handleKeyDown = useCallback((e) => {
    const p = phaseRef.current;
    if (p !== 'ready' && p !== 'input') return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (verifyingRef.current) return;
      setUserInput(prev => {
        if (prev.length === 0) return prev;
        verifyingRef.current = true;
        verifyPassword(prev).then(valid => {
          verifyingRef.current = false;
          if (valid) {
            onSuccess();
          } else {
            setShowIncorrect(true);
            setTimeout(() => { setShowIncorrect(false); inputStarted.current = false; }, INCORRECT_DISPLAY_MS);
          }
        });
        return '';
      });
      inputStarted.current = false;
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      setUserInput(prev => {
        const v = prev.slice(0, -1);
        if (v.length === 0) inputStarted.current = false;
        return v;
      });
      return;
    }

    if (/^[a-zA-Z0-9]$/.test(e.key)) {
      e.preventDefault();
      if (!inputStarted.current) { inputStarted.current = true; setPhase('input'); }
      setUserInput(prev => prev.length >= MAX_INPUT_LENGTH ? prev : prev + e.key);
    }
  }, [onSuccess]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (phase === 'done') return null;

  const isLogoPhase = phase === 'logo-in' || phase === 'logo-hold' || phase === 'logo-out';
  const isStartOrLogo = isLogoPhase;
  const isSplit = !isStartOrLogo && phase !== 'idle';
  const isReveal = phase === 'revealing';

  // --- TEXT ---
  const textStyle = {
    color: '#fff', fontWeight: 'bold', textTransform: 'uppercase',
    letterSpacing: '0.15em', fontSize: '20.5px', fontFamily: 'monospace',
  };
  const cursor = <span style={{ animation: 'blink 1.06s step-end infinite' }}>_</span>;
  const showCursor = (phase === 'ready' || phase === 'input') && !showIncorrect && !isReveal;

  let centerContent = null;
  if (showIncorrect) {
    centerContent = <span style={textStyle}>INCORRECT</span>;
  } else if (isReveal) {
    centerContent = null;
  } else if ((phase === 'typing' || phase === 'ready') && !inputStarted.current) {
    centerContent = (
      <span style={textStyle}>
        {TYPING_WORD.slice(0, typedLetters)}
        {phase === 'ready' && cursor}
      </span>
    );
  } else if (inputStarted.current && userInput.length > 0) {
    centerContent = <span style={textStyle}>{'*'.repeat(userInput.length)}{showCursor && cursor}</span>;
  } else if (phase === 'ready' || phase === 'input') {
    centerContent = <span style={textStyle}>{showCursor && cursor}</span>;
  }

  return (
    <>
      {/* Startup logo card — full-screen orange with centered logo */}
      {isLogoPhase && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 55,
          backgroundColor: '#ea580c',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img
            src="/logo.png"
            alt="Logo"
            style={{
              height: '90.5px',
              width: 'auto',
              filter: 'brightness(0) invert(1)',
              opacity: logoOpacity,
              transition: phase === 'logo-out'
                ? `opacity ${LOGO_FADE_OUT_MS}ms ease-out`
                : `opacity ${LOGO_FADE_IN_MS}ms ease-in`,
            }}
          />
        </div>
      )}

      {/* Light orange background — fades to reveal DOG */}
      {!isStartOrLogo && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 51,
          backgroundColor: '#f4a261',
          transition: 'opacity 800ms ease-out',
          opacity: bgVisible ? 1 : 0,
          pointerEvents: isReveal ? 'none' : 'auto',
        }} />
      )}

      {/* Top orange panel */}
      {!isStartOrLogo && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0,
          backgroundColor: '#ea580c', zIndex: 52,
          height: isReveal ? '268px' : '50vh',
          transform: isReveal ? 'translateY(0)' : (isSplit ? 'translateY(-20px)' : 'translateY(0)'),
          opacity: panelsVisible ? 1 : 0,
          transition: isReveal
            ? 'height 1000ms cubic-bezier(0.4,0,0.2,1), transform 1000ms cubic-bezier(0.4,0,0.2,1), opacity 800ms ease-out'
            : 'transform 600ms cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Bottom orange panel */}
      {!isStartOrLogo && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          backgroundColor: '#ea580c', zIndex: 52,
          height: isReveal ? '268px' : '50vh',
          transform: isReveal ? 'translateY(0)' : (isSplit ? 'translateY(20px)' : 'translateY(0)'),
          opacity: panelsVisible ? 1 : 0,
          transition: isReveal
            ? 'height 1000ms cubic-bezier(0.4,0,0.2,1), transform 1000ms cubic-bezier(0.4,0,0.2,1), opacity 800ms ease-out'
            : 'transform 600ms cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: 'none',
        }} />
      )}

      {/* Center text */}
      {!isStartOrLogo && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)', zIndex: 53,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '40px', pointerEvents: 'none',
          opacity: isReveal ? 0 : 1,
          transition: isReveal ? 'opacity 200ms ease-out' : 'none',
        }}>
          {centerContent}
        </div>
      )}
    </>
  );
}
