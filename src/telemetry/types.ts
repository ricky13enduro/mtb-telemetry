export type RunState = "READY" | "RECORDING" | "PAUSED" | "STOPPED";
export type PermStatus = "unknown" | "granted" | "denied" | "blocked" | "unavailable";

export type TrackPoint = {
  t: number; // epoch ms
  lat: number;
  lon: number;
  alt: number | null;
  spd: number; // km/h
  g: number; // peak total G since previous point
  lean: number; // deg, + right / - left
};

export type Jump = {
  t: number;
  airtime: number; // s
  impact: number; // G
  lat?: number;
  lon?: number;
};

export type RunStats = {
  distanceM: number;
  maxSpeed: number; // km/h
  gain: number;
  loss: number;
  maxLean: number;
  maxLeanL: number;
  maxLeanR: number;
  peakG: number;
  maxBrakingG: number;
  totalJumps: number;
  lastAirtime: number;
  bestAirtime: number;
  lastImpact: number;
  maxImpact: number;
};

export type RunSummary = RunStats & {
  id: string;
  number: number;
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  movingMs: number;
  avgSpeed: number;
  pointCount: number;
};

export type RunRecord = RunSummary & { track: TrackPoint[]; jumps: Jump[] };

export const emptyStats = (): RunStats => ({
  distanceM: 0,
  maxSpeed: 0,
  gain: 0,
  loss: 0,
  maxLean: 0,
  maxLeanL: 0,
  maxLeanR: 0,
  peakG: 0,
  maxBrakingG: 0,
  totalJumps: 0,
  lastAirtime: 0,
  bestAirtime: 0,
  lastImpact: 0,
  maxImpact: 0,
});
