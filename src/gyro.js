// ── gyro.js ──────────────────────────────────────────────────────────────
// Phone-tilt look-around for center view, via the DeviceOrientationEvent
// API — the same sensor fusion (accelerometer+magnetometer+gyroscope)
// AR/VR-style "look around" apps use. Tracks ROTATION RELATIVE TO WHERE
// THE PHONE WAS POINTING when gyro started (not absolute compass
// heading) — the natural behavior users expect ("turn your phone, the
// view turns the same amount"), decoupled from magnetometer drift/
// calibration accuracy and from whatever direction the phone happened to
// be facing in the room when center view was entered.
//
// iOS 13+ gates DeviceOrientationEvent behind an explicit permission
// prompt (DeviceOrientationEvent.requestPermission()) that MUST be
// invoked synchronously from within a real user-gesture handler (a
// click) — deferring it even by one microtask/await risks Safari
// rejecting it. requestGyroPermission() below is written to be called
// directly from a click handler for exactly that reason (main.js calls it
// from inside the "View from center" button's own click handler, so no
// separate tap/prompt is needed — entering center view IS the gesture).

import * as THREE from 'three';

export function isCoarsePointerDevice() {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function deviceOrientationNeedsPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
}

// Call directly from a click handler — see file header. Resolves true if
// orientation events will actually fire (permission just granted, or this
// platform never gates them), false if denied or the API doesn't exist.
export function requestGyroPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return Promise.resolve(false);
  if (!deviceOrientationNeedsPermission()) return Promise.resolve(true);
  return DeviceOrientationEvent.requestPermission().then((state) => state === 'granted').catch(() => false);
}

// Converts the phone's own orientation frame (alpha=compass heading
// around Z, beta=front-back tilt around X, gamma=left-right tilt around
// Y — the W3C DeviceOrientationEvent axes) into three.js's camera
// convention (looking down -Z, +Y up). Q1 is a fixed -90° rotation about
// X: a phone lying flat, screen up, top edge away from the user has its
// own +Z pointing straight up out of the screen — Q1 tips that over to
// point along the camera's forward (-Z) instead. This is the only
// geometrically correct value for it, not a tunable parameter — same
// algorithm every device-orientation-driven camera control implements
// (it's the fixed coordinate-frame transform the W3C spec's axes require,
// not a stylistic choice).
const EULER = new THREE.Euler();
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const ZEE = new THREE.Vector3(0, 0, 1);
const SCREEN_ADJUST = new THREE.Quaternion();

function deviceQuaternion(alphaDeg, betaDeg, gammaDeg, screenAngleDeg, out) {
  const d = Math.PI / 180;
  EULER.set(betaDeg * d, alphaDeg * d, -gammaDeg * d, 'YXZ');
  out.setFromEuler(EULER);
  out.multiply(Q1);
  out.multiply(SCREEN_ADJUST.setFromAxisAngle(ZEE, -screenAngleDeg * d));
  return out;
}

// Returns { start(cameraQuaternion), stop(), isLive, apply(out) }.
export function createGyroLookAround() {
  let baseline = null; // THREE.Quaternion — device reading captured at start()
  let initialCameraQuaternion = null; // THREE.Quaternion — camera pose at start()
  let latestDeviceQuaternion = null; // THREE.Quaternion — most recent reading
  const scratch = new THREE.Quaternion();
  const deltaInverse = new THREE.Quaternion();

  function onOrientation(e) {
    // Some browsers fire one null-filled event before real sensor data
    // arrives — skip it rather than let it become a bogus baseline.
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    const screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    latestDeviceQuaternion = deviceQuaternion(e.alpha, e.beta, e.gamma, screenAngle, latestDeviceQuaternion ?? new THREE.Quaternion());
    if (!baseline) baseline = latestDeviceQuaternion.clone();
  }

  return {
    start(cameraQuaternion) {
      baseline = null;
      latestDeviceQuaternion = null;
      initialCameraQuaternion = cameraQuaternion.clone();
      window.addEventListener('deviceorientation', onOrientation);
    },
    stop() {
      window.removeEventListener('deviceorientation', onOrientation);
      baseline = null;
      latestDeviceQuaternion = null;
    },
    // True once real sensor data has actually arrived. Callers should keep
    // their existing (touch-drag) control scheme active until this flips
    // true — permission can be granted but some browsers/devices still
    // never actually deliver events, and without this check that would
    // silently leave the user with no way to look around at all.
    get isLive() { return baseline !== null; },
    // Writes the gyro-driven orientation into `out`. No-op (returns false)
    // until isLive.
    apply(out) {
      if (!baseline || !latestDeviceQuaternion) return false;
      // Incremental WORLD rotation since start(): "undo" baseline, then
      // apply the current reading — see file header for why this is
      // relative to the start pose, not absolute compass heading.
      const delta = scratch.copy(latestDeviceQuaternion).multiply(deltaInverse.copy(baseline).invert());
      out.copy(delta).multiply(initialCameraQuaternion);
      return true;
    },
  };
}
