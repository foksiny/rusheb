import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Beatmap, GameSettings, ScoreDetails, NoteType, EasingType, EventType, GameEvent, Note, KeyMode } from '../types';
import { HIT_WINDOWS, SCORES, DEFAULT_KEY_BINDINGS } from '../constants';

interface GameCanvasProps {
  beatmap: Beatmap;
  settings: GameSettings;
  onEnd: (score: ScoreDetails) => void;
  onAbort: () => void;
}

interface ActiveNote extends Note {
  hitState: 'NONE' | 'HIT' | 'HOLDING' | 'MISSED';
  y: number;
  visible: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  speedMod: number; // Parallax effect
}

interface FallingKey {
  key: string;
  x: number;
  y: number;
  opacity: number;
  scale: number;
  rotation: number;
  color: string;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  scale: number;
}

const getEasing = (type: EasingType, t: number) => {
  switch (type) {
    case EasingType.EASE_IN: return t * t;
    case EasingType.EASE_OUT: return t * (2 - t);
    case EasingType.EASE_IN_OUT: return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    case EasingType.EASE_OUT_BACK: {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case EasingType.ELASTIC: {
      const c4 = (2 * Math.PI) / 3;
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
    }
    case EasingType.BOUNCE: {
      const n1 = 7.5625;
      const d1 = 2.75;
      let t2 = t;
      if (t2 < 1 / d1) {
        return n1 * t2 * t2;
      } else if (t2 < 2 / d1) {
        return n1 * (t2 -= 1.5 / d1) * t2 + 0.75;
      } else if (t2 < 2.5 / d1) {
        return n1 * (t2 -= 2.25 / d1) * t2 + 0.9375;
      } else {
        return n1 * (t2 -= 2.625 / d1) * t2 + 0.984375;
      }
    }
    case EasingType.LINEAR:
    default: return t;
  }
};

const getLaneX = (canvasWidth: number, canvasHeight: number, lane: number) => {
  const playfieldWidth = Math.min(canvasWidth * 0.9, canvasHeight * 0.9, 800);
  const offsetX = (canvasWidth - playfieldWidth) / 2;
  const laneWidth = playfieldWidth / 4;
  return offsetX + lane * laneWidth + laneWidth / 2;
};

const getLaneWidth = (canvasWidth: number, canvasHeight: number) => {
  const playfieldWidth = Math.min(canvasWidth * 0.9, canvasHeight * 0.9, 800);
  return playfieldWidth / 4;
};

const GameCanvas: React.FC<GameCanvasProps> = ({ beatmap, settings, onEnd, onAbort }) => {
  const [isPaused, setIsPaused] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);

  const stateRef = useRef({
    startTime: 0,
    lastFrameTime: 0,
    currentTime: 0,
    isPlaying: false,
    audioStarted: false,
    hasEnded: false,
    isPaused: false,
    pauseStartTime: 0,
    notes: [] as ActiveNote[],
    events: [] as GameEvent[],
    score: {
      perfect: 0,
      good: 0,
      miss: 0,
      minesHit: 0,
      maxCombo: 0,
      score: 0,
    },
    combo: 0,
    particles: [] as Particle[],
    stars: [] as Star[],
    floatingTexts: [] as FloatingText[],
    laneFlashes: [0, 0, 0, 0],
    pressedInputs: new Set<string>(),
    activeHoldNoteIds: new Set<string>(),
    lastKeyPressName: '',
    cameraShake: 0,
    targetGlobalSpeedMultiplier: 1.0,
    currentGlobalSpeedMultiplier: 1.0,
    fallingKeys: [] as FallingKey[],
    rippleEffects: [] as { x: number; y: number; radius: number; opacity: number; color: string }[]
  });

  const requestRef = useRef<number>(0);

  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      audioCtxRef.current = new AudioContextClass();
    }

    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
      }
    };
  }, []);

  const playHitSound = useCallback((type: NoteType) => {
    // Mine = Silent
    if (type === NoteType.MINE) return;

    const ctx = audioCtxRef.current;
    if (!ctx) return;

    const master = settings.masterVolume !== undefined ? settings.masterVolume : 1.0;
    const sfx = settings.sfxVolume !== undefined ? settings.sfxVolume : 0.8;
    const vol = master * sfx;
    if (vol <= 0) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => { });
    }

    const t = ctx.currentTime;

    if (type === NoteType.HOLD_CLICK) {
      // "Switch" Click Sound (High pitch, very short)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2000, t);
      osc.frequency.exponentialRampToValueAtTime(1000, t + 0.05);

      gain.gain.setValueAtTime(0.15 * vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.05);

    } else {
      // "Punchy Click" (Transient + Body)

      // 1. Transient (The "click")
      const clickOsc = ctx.createOscillator();
      const clickGain = ctx.createGain();
      clickOsc.type = 'sine';
      clickOsc.frequency.setValueAtTime(4000, t);
      clickOsc.frequency.exponentialRampToValueAtTime(200, t + 0.02);

      clickGain.gain.setValueAtTime(0.3 * vol, t);
      clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.02);

      clickOsc.connect(clickGain);
      clickGain.connect(ctx.destination);
      clickOsc.start(t);
      clickOsc.stop(t + 0.02);

      // 2. Body (The "thump")
      const bodyOsc = ctx.createOscillator();
      const bodyGain = ctx.createGain();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(200, t);
      bodyOsc.frequency.exponentialRampToValueAtTime(50, t + 0.1);

      bodyGain.gain.setValueAtTime(0.4 * vol, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

      bodyOsc.connect(bodyGain);
      bodyGain.connect(ctx.destination);

      bodyOsc.start(t);
      bodyOsc.stop(t + 0.1);
    }

  }, [settings.sfxVolume, settings.masterVolume]);

  const addFloatingText = (x: number, y: number, text: string, color: string) => {
    stateRef.current.floatingTexts.push({ x, y, text, life: 1.0, color, scale: 1.0 });
  };

  const addParticles = (x: number, y: number, color: string, count: number = 10, intensity: number = 1) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 10 * intensity;
      stateRef.current.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.0,
        color,
        size: Math.random() * 6 + 2
      });
    }
  };

  const handleNoteMutation = (parent: ActiveNote) => {
    if (!parent.mutationType) return;

    const count = parent.mutationCount || 1;
    const state = stateRef.current;
    const spacing = 200;

    for (let i = 0; i < count; i++) {
      const spawnTime = state.currentTime + spacing + (i * spacing);
      const newNote: ActiveNote = {
        id: `mutation_${Date.now()}_${i}_${Math.random()}`,
        time: spawnTime,
        type: parent.mutationType,
        lane: Math.floor(Math.random() * 4),
        speedMultiplier: parent.speedMultiplier,
        hitState: 'NONE',
        y: -100,
        visible: true
      };
      state.notes.push(newNote);
    }
    state.notes.sort((a, b) => a.time - b.time);
    addFloatingText(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, parent.lane), canvasRef.current?.height ? canvasRef.current.height - 200 : 400, "EVOLVED!", "#facc15");
  };

  const togglePause = useCallback(() => {
    setIsPaused(prev => {
      const next = !prev;
      const state = stateRef.current;
      state.isPaused = next;

      if (next) {
        state.pauseStartTime = performance.now();
        if (audioRef.current) audioRef.current.pause();
      } else {
        const pauseDuration = performance.now() - state.pauseStartTime;
        state.startTime += pauseDuration;
        state.lastFrameTime = performance.now();

        if (audioRef.current && state.audioStarted) {
          audioRef.current.play().catch(console.error);
        }
      }
      return next;
    });
  }, []);

  const initStars = (width: number, height: number) => {
    const stars: Star[] = [];
    const starCount = 150;
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.8 + 0.2,
        speedMod: Math.random() * 0.8 + 0.2
      });
    }
    return stars;
  };

  const handleRestart = useCallback(() => {
    setIsPaused(false);
    const state = stateRef.current;
    state.isPaused = false;
    state.hasEnded = false;
    state.startTime = performance.now();
    state.lastFrameTime = 0;
    state.currentTime = 0;
    state.audioStarted = false;
    state.combo = 0;
    state.score = { perfect: 0, good: 0, miss: 0, minesHit: 0, maxCombo: 0, score: 0 };
    state.particles = [];
    state.floatingTexts = [];
    state.laneFlashes = [0, 0, 0, 0];
    state.pressedInputs.clear();
    state.activeHoldNoteIds.clear();
    state.cameraShake = 0;
    state.targetGlobalSpeedMultiplier = 1.0;
    state.currentGlobalSpeedMultiplier = 1.0;

    // Init stars
    state.stars = initStars(window.innerWidth, window.innerHeight);

    state.notes = (beatmap.notes || []).map(n => ({
      ...n,
      hitState: 'NONE' as const,
      y: -100,
      visible: true
    })).sort((a, b) => a.time - b.time);

    state.events = [...(beatmap.events || [])].sort((a, b) => a.time - b.time);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [beatmap]);

  const processHit = useCallback((laneIndex?: number, keyName?: string, inputId: string = 'default') => {
    const state = stateRef.current;
    if (state.isPaused || state.hasEnded) return;

    if (state.pressedInputs.has(inputId)) return;
    state.pressedInputs.add(inputId);

    if (keyName) state.lastKeyPressName = keyName;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.width;
    const height = canvas.height;
    const hitLineY = canvas.height - 150;

    // Determine the target lane based on key mode
    const keyMode = settings.keyMode || KeyMode.ALL_KEYS;
    const keyBindings = settings.keyBindings || DEFAULT_KEY_BINDINGS;
    let targetLane: number | undefined = laneIndex;

    if (keyMode === KeyMode.FOUR_KEYS && keyName) {
      const keyIndex = keyBindings.indexOf(keyName);
      if (keyIndex >= 0 && keyIndex < 4) {
        targetLane = keyIndex;
      } else {
        return; // Key not bound, ignore
      }
    }

    // Find ALL candidates in window
    let candidates: ActiveNote[] = [];
    for (const note of state.notes) {
      if (note.hitState !== 'NONE') continue;
      
      // In FOUR_KEYS mode, only consider notes in the target lane
      if (keyMode === KeyMode.FOUR_KEYS && targetLane !== undefined && note.lane !== targetLane) continue;
      
      const diff = note.time - state.currentTime;
      // Too far future
      if (diff > HIT_WINDOWS.MISS) break;
      // Too far past
      if (diff < -HIT_WINDOWS.MISS) continue;

      candidates.push(note);
    }

    // Sort candidates:
    // 1. SAFE notes (Click, Hold) over MINES.
    // 2. Closest time to 0.
    candidates.sort((a, b) => {
      const aIsMine = a.type === NoteType.MINE;
      const bIsMine = b.type === NoteType.MINE;

      if (aIsMine && !bIsMine) return 1; // b comes first
      if (!aIsMine && bIsMine) return -1; // a comes first

      // If both are same category, closest time wins
      return Math.abs(a.time - state.currentTime) - Math.abs(b.time - state.currentTime);
    });

    const targetNote = candidates.length > 0 ? candidates[0] : null;

    if (targetNote) {
      const minDiff = Math.abs(targetNote.time - state.currentTime);
      const x = getLaneX(width, height, targetNote.lane);

      state.laneFlashes[targetNote.lane] = 1.0;

      // Speed notes only work if practice mode is disabled
      if (!settings.practiceMode && targetNote.speedMultiplier && targetNote.speedMultiplier !== 1.0) {
        state.targetGlobalSpeedMultiplier = targetNote.speedMultiplier;
        const textMsg = targetNote.speedMultiplier > 1 ? 'SPEED UP!' : 'SLOW DOWN!';
        addFloatingText(width / 2, height / 2, textMsg, targetNote.speedMultiplier > 1 ? '#f97316' : '#2563eb');
        state.cameraShake = 10;
      }

      if (targetNote.type === NoteType.MINE) {
        targetNote.hitState = 'HIT';
        targetNote.visible = false;
        state.combo = 0;
        state.score.minesHit++;
        state.score.score += SCORES.MINE;
        addFloatingText(width / 2, hitLineY, 'MINE HIT!', '#ef4444');
        addParticles(x, hitLineY, '#ef4444', 60, 4);
        state.cameraShake = 30;
        playHitSound(NoteType.MINE);
        return;
      }

      let scoreAdd = 0;
      let text = '';
      let color = '';

      if (minDiff <= HIT_WINDOWS.PERFECT) {
        scoreAdd = SCORES.PERFECT; text = 'PERFECT'; color = '#facc15';
      } else if (minDiff <= HIT_WINDOWS.GOOD) {
        scoreAdd = SCORES.GOOD; text = 'GOOD'; color = '#4ade80';
      } else {
        scoreAdd = SCORES.MISS; text = 'MISS'; color = '#9ca3af';
      }

      if (scoreAdd > 0) {
        state.combo++;
        if (state.combo > state.score.maxCombo) state.score.maxCombo = state.combo;

        if (scoreAdd === SCORES.PERFECT) {
          state.score.perfect++;
          state.cameraShake = settings.stupidlyCrazyEffects ? 15 : 5;
          if (settings.stupidlyCrazyEffects) {
            state.rippleEffects.push({ x, y: hitLineY, radius: 0, opacity: 1, color });
          }
        } else {
          state.score.good++;
          state.cameraShake = settings.stupidlyCrazyEffects ? 8 : 2;
        }
        playHitSound(targetNote.type);
        if (targetNote.mutationType) handleNoteMutation(targetNote);

        // --- SYNCHRONOUS AUTO-HIT LOGIC ---
        const syncRadius = 50; // ms
        state.notes.forEach(nearbyNote => {
          if (nearbyNote.type === NoteType.HOLD_CLICK && nearbyNote.hitState === 'NONE') {
            if (Math.abs(nearbyNote.time - targetNote.time) <= syncRadius) {
              nearbyNote.hitState = 'HIT';
              nearbyNote.visible = false;
              state.combo++;
              state.score.perfect++;
              state.score.score += SCORES.PERFECT;
              state.laneFlashes[nearbyNote.lane] = 1.0;
              playHitSound(NoteType.HOLD_CLICK);
              addParticles(getLaneX(width, height, nearbyNote.lane), hitLineY, '#2dd4bf', 15);
              if (nearbyNote.mutationType) handleNoteMutation(nearbyNote);
            }
          }
        });

        state.score.score += scoreAdd;
        addFloatingText(x, hitLineY - 50, text, color);
        addParticles(x, hitLineY, color, scoreAdd === SCORES.PERFECT ? (settings.stupidlyCrazyEffects ? 60 : 30) : 15, scoreAdd === SCORES.PERFECT ? 2 : 1);

        if (targetNote.type === NoteType.CLICK || targetNote.type === NoteType.HOLD_CLICK) {
          targetNote.hitState = 'HIT';
          targetNote.visible = false;
        } else if (targetNote.type === NoteType.HOLD) {
          targetNote.hitState = 'HOLDING';
          state.activeHoldNoteIds.add(targetNote.id);
        }
      } else {
        // If it's a "MISS" timing (Early) or Ghost Click, we just ignore it.
        // The game will only detect a MISS when the note actually passes the hit line.
        return;
      }
    }
  }, [playHitSound, settings.keyMode, settings.keyBindings]);

  const processRelease = useCallback((inputId: string = 'default') => {
    const state = stateRef.current;
    state.pressedInputs.delete(inputId);
    if (state.isPaused || state.hasEnded) return;

    // RUSHEB MECHANIC: 
    // If ANY key is still pressed, we sustain ALL active holds.
    // We only fail/release hold notes when pressedInputs.size drops to 0.

    if (state.pressedInputs.size > 0) {
      // Still holding at least one key, so we assume the player is maintaining the hold
      return;
    }

    // If we are here, ZERO keys are pressed. 
    // Process release for all currently held notes.
    const holdingNoteIds = Array.from(state.activeHoldNoteIds);
    const canvas = canvasRef.current;

    for (const holdNoteId of holdingNoteIds) {
      const note = state.notes.find(n => n.id === holdNoteId);
      if (note && note.hitState === 'HOLDING') {
        const releaseTime = note.time + (note.holdDuration || 0);
        const isReleaseRequired = note.requireRelease !== false;

        if (isReleaseRequired) {
          // Release is required - check timing
          if (state.currentTime < releaseTime - HIT_WINDOWS.GOOD) {
            // Released too early
            note.hitState = 'MISSED';
            state.combo = 0;
            state.score.miss++;
            addFloatingText(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "LET GO EARLY", "#ef4444");
          } else if (state.currentTime > releaseTime + HIT_WINDOWS.GOOD) {
            // Released too late - this is a MISS
            note.hitState = 'MISSED';
            state.combo = 0;
            state.score.miss++;
            addFloatingText(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "LATE RELEASE!", "#ef4444");
            addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#ef4444", 30, 2);
          } else {
            // Released at appropriate time (within GOOD window of releaseTime)
            addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#facc15", 20, 1.5);
            note.hitState = 'HIT';
            note.visible = false;
            state.score.score += SCORES.PERFECT;
          }
        } else {
          // Release not required - any release counts as success
          addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#facc15", 20, 1.5);
          note.hitState = 'HIT';
          note.visible = false;
          state.score.score += SCORES.PERFECT;
        }
      }
      state.activeHoldNoteIds.delete(holdNoteId);
    }

  }, [playHitSound]);

  const drawNote = useCallback((ctx: CanvasRenderingContext2D, note: ActiveNote, x: number, y: number, color: string, isHolding: boolean) => {
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;

    const grad = ctx.createRadialGradient(x - 5, y - 5, 2, x, y, 25);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, '#000000');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, isHolding ? 22 : 25, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.shadowBlur = 0;

    if (note.type === NoteType.MINE) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', x, y);
    }
  }, []);

  const update = useCallback((timestamp: number) => {
    const state = stateRef.current;
    if (state.isPaused) {
      state.lastFrameTime = timestamp;
      if (state.isPlaying) requestRef.current = requestAnimationFrame(update);
      return;
    }

    if (!state.lastFrameTime) state.lastFrameTime = timestamp;
    const dt = timestamp - state.lastFrameTime;
    state.lastFrameTime = timestamp;
    if (!state.startTime) state.startTime = timestamp;

    const START_DELAY_MS = 2000;
    const elapsed = timestamp - state.startTime;
    const speedMult = settings.practiceMode ? 0.5 : 1.0;

    if (elapsed >= START_DELAY_MS && !state.audioStarted) {
      state.audioStarted = true;
      if (audioRef.current) {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => console.log("Audio autoplay blocked"));
        }
      }
    }

    if (elapsed < START_DELAY_MS) {
      state.currentTime = elapsed - START_DELAY_MS;
    } else {
      if (audioRef.current) {
        // Apply music volume settings
        const master = settings.masterVolume !== undefined ? settings.masterVolume : 1.0;
        const music = settings.musicVolume !== undefined ? settings.musicVolume : 0.8;
        audioRef.current.volume = master * music;

        if (!audioRef.current.paused) {
          const audioTime = audioRef.current.currentTime * 1000;
          const drift = audioTime - state.currentTime;
          state.currentTime += (dt * speedMult) + (Math.abs(drift) > 300 ? drift : drift * 0.1);
        } else {
          state.currentTime += dt * speedMult;
        }
      } else {
        state.currentTime += dt * speedMult;
      }
    }

    if (!state.hasEnded) {
      const buffer = 2000;
      const isAudioFinished = audioRef.current && state.audioStarted && audioRef.current.ended;
      const isTimeOver = state.currentTime > beatmap.duration + buffer;
      if (isAudioFinished || isTimeOver) {
        state.hasEnded = true;
        onEnd(state.score);
        return;
      }
    }

    // CHECK HOLD NOTE END CONDITIONS
    // Handle both auto-complete (requireRelease=false) and miss condition (requireRelease=true, didn't release)
    const holdingIds = Array.from(state.activeHoldNoteIds);
    for (const id of holdingIds) {
      const note = state.notes.find(n => n.id === id);
      if (note && note.hitState === 'HOLDING') {
        const endTime = note.time + (note.holdDuration || 0);
        const isReleaseRequired = note.requireRelease !== false;
        
        if (state.currentTime >= endTime) {
          // Hold duration has ended
          if (!isReleaseRequired) {
            // Auto-complete: no release required, count as HIT
            note.hitState = 'HIT';
            note.visible = false;
            state.score.score += SCORES.PERFECT;
            state.activeHoldNoteIds.delete(id);
            addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#facc15", 20, 1.5);
          } else if (state.pressedInputs.size === 0) {
            // User released at the right time (within the update loop, pressedInputs is already 0)
            // This case is handled in processRelease, but we also handle it here for safety
            note.hitState = 'HIT';
            note.visible = false;
            state.score.score += SCORES.PERFECT;
            state.activeHoldNoteIds.delete(id);
            addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#facc15", 20, 1.5);
          }
          // If release is required and user is still holding, wait for them to release
          // The miss will be triggered when they release too late (checked below)
        }
        
        // Check if user held too long past the end time (miss condition for requireRelease)
        if (isReleaseRequired && state.pressedInputs.size > 0 && state.currentTime > endTime + HIT_WINDOWS.GOOD) {
          // User is still holding past the release window - give a MISS
          note.hitState = 'MISSED';
          note.visible = false;
          state.combo = 0;
          state.score.miss++;
          state.activeHoldNoteIds.delete(id);
          addFloatingText(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "NO RELEASE!", "#ef4444");
          addParticles(getLaneX(canvasRef.current?.width || 800, canvasRef.current?.height || 600, note.lane), canvasRef.current?.height ? canvasRef.current.height - 150 : 500, "#ef4444", 30, 2);
        }
      }
    }

    const canvas = canvasRef.current;
    if (!canvas || !canvas.getContext('2d')) return;
    const ctx = canvas.getContext('2d')!;
    const { width, height } = canvas;
    const hitLineY = height - 150;
    const baseNoteSpeed = height / 2000;

    state.currentGlobalSpeedMultiplier += (state.targetGlobalSpeedMultiplier - state.currentGlobalSpeedMultiplier) * 0.05;

    const getEvValue = (type: EventType, defaultVal: number) => {
      let base = defaultVal;
      let activeEv = null;
      for (const ev of state.events) {
        if (ev.type !== type) continue;
        if (state.currentTime >= ev.time + ev.duration) base = ev.value;
        else if (state.currentTime >= ev.time) { activeEv = ev; break; }
      }
      if (activeEv) {
        const progress = activeEv.duration > 0 ? (state.currentTime - activeEv.time) / activeEv.duration : 1;
        return base + (activeEv.value - base) * getEasing(activeEv.easing || EasingType.LINEAR, Math.max(0, Math.min(1, progress)));
      }
      return base;
    };

    const finalNoteSpeed = baseNoteSpeed * getEvValue(EventType.NOTES_SPEED, 1.0) * state.currentGlobalSpeedMultiplier;

    // --- DRAW BACKGROUND (STARS) ---
    ctx.fillStyle = '#050510'; // Deep void
    ctx.fillRect(0, 0, width, height);

    // Update and Draw Stars
    ctx.fillStyle = '#ffffff';
    for (const star of state.stars) {
      // Move star down based on game speed + parallax
      star.y += finalNoteSpeed * dt * 0.5 * star.speedMod;

      // Reset if off screen
      if (star.y > height) {
        star.y = 0;
        star.x = Math.random() * width;
      }

      ctx.globalAlpha = star.opacity;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // --- CAMERA TRANSFORMS ---
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.scale(getEvValue(EventType.CAMERA_ZOOM, 1.0), getEvValue(EventType.CAMERA_ZOOM, 1.0));
    ctx.rotate((getEvValue(EventType.CAMERA_ROTATION, 0) * Math.PI) / 180);
    ctx.translate(-width / 2, -height / 2);

    if (state.cameraShake > 0) {
      const shakeX = (Math.random() - 0.5) * state.cameraShake;
      const shakeY = (Math.random() - 0.5) * state.cameraShake;
      ctx.translate(shakeX, shakeY);
      state.cameraShake *= 0.9;
      if (state.cameraShake < 0.5) state.cameraShake = 0;
    }

    // --- GRID / LANES ---
    // Draw Lanes
    const laneWidth = getLaneWidth(width, height);
    for (let i = 0; i < 4; i++) {
      const lx = getLaneX(width, height, i);
      // Lane Flash
      if (state.laneFlashes[i] > 0.01) {
        ctx.fillStyle = `rgba(255, 255, 255, ${state.laneFlashes[i] * 0.3})`;
        ctx.fillRect(lx - laneWidth / 2, 0, laneWidth, height);
        state.laneFlashes[i] *= 0.85;
      }
      // Lane guides
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, height);
      ctx.stroke();
    }

    // Judgement Line
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ec4899';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.fillRect(0, hitLineY - 2, width, 4);
    ctx.shadowBlur = 0;

    ctx.globalAlpha = getEvValue(EventType.NOTES_OPACITY, 1.0);

    // --- RENDER CONNECTORS (MULTI-HIT LINES) ---
    const visibleNotes = state.notes.filter(n => n.visible && n.hitState !== 'HIT' && (hitLineY - (n.time - state.currentTime) * finalNoteSpeed) < height + 100 && (hitLineY - (n.time - state.currentTime) * finalNoteSpeed) > -100);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 6;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'white';
    ctx.beginPath();

    for (let i = 0; i < visibleNotes.length - 1; i++) {
      const n1 = visibleNotes[i];
      const n2 = visibleNotes[i + 1];

      // Tolerance for "Simultaneous" (e.g., 10ms)
      if (Math.abs(n1.time - n2.time) < 10) {
        const timeDiff1 = n1.time - state.currentTime;
        const y1 = hitLineY - (timeDiff1 * finalNoteSpeed);
        const x1 = getLaneX(width, height, n1.lane);

        const timeDiff2 = n2.time - state.currentTime;
        const y2 = hitLineY - (timeDiff2 * finalNoteSpeed);
        const x2 = getLaneX(width, height, n2.lane);

        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;


    // --- RENDER NOTES ---

    // 1. Render Hold Tails (Behind heads)
    for (const note of state.notes) {
      if (!note.visible) continue;
      const timeDiff = note.time - state.currentTime;
      const y = hitLineY - (timeDiff * finalNoteSpeed);
      const x = getLaneX(width, height, note.lane);

      if (note.type === NoteType.HOLD && note.holdDuration) {
        const tailHeight = note.holdDuration * finalNoteSpeed;
        let tailY = y - tailHeight;
        let tailDrawHeight = tailHeight;

        // Visual consume effect
        if (note.hitState === 'HOLDING') {
          const endTime = note.time + note.holdDuration;
          const remainingTime = endTime - state.currentTime;
          if (remainingTime > 0) {
            tailDrawHeight = remainingTime * finalNoteSpeed;
            tailY = hitLineY - tailDrawHeight;

            // Draw active beam with enhanced effects
            ctx.save();
            ctx.shadowBlur = settings.stupidlyCrazyEffects ? 40 : 20;
            ctx.shadowColor = '#a855f7';
            
            if (settings.stupidlyCrazyEffects) {
              // Rainbow beam effect
              const hue = (timestamp / 10) % 360;
              ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
            } else {
              ctx.fillStyle = '#fff';
            }
            ctx.fillRect(x - 5, hitLineY - tailDrawHeight, 10, tailDrawHeight);
            
            // Add sparkle particles for hold
            if (settings.stupidlyCrazyEffects && Math.random() > 0.7) {
              addParticles(x, hitLineY - Math.random() * tailDrawHeight, '#a855f7', 2, 0.5);
            }
            ctx.restore();
          } else {
            tailDrawHeight = 0;
          }
        }

        if (tailDrawHeight > 0) {
          // Draw Tail Body
          const grad = ctx.createLinearGradient(x, tailY, x, tailY + tailDrawHeight);
          grad.addColorStop(0, 'rgba(168, 85, 247, 0.0)');
          grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.6)');
          grad.addColorStop(1, 'rgba(168, 85, 247, 0.8)');

          ctx.fillStyle = grad;
          ctx.fillRect(x - 20, tailY, 40, tailDrawHeight);

          // Draw Release Ball at the top of the tail
          // Yellow if requireRelease, otherwise White
          const ballY = tailY;
          const ballColor = note.requireRelease ? '#facc15' : '#ffffff';

          ctx.save();
          ctx.shadowBlur = 15;
          ctx.shadowColor = ballColor;
          ctx.fillStyle = ballColor;
          ctx.beginPath();
          ctx.arc(x, ballY, 15, 0, Math.PI * 2);
          ctx.fill();

          // Inner dot
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(x, ballY, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // 2. Render Note Heads
    for (const note of state.notes) {
      if (!note.visible) continue;
      // If holding, hide head
      if (note.hitState === 'HOLDING') continue;

      const timeDiff = note.time - state.currentTime;

      // Auto-hit HOLD_CLICK (Rusheb feature)
      if (note.type === NoteType.HOLD_CLICK && note.hitState === 'NONE' && timeDiff <= 0 && timeDiff >= -HIT_WINDOWS.MISS && state.pressedInputs.size > 0) {
        note.hitState = 'HIT'; note.visible = false;
        state.combo++; state.score.perfect++; state.score.score += SCORES.PERFECT;
        playHitSound(NoteType.HOLD_CLICK);
        if (note.mutationType) handleNoteMutation(note);
        state.laneFlashes[note.lane] = 1.0;
        addParticles(getLaneX(width, height, note.lane), hitLineY, '#2dd4bf', 15);
        continue;
      }

      if (timeDiff < -HIT_WINDOWS.MISS && note.hitState === 'NONE') {
        if (note.type === NoteType.MINE) {
          // Mines are IGNORED if they pass through. They only hurt if you hit them.
          note.hitState = 'HIT'; // Mark as "processed" but don't count score/combo
          note.visible = false;
        } else {
          note.hitState = 'MISSED';
          state.combo = 0;
          state.score.miss++;

          // Visual feedback for missing the note entirely
          const x = getLaneX(width, height, note.lane);
          addFloatingText(x, hitLineY, 'MISS', '#9ca3af');
          
          // Enhanced miss effects for stupidly crazy effects
          if (settings.stupidlyCrazyEffects) {
            addParticles(x, hitLineY, '#9ca3af', 40, 3);
            state.cameraShake = 20;
          }
        }
      }

      const y = hitLineY - (timeDiff * finalNoteSpeed);
      if (y > height + 100) continue;

      const x = getLaneX(width, height, note.lane);
      const color = note.type === NoteType.CLICK ? '#38bdf8' : note.type === NoteType.MINE ? '#ef4444' : note.type === NoteType.HOLD_CLICK ? '#2dd4bf' : '#a855f7';

      drawNote(ctx, note, x, y, color, false);
    }

    // Render Particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.2;
      p.life -= 0.02;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      } else {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1.0;

    // Render Floating Text
    for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
      const t = state.floatingTexts[i];
      t.y -= 1;
      t.scale += 0.01;
      t.life -= 0.02;
      if (t.life <= 0) {
        state.floatingTexts.splice(i, 1);
      } else {
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.scale(t.scale, t.scale);
        ctx.fillStyle = t.color;
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 4;
        ctx.font = "900 24px 'Arial Black', sans-serif";
        ctx.textAlign = 'center';
        ctx.fillText(t.text, 0, 0);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeText(t.text, 0, 0);
        ctx.restore();
      }
    }

    // Render Text Effects
    state.events.forEach(ev => {
      if (ev.type !== EventType.TEXT_EFFECT) return;
      if (state.currentTime < ev.time || state.currentTime > ev.time + ev.duration) return;

      const elapsed = state.currentTime - ev.time;
      const animProgress = ev.animDuration ? Math.min(1, elapsed / ev.animDuration) : 1;
      const easedAnim = getEasing(ev.easing || EasingType.LINEAR, animProgress);

      ctx.save();

      let x = width / 2;
      let y = height / 2;
      let opacity = 1;

      if (ev.appearance === 'GRADUAL') {
        opacity = easedAnim;
      } else if (ev.appearance === 'LEFT_CENTER') {
        x = -400 + (width / 2 + 400) * easedAnim;
      } else if (ev.appearance === 'RIGHT_CENTER') {
        x = width + 400 - (width / 2 + 400) * easedAnim;
      }

      // Handle fade out at end of duration
      const fadeOutTime = 300;
      const remaining = (ev.time + ev.duration) - state.currentTime;
      if (remaining < fadeOutTime) {
        opacity *= (remaining / fadeOutTime);
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

      // Styling
      let fontStr = '';
      if (ev.isItalic) fontStr += 'italic ';
      if (ev.isBold) fontStr += '900 ';
      fontStr += `${ev.fontSize || 40}px "${ev.font || 'Arial Black'}, sans-serif"`;

      ctx.font = fontStr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Shadow / Glow
      if (ev.shadowBlur) {
        ctx.shadowColor = ev.shadowColor || '#000';
        ctx.shadowBlur = ev.shadowBlur;
      } else if (ev.glowBlur) {
        ctx.shadowColor = ev.glowColor || '#fff';
        ctx.shadowBlur = ev.glowBlur;
      }

      // Border
      if (ev.borderWidth && ev.borderWidth > 0) {
        ctx.strokeStyle = ev.borderColor || '#000';
        ctx.lineWidth = ev.borderWidth;
        ctx.strokeText(ev.text || '', x, y);
      }

      ctx.fillStyle = ev.color || '#fff';
      ctx.fillText(ev.text || '', x, y);

      ctx.restore();
    });

    ctx.restore();

    // --- RENDER FALLING KEYS (Crazy Keyboard Mode) ---
    for (let i = state.fallingKeys.length - 1; i >= 0; i--) {
      const fk = state.fallingKeys[i];
      fk.y += 5;
      fk.opacity -= 0.008;
      fk.rotation += (Math.random() - 0.5) * 2;
      
      if (fk.opacity <= 0 || fk.y > height + 100) {
        state.fallingKeys.splice(i, 1);
      } else {
        ctx.save();
        ctx.translate(fk.x, fk.y);
        ctx.rotate((fk.rotation * Math.PI) / 180);
        ctx.scale(fk.scale, fk.scale);
        ctx.globalAlpha = fk.opacity;
        
        // Key background
        ctx.shadowBlur = 20;
        ctx.shadowColor = fk.color;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.roundRect(-25, -25, 50, 50, 8);
        ctx.fill();
        
        // Key border
        ctx.strokeStyle = fk.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Key text
        ctx.fillStyle = fk.color;
        ctx.font = "900 24px 'Arial Black', sans-serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fk.key, 0, 0);
        
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1.0;

    // --- RENDER RIPPLE EFFECTS (Stupidly Crazy Effects) ---
    for (let i = state.rippleEffects.length - 1; i >= 0; i--) {
      const ripple = state.rippleEffects[i];
      ripple.radius += 15;
      ripple.opacity -= 0.03;
      
      if (ripple.opacity <= 0) {
        state.rippleEffects.splice(i, 1);
      } else {
        ctx.save();
        ctx.globalAlpha = ripple.opacity;
        ctx.strokeStyle = ripple.color;
        ctx.lineWidth = 4;
        ctx.shadowBlur = 20;
        ctx.shadowColor = ripple.color;
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1.0;

    // HUD
    if (state.combo > 0) {
      ctx.save();
      ctx.translate(50, height - 50);
      
      // Enhanced combo effects for stupidly crazy effects
      if (settings.stupidlyCrazyEffects) {
        const comboScale = state.combo > 50 ? 1.5 : state.combo > 25 ? 1.3 : state.combo > 10 ? 1.1 : 1;
        const pulse = 1 + Math.sin(timestamp / 50) * 0.15 * comboScale;
        ctx.scale(pulse, pulse);
        
        // Rainbow color for high combos
        if (state.combo > 25) {
          const hue = (timestamp / 5) % 360;
          ctx.fillStyle = `hsl(${hue}, 100%, 70%)`;
        } else {
          ctx.fillStyle = '#fff';
        }
        
        // Glow effect
        ctx.shadowBlur = 30;
        ctx.shadowColor = state.combo > 50 ? '#facc15' : state.combo > 25 ? '#ec4899' : '#fff';
        
        ctx.font = "900 40px 'Arial Black', sans-serif";
        ctx.textAlign = 'left';
        ctx.fillText(`${state.combo}x`, 0, 0);
        
        // Outline
        ctx.strokeStyle = state.combo > 25 ? '#fff' : '#ec4899';
        ctx.lineWidth = 2;
        ctx.strokeText(`${state.combo}x`, 0, 0);
      } else {
        const pulse = 1 + Math.sin(timestamp / 50) * 0.1;
        ctx.scale(pulse, pulse);
        ctx.fillStyle = '#fff';
        ctx.font = "900 40px 'Arial Black', sans-serif";
        ctx.textAlign = 'left';
        ctx.fillText(`${state.combo}x`, 0, 0);
        ctx.fillStyle = '#ec4899';
        ctx.fillText(`${state.combo}x`, 2, 2);
      }
      ctx.restore();
      
      // Combo milestone effects
      if (settings.stupidlyCrazyEffects && (state.combo === 10 || state.combo === 25 || state.combo === 50 || state.combo === 100)) {
        state.rippleEffects.push({ x: width / 2, y: height / 2, radius: 0, opacity: 1, color: '#facc15' });
        addFloatingText(width / 2, height / 2 - 100, `${state.combo}x COMBO!`, '#facc15');
      }
    }

    ctx.fillStyle = '#fff';
    ctx.font = "bold 24px monospace";
    ctx.textAlign = 'right';
    ctx.fillText(`SCORE: ${state.score.score.toLocaleString()}`, width - 20, 40);

    const progress = Math.min(1, Math.max(0, state.currentTime / beatmap.duration));
    ctx.fillStyle = '#333';
    ctx.fillRect(0, 0, width, 8);
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(0, 0, width * progress, 8);

    if (state.isPlaying) requestRef.current = requestAnimationFrame(update);
  }, [beatmap, settings, onEnd, playHitSound, drawNote]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Escape') { togglePause(); return; }
      
      // Check if key is allowed based on keyMode
      const keyMode = settings.keyMode || KeyMode.ALL_KEYS;
      const keyBindings = settings.keyBindings || DEFAULT_KEY_BINDINGS;
      
      if (keyMode === KeyMode.FOUR_KEYS) {
        const pressedKey = e.key.toUpperCase();
        if (!keyBindings.includes(pressedKey)) {
          return; // Ignore keys not in the binding list
        }
      }
      
      processHit(undefined, e.key.toUpperCase(), e.code);
      
      // Add falling key for crazy keyboard mode
      if (settings.crazyKeyboardMode) {
        const state = stateRef.current;
        const canvas = canvasRef.current;
        if (canvas) {
          const colors = ['#ec4899', '#f97316', '#facc15', '#4ade80', '#38bdf8', '#a855f7'];
          state.fallingKeys.push({
            key: e.key.toUpperCase(),
            x: Math.random() * (canvas.width - 100) + 50,
            y: -50,
            opacity: 1,
            scale: 1.5 + Math.random() * 0.5,
            rotation: (Math.random() - 0.5) * 30,
            color: colors[Math.floor(Math.random() * colors.length)]
          });
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => processRelease(e.code);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => { window.removeEventListener('keydown', handleKeyDown); window.removeEventListener('keyup', handleKeyUp); };
  }, [togglePause, processHit, processRelease, settings.keyMode, settings.keyBindings]);

  useEffect(() => {
    handleRestart();
    stateRef.current.isPlaying = true;
    requestRef.current = requestAnimationFrame(update);
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); if (audioRef.current) audioRef.current.pause(); };
  }, [beatmap, handleRestart, update]);

  return (
    <div ref={containerRef} className="flex-1 w-full h-full relative bg-black overflow-hidden">
      {beatmap.audioData && <audio ref={audioRef} src={beatmap.audioData} className="hidden" />}
      <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight} className="block w-full h-full" />
      {isPaused && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 border-2 border-pink-500 rounded-3xl p-8 flex flex-col items-center gap-6 shadow-[0_0_50px_rgba(236,72,153,0.3)] w-80">
            <h2 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 to-purple-500 italic mb-4">PAUSED</h2>
            <button onClick={togglePause} className="w-full py-4 bg-pink-600 hover:bg-pink-500 rounded-xl font-black transition-all shadow-[0_0_15px_rgba(236,72,153,0.5)] text-white hover:scale-105">RESUME</button>
            <button onClick={handleRestart} className="w-full py-4 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-all border border-gray-500 text-white">RESTART</button>
            <button onClick={onAbort} className="w-full py-4 bg-red-900/80 hover:bg-red-800 rounded-xl font-bold transition-all border border-red-500 text-white">QUIT TO MENU</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameCanvas;