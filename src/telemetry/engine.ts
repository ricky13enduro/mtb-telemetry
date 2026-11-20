import * as Location from "expo-location";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { Accelerometer, DeviceMotion, Gyroscope } from "expo-sensors";
import { Platform } from "react-native";

import { saveRun } from "./runs";
import { emptyStats, Jump, PermStatus, RunRecord, RunState, RunStats, TrackPoint } from "./types";

const G0 = 9.81;
const KEEP_AWAKE_TAG = "mtb-telemetry";

// Jump detection thresholds (orientation-independent, |a| / g)
const FREEFALL_G = 0.38;
const FREEFALL_MIN_MS = 170;
const LANDING_G = 1.8;
const MAX_AIR_MS = 5000;

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec) => Math.sqrt(dot(a, a));

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR;
  const dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toR = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * toR) * Math.cos(lat2 * toR);
  const x =
    Math.cos(lat1 * toR) * Math.sin(lat2 * toR) - Math.sin(lat1 * toR) * Math.cos(lat2 * toR) * Math.cos((lon2 - lon1) * toR);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

type MotionSample = {
  accelerationIncludingGravity: { x: number; y: number; z: number } | null;
  rotationRate: { alpha: number; beta: number; gamma: number } | null;
};

function webMotionRequester(): (() => Promise<string>) | null {
  if (Platform.OS !== "web") return null;
  const D = (globalThis as any).DeviceMotionEvent;
  return D && typeof D.requestPermission === "function" ? () => D.requestPermission() : null;
}

type FrameListener = (latG: number, lonG: number, g: number) => void;

class TelemetryEngine {
  state: RunState = "READY";
  motionPerm: PermStatus = "unknown";
  gpsPerm: PermStatus = "unknown";
  initialized = false;

  live = {
    g: 1,
    latG: 0,
    lonG: 0,
    lean: 0,
    speedKmh: 0,
    altitude: null as number | null,
    heading: null as number | null,
    accuracy: null as number | null,
    airborne: false,
    airStart: 0,
    motionHz: 0,
    hasFix: false,
  };
  stats: RunStats = emptyStats();
  track: TrackPoint[] = [];
  jumps: Jump[] = [];
  trackVersion = 0;
  lastSaved: RunRecord | null = null;

  private listeners = new Set<() => void>();
  private frameListeners = new Set<FrameListener>();
  private motionSubs: { remove: () => void }[] = [];
  private watchdogs: ReturnType<typeof setTimeout>[] = [];
  private locSub: Location.LocationSubscription | null = null;

  // timing
  private startedAt = 0;
  private activeMs = 0;
  private segStart = 0;
  private movingMs = 0;
  private resumeGap = false;

  // motion internals
  private lastMotionT = 0;
  private hzCount = 0;
  private hzT = 0;
  private gLP = 1; // low-pass |a| (trail chatter filter)
  private gFast = 1;
  private grav: Vec = [0, 0, G0];
  private gravInit = false;
  private yawGyro = 0;
  private hasGyro = false;
  private lowStart: number | null = null;
  private softStart: number | null = null;
  private airMaxG = 0;
  private pendingJump: Jump | null = null;
  private pendingUntil = 0;
  private pointPeakG = 0;

  // gps internals
  private lastFix: { lat: number; lon: number; t: number } | null = null;
  private lastCourse: { lat: number; lon: number; t: number; brg: number } | null = null;
  private gpsSpeed = 0; // m/s, smoothed
  private gpsYawRate = 0; // rad/s
  private lonGps = 0;
  private lonGpsT = 0;
  private altF: number | null = null;
  private altRef: number | null = null;
  private lastRecPt: TrackPoint | null = null;
  private lastRecT = 0;

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onFrame(fn: FrameListener) {
    this.frameListeners.add(fn);
    return () => {
      this.frameListeners.delete(fn);
    };
  }

  private wakeLocked = false;
  private wakePromise: Promise<void> = Promise.resolve();
  private releaseWakeLock() {
    if (!this.wakeLocked) return;
    this.wakeLocked = false;
    this.wakePromise
      .then(() => deactivateKeepAwake(KEEP_AWAKE_TAG))
      .catch(() => {});
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  get elapsedMs() {
    return this.activeMs + (this.state === "RECORDING" ? Date.now() - this.segStart : 0);
  }

  get avgSpeed() {
    const ms = this.movingMs > 0 ? this.movingMs : this.elapsedMs;
    return ms > 1000 ? this.stats.distanceM / 1000 / (ms / 3600000) : 0;
  }

  get permsGranted() {
    // Motion "denied" only means iOS Safari still needs the tap prompt; everything else lets the app run
    return this.gpsPerm === "granted" && this.motionPerm !== "denied";
  }

  // ---------- permissions & sensors ----------
  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this.startMotion();
    try {
      const l = await Location.getForegroundPermissionsAsync();
      this.gpsPerm = l.granted ? "granted" : l.canAskAgain ? "unknown" : "blocked";
    } catch {
      this.gpsPerm = "unknown";
    }
    await this.startGps();
    this.emit();
  }

  async requestPermissions() {
    // iOS Safari: requestPermission must be called synchronously inside the tap, before any await
    const webReq = webMotionRequester();
    const webP = webReq && this.motionPerm !== "granted" ? webReq() : null;
    if (webP) {
      this.webAsked = true;
      const restart = () => {
        this.stopMotion();
        this.motionPerm = "unknown";
        this.startMotion();
        this.emit();
      };
      webP.then(restart, restart);
    } else if (this.motionPerm !== "granted") {
      this.retryMotion();
    }
    if (this.gpsPerm !== "granted") {
      try {
        let l = await Location.getForegroundPermissionsAsync();
        if (!l.granted && l.canAskAgain) l = await Location.requestForegroundPermissionsAsync();
        this.gpsPerm = l.granted ? "granted" : l.canAskAgain ? "denied" : "blocked";
      } catch {
        this.gpsPerm = "denied";
      }
    }
    await this.startGps();
    this.emit();
  }

  retryMotion() {
    const webReq = webMotionRequester();
    if (webReq) {
      this.requestPermissions();
      return;
    }
    this.stopMotion();
    this.motionPerm = "unknown";
    this.startMotion();
    this.emit();
  }

  private stopMotion() {
    this.motionSubs.forEach((s) => s.remove());
    this.motionSubs = [];
    this.watchdogs.forEach(clearTimeout);
    this.watchdogs = [];
    this.lastMotionT = 0;
  }

  /**
   * Raw accelerometer + gyroscope data need no runtime permission on iOS/Android.
   * (expo's DeviceMotion "permission" is Motion & Fitness / ACTIVITY_RECOGNITION, which is
   * not needed for telemetry, so we never gate on it.) We just subscribe and verify samples arrive.
   */
  private webAsked = false;

  private startMotion() {
    if (this.motionSubs.length) return;
    this.lastMotionT = 0;
    if (Platform.OS === "web") {
      const w = globalThis as any;
      if (typeof w.DeviceMotionEvent === "undefined") {
        this.motionPerm = "unavailable";
        return;
      }
      const handler = (e: any) =>
        this.onMotion({ accelerationIncludingGravity: e.accelerationIncludingGravity, rotationRate: e.rotationRate });
      w.addEventListener("devicemotion", handler);
      this.motionSubs.push({ remove: () => w.removeEventListener("devicemotion", handler) });
    } else {
      try {
        DeviceMotion.setUpdateInterval(16);
        this.motionSubs.push(DeviceMotion.addListener((m) => this.onMotion(m)));
      } catch {}
      // Fallback: raw Accelerometer + Gyroscope if DeviceMotion stays silent
      this.watchdogs.push(
        setTimeout(() => {
          if (this.lastMotionT) return;
          // drop the silent DeviceMotion sub so samples are never doubled
          this.motionSubs.forEach((sub) => sub.remove());
          this.motionSubs = [];
          try {
            let gyro: MotionSample["rotationRate"] = null;
            const D = 180 / Math.PI;
            Gyroscope.setUpdateInterval(16);
            this.motionSubs.push(
              Gyroscope.addListener((g) => {
                gyro = { alpha: g.z * D, beta: g.x * D, gamma: g.y * D };
              }),
            );
            Accelerometer.setUpdateInterval(16);
            this.motionSubs.push(
              Accelerometer.addListener((a) =>
                this.onMotion({ accelerationIncludingGravity: { x: a.x * G0, y: a.y * G0, z: a.z * G0 }, rotationRate: gyro }),
              ),
            );
          } catch {}
        }, 2000),
      );
    }
    this.watchdogs.push(
      setTimeout(() => {
        if (!this.lastMotionT) {
          // iOS-style browsers still need the tap prompt; otherwise sensors are just silent
          this.motionPerm = webMotionRequester() && !this.webAsked ? "denied" : "unavailable";
          this.emit();
        }
      }, 4500),
    );
  }

  private async startGps() {
    if (this.gpsPerm === "granted" && !this.locSub) {
      try {
        this.locSub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
          this.onLocation,
        );
      } catch {
        this.locSub = null;
      }
    }
  }

  // ---------- run controls ----------
  start() {
    const now = Date.now();
    if (this.state === "READY" || this.state === "STOPPED") {
      this.clearData();
      this.lastSaved = null;
      this.startedAt = now;
    }
    if (this.state === "PAUSED") this.resumeGap = true;
    this.lastRecT = 0;
    this.segStart = now;
    this.state = "RECORDING";
    if (!this.wakeLocked) {
      this.wakeLocked = true;
      this.wakePromise = activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {
        this.wakeLocked = false;
      });
    }
    this.emit();
  }

  pause() {
    if (this.state !== "RECORDING") return;
    this.activeMs += Date.now() - this.segStart;
    this.state = "PAUSED";
    this.emit();
  }

  async stop(): Promise<RunRecord | null> {
    if (this.state !== "RECORDING" && this.state !== "PAUSED") return null;
    if (this.state === "RECORDING") this.activeMs += Date.now() - this.segStart;
    this.state = "STOPPED";
    this.flushPendingJump();
    this.releaseWakeLock();
    this.emit();
    const rec = await saveRun({
      ...this.stats,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      durationMs: this.activeMs,
      movingMs: this.movingMs,
      avgSpeed: this.avgSpeed,
      pointCount: this.track.length,
      track: this.track.slice(),
      jumps: this.jumps.slice(),
    });
    this.lastSaved = rec;
    this.releaseWakeLock();
    this.emit();
    return rec;
  }

  reset() {
    this.state = "READY";
    this.clearData();
    this.lastSaved = null;
    this.releaseWakeLock();
    this.emit();
  }

  private clearData() {
    this.stats = emptyStats();
    this.track = [];
    this.jumps = [];
    this.trackVersion++;
    this.activeMs = 0;
    this.movingMs = 0;
    this.segStart = 0;
    this.lastRecPt = null;
    this.lastRecT = 0;
    this.altRef = null;
    this.pendingJump = null;
    this.lowStart = null;
    this.softStart = null;
    this.pointPeakG = 0;
    this.resumeGap = false;
    this.live.airborne = false;
  }

  // ---------- motion ----------
  private onMotion = (m: MotionSample) => {
    const a = m.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const now = Date.now();
    if (this.motionPerm !== "granted") {
      this.motionPerm = "granted";
      this.watchdogs.forEach(clearTimeout);
      this.watchdogs = [];
      this.emit();
    }
    const dtMs = this.lastMotionT ? Math.min(200, now - this.lastMotionT) : 16;
    this.lastMotionT = now;

    // sample rate meter
    this.hzCount++;
    if (now - this.hzT >= 1000) {
      this.live.motionHz = this.hzCount;
      this.hzCount = 0;
      this.hzT = now;
    }

    const v: Vec = [a.x, a.y, a.z];
    const mag = norm(v);
    const G = mag / G0;
    this.gLP += 0.3 * (G - this.gLP); // ignore rock garden chatter
    this.gFast += 0.6 * (G - this.gFast);
    this.live.g = this.gLP;

    // Auto-leveling: resting gravity vector (only refined while near 1G = steady riding)
    if (!this.gravInit) {
      this.grav = [...v];
      this.gravInit = true;
    } else if (Math.abs(G - 1) < 0.15) {
      const k = 0.02;
      this.grav = [this.grav[0] + k * (v[0] - this.grav[0]), this.grav[1] + k * (v[1] - this.grav[1]), this.grav[2] + k * (v[2] - this.grav[2])];
    }
    const gn = norm(this.grav) || G0;
    const gu: Vec = [this.grav[0] / gn, this.grav[1] / gn, this.grav[2] / gn];

    // Yaw rate about gravity axis (orientation independent), rad/s
    const r = m.rotationRate;
    if (r && (r.alpha !== 0 || r.beta !== 0 || r.gamma !== 0)) {
      this.hasGyro = true;
      const rv: Vec = [r.beta, r.gamma, r.alpha];
      const yaw = (dot(rv, gu) * Math.PI) / 180;
      this.yawGyro += 0.15 * (yaw - this.yawGyro);
    }

    // Lateral G = v * omega / g (gyro fused with GPS turn rate)
    const spd = this.gpsSpeed;
    const omega = this.hasGyro ? 0.85 * this.yawGyro + 0.15 * this.gpsYawRate : this.gpsYawRate;
    let latTarget = spd > 1.5 ? (spd * omega) / G0 : 0;
    latTarget = Math.max(-2, Math.min(2, latTarget));
    this.live.latG += 0.2 * (latTarget - this.live.latG);
    const leanDeg = (Math.atan(this.live.latG) * 180) / Math.PI;
    this.live.lean = Math.max(-65, Math.min(65, leanDeg));

    // Longitudinal G: GPS dv/dt (decays between fixes) blended with horizontal linear accel
    const sinceGps = (now - this.lonGpsT) / 1000;
    const lonGpsDec = this.lonGps * Math.exp(-sinceGps / 1.5);
    const lin: Vec = [v[0] - this.grav[0], v[1] - this.grav[1], v[2] - this.grav[2]];
    const vert = dot(lin, gu);
    const horiz = Math.sqrt(Math.max(0, dot(lin, lin) - vert * vert)) / G0;
    const lonAcc = Math.sqrt(Math.max(0, horiz * horiz - this.live.latG * this.live.latG));
    let lonTarget = lonGpsDec;
    if (Math.abs(lonGpsDec) > 0.02 && !this.live.airborne) {
      lonTarget = 0.6 * lonGpsDec + 0.4 * Math.sign(lonGpsDec) * Math.min(lonAcc, 1.5);
    }
    this.live.lonG += 0.15 * (lonTarget - this.live.lonG);

    this.detectJump(now, G, dtMs);

    if (this.state === "RECORDING") {
      const s = this.stats;
      if (this.gFast > s.peakG) s.peakG = this.gFast;
      if (this.gFast > this.pointPeakG) this.pointPeakG = this.gFast;
      const absLean = Math.abs(this.live.lean);
      if (absLean > s.maxLean) s.maxLean = absLean;
      if (this.live.lean < 0 && absLean > s.maxLeanL) s.maxLeanL = absLean;
      if (this.live.lean > 0 && absLean > s.maxLeanR) s.maxLeanR = absLean;
      if (-this.live.lonG > s.maxBrakingG) s.maxBrakingG = -this.live.lonG;
    }

    this.frameListeners.forEach((f) => f(this.live.latG, this.live.lonG, this.gLP));
  };

  private detectJump(now: number, G: number, _dtMs: number) {
    // Refine landing impact peak for a short window after touchdown
    if (this.pendingJump) {
      if (now <= this.pendingUntil) {
        if (G > this.pendingJump.impact) this.pendingJump.impact = G;
      } else this.flushPendingJump();
    }

    if (!this.live.airborne) {
      if (this.gLP < FREEFALL_G) {
        if (this.lowStart == null) this.lowStart = now;
        else if (now - this.lowStart >= FREEFALL_MIN_MS) {
          this.live.airborne = true;
          this.live.airStart = this.lowStart;
          this.airMaxG = 0;
          this.softStart = null;
          this.emit();
        }
      } else this.lowStart = null;
      return;
    }

    // airborne
    if (G > this.airMaxG) this.airMaxG = G;
    if (G > LANDING_G) {
      this.land(now, G);
      return;
    }
    if (this.gLP > 0.9) {
      if (this.softStart == null) this.softStart = now;
      else if (now - this.softStart > 350) {
        this.land(this.softStart, this.airMaxG); // soft landing without spike
        return;
      }
    } else this.softStart = null;
    if (now - this.live.airStart > MAX_AIR_MS) {
      // phone dropped / false trigger
      this.live.airborne = false;
      this.lowStart = null;
      this.emit();
    }
  }

  private land(t: number, impact: number) {
    const airtime = (t - this.live.airStart) / 1000;
    this.live.airborne = false;
    this.lowStart = null;
    this.softStart = null;
    if (this.state === "RECORDING" && airtime >= FREEFALL_MIN_MS / 1000) {
      this.flushPendingJump();
      const last = this.track[this.track.length - 1];
      this.pendingJump = { t, airtime, impact, lat: last?.lat, lon: last?.lon };
      this.pendingUntil = t + 150;
      const s = this.stats;
      s.totalJumps++;
      s.lastAirtime = airtime;
      s.lastImpact = impact;
      if (airtime > s.bestAirtime) s.bestAirtime = airtime;
      if (impact > s.maxImpact) s.maxImpact = impact;
    }
    this.emit();
  }

  private flushPendingJump() {
    if (!this.pendingJump) return;
    const j = this.pendingJump;
    this.pendingJump = null;
    this.jumps.push(j);
    if (this.stats.totalJumps > 0) {
      this.stats.lastImpact = j.impact;
      if (j.impact > this.stats.maxImpact) this.stats.maxImpact = j.impact;
    }
  }

  // ---------- GPS ----------
  private onLocation = (loc: Location.LocationObject) => {
    const { latitude: lat, longitude: lon, altitude, accuracy, speed } = loc.coords;
    const t = loc.timestamp || Date.now();
    this.live.accuracy = accuracy ?? null;
    if (accuracy != null && accuracy > 35) {
      this.emit();
      return; // jitter filter: reject poor fixes
    }
    this.live.hasFix = true;

    let s = 0;
    let dt = 1;
    if (this.lastFix) {
      dt = Math.max(0.2, (t - this.lastFix.t) / 1000);
      const d = haversine(this.lastFix.lat, this.lastFix.lon, lat, lon);
      const computed = d / dt;
      if (computed > 40 && (speed == null || speed < 0)) {
        // teleport: reject, but re-anchor so following fixes are not rejected too
        this.lastFix = { lat, lon, t };
        this.resumeGap = true; // don't add the jump to distance
        this.emit();
        return;
      }
      s = speed != null && speed >= 0 ? speed : computed;
    } else if (speed != null && speed >= 0) s = speed;
    if (s < 0.5) s = 0;
    if (s > 40) s = this.gpsSpeed; // implausible
    const prev = this.gpsSpeed;
    this.gpsSpeed = this.lastFix ? 0.65 * s + 0.35 * prev : s;
    this.lonGps = this.lastFix ? (this.gpsSpeed - prev) / dt / G0 : 0;
    this.lonGpsT = Date.now();
    this.lastFix = { lat, lon, t };
    this.live.speedKmh = this.gpsSpeed * 3.6;

    // Course & GPS turn rate
    if (this.lastCourse) {
      const d = haversine(this.lastCourse.lat, this.lastCourse.lon, lat, lon);
      if (d >= 3 && this.gpsSpeed > 1.5) {
        const brg = bearing(this.lastCourse.lat, this.lastCourse.lon, lat, lon);
        const cdt = Math.max(0.5, (t - this.lastCourse.t) / 1000);
        this.gpsYawRate = ((wrap180(brg - this.lastCourse.brg) * Math.PI) / 180) / cdt;
        this.lastCourse = { lat, lon, t, brg };
        this.live.heading = brg;
      } else if (this.gpsSpeed <= 1.5) this.gpsYawRate *= 0.5;
    } else {
      this.lastCourse = { lat, lon, t, brg: loc.coords.heading ?? 0 };
    }
    if (loc.coords.heading != null && loc.coords.heading >= 0 && this.gpsSpeed > 1.5) this.live.heading = loc.coords.heading;

    if (altitude != null) {
      this.altF = this.altF == null ? altitude : this.altF + 0.3 * (altitude - this.altF);
      this.live.altitude = this.altF;
    }

    if (this.state === "RECORDING") this.record(lat, lon, t, accuracy ?? 10);
    this.emit();
  };

  private record(lat: number, lon: number, t: number, acc: number) {
    const s = this.stats;
    // moving time only counts intervals inside the recording segment (skip first fix after START/RESUME)
    const first = this.lastRecT === 0;
    if (!first && this.gpsSpeed > 0.8) this.movingMs += Math.min(5000, Math.max(0, t - this.lastRecT));
    this.lastRecT = t;
    const kmh = this.gpsSpeed * 3.6;
    if (!first && acc <= 20 && kmh > s.maxSpeed) s.maxSpeed = kmh;

    if (this.altF != null) {
      if (this.altRef == null) this.altRef = this.altF;
      const diff = this.altF - this.altRef;
      if (diff >= 3) {
        s.gain += diff;
        this.altRef = this.altF;
      } else if (diff <= -3) {
        s.loss += -diff;
        this.altRef = this.altF;
      }
    }

    const last = this.lastRecPt;
    const d = last ? haversine(last.lat, last.lon, lat, lon) : 0;
    if (last && d < Math.max(3, acc * 0.5)) return; // stationary jitter
    const pt: TrackPoint = {
      t,
      lat,
      lon,
      alt: this.altF,
      spd: kmh,
      g: this.pointPeakG || this.gLP,
      lean: this.live.lean,
    };
    if (last && !this.resumeGap) s.distanceM += d;
    this.resumeGap = false;
    this.pointPeakG = 0;
    this.track.push(pt);
    this.lastRecPt = pt;
    this.trackVersion++;
  }
}

export const engine = new TelemetryEngine();
