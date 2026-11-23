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
import { useI18n } from "@/src/i18n";
import { engine } from "@/src/telemetry/engine";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const CONTROL_H = 76;

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { lang, setLang, t } = useI18n();
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
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
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

  const motionLabel = (perm: string) => {
    if (perm === "unknown") return t("starting");
    if (perm === "granted") return t("active");
    if (perm === "denied") return t("tapToAllow");
    if (perm === "unavailable") return t("notResponding");
    return perm.toUpperCase();
  };

  const onStop = async () => {
    setBusy(true);
    try {
      const rec = await engine.stop();
      if (rec) setToast(`${rec.name} ${t("saved")}`);
    } catch {
      setToast(t("saveFailed"));
    }
    setBusy(false);
  };

  const statusColor =
    st === "RECORDING"
      ? colors.brandPrimary
      : st === "PAUSED"
        ? colors.brandSecondary
        : st === "STOPPED"
          ? colors.info
          : colors.muted;

  const gpsColor = !l.hasFix
    ? colors.muted
    : (l.accuracy ?? 99) <= 10
      ? colors.brandPrimary
      : colors.brandSecondary;

  return (
    <View style={styles.screen}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>{t("brand")}</Text>
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
                {l.hasFix ? `GPS ±${f(l.accuracy ?? 0, 0)}m` : t("noGps")}
              </Text>
            </View>
            <Text testID="motion-hz-text" style={styles.hz}>
              {l.motionHz ? `${l.motionHz}Hz` : ""}
            </Text>
          </View>
        </View>

        {/* Language toggle */}
        <Pressable
          onPress={() => setLang(lang === "it" ? "en" : "it")}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <Text style={styles.langText}>{lang === "it" ? "EN" : "IT"}</Text>
        </Pressable>

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
              <Text style={styles.permTitle}>{t("sensorsNeeded")}</Text>
              <Text style={styles.permBody}>{t("sensorsBody")}</Text>
              <Text testID="permission-status-text" style={styles.permStatus}>
                MOTION: {motionLabel(engine.motionPerm)} · GPS: {engine.gpsPerm.toUpperCase()}
              </Text>
              {engine.gpsPerm === "blocked" || (!canOpenSettings && engine.gpsPerm === "denied") ? (
                canOpenSettings ? (
                  <Btn testID="open-settings-button" label={t("openSettings")} variant="orange" onPress={openSettings} />
                ) : (
                  <Text testID="browser-settings-hint" style={styles.permStatus}>
                    {t("browserSettings")}
                  </Text>
                )
              ) : (
                <Btn
                  testID="grant-permissions-button"
                  label={t("grantPermissions")}
                  onPress={() => engine.requestPermissions()}
                />
              )}
            </GlassCard>
          </Animated.View>
        )}

        {engine.permsGranted && engine.motionPerm === "unavailable" && (
          <GlassCard testID="motion-unavailable-card" style={styles.warnCard}>
            <Text style={styles.warnText}>{t("motionUnavailable")}</Text>
            <Btn
              testID="retry-motion-button"
              label={t("enableMotion")}
              variant="ghost"
              onPress={() => engine.retryMotion()}
            />
          </GlassCard>
        )}

        {/* Speed hero */}
        <GlassCard testID="speed-card">
          <CardLabel>{t("liveSpeed")}</CardLabel>
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
            <Stat testID="max-speed-value" label={t("max")} value={f(s.maxSpeed)} unit="km/h" tone="orange" />
            <Stat testID="avg-speed-value" label={t("avg")} value={f(engine.avgSpeed)} unit="km/h" />
            <Stat testID="distance-value" label={t("dist")} value={f(s.distanceM / 1000, 2)} unit="km" />
          </View>
        </GlassCard>

        {/* Trail */}
        <GlassCard testID="trail-card">
          <CardLabel>{t("gpsTrail")}</CardLabel>
          <TrailMap
            testID="trail-map"
            points={engine.track}
            version={engine.trackVersion}
            height={220}
            live={st !== "STOPPED"}
            heading={l.heading}
          />
          <View style={[styles.row, { marginTop: 12 }]}>
            <Stat
              testID="altitude-value"
              label={t("altitude")}
              value={l.altitude == null ? "--" : f(l.altitude, 0)}
              unit="m"
            />
            <Stat testID="elevation-gain-value" label={t("gain")} value={f(s.gain, 0)} unit="m" tone="lime" />
            <Stat testID="elevation-loss-value" label={t("loss")} value={f(s.loss, 0)} unit="m" tone="orange" />
          </View>
        </GlassCard>

        {/* G-force & lean */}
        <GlassCard testID="gforce-card">
          <CardLabel>{t("gforceLean")}</CardLabel>
          <View style={styles.gRow}>
            <GBall size={150} />
            <View style={styles.gSide}>
              <Text style={styles.miniLabel}>{t("leanAngle")}</Text>
              <View style={styles.leanRow}>
                <Text testID="lean-side-text" style={styles.leanSide}>
                  {lean.side}
                </Text>
                <Text testID="live-lean-value" style={styles.leanValue}>
                  {lean.value}°
                </Text>
              </View>
              <Stat testID="max-lean-value" label={t("maxLean")} value={`${f(s.maxLean, 0)}°`} tone="orange" size={24} />
              <Text style={styles.leanLR}>
                L {f(s.maxLeanL, 0)}° · R {f(s.maxLeanR, 0)}°
              </Text>
            </View>
          </View>
          <View style={[styles.row, { marginTop: 12 }]}>
            <Stat testID="live-g-value" label={t("liveG")} value={f(l.g, 2)} unit="G" />
            <Stat testID="peak-g-value" label={t("peakG")} value={f(s.peakG, 2)} unit="G" tone="orange" />
            <Stat testID="max-braking-value" label={t("maxBrake")} value={f(s.maxBrakingG, 2)} unit="G" tone="orange" />
          </View>
        </GlassCard>

        {/* Jumps */}
        <GlassCard testID="jump-card" style={l.airborne ? { borderColor: colors.brandPrimary } : undefined}>
          <CardLabel
            right={
              l.airborne ? (
                <Text testID="airborne-indicator" style={styles.airborne}>
                  {t("airborne")} {f(airNow, 2)}s
                </Text>
              ) : undefined
            }
          >
            {t("airtime")}
          </CardLabel>
          <View style={styles.row}>
            <Stat testID="last-airtime-value" label={t("lastJump")} value={f(s.lastAirtime, 2)} unit="s" tone="lime" size={44} />
            <Stat testID="best-airtime-value" label={t("best")} value={f(s.bestAirtime, 2)} unit="s" tone="lime" size={44} />
          </View>
          <View style={[styles.row, { marginTop: 8 }]}>
            <Stat testID="total-jumps-value" label={t("totalJumps")} value={String(s.totalJumps)} />
            <Stat testID="landing-impact-value" label={t("landingImpact")} value={f(s.lastImpact, 2)} unit="G" tone="orange" />
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
        <BlurView intensity={30} 
