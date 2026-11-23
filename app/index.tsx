import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import {
  ArrowCounterClockwise,
  ClockCounterClockwise,
  Compass,
  MoonStars,
  Pause,
  Play,
  ShieldCheck,
  Stop,
} from "phosphor-react-native";
import { useEffect, useReducer, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GBall } from "@/src/components/GBall";
import { PocketBlackout } from "@/src/components/PocketBlackout";
import { TrailMap } from "@/src/components/TrailMap";
import { Btn, CardLabel, GlassCard, Stat } from "@/src/components/ui";
import { duration, f, leanText } from "@/src/format";
import { engine } from "@/src/telemetry/engine";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const CONTROL_H = 76;
const MOTION_LABEL: Record<string, string> = {
  unknown: "STARTING",
  granted: "ACTIVE",
  denied: "TAP TO ALLOW",
  unavailable: "NOT RESPONDING",
};

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const [, tick] = useReducer((x: number) => x + 1, 0);
  const [blackout, setBlackout] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    engine.init();
    const unsub = engine.subscribe(tick);
    const id = setInterval(tick, 100);
    return () => {
      unsub();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const st = engine.state;
  const s = engine.stats;
  const l = engine.live;
  const lean = leanText(l.lean);
  const canOpenSettings = Platform.OS !== "web";
  const openSettings = () => {
    Linking.openSettings().catch(() => {});
  };
  const airNow = l.airborne ? (Date.now() - l.airStart) / 1000 : 0;

  const onStop = async () => {
    setBusy(true);
    try {
      const rec = await engine.stop();
      if (rec) setToast(`${rec.name} saved`);
    } catch {
      setToast("Save failed: storage full");
    }
    setBusy(false);
  };

  const statusColor =
    st === "RECORDING" ? colors.brandPrimary : st === "PAUSED" ? colors.brandSecondary : st === "STOPPED" ? colors.info : colors.muted;
  const gpsColor = !l.hasFix ? colors.muted : (l.accuracy ?? 99) <= 10 ? colors.brandPrimary : colors.brandSecondary;

  return (
    <View style={styles.screen}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>ENDURO TELEMETRY</Text>
          <View style={styles.pillRow}>
            <View testID="run-state-pill" style={[styles.pill, { borderColor: statusColor }]}>
              <View style={[styles.pillDot, { backgroundColor: statusColor }]} />
              <Text testID="run-state-text" style={[styles.pillText, { color: statusColor }]}>
                {st}
              </Text>
            </View>
            <View style={[styles.pill, { borderColor: colors.border }]}>
              <View style={[styles.pillDot, { backgroundColor: gpsColor }]} />
              <Text testID="gps-status-text" style={[styles.pillText, { color: gpsColor }]}>
                {l.hasFix ? `GPS ±${f(l.accuracy ?? 0, 0)}m` : "NO GPS"}
              </Text>
            </View>
            <Text testID="motion-hz-text" style={styles.hz}>{l.motionHz ? `${l.motionHz}Hz` : ""}</Text>
          </View>
        </View>
        <Pressable testID="open-maps-button" onPress={() => router.push("/maps")} style={styles.iconBtn} hitSlop={8}>
          <Compass size={24} weight="bold" color={colors.onSurface} />
        </Pressable>
        <Pressable testID="open-history-button" onPress={() => router.push("/history")} style={styles.iconBtn} hitSlop={8}>
          <ClockCounterClockwise size={24} weight="bold" color={colors.onSurface} />
        </Pressable>
        <Pressable testID="pocket-blackout-button" onPress={() => setBlackout(true)} style={styles.iconBtn} hitSlop={8}>
          <MoonStars size={24} weight="fill" color={colors.brandPrimary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: CONTROL_H + insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {!engine.permsGranted && (
          <Animated.View entering={FadeInDown.duration(300)}>
            <GlassCard testID="permission-card" style={styles.permCard}>
              <ShieldCheck size={30} weight="fill" color={colors.brandPrimary} />
              <Text style={styles.permTitle}>SENSORS NEEDED</Text>
              <Text style={styles.permBody}>
                Motion sensors detect jumps, airtime and G-forces. GPS draws your trail, speed and elevation. Works with the
                phone in your backpack, no calibration.
              </Text>
              <Text testID="permission-status-text" style={styles.permStatus}>
                MOTION: {MOTION_LABEL[engine.motionPerm] ?? engine.motionPerm.toUpperCase()} · GPS: {engine.gpsPerm.toUpperCase()}
              </Text>
              {engine.gpsPerm === "blocked" || (!canOpenSettings && engine.gpsPerm === "denied") ? (
                canOpenSettings ? (
                  <Btn testID="open-settings-button" label="OPEN SETTINGS" variant="orange" onPress={openSettings} />
                ) : (
                  <Text testID="browser-settings-hint" style={styles.permStatus}>
                    ENABLE LOCATION IN YOUR BROWSER SITE SETTINGS, THEN RELOAD
                  </Text>
                )
              ) : (
                <Btn testID="grant-permissions-button" label="GRANT SENSOR PERMISSIONS" onPress={() => engine.requestPermissions()} />
              )}
            </GlassCard>
          </Animated.View>
        )}

        {engine.permsGranted && engine.motionPerm === "unavailable" && (
          <GlassCard testID="motion-unavailable-card" style={styles.warnCard}>
            <Text style={styles.warnText}>MOTION SENSORS NOT RESPONDING · GPS-ONLY</Text>
            <Btn
              testID="retry-motion-button"
              label="ENABLE MOTION SENSORS"
              variant="ghost"
              onPress={() => engine.retryMotion()}
            />
          </GlassCard>
        )}

        {/* Speed hero */}
        <GlassCard testID="speed-card">
          <CardLabel>LIVE SPEED</CardLabel>
          <View style={styles.speedRow}>
            <Text testID="live-speed-value" style={styles.speed}>
              {f(l.speedKmh, 0)}
            </Text>
            <View style={styles.speedSide}>
              <Text style={styles.speedUnit}>KM/H</Text>
              <Text testID="elapsed-time-value" style={styles.timer}>
                {duration(engine.elapsedMs)}
              </Text>
            </View>
          </View>
          <View style={styles.row}>
            <Stat testID="max-speed-value" label="MAX" value={f(s.maxSpeed)} unit="km/h" tone="orange" />
            <Stat testID="avg-speed-value" label="AVG" value={f(engine.avgSpeed)} unit="km/h" />
            <Stat testID="distance-value" label="DIST" value={f(s.distanceM / 1000, 2)} unit="km" />
          </View>
        </GlassCard>

        {/* Trail */}
        <GlassCard testID="trail-card">
          <CardLabel>GPS TRAIL</CardLabel>
          <TrailMap
            testID="trail-map"
            points={engine.track}
            version={engine.trackVersion}
            height={220}
            live={st !== "STOPPED"}
            heading={l.heading}
          />
          <View style={[styles.row, { marginTop: 12 }]}>
            <Stat testID="altitude-value" label="ALTITUDE" value={l.altitude == null ? "--" : f(l.altitude, 0)} unit="m" />
            <Stat testID="elevation-gain-value" label="D+" value={f(s.gain, 0)} unit="m" tone="lime" />
            <Stat testID="elevation-loss-value" label="D-" value={f(s.loss, 0)} unit="m" tone="orange" />
          </View>
        </GlassCard>

        {/* G-force & lean */}
        <GlassCard testID="gforce-card">
          <CardLabel>G-FORCE · LEAN</CardLabel>
          <View style={styles.gRow}>
            <GBall size={150} />
            <View style={styles.gSide}>
              <Text style={styles.miniLabel}>LEAN ANGLE</Text>
              <View style={styles.leanRow}>
                <Text testID="lean-side-text" style={styles.leanSide}>
                  {lean.side}
                </Text>
                <Text testID="live-lean-value" style={styles.leanValue}>
                  {lean.value}°
                </Text>
              </View>
              <Stat testID="max-lean-value" label="MAX LEAN" value={`${f(s.maxLean, 0)}°`} tone="orange" size={24} />
              <Text style={styles.leanLR}>
                L {f(s.maxLeanL, 0)}° · R {f(s.maxLeanR, 0)}°
              </Text>
            </View>
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Stat testID="live-g-value" label="LIVE G" value={f(l.g, 2)} unit="G" />
            <Stat testID="peak-g-value" label="PEAK TOTAL" value={f(s.peakG, 2)} unit="G" tone="orange" />
            <Stat testID="max-braking-value" label="MAX BRAKE" value={f(s.maxBrakingG, 2)} unit="G" tone="orange" />
          </View>
        </GlassCard>

        {/* Jumps */}
        <GlassCard testID="jump-card" style={l.airborne ? { borderColor: colors.brandPrimary } : undefined}>
          <CardLabel
            right={
              l.airborne ? (
                <Text testID="airborne-indicator" style={styles.airborne}>
                  AIRBORNE {f(airNow, 2)}s
                </Text>
              ) : undefined
            }
          >
            AIRTIME
          </CardLabel>
          <View style={styles.row}>
            <Stat testID="last-airtime-value" label="LAST JUMP" value={f(s.lastAirtime, 2)} unit="s" tone="lime" size={44} />
            <Stat testID="best-airtime-value" label="BEST" value={f(s.bestAirtime, 2)} unit="s" tone="lime" size={44} />
          </View>
          <View style={[styles.row, { marginTop: 8 }]}>
            <Stat testID="total-jumps-value" label="TOTAL JUMPS" value={String(s.totalJumps)} />
            <Stat testID="landing-impact-value" label="LANDING IMPACT" value={f(s.lastImpact, 2)} unit="G" tone="orange" />
          </View>
        </GlassCard>
      </ScrollView>

      {toast && (
        <View testID="toast" style={[styles.toast, { bottom: insets.bottom + CONTROL_H + 28 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Floating glass control bar */}
      <View style={[styles.controlsWrap, { bottom: insets.bottom + 16 }]}>
        <BlurView intensity={30} tint="dark" style={styles.controls}>
          {st === "READY" && (
            <Btn
              testID="start-button"
              label="START"
              flex
              icon={<Play size={20} weight="fill" color={colors.onBrandPrimary} />}
              onPress={() => engine.start()}
            />
          )}
          {st === "RECORDING" && (
            <>
              <Btn
                testID="pause-button"
                label="PAUSE"
                flex
                variant="ghost"
                icon={<Pause size={20} weight="fill" color={colors.onSurface} />}
                onPress={() => engine.pause()}
              />
              <Btn
                testID="stop-button"
                label="STOP"
                flex
                variant="orange"
                disabled={busy}
                icon={<Stop size={20} weight="fill" color={colors.onBrandSecondary} />}
                onPress={onStop}
              />
            </>
          )}
          {st === "PAUSED" && (
            <>
              <Btn
                testID="resume-button"
                label="RESUME"
                flex
                icon={<Play size={20} weight="fill" color={colors.onBrandPrimary} />}
                onPress={() => engine.start()}
              />
              <Btn
                testID="stop-button"
                label="STOP"
                flex
                variant="orange"
                disabled={busy}
                icon={<Stop size={20} weight="fill" color={colors.onBrandSecondary} />}
                onPress={onStop}
              />
            </>
          )}
          {st === "STOPPED" && (
            <>
              <Btn
                testID="view-run-button"
                label="HISTORY"
                flex
                variant="ghost"
                icon={<ClockCounterClockwise size={20} weight="bold" color={colors.onSurface} />}
                onPress={() => router.push("/history")}
              />
              <Btn
                testID="reset-new-run-button"
                label="NEW RUN"
                flex
                icon={<ArrowCounterClockwise size={20} weight="bold" color={colors.onBrandPrimary} />}
                onPress={() => engine.reset()}
              />
            </>
          )}
        </BlurView>
      </View>

      <PocketBlackout visible={blackout} onUnlock={() => setBlackout(false)} />
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
    gap: 8,
  },
  brand: { color: c.onSurface, fontFamily: fonts.display, fontSize: 24, letterSpacing: 1.5 },
  pillRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    height: 26,
  },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontFamily: fonts.displaySemi, fontSize: 13, letterSpacing: 1 },
  hz: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surfaceSecondary,
    borderWidth: 1,
    borderColor: c.border,
  },
  content: { padding: 16, gap: 12 },
  permCard: { gap: 12, borderColor: c.brandTertiary },
  permTitle: { color: c.brandPrimary, fontFamily: fonts.display, fontSize: 24, letterSpacing: 1.5 },
  permBody: { color: c.onSurfaceTertiary, fontFamily: fonts.text, fontSize: 14, lineHeight: 20 },
  warnCard: { gap: 8, borderColor: c.brandSecondary },
  warnText: { color: c.brandSecondary, fontFamily: fonts.displaySemi, fontSize: 14, letterSpacing: 1 },
  permStatus: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 13, letterSpacing: 1 },
  speedRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 8 },
  speed: { color: c.brandPrimary, fontFamily: fonts.display, fontSize: 112, lineHeight: 112, letterSpacing: -2 },
  speedSide: { marginLeft: 12, marginBottom: 14 },
  speedUnit: { color: c.muted, fontFamily: fonts.displaySemi, fontSize: 18, letterSpacing: 2 },
  timer: { color: c.onSurface, fontFamily: fonts.display, fontSize: 30 },
  row: { flexDirection: "row", gap: 12 },
  gRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  gSide: { flex: 1, gap: 4 },
  miniLabel: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12, letterSpacing: 1.2 },
  leanRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  leanSide: { color: c.brandSecondary, fontFamily: fonts.display, fontSize: 28, marginBottom: 6, minWidth: 14 },
  leanValue: { color: c.brandPrimary, fontFamily: fonts.display, fontSize: 56, lineHeight: 58 },
  leanLR: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 13 },
  airborne: { color: c.brandPrimary, fontFamily: fonts.display, fontSize: 15, letterSpacing: 1 },
  controlsWrap: { position: "absolute", left: 16, right: 16, borderRadius: 999, overflow: "hidden" },
  controls: {
    height: CONTROL_H,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: c.glass,
    borderWidth: 1,
    borderColor: c.glassBorder,
    borderRadius: 999,
  },
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: c.surfaceInverse,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  toastText: { color: c.onSurfaceInverse, fontFamily: fonts.display, fontSize: 16, letterSpacing: 1 },
}));
