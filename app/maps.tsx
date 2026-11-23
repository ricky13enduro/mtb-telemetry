import { useRouter } from "expo-router";
import {
  ArrowClockwise,
  ArrowLeft,
  Compass,
  DownloadSimple,
  MapPin,
  Path,
  Play,
} from "phosphor-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import { CardLabel, GlassCard, Stat, Btn } from "@/src/components/ui";
import { f } from "@/src/format";
import { engine } from "@/src/telemetry/engine";
import { fonts, makeStyles, useTheme } from "@/src/theme";

// Se hai già creato i file i18n, decommenta questa riga:
// import { useI18n } from "@/src/i18n";

type MtbLevel = "S1" | "S2" | "S3" | "S4" | "NC";

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
const FALLBACK_COORDS = { lat: 44.4142, lon: 8.9422 };

// Server Overpass multipli (se uno fallisce prova il successivo)
const OVERPASS_SERVERS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

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

function buildTrailGpx(trail: NearbyTrail): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const pts = trail.points
    .map((p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"></trkpt>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Enduro Telemetry" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(trail.name)}</name>
  </metadata>
  <trk>
    <name>${esc(trail.name)}</name>
    <type>mountain_biking</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>`;
}

async function shareGpx(trail: NearbyTrail) {
  const filename = `${trail.name.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40)}.gpx`;
  const content = buildTrailGpx(trail);

  if (Platform.OS === "web") {
    const doc = (globalThis as any).document;
    const blob = new Blob([content], { type: "application/gpx+xml" });
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
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/gpx+xml",
    dialogTitle: filename,
    UTI: "com.topografix.gpx",
  });
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
    const lat0 = ((minLat + maxLat) / 2) * (Math.PI) / 180;
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

    return { poly, start: xy[0], end: xy[xy.length - 1], user: userXy };
  }, [trail, userLat, userLon, w, height]);

  return (
    <View style={[styles.previewWrap, { height }]} onLayout={onLayout}>
      {w > 0 && (
        <Svg width={w} height={height}>
          {[0.25, 0.5, 0.75].map((r) => (
            <Line key={`h${r}`} x1={0} x2={w} y1={height * r} y2={height * r} stroke={colors.divider} strokeWidth={1} />
          ))}
          {[0.25, 0.5, 0.75].map((r) => (
            <Line key={`v${r}`} y1={0} y2={height} x1={w * r} x2={w * r} stroke={colors.divider} strokeWidth={1} />
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
              <Circle cx={geo.start[0]} cy={geo.start[1]} r={7} fill={colors.brandPrimary} stroke={colors.surface} strokeWidth={2} />
              <SvgText x={geo.start[0]} y={geo.start[1] + 3} fill={colors.onBrandPrimary} fontSize={8} fontWeight="bold" textAnchor="middle">
                S
              </SvgText>
              <Circle cx={geo.end[0]} cy={geo.end[1]} r={7} fill={colors.brandSecondary} stroke={colors.surface} strokeWidth={2} />
              <SvgText x={geo.end[0]} y={geo.end[1] + 3} fill={colors.onBrandSecondary} fontSize={8} fontWeight="bold" textAnchor="middle">
                F
              </SvgText>
              <Circle cx={geo.user[0]} cy={geo.user[1]} r={11} fill={colors.info} opacity={0.25} />
              <Circle cx={geo.user[0]} cy={geo.user[1]} r={5.5} fill={colors.info} stroke={colors.surface} strokeWidth={1.5} />
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

  // Quando avrai i file i18n, sostituisci con: const { t } = useI18n();
  const t = (key: string, params?: any) => {
    // fallback temporaneo in italiano
    const map: Record<string, string> = {
      mtbMaps: "MAPPE MTB",
      gpsActive: "POSIZIONE GPS ATTIVA",
      waitingGps: "ZONA GENOVA (ATTESA FIX GPS)",
      difficultyFilter: "FILTRO DIFFICOLTÀ SINGLETRACK",
      searchRadius: "RAGGIO RICERCA ONLINE",
      includeUnclassified: "INCLUDI NON CLASSIFICATI",
      includeOn: "ON · cerca anche trail senza S1-S4",
      includeOff: "OFF · solo trail con scala",
      trailPreview: "ANTEPRIMA TRAIL",
      distanceFromYou: "DISTANZA DA TE",
      trailLength: "LUNGHEZZA TRAIL",
      nearbyTrails: "TRAIL VICINI A TE",
      found: "TROVATI",
      searching: "RICERCA SINGLETRACK ONLINE...",
      noTrailsFound: `Nessun trail trovato entro ${params?.km ?? "?"} km.`,
      tryIncreaseRadius: "Prova ad aumentare il raggio o attiva “Includi non classificati”.",
      networkError: "Impossibile scaricare i trail. Controlla la connessione e riprova.",
      selectTrail: "SELEZIONA UN TRAIL DALLA LISTA",
      exportGpx: "ESPORTA GPX",
      startFromThis: "PARTI DA QUESTO",
      unclassified: "N/C",
    };
    return map[key] ?? key;
  };

  const [selectedLevels, setSelectedLevels] = useState<MtbLevel[]>(["S1", "S2", "S3", "S4"]);
  const [includeUnclassified, setIncludeUnclassified] = useState(true); // default ON per trovare più trail
  const [radiusKm, setRadiusKm] = useState(10);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [trails, setTrails] = useState<NearbyTrail[]>([]);
  const [activeTrailId, setActiveTrailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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

    const radiusM = radiusKm * 1000;

    let query = `[out:json][timeout:25];
(
  way["highway"~"path|track|cycleway"]["mtb:scale"~"^[1-4]"](around:${radiusM},${userLat},${userLon});
`;

    if (includeUnclassified) {
      query += `
  way["highway"~"path|track"]["mtb"="yes"](around:${radiusM},${userLat},${userLon});
  way["highway"="path"]["surface"~"ground|gravel|dirt|earth|unpaved"](around:${radiusM},${userLat},${userLon});
`;
    }

    query += `
);
out body geom;`;

    let lastError: any = null;
    let json: any = null;

    for (const server of OVERPASS_SERVERS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);

        const res = await fetch(server, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }

        json = await res.json();
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!json) {
      setErrorMsg(t("networkError"));
      setLoading(false);
      return;
    }

    try {
      const elements = Array.isArray(json.elements) ? json.elements : [];
      const seen = new Set<string>();
      const parsed: NearbyTrail[] = [];

      for (const el of elements) {
        if (el.type !== "way" || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
        const id = String(el.id);
        if (seen.has(id)) continue;
        seen.add(id);

        const level = parseMtbScale(el.tags?.["mtb:scale"]) ?? "NC";
        if (level === "NC" && !includeUnclassified) continue;

        const pts: TrailPoint[] = el.geometry.map((g: { lat: number; lon: number }) => ({
          lat: g.lat,
          lon: g.lon,
        }));

        let lengthM = 0;
        for (let i = 1; i < pts.length; i++) {
          lengthM += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
        }

        if (lengthM < 60) continue; // troppo corti = rumore

        const startDist = haversineM(userLat, userLon, pts[0].lat, pts[0].lon);
        const rawName =
          el.tags?.name ||
          el.tags?.ref ||
          (level === "NC" ? `Sentiero #${el.id}` : `Singletrack ${level} #${el.id}`);

        parsed.push({
          id,
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
      setErrorMsg(t("networkError"));
    } finally {
      setLoading(false);
    }
  }, [radiusKm, userLat, userLon, includeUnclassified]);

  useEffect(() => {
    fetchNearbyTrails();
  }, [fetchNearbyTrails]);

  const filteredTrails = useMemo(() => {
    return trails.filter((t) => {
      if (t.level === "NC") return includeUnclassified;
      return selectedLevels.includes(t.level);
    });
  }, [trails, selectedLevels, includeUnclassified]);

  const activeTrail = useMemo(
    () => filteredTrails.find((t) => t.id === activeTrailId) ?? filteredTrails[0] ?? null,
    [filteredTrails, activeTrailId]
  );

  const levelColor = (lvl: MtbLevel) => {
    if (lvl === "S1") return colors.brandPrimary;
    if (lvl === "S2") return colors.info;
    if (lvl === "S3") return colors.brandSecondary;
    if (lvl === "S4") return "#FF3B30";
    return colors.muted;
  };

  const onExportGpx = async () => {
    if (!activeTrail) return;
    setExporting(true);
    try {
      await shareGpx(activeTrail);
    } catch {
      // silenzioso
    } finally {
      setExporting(false);
    }
  };

  const onStartFromTrail = () => {
    engine.reset();
    engine.start();
    router.replace("/");
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn} hitSlop={8}>
          <ArrowLeft size={22} weight="bold" color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{t("mtbMaps")}</Text>
          <Text style={styles.subTitle}>{hasRealGps ? t("gpsActive") : t("waitingGps")}</Text>
        </View>
        <Pressable onPress={fetchNearbyTrails} style={styles.iconBtn} hitSlop={8} disabled={loading}>
          <ArrowClockwise size={22} weight="bold" color={colors.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <CardLabel>{t("difficultyFilter")}</CardLabel>
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
                  <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>
                    {lvl}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => setIncludeUnclassified((v) => !v)}
            style={[
              styles.toggleRow,
              {
                borderColor: includeUnclassified ? colors.brandPrimary : colors.border,
                backgroundColor: includeUnclassified ? colors.brandPrimary + "22" : colors.surfaceSecondary,
              },
            ]}
          >
            <Text style={[styles.toggleText, { color: includeUnclassified ? colors.brandPrimary : colors.onSurface }]}>
              {t("includeUnclassified")}
            </Text>
            <Text style={[styles.toggleHint, { color: colors.muted }]}>
              {includeUnclassified ? t("includeOn") : t("includeOff")}
            </Text>
          </Pressable>

          <CardLabel style={{ marginTop: 14 }}>{t("searchRadius")}</CardLabel>
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
                  <Text style={[styles.chipText, { color: active ? colors.onBrandPrimary : colors.onSurface }]}>
                    {km} KM
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        <GlassCard>
          <CardLabel
            right={
              activeTrail ? (
                <Text style={[styles.badgeText, { color: levelColor(activeTrail.level) }]}>
                  {activeTrail.level === "NC" ? t("unclassified") : activeTrail.level}
                </Text>
              ) : undefined
            }
          >
            {activeTrail ? activeTrail.name.toUpperCase() : t("trailPreview")}
          </CardLabel>

          <TrailPreviewSvg trail={activeTrail} userLat={userLat} userLon={userLon} />

          {activeTrail && (
            <>
              <View style={[styles.statsRow, { marginTop: 12 }]}>
                <Stat label={t("distanceFromYou")} value={f(activeTrail.distanceFromUserM / 1000, 2)} unit="km" tone="lime" />
                <Stat label={t("trailLength")} value={f(activeTrail.lengthM / 1000, 2)} unit="km" tone="orange" />
              </View>

              <View style={styles.actionRow}>
                <Btn
                  label={exporting ? "..." : t("exportGpx")}
                  flex
                  variant="ghost"
                  disabled={exporting}
                  icon={<DownloadSimple size={18} weight="bold" color={colors.onSurface} />}
                  onPress={onExportGpx}
                />
                <Btn
                  label={t("startFromThis")}
                  flex
                  icon={<Play size={18} weight="fill" color={colors.onBrandPrimary} />}
                  onPress={onStartFromTrail}
                />
              </View>
            </>
          )}
        </GlassCard>

        <GlassCard>
          <CardLabel right={<Text style={styles.countText}>{filteredTrails.length} {t("found")}</Text>}>
            {t("nearbyTrails")}
          </CardLabel>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.brandPrimary} />
              <Text style={styles.mutedText}>{t("searching")}</Text>
            </View>
          ) : errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : filteredTrails.length === 0 ? (
            <Text style={styles.mutedText}>
              {t("noTrailsFound", { km: radiusKm })}
              {"\n"}
              {t("tryIncreaseRadius")}
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
                      <Text style={styles.levelPillText}>
                        {trail.level === "NC" ? "NC" : trail.level}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trailName} numberOfLines={1}>
                        {trail.name}
                      </Text>
                      <View style={styles.metaRow}>
                        <MapPin size={13} color={colors.muted} />
                        <Text style={styles.metaText}>A {f(trail.distanceFromUserM / 1000, 1)} km</Text>
                        <Path size={13} color={colors.muted} />
                        <Text style={styles.metaText}>Lungo {f(trail.lengthM / 1000, 2)} km</Text>
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
  toggleRow: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  toggleText: { fontFamily: fonts.displaySemi, fontSize: 14, letterSpacing: 0.5 },
  toggleHint: { fontFamily: fonts.text, fontSize: 12, marginTop: 2 },
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
  actionRow: { flexDirection: "row", gap: 10, marginTop: 14 },
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
  levelPillText: { color: "#000000", fontFamily: fonts.display, fontSize: 13 },
  trailName: { color: c.onSurface, fontFamily: fonts.displaySemi, fontSize: 15, letterSpacing: 0.5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  metaText: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12, marginRight: 6 },
}));
