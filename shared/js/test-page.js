/**
 * test-page.js
 * Starts an instrument's production test in a test page: loads the annotated
 * faceplate into #visualization, runs the instrument's setup, and connects MIDI
 * with autodetect — when the other instrument is plugged in, the page switches
 * to its test.
 *
 * Each instrument's js/test.js default-exports:
 *   profile     device profile (js/device.js)
 *   faceplate   URL of the annotated faceplate SVG
 *   start({ statusEl, listEl, visualizationEl })
 *               visualizer, test runner and MIDI listeners; the faceplate is in
 *               the DOM by then, MIDI is connected right after
 */

import { initMIDI } from './midi.js';
import { DRUM } from '../../drum/js/device.js';
import { DUO } from '../../duo/js/device.js';

const PROFILES = [DRUM, DUO];

export async function startTest(test) {
  const statusEl = document.getElementById('midi-status');
  const listEl = document.getElementById('test-list');
  const visualizationEl = document.getElementById('visualization');

  try {
    const res = await fetch(test.faceplate);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    // Drop the XML declaration: not valid inside HTML
    const svg = (await res.text()).replace(/^<\?xml[^>]*>\s*/, '');
    visualizationEl.insertAdjacentHTML('beforeend', svg);
  } catch (err) {
    statusEl.textContent = `Could not load the faceplate: ${err.message}`;
    return;
  }

  test.start({ statusEl, listEl, visualizationEl });
  initMIDI(statusEl, test.profile, PROFILES.filter(p => p !== test.profile));

  // Another instrument was plugged in: switch to its test
  document.addEventListener('midi-other-device', e => {
    location.replace(`../${e.detail.id}/test.html${location.search}`);
  });
}
