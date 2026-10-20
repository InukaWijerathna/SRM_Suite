// Web Audio synth chimes + haptics for the scanner. No audio files to load or cache.

let ctx: AudioContext | null = null;
let muted = false;

type AudioCtor = typeof AudioContext;

function getContext(): AudioContext | null {
  const Ctor: AudioCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Browsers only let audio start from a user gesture (iOS Safari is strictest). Call this
 * from a tap handler; scan callbacks fire outside gestures and rely on it having run.
 */
export function unlockAudio() {
  const c = getContext();
  if (c && c.state === 'suspended') void c.resume();
}

export const setSoundEnabled = (enabled: boolean) => {
  muted = !enabled;
};

function tone(freq: number, start: number, duration: number, volume = 0.22) {
  const c = getContext();
  if (!c || muted) return;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Short attack/release envelope so the tone doesn't click.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Valid scan: one bright 0.1s beep. */
export function playSuccess() {
  tone(1046.5, 0, 0.1);
}

/** Duplicate scan: lower double-beep. */
export function playDuplicate() {
  tone(330, 0, 0.09);
  tone(330, 0.15, 0.09);
}

/** Unknown / inactive ID: a single low buzz. */
export function playError() {
  tone(180, 0, 0.22, 0.26);
}

/** navigator.vibrate is missing on iOS Safari; treat it as best-effort. */
export function vibrate(pattern: number | number[]) {
  if (muted) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
