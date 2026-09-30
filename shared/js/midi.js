/**
 * midi.js
 * Web MIDI API wrapper, shared by every instrument.
 * Parses incoming MIDI messages and dispatches typed CustomEvents on `document`.
 * Everything instrument-specific (the SysEx dialect) lives in a device profile
 * passed to initMIDI() — see drum/js/device.js and duo/js/device.js.
 *
 * Events dispatched here:
 *   'midi-cc'               detail: { channel, cc, value }
 *   'midi-note-on'          detail: { channel, note, velocity, time }
 *   'midi-note-off'         detail: { channel, note, time }
 *   'midi-aftertouch'       detail: { channel, note, pressure }
 *   'midi-clock'            detail: { time }
 *   'midi-transport'        detail: { type: 'start'|'continue'|'stop' }
 *   'midi-firmware-version' detail: { version }
 *   'midi-connected'        detail: { name }
 *   'midi-disconnected'     detail: { name }
 *   'midi-other-device'     detail: { id, name }  one of the other profiles answered instead
 * `time` is the message's DOMHighResTimeStamp (ms). Device profiles dispatch
 * their own SysEx-derived events through dispatch().
 *
 * Device profile:
 *   id                         'drum' / 'duo' (the instrument's folder)
 *   name                       shown in the "plug in the …" status message
 *   requestFirmwareVersion()   send the firmware version request (retried until answered)
 *   matches(data)              is this SysEx message in the profile's dialect?
 *   onConnected()              optional: further requests / polling, once the device
 *                              has identified itself
 *   onDisconnected()           optional: stop polling
 *   parseSysEx(data)           handle an incoming SysEx message; return the version
 *                              string if it was a firmware version response
 *
 * Autodetect: initMIDI() may also be given the profiles of other instruments.
 * On connect their firmware version requests are sent along with the page's own;
 * the dialect of the first reply tells which instrument is plugged in. The page's
 * own device is only set up (onConnected) once it has answered; if another one
 * answers, 'midi-other-device' is dispatched so the page can switch.
 */

let midiAccess = null;
let device = null;
let otherDevices = [];
let deviceName = null;
let firmwareVersion = null;
let statusElement = null;

// Per connection: the profile whose dialect answered first (null until then),
// and whether the page's own device has been set up with onConnected().
let identified = null;
let started = false;

/** Send a raw MIDI message (e.g. a complete F0 … F7 SysEx) to every connected output. */
export function sendMessage(msg) {
  if (!midiAccess) return;
  for (const output of midiAccess.outputs.values()) {
    // Sending on a disconnected port throws InvalidStateError; skip stale ports
    if (output.state !== 'connected') continue;
    output.send(msg);
  }
}

// After a hot-plug the input port reports 'connected' before the output port
// does (and before the device is ready to answer), so a single request is lost.
// Retry the firmware version request until a response arrives.
const VERSION_RETRY_INTERVAL_MS = 500;
const VERSION_RETRY_MAX = 10;
let versionRetryTimer = null;

function requestFirmwareVersionWithRetry() {
  stopVersionRetry();
  let attempts = 0;
  const attempt = () => {
    if (firmwareVersion !== null || (identified && identified !== device)) {
      stopVersionRetry();
      return;
    }
    if (attempts >= VERSION_RETRY_MAX) {
      stopVersionRetry();
      // Nothing answered: carry on as the page's own device, as before autodetect
      startDevice();
      return;
    }
    attempts++;
    device.requestFirmwareVersion();
    // Probe the other instruments until something answers
    if (!identified) for (const other of otherDevices) other.requestFirmwareVersion();
  };
  attempt();
  versionRetryTimer = setInterval(attempt, VERSION_RETRY_INTERVAL_MS);
}

function stopVersionRetry() {
  if (versionRetryTimer !== null) {
    clearInterval(versionRetryTimer);
    versionRetryTimer = null;
  }
}

/** Set up the page's own device (once per connection). */
function startDevice() {
  if (started) return;
  started = true;
  device.onConnected?.();
}

/**
 * @param {Element}  statusEl       status line
 * @param {object}   deviceProfile  the page's instrument
 * @param {object[]} [others]       other instruments to recognise (see Autodetect above)
 */
export async function initMIDI(statusEl, deviceProfile, others = []) {
  statusElement = statusEl;
  device = deviceProfile;
  otherDevices = others;
  if (!navigator.requestMIDIAccess) {
    setStatus('Web MIDI API not supported in this browser.');
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: true });
  } catch (err) {
    setStatus(`MIDI access denied: ${err.message}`);
    return;
  }

  function onConnected() {
    identified = null;
    started = false;
    requestFirmwareVersionWithRetry();
  }

  function attachInputs() {
    let count = 0;
    for (const input of midiAccess.inputs.values()) {
      input.onmidimessage = onMessage;
      count++;
    }
    const names = [...midiAccess.inputs.values()].map(i => i.name).join(', ');
    if (count > 0) {
      deviceName = names;
      updateConnectedStatus();
      dispatch('midi-connected', { name: names });
      onConnected();
    } else {
      const names = [device, ...otherDevices].map(p => p.name).join(' or ');
      setStatus(`No MIDI input – plug in a ${names}`);
    }
  }

  attachInputs();

  midiAccess.onstatechange = (e) => {
    const port = e.port;
    if (port.type === 'output') {
      // Output port came up after the input: (re)send the initial requests now
      if (port.state === 'connected' && deviceName && !identified) onConnected();
      return;
    }
    if (port.state === 'connected') {
      port.onmidimessage = onMessage;
      deviceName = port.name;
      firmwareVersion = null;
      updateConnectedStatus();
      dispatch('midi-connected', { name: port.name });
      onConnected();
    } else {
      device.onDisconnected?.();
      stopVersionRetry();
      deviceName = null;
      firmwareVersion = null;
      identified = null;
      started = false;
      setStatus(`Disconnected: ${port.name}`);
      dispatch('midi-disconnected', { name: port.name });
    }
  };
}

function updateConnectedStatus() {
  if (!deviceName) return;
  setStatus(firmwareVersion ? `Connected: ${deviceName} (${firmwareVersion})` : `Connected: ${deviceName}`);
}

function onSysEx(data) {
  const other = otherDevices.find(p => p.matches(data));
  if (other) {
    onOtherDevice(other);
    return;
  }
  if (!identified && device.matches(data)) {
    identified = device;
    startDevice();
  }
  const version = device.parseSysEx(data);
  if (version == null) return;
  firmwareVersion = version;
  stopVersionRetry();
  console.log(`sysex: firmware version ${firmwareVersion}`);
  updateConnectedStatus();
  dispatch('midi-firmware-version', { version: firmwareVersion });
}

/** Another instrument answered: stop talking to it and let the page switch. */
function onOtherDevice(other) {
  if (identified === other) return;
  identified = other;
  stopVersionRetry();
  if (started) device.onDisconnected?.();
  started = false;
  console.log(`sysex: ${other.name} answered – not a ${device.name}`);
  setStatus(`${other.name} connected`);
  dispatch('midi-other-device', { id: other.id, name: other.name });
}

function onMessage(e) {
  const [status, data1, data2] = e.data;
  const type = status & 0xF0;
  const channel = status & 0x0F;
  const time = e.timeStamp;

  if (status === 0xF0) {
    onSysEx(e.data);
    return;
  }

  switch (status) {
    case 0xF8: // MIDI Clock
      dispatch('midi-clock', { time });
      return;
    case 0xFA: // Start
      dispatch('midi-transport', { type: 'start' });
      return;
    case 0xFB: // Continue
      dispatch('midi-transport', { type: 'continue' });
      return;
    case 0xFC: // Stop
      dispatch('midi-transport', { type: 'stop' });
      return;
  }

  switch (type) {
    case 0x80: // Note Off
      dispatch('midi-note-off', { channel, note: data1, time });
      break;
    case 0x90: // Note On
      if (data2 === 0) {
        dispatch('midi-note-off', { channel, note: data1, time });
      } else {
        dispatch('midi-note-on', { channel, note: data1, velocity: data2, time });
      }
      break;
    case 0xA0: // Polyphonic Aftertouch
      dispatch('midi-aftertouch', { channel, note: data1, pressure: data2 });
      break;
    case 0xB0: // Control Change
      dispatch('midi-cc', { channel, cc: data1, value: data2 });
      break;
  }
}

export function dispatch(name, detail) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function setStatus(text) {
  if (statusElement) statusElement.textContent = text;
}
