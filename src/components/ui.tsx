import { ReactNode } from "react";
import { Pressable, Text, View, ViewStyle } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

export function GlassCard({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

export function CardLabel({ children, right }: { children: string; right?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {right}
    </View>
  );
}

type Tone = "lime" | "orange" | "white";

export function Stat({
  label,
  value,
  unit,
  tone = "white",
  size = 28,
  testID,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: Tone;
  size?: number;
  testID?: string;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const color = tone === "lime" ? colors.brandPrimary : tone === "orange" ? colors.brandSecondary : colors.onSurface;
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.statValueRow}>
        <Text testID={testID} style={[styles.statValue, { color, fontSize: size, lineHeight: size * 1.05 }]} numberOfLines={1}>
          {value}
        </Text>
        {unit ? <Text style={styles.statUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

export function Btn({
  label,
  onPress,
  icon,
  variant = "primary",
  testID,
  flex,
  disabled,
  onLongPress,
}: {
  label: string;
  onPress?: () => void;
  onLongPress?: () => void;
  icon?: ReactNode;
  variant?: "primary" | "orange" | "ghost" | "danger";
  testID?: string;
  flex?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const bg =
    variant === "primary"
      ? colors.brandPrimary
      : variant === "orange"
        ? colors.brandSecondary
        : variant === "danger"
          ? colors.error
          : colors.surfaceTertiary;
  const fg =
    variant === "primary"
      ? colors.onBrandPrimary
      : variant === "orange"
        ? colors.onBrandSecondary
        : variant === "danger"
          ? colors.onError
          : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] },
        flex && { flex: 1 },
      ]}
    >
      {icon}
      <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  card: {
    backgroundColor: c.glass,
    borderColor: c.glassBorder,
    borderWidth: 1,
    borderRadius: 20,
    padding: 12,
    overflow: "hidden",
  },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  label: { color: c.muted, fontFamily: fonts.displaySemi, fontSize: 13, letterSpacing: 2 },
  stat: { flex: 1, minWidth: 0 },
  statLabel: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 12, letterSpacing: 1.2 },
  statValueRow: { flexDirection: "row", alignItems: "flex-end" },
  statValue: { fontFamily: fonts.display },
  statUnit: { color: c.muted, fontFamily: fonts.displayMed, fontSize: 13, marginLeft: 3, marginBottom: 3 },
  btn: {
    minHeight: 52,
    borderRadius: 999,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnText: { fontFamily: fonts.display, fontSize: 19, letterSpacing: 1.5 },
}));
