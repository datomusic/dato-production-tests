/**
 * tone.js
 * Sine wave generator for the line-in test (test.html).
 *
 * The browser's audio output is cabled to the DRUM's line input and judged by
 * ear — there is no measurement loop back into the computer, so this has no
 * entry in the test list. A speaker button toggles the tone; its frequency
 * follows the PITCH1 slider (see test.js). Starts muted, and is muted again
 * on every test reset.
 */

// CC 0–127 maps exponentially over TONE_OCTAVES from TONE_MIN_HZ (110 → 1760 Hz,
// A2 … A6), so the slider's center lands near 440 Hz and each step sounds like
// an equal interval.
const TONE_MIN_HZ = 110;
const TONE_OCTAVES = 4;
const TONE_GAIN = 0.5;
const RAMP_S = 0.02; // short fade in/out to avoid clicks on toggle
const GLIDE_S = 0.01; // pitch glide time constant

let ctx = null;
let gain = null;
let osc = null;
let buttonEl = null;
let frequency = TONE_MIN_HZ * 2 ** (TONE_OCTAVES * 64 / 127);
let playing = false;
let glidePending = false;

/** Wire the toggle button. Audio is created lazily on the first click (user gesture). */
export function initTone(el) {
  buttonEl = el;
  buttonEl.addEventListener('click', () => setTonePlaying(!playing));
  updateButton();
}

/**
 * Set the tone frequency from a 0–127 CC value. A fast slider move sends a
 * burst of CCs; scheduling an automation event for each one piles them up on
 * the audio thread, which garbles the sound on slower machines. Instead keep
 * only the latest value and glide to it at most once per animation frame.
 */
export function setToneCC(value) {
  frequency = TONE_MIN_HZ * 2 ** (TONE_OCTAVES * value / 127);
  if (osc && !glidePending) {
    glidePending = true;
    requestAnimationFrame(glideToFrequency);
  }
}

function glideToFrequency() {
  glidePending = false;
  const f = osc.frequency;
  const t = ctx.currentTime;
  // Drop the previous glide and hold the current pitch, so the timeline never
  // holds more than one pending event.
  if (f.cancelAndHoldAtTime) {
    f.cancelAndHoldAtTime(t);
  } else {
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
  }
  f.setTargetAtTime(frequency, t, GLIDE_S);
}

export function muteTone() {
  setTonePlaying(false);
}

function setTonePlaying(on) {
  if (on && !ctx) createAudio();
  playing = on;
  if (ctx) {
    if (on && ctx.state === 'suspended') ctx.resume();
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(on ? TONE_GAIN : 0, ctx.currentTime, RAMP_S);
  }
  updateButton();
}

function createAudio() {
  // A test tone doesn't need low latency; a larger buffer rides out CPU
  // hiccups on the older production Macs without underrunning.
  ctx = new AudioContext({ latencyHint: 'playback' });
  gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = frequency;
  osc.connect(gain);
  osc.start();
}

function updateButton() {
  if (!buttonEl) return;
  buttonEl.classList.toggle('muted', !playing);
  buttonEl.setAttribute('aria-pressed', String(playing));
  buttonEl.title = playing ? 'Mute sine wave' : 'Play sine wave (pitch: PITCH1 slider)';
}
