import { useFocusEffect, useRouter } from "expo-router";
import { CaretLeft, FileCsv, MapTrifold, Mountains, Trash } from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TrailMap } from "@/src/components/TrailMap";
import { Btn, GlassCard, Stat } from "@/src/components/ui";
import { duration, f } from "@/src/format";
import { useI18n } from "@/src/i18n";
import { exportCsv, exportGpx } from "@/src/telemetry/export";
import { deleteRun, getRun, listRuns } from "@/src/telemetry/runs";
import { RunRecord, RunSummary } from "@/src/telemetry/types";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function History() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const { t } = useI18n();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRuns(await listRuns());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable
          testID="history-back-button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={styles.iconBtn}
          hitSlop={8}
        >
          <CaretLeft size={22} weight="bold" color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{t("runHistory")}</Text>
        <Text testID="run-count-text" style={styles.count}>
          {runs ? `${runs.length} ${t("runs")}` : ""}
        </Text>
      </View>

      {runs === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandPrimary} />
        </View>
      ) : (
        <FlatList
          testID="runs-list"
          data={runs}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }, runs.length === 0 && { flex: 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.brandPrimary}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <View testID="history-empty-state" style={styles.center}>
              <Mountains size={64} weight="fill" color={colors.borderStrong} />
              <Text style={styles.emptyTitle}>{t("noRunsYet")}</Text>
              <Text style={styles.emptyBody}>{t("noRunsBody")}</Text>
            </View>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 60).duration(280)}>
              <RunCard
                run={item}
                onToast={setToast}
                onDeleted={() => setRuns((r) => (r ?? []).filter((x) => x.id !== item.id))}
              />
            </Animated.View>
          )}
        />
      )}

      {toast && (
        <View testID="history-toast" style={[styles.toast, { bottom: insets.bottom + 24 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

function RunCard({
  run,
  onToast,
  onDeleted,
}: {
  run: RunSummary;
  onToast: (s: string) => void;
  onDeleted: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useI18n();
  const [full, setFull] = useState<RunRecord | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getRun(run.id).then(setFull);
  }, [run.id]);

  const doExport = async (kind: "csv" | "gpx") => {
    if (!full) return;
    setBusy(kind);
    try {
      if (kind === "csv") await exportCsv(full);
      else await exportGpx(full);
    } catch {
      onToast(t("exportFailed"));
    }
    setBusy(null);
  };

  const id = `run-${run.number}`;
  return (
    <GlassCard testID={`${id}-card`} style={{ gap: 12 }}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text testID={`${id}-name`} style={styles.runName}>
            {run.name}
          </Text>
          <Text style={styles.runDate}>
            {new Date(run.startedAt).toLocaleString()} · {duration(run.durationMs)}
          </Text>
        </View>
        <Pressable
          testID={`${id}-delete-button`}
          hitSlop={8}
          onPress={async () => {
            if (!confirmDel) {
              setConfirmDel(true);
              setTimeout(() => setConfirmDel(false), 3000);
              return;
            }
            await deleteRun(run.id);
            onDeleted();
            onToast(`${run.name} ${t("deleted")}`);
          }}
          style={[styles.delBtn, confirmDel && { backgroundColor: colors.error, borderColor: colors.error }]}
        >
          <Trash size={18} weight="bold" color={confirmDel ? colors.onError : colors.muted} />
          {confirmDel && <Text style={styles.delText}>{t("tapAgain")}</Text>}
        </Pressable>
      </View>

      {full ? (
        <TrailMap points={full.track} version={full.track.length} height={140} testID={`${id}-trail`} />
      ) : (
        <View style={styles.mapSkeleton} />
      )}

      <View style={styles.row}>
        <Stat label={t("dist")} value={f(run.distanceM / 1000, 2)} unit="km" size={24} />
        <Stat label={t("max")} value={f(run.maxSpeed)} unit="km/h" tone="orange" size={24} />
        <Stat label={t("avg")} value={f(run.avgSpeed)} unit="km/h" size={24} />
      </View>
      <View style={styles.row}>
        <Stat label={t("best")} value={f(run.bestAirtime, 2)} unit="s" tone="lime" size={24} />
        <Stat label={t("totalJumps")} value={String(run.totalJumps)} size={24} />
        <Stat label={t("peakG")} value={f(run.peakG, 2)} tone="orange" size={24} />
      </View>
      <View style={styles.row}>
        <Stat label={t("maxLean")} value={`${f(run.maxLean, 0)}°`} size={24} />
        <Stat label={t("maxBrake")} value={f(run.maxBrakingG, 2)} size={24} />
        <Stat label={`${t("gain")} / ${t("loss")}`} value={`${f(run.gain, 0)}/${f(run.loss, 0)}`} unit="m" size={24} />
      </View>

      <View style={styles.row}>
        <Btn
          testID={`${id}-export-csv-button`}
          label={busy === "csv" ? "..." : "CSV"}
          variant="orange"
          flex
          disabled={!full || !!busy}
          icon={<FileCsv size={20} weight="bold" color={colors.onBrandSecondary} />}
          onPress={() => doExport("csv")}
        />
        <Btn
          testID={`${id}-export-gpx-button`}
          label={busy === "gpx" ? "..." : "GPX"}
          variant="orange"
          flex
          disabled={!full || !!busy}
          icon={<MapTrifold size={20} weight="bold" color={colors.onBrandSecondary} />}
          onPress={() => doExport("gpx")}
        />
      </View>
    </GlassCard>
  );
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.divider,
    backgroundColor: c.surface,
  },
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
  title: { flex: 1, color: c.onSurface, fontFamily: fonts.display, fontSize: 24, letterSpacing: 1.5 },
  count: { color: c.muted, fontFamily: fonts.displaySemi, fontSize: 14, letterSpacing: 1 },
  list: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  emptyTitle: { color: c.onSurface, fontFamily: fonts.display, fontSize: 24, letterSpacing: 1.5 },
  emptyBody: { color: c.muted, fontFamily: fonts.text, fontSize: 14, textAlign: "center" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  runName: { color: c.brandPrimary, fontFamily: fonts.display, fontSize: 28 },
  runDate: { color: c.muted, fontFamily: fonts.text, fontSize: 12 },
  delBtn: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  delText: { color: c.onError, fontFamily: fonts.display, fontSize: 13 },
  mapSkeleton: { height: 140, borderRadius: 12, backgroundColor: c.surfaceTertiary },
  row: { flexDirection: "row", gap: 12 },
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
