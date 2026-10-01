/**
 * test-page.js
 * The production test page (test.html at the root), for every instrument.
 *
 * test.html?device=drum|duo loads that instrument's test: its stylesheets, the
 * annotated faceplate into #visualization, then its setup, and connects MIDI with
 * autodetect. Without (a known) ?device the page only detects. Whenever another
 * instrument answers than the one loaded, the page reloads with its ?device — so
 * swapping devices on an open page switches the test.
 *
 * Each instrument's js/test.js default-exports:
 *   profile     device profile (js/device.js)
 *   css         stylesheet URLs, on top of shared/css/test.css
 *   faceplate   URL of the annotated faceplate SVG
 *   start({ statusEl, listEl, visualizationEl })
 *               visualizer, test runner and MIDI listeners; the faceplate is in
 *               the DOM by then, MIDI is connected right after
 */

import { initMIDI } from './midi.js';
import { DRUM } from '../../drum/js/device.js';
import { DUO } from '../../duo/js/device.js';

const PROFILES = [DRUM, DUO];

// Only the instrument in use is loaded
const TESTS = {
  drum: () => import('../../drum/js/test.js'),
  duo: () => import('../../duo/js/test.js'),
};

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = resolve;
    link.onerror = () => reject(new Error(`${href} did not load`));
    document.head.append(link);
  });
}

async function fetchFaceplate(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  // Drop the XML declaration: not valid inside HTML
  return (await res.text()).replace(/^<\?xml[^>]*>\s*/, '');
}

export async function startTestPage() {
  const statusEl = document.getElementById('midi-status');
  const listEl = document.getElementById('test-list');
  const visualizationEl = document.getElementById('visualization');
  const titleEl = document.getElementById('test-title');

  // Another instrument answered (or, while detecting, any): reload as its test
  document.addEventListener('midi-other-device', e => {
    const url = new URL(location.href);
    url.searchParams.set('device', e.detail.id);
    location.replace(url);
  });

  const id = new URLSearchParams(location.search).get('device');
  if (!Object.hasOwn(TESTS, id ?? '')) {
    initMIDI(statusEl, null, PROFILES);
    return;
  }

  let test;
  try {
    test = (await TESTS[id]()).default;
    const [svg] = await Promise.all([fetchFaceplate(test.faceplate), ...test.css.map(loadStylesheet)]);
    visualizationEl.insertAdjacentHTML('beforeend', svg);
  } catch (err) {
    statusEl.textContent = `Could not load the ${id} test: ${err.message}`;
    return;
  }

  const { name } = test.profile;
  document.title = `Dato ${name} — Production Test`;
  titleEl.textContent = `${name} production test`;

  test.start({ statusEl, listEl, visualizationEl });
  initMIDI(statusEl, test.profile, PROFILES.filter(p => p !== test.profile));
}
