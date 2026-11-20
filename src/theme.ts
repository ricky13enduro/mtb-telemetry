// Design tokens for this app. Dark OLED theme only (from /app/design_guidelines.json).
import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const dark = {
  surface: "#050507",
  onSurface: "#FFFFFF",
  surfaceSecondary: "#121215",
  onSurfaceSecondary: "#FFFFFF",
  surfaceTertiary: "#1A1A1E",
  onSurfaceTertiary: "#E0E0E4",
  surfaceInverse: "#FFFFFF",
  onSurfaceInverse: "#050507",
  muted: "#888890",

  brand: "#CCFF00",
  onBrand: "#050507",
  brandPrimary: "#CCFF00",
  onBrandPrimary: "#050507",
  brandSecondary: "#FF5500",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#2A3300",
  onBrandTertiary: "#CCFF00",

  success: "#CCFF00",
  onSuccess: "#050507",
  warning: "#FF5500",
  onWarning: "#FFFFFF",
  error: "#FF3333",
  onError: "#FFFFFF",
  info: "#00E5FF",
  onInfo: "#050507",

  border: "#222225",
  borderStrong: "#333338",
  divider: "#1A1A1E",

  // Extra tokens
  glass: "rgba(18,18,21,0.82)",
  glassBorder: "rgba(255,255,255,0.08)",
  orangeTertiary: "#331100",
  blackout: "#000000",
  blackoutText: "#2A2A2E",
};

export type ThemeColors = typeof dark;

export const defaultScheme = "dark" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light: dark, dark };

export const colors = dark;

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.("dark");

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = (system === "light" || system === "dark") && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? dark };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const fonts = {
  display: "BarlowBold",
  displaySemi: "BarlowSemi",
  displayMed: "BarlowMed",
  text: "Chivo",
};
