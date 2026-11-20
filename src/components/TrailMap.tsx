import { memo, useMemo, useState } from "react";
import { LayoutChangeEvent, Text, View } from "react-native";
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from "react-native-svg";

import { TrackPoint } from "@/src/telemetry/types";
import { fonts, makeStyles, ThemeColors, useTheme } from "@/src/theme";

type Props = {
  points: TrackPoint[];
  version: number;
  height: number;
  live?: boolean;
  heading?: number | null;
  testID?: string;
};

const PAD = 18;
const BUCKETS = 6;
const MAX_KMH = 45;

function hexToRgb(h: string) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function bucketColors(c: ThemeColors) {
  const a = hexToRgb(c.brandSecondary);
  const b = hexToRgb(c.brandPrimary);
  return Array.from({ length: BUCKETS }, (_, i) => {
    const t = i / (BUCKETS - 1);
    const m = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${m[0]},${m[1]},${m[2]})`;
  });
}

function build(points: TrackPoint[], w: number, h: number) {
  if (!points.length || w <= 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const lat0 = ((minLat + maxLat) / 2) * (Math.PI / 180);
  const kx = Math.cos(lat0) * 111320;
  const ky = 110540;
  const spanX = (maxLon - minLon) * kx;
  const spanY = (maxLat - minLat) * ky;
  const iw = w - PAD * 2;
  const ih = h - PAD * 2;
  // auto-scale, never zoom in tighter than ~60 m
  const scale = Math.min(iw / Math.max(spanX, 60), ih / Math.max(spanY, 60));
  const ox = PAD + (iw - spanX * scale) / 2;
  const oy = PAD + (ih - spanY * scale) / 2;
  const proj = (p: TrackPoint) => [ox + (p.lon - minLon) * kx * scale, oy + (maxLat - p.lat) * ky * scale];

  const stride = Math.max(1, Math.ceil(points.length / 600));
  const idx: number[] = [];
  for (let i = 0; i < points.length; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== points.length - 1) idx.push(points.length - 1);

  const xy = idx.map((i) => proj(points[i]));
  const segs: { b: number; pts: string }[] = [];
  for (let k = 1; k < idx.length; k++) {
    const spd = (points[idx[k]].spd + points[idx[k - 1]].spd) / 2;
    const b = Math.min(BUCKETS - 1, Math.floor((spd / MAX_KMH) * BUCKETS));
    const seg = `${xy[k - 1][0].toFixed(1)},${xy[k - 1][1].toFixed(1)} ${xy[k][0].toFixed(1)},${xy[k][1].toFixed(1)}`;
    const cur = segs[segs.length - 1];
    if (cur && cur.b === b) cur.pts += ` ${xy[k][0].toFixed(1)},${xy[k][1].toFixed(1)}`;
    else segs.push({ b, pts: seg });
  }
  let autoHeading = 0;
  if (xy.length >= 2) {
    const [x1, y1] = xy[xy.length - 2];
    const [x2, y2] = xy[xy.length - 1];
    autoHeading = (Math.atan2(x2 - x1, -(y2 - y1)) * 180) / Math.PI;
  }
  return { segs, start: xy[0], end: xy[xy.length - 1], autoHeading, single: xy.length === 1 };
}

export const TrailMap = memo(function TrailMap({ points, version, height, live, heading, testID }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [w, setW] = useState(0);
  const palette = useMemo(() => bucketColors(colors), [colors]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geo = useMemo(() => build(points, w, height), [version, points.length, w, height]);

  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));
  const rot = heading ?? geo?.autoHeading ?? 0;

  return (
    <View testID={testID} style={[styles.wrap, { height }]} onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={`h${f}`} x1={0} x2={w} y1={height * f} y2={height * f} stroke={colors.divider} strokeWidth={1} />
          ))}
          {[0.25, 0.5, 0.75].map((f) => (
            <Line key={`v${f}`} y1={0} y2={height} x1={w * f} x2={w * f} stroke={colors.divider} strokeWidth={1} />
          ))}
          <SvgText x={w - 14} y={16} fill={colors.muted} fontSize={10} fontWeight="bold" textAnchor="middle">
            N
          </SvgText>
          <Polygon points={`${w - 14},20 ${w - 18},28 ${w - 10},28`} fill={colors.muted} />
          {geo &&
            geo.segs.map((s, i) => (
              <Polyline
                key={i}
                points={s.pts}
                fill="none"
                stroke={palette[s.b]}
                strokeWidth={3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          {geo && (
            <G>
              <Circle cx={geo.start[0]} cy={geo.start[1]} r={7} fill={colors.brandPrimary} stroke={colors.surface} strokeWidth={2} />
              <SvgText x={geo.start[0]} y={geo.start[1] + 3} fill={colors.onBrandPrimary} fontSize={8} fontWeight="bold" textAnchor="middle">
                S
              </SvgText>
              {live ? (
                <G transform={`translate(${geo.end[0]} ${geo.end[1]}) rotate(${rot})`}>
                  <Circle r={11} fill={colors.brandSecondary} opacity={0.25} />
                  <Polygon points="0,-9 7,7 0,3 -7,7" fill={colors.brandSecondary} stroke={colors.surface} strokeWidth={1.5} />
                </G>
              ) : (
                !geo.single && (
                  <G>
                    <Circle cx={geo.end[0]} cy={geo.end[1]} r={7} fill={colors.brandSecondary} stroke={colors.surface} strokeWidth={2} />
                    <SvgText x={geo.end[0]} y={geo.end[1] + 3} fill={colors.onBrandSecondary} fontSize={8} fontWeight="bold" textAnchor="middle">
                      F
                    </SvgText>
                  </G>
                )
              )}
            </G>
          )}
        </Svg>
      )}
      {!geo && (
        <View style={styles.empty} pointerEvents="none">
          <Text style={styles.emptyText}>{live ? "WAITING FOR GPS TRACK" : "NO GPS TRACK"}</Text>
        </View>
      )}
    </View>
  );
});

const useStyles = makeStyles((c) => ({
  wrap: { width: "100%", borderRadius: 12, overflow: "hidden", backgroundColor: c.surface },
  empty: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  emptyText: { color: c.muted, fontFamily: fonts.displaySemi, fontSize: 14, letterSpacing: 2 },
}));
