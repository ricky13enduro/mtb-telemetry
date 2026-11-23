import { useRouter } from "expo-router";
import {
  ArrowClockwise,
  ArrowLeft,
  Compass,
  MapPin,
  Mountains,
  Path,
} from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";

import { CardLabel, GlassCard, Stat } from "@/src/components/ui";
import { f } from "@/src/format";
import { engine } from "@/src/telemetry/engine";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type MtbLevel = "S1" | "S2" | "S3" | "S4";

type TrailPoint = { lat: number; lon: number };

type NearbyTrail = {
  id: string;
  name: string;
  level: MtbLevel;
  distanceFromUserM: number;
  lengthM: number;
  points: TrailPoint[];
};

const LEVELS: MtbLevel[] = ["S1", "S2", "S3", "S4"];
const RADII_KM = [2, 5, 10, 20];

// Fallback su Genova se il fix GPS non è ancora agganciato
const FALLBACK_COORDS = { lat: 44.4142, lon: 8.9422 };

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseMtbScale(raw?: string): MtbLevel | null {
  if (!raw) return null;
  const clean = raw.trim().replace(/[+-]/g, "");
  if (clean === "1") return "S1";
  if (clean === "2") return "S2";
  if (clean === "3") return "S3";
  if (clean === "4") return "S4";
  return null;
}

function TrailPreviewSvg({
  trail,
  userLat,
  userLon,
  height = 210,
}: {
  trail: NearbyTrail | null;
  userLat: number;
  userLon: number;
  height?: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [w, setW] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width));

  const geo = useMemo(() => {
    if (!trail || !trail.points.length || w <= 0) return null;
    const allPts = [...trail.points, { lat: userLat, lon: userLon }];
    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;

    for (const p of allPts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    const pad = 22;
    const lat0 = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const kx = Math.cos(lat0) * 111320;
    const ky = 110540;
    const spanX = (maxLon - minLon) * kx;
    const spanY = (maxLat - minLat) * ky;
    const iw = w - pad * 2;
    const ih = height - pad * 2;
    const scale = Math.min(iw / Math.max(spanX, 80), ih / Math.max(spanY, 80));
    const ox = pad + (iw - spanX * scale) / 2;
    const oy = pad + (ih - spanY * scale) / 2;

    const proj = (p: TrailPoint) => [
      ox + (p.lon - minLon) * kx * scale,
      oy + (maxLat - p.lat) * ky * scale,
    ];

    const xy = trail.points.map(proj);
    const poly = xy.map((pt) => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
    const userXy = proj({ lat: userLat, lon: userLon });

    return {
      poly,
      start: xy[0],
      end: xy[xy.length - 1],
      user: userXy,
    };
  }, [trail, userLat, userLon, w, height]);

  return (
    <View style={[styles.previewWrap, { height }]} onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {[0.25, 0.5, 0.75].map((r) => (
            <Line
              key={`h${r}`}
              x1={0}
              x2={w}
              y1={height * r}
              y2={height * r}
              stroke={colors.divider}
              strokeWidth={1}
            />
          ))}
          {[0.25, 0.5, 0.75].map((r) => (
            <Line
              key={`v${r}`}
              y1={0}
              y2={height}
              x1={w * r}
              x2={w * r}
              stroke={colors.divider}
              strokeWidth={1}
            />
          ))}

          {geo && (
            <>
              <Polyline
                points={geo.poly}
                fill="none"
                stroke={colors.brandPrimary}
                strokeWidth={4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Start trail */}
              <Circle
                cx={geo.start[0]}
                cy={geo.start[1]}
                r={7}
                fill={colors.brandPrimary}
                stroke={colors.surface}
                strokeWidth={2}
              />
              <SvgText
                x={geo.start[0]}
                y={geo.start[1] + 3}
                fill={colors.onBrandPrimary}
                fontSize={8}
                fontWeight="bold"
                textAnchor="middle"
              >
                S
              </SvgText>

              {/* Fine trail */}
              <Circle
                cx={geo.end[0]}
                cy={geo.end[1]}
                r={7}
                fill={colors.brandSecondary}
                stroke={colors.surface}
                strokeWidth={2}
              />
              <SvgText
                x={geo.end[0]}
                y={geo.end[1] + 3}
                fill={colors.onBrandSecondary}
                fontSize={8}
                fontWeight="bold"
                textAnchor="middle"
              >
                F
              </SvgText>

              {/* Posizione utente */}
              <Circle cx={geo.user[0]} cy={geo.user[1]} r={11} fill={colors.info} opacity={0.25} />
              <Circle
                cx={geo.user[0]}
                cy={geo.user[1]}
                r={5.5}
                fill={colors.info}
                stroke={colors.surface}
                strokeWidth={1.5}
              />
            </>
          )}
        </Svg>
      )}
      {!geo && (
        <View style={styles.emptyPreview}>
          <Text style={styles.emptyPreviewText}>SELEZIONA UN TRAIL DALLA LISTA</Text>
        </View>
      )}
    </View>
  );
}

export default function MtbMapsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();

  const [selectedLevels, setSelectedLevels] = useState<MtbLevel[]>(["S1", "S2", "S3", "S4"]);
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [trails, setTrails] = useState<NearbyTrail[]>([]);
  const [activeTrailId, setActiveTrailId] = useState<string | null>(null);

  const liveAny = engine.live as { lat?: number; lon?: number; hasFix?: boolean };
  const lastTrackPt = engine.track.length > 0 ? engine.track[engine.track.length - 1] : null;

  const userLat = liveAny.lat ?? lastTrackPt?.lat ?? FALLBACK_COORDS.lat;
  const userLon = liveAny.lon ?? lastTrackPt?.lon ?? FALLBACK_COORDS.lon;
  const hasRealGps = Boolean(liveAny.hasFix || lastTrackPt);

  const toggleLevel = (lvl: MtbLevel) => {
    setSelectedLevels((prev) => {
      if (prev.includes(lvl)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== lvl);
      }
      return [...prev, lvl];
    });
  };

  const fetchNearbyTrails = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const radiusM = radiusKm * 1000;
      const query = `[out:json][timeout:15];
(
  way["highway"~"path|track|cycleway"]["mtb:scale"~"^[1-4]"](around:${radiusM},${userLat},${userLon});
);
out body geom;`;

      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
      });

      if (!res.ok) throw new Error("Errore server mappe");
      const json = await res.json();
      const elements = Array.isArray(json.elements) ? json.elements : [];

      const parsed: NearbyTrail[] = [];
      for (const el of elements) {
        if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const level = parseMtbScale(el.tags?.["mtb:scale"]);
        if (!level) continue;

        const pts: TrailPoint[] = el.geometry.map((g: { lat: number; lon: number }) => ({
          lat: g.lat,
          lon: g.lon,
        }));

        let lengthM = 0;
        for (let i = 1; i < pts.length; i++) {
          lengthM += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
        }

        const startDist = haversineM(userLat, userLon, pts[0].lat, pts[0].lon);
        const rawName = el.tags?.name || el.tags?.ref || `Singletrack ${level} #${el.id}`;

        parsed.push({
          id: String(el.id),
          name: rawName,
          level,
          distanceFromUserM: startDist,
          lengthM,
          points: pts,
        });
      }

      parsed.sort((a, b) => a.distanceFromUserM - b.distanceFromUserM);
      setTrails(parsed);
      if (parsed.length > 0) {
        setActiveTrailId((prev) => (parsed.some((t) => t.id === prev) ? prev : parsed[0].id));
      } else {
        setActiveTrailId(null);
      }
    } catch {
      setErrorMsg("Impossibile scaricare i trail online. Controlla la rete o riprova.");
    } finally {
      setLoading(false);
    }
  }, [radiusKm, userLat, userLon]);

  useEffect(() => {
    fetchNearbyTrails();
  }, [fetchNearbyTrails]);

  const filteredTrails = useMemo(
    () => trails.filter((t) => selectedLevels.includes(t.level)),
    [trails, selectedLevels]
  );

  const activeTrail = useMemo(
    () => filteredTrails.find((t) => t.id === activeTrailId) ?? filteredTrails[0] ?? null,
    [filteredTrails, activeTrailId]
  );

  const levelColor = (lvl: MtbLevel) => {
    if (lvl === "S1") return colors.brandPrimary;
    if (lvl === "S2") return colors.info;
    if (lvl === "S3") return colors.brandSecondary;
    return "#FF3B30";
  };

  return (
    <View style={styles.screen}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={22} weight="bold" color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>MAPPE MTB</Text>
          <Text style={styles.subTitle}>
            {hasRealGps ? "POSIZIONE GPS ATTIVA" : "ZONA GENOVA (ATTESA FIX GPS)"}
          </Text>
        </View>
        <Pressable onPress={fetchNearbyTrails} style={styles.iconBtn} hitSlop={8} disabled={loading}>
          <ArrowClockwise size={22} weight="bold" color={colors.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Filtri S1-S4 & Raggio */}
        <GlassCard>
          <CardLabel>FILTRO DIFFICOLTÀ SINGLETRACK</CardLabel>
          <View style={styles.chipRow}>
            {LEVELS.map((lvl) => {
              const active = selectedLevels.includes(lvl);
              const badgeColor = levelColor(lvl);
              return (
                <Pressable
                  key={lvl}
                  onPress={() => toggleLevel(lvl)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? badgeColor : colors.border,
                      backgroundColor: active ? badgeColor : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.onBrandPrimary : colors.onSurface },
                    ]}
                  >
                    {lvl}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <CardLabel style={{ marginTop: 14 }}>RAGGIO RICERCA ONLINE</CardLabel>
          <View style={styles.chipRow}>
            {RADII_KM.map((km) => {
              const active = radiusKm === km;
              return (
                <Pressable
                  key={km}
                  onPress={() => setRadiusKm(km)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.brandPrimary : colors.border,
                      backgroundColor: active ? colors.brandPrimary : colors.surfaceSecondary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.onBrandPrimary : colors.onSurface },
                    ]}
                  >
                    {km} KM
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        {/* Mappa Anteprima Trail */}
        <GlassCard>
          <CardLabel
            right={
              activeTrail ? (
                <Text style={[styles.badgeText, { color: levelColor(activeTrail.level) }]}>
                  {activeTrail.level}
                </Text>
              ) : undefined
            }
          >
            {activeTrail ? activeTrail.name.toUpperCase() : "ANTEPRIMA TRAIL"}
          </CardLabel>

          <TrailPreviewSvg trail={activeTrail} userLat={userLat} userLon={userLon} />

          {activeTrail && (
            <View style={[styles.statsRow, { marginTop: 12 }]}>
              <Stat
                label="DISTANZA DA TE"
                value={f(activeTrail.distanceFromUserM / 1000, 2)}
                unit="km"
                tone="lime"
              />
              <Stat
                label="LUNGHEZZA TRAIL"
                value={f(activeTrail.lengthM / 1000, 2)}
                unit="km"
                tone="orange"
              />
            </View>
          )}
        </GlassCard>

        {/* Lista Trail trovati */}
        <GlassCard>
          <CardLabel right={<Text style={styles.countText}>{filteredTrails.length} TROVATI</Text>}>
            TRAIL VICINI A TE
          </CardLabel>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.mutedText}>RICERCA SINGLETRACK ONLINE...</Text>
            </View>
          ) : errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : filteredTrails.length === 0 ? (
            <Text style={styles.mutedText}>
              Nessun singletrack con scala {selectedLevels.join("/")} trovato entro {radiusKm} km.
              Prova ad aumentare il raggio.
            </Text>
          ) : (
            <View style={styles.list}>
              {filteredTrails.map((trail) => {
                const isSelected = activeTrail?.id === trail.id;
                const badgeColor = levelColor(trail.level);
                return (
                  <Pressable
                    key={trail.id}
                    onPress={() => setActiveTrailId(trail.id)}
                    style={[
                      styles.trailItem,
                      {
                        borderColor: isSelected ? colors.brandPrimary : colors.border,
                        backgroundColor: colors.surfaceSecondary,
                      },
                    ]}
                  >
                    <View style={[styles.levelPill, { backgroundColor: badgeColor }]}>
                      <Text style={styles.levelPillText}>{trail.level}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trailName} numberOfLines={1}>
                        {trail.name}
                      </Text>
                      <View style={styles.metaRow}>
                        <MapPin size={13} color={colors.muted} />
                        <Text style={styles.metaText}>
                          A {f(trail.distanceFromUserM / 1000, 1)} km
                        </Text>
                        <Path size={13} color={colors.muted} />
                        <Text style={styles.metaText}>
                          Lungo {f(trail.lengthM / 1000, 2)} km
                        </Text>
                      </View>
                    </View>
                    <Compass
                      size={20}
                      weight={isSelected ? "fill" : "regular"}
                      color={isSelected ? colors.brandPrimary : colors.muted}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </GlassCard>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: c.surface,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    gap: 10,
  },
  title: { color: c.onSurface, fontFamily: fonts.display, fontSize: 22, letterSpacing: 1.5 },
  subTitle: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 11, letterSpacing: 1 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  content: { padding: 16, gap: 12 },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  previewWrap: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: c.surfaceSecondary,
    marginTop: 8,
  },
  emptyPreview: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyPreviewText: { color: c.muted, fontFamily: fonts.displaySemi, fontSize: 13, letterSpacing: 1.5 },
  badgeText: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  statsRow: { flexDirection: "row", gap: 12 },
  countText: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12 },
  centerBox: { alignItems: "center", justifyContent: "center", paddingVertical: 20, gap: 8 },
  mutedText: { color: c.muted, fontFamily: fonts.text, fontSize: 13, lineHeight: 19, marginTop: 6 },
  errorText: { color: c.brandSecondary, fontFamily: fonts.text, fontSize: 13, marginTop: 6 },
  list: { gap: 8, marginTop: 8 },
  trailItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  levelPill: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  levelPillText: { color: "#000000", fontFamily: fonts.display, fontSize: 15 },
  trailName: { color: c.onSurface, fontFamily: fonts.displaySemi, fontSize: 15, letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  metaText: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12, marginRight: 6 },
}));
