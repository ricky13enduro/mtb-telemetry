import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { RunRecord } from "./types";

const iso = (t: number) => new Date(t).toISOString();
const safeName = (r: RunRecord) => r.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/_+$/, "");

export function buildCsv(r: RunRecord): string {
  const lines: string[] = [];
  lines.push("timestamp_iso,elapsed_s,latitude,longitude,altitude_m,speed_kmh,total_g,lean_deg");
  for (const p of r.track) {
    lines.push(
      [
        iso(p.t),
        ((p.t - r.startedAt) / 1000).toFixed(1),
        p.lat.toFixed(7),
        p.lon.toFixed(7),
        p.alt == null ? "" : p.alt.toFixed(1),
        p.spd.toFixed(1),
        p.g.toFixed(2),
        p.lean.toFixed(1),
      ].join(","),
    );
  }
  lines.push("");
  lines.push("jump_no,timestamp_iso,airtime_s,landing_impact_g,latitude,longitude");
  r.jumps.forEach((j, i) => {
    lines.push(
      [i + 1, iso(j.t), j.airtime.toFixed(2), j.impact.toFixed(2), j.lat?.toFixed(7) ?? "", j.lon?.toFixed(7) ?? ""].join(","),
    );
  });
  lines.push("");
  lines.push("summary_key,value");
  const summary: [string, string][] = [
    ["run", r.name],
    ["start", iso(r.startedAt)],
    ["duration_s", (r.durationMs / 1000).toFixed(0)],
    ["distance_km", (r.distanceM / 1000).toFixed(3)],
    ["max_speed_kmh", r.maxSpeed.toFixed(1)],
    ["avg_speed_kmh", r.avgSpeed.toFixed(1)],
    ["elevation_gain_m", r.gain.toFixed(0)],
    ["elevation_loss_m", r.loss.toFixed(0)],
    ["max_lean_deg", r.maxLean.toFixed(1)],
    ["peak_total_g", r.peakG.toFixed(2)],
    ["max_braking_g", r.maxBrakingG.toFixed(2)],
    ["total_jumps", String(r.totalJumps)],
    ["best_airtime_s", r.bestAirtime.toFixed(2)],
  ];
  summary.forEach(([k, v]) => lines.push(`${k},${v}`));
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildGpx(r: RunRecord): string {
  const pts = r.track
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">` +
        (p.alt == null ? "" : `<ele>${p.alt.toFixed(1)}</ele>`) +
        `<time>${iso(p.t)}</time></trkpt>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MTB Telemetry" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${esc(r.name)}</name>
    <time>${iso(r.startedAt)}</time>
  </metadata>
  <trk>
    <name>${esc(r.name)}</name>
    <type>mountain_biking</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

async function shareText(filename: string, content: string, mimeType: string, uti: string) {
  if (Platform.OS === "web") {
    const doc = (globalThis as any).document;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    doc.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: filename, UTI: uti });
}

export async function exportCsv(r: RunRecord) {
  await shareText(`${safeName(r)}.csv`, buildCsv(r), "text/csv", "public.comma-separated-values-text");
}

export async function exportGpx(r: RunRecord) {
  await shareText(`${safeName(r)}.gpx`, buildGpx(r), "application/gpx+xml", "com.topografix.gpx");
}
