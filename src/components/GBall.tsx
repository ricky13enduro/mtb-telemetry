import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";

import { engine } from "@/src/telemetry/engine";
import { makeStyles, useTheme } from "@/src/theme";

const MAX_G = 1.5;
const DOT = 20;

export function GBall({ size }: { size: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const R = size / 2 - 12;

  useEffect(
    () =>
      engine.onFrame((lat, lon) => {
        let gx = lat;
        let gy = lon;
        const m = Math.sqrt(gx * gx + gy * gy);
        if (m > MAX_G) {
          gx = (gx / m) * MAX_G;
          gy = (gy / m) * MAX_G;
        }
        x.value = (gx / MAX_G) * R;
        y.value = (-gy / MAX_G) * R; // braking (negative) pushes the ball forward/up
      }),
    [R, x, y],
  );

  const dotStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));

  const c = size / 2;
  return (
    <View testID="g-ball" style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {[1, 2 / 3, 1 / 3].map((f, i) => (
          <Circle
            key={f}
            cx={c}
            cy={c}
            r={R * f}
            fill={i === 0 ? colors.surface : "none"}
            stroke={i === 0 ? colors.borderStrong : colors.border}
            strokeWidth={1}
          />
        ))}
        <Line x1={c - R} x2={c + R} y1={c} y2={c} stroke={colors.border} strokeWidth={1} />
        <Line y1={c - R} y2={c + R} x1={c} x2={c} stroke={colors.border} strokeWidth={1} />
        <SvgText x={c + 3} y={c - R / 3 + 10} fill={colors.muted} fontSize={8}>0.5</SvgText>
        <SvgText x={c + 3} y={c - (2 * R) / 3 + 10} fill={colors.muted} fontSize={8}>1.0</SvgText>
        <SvgText x={c + 3} y={c - R + 10} fill={colors.muted} fontSize={8}>1.5G</SvgText>
        <SvgText x={c} y={10} fill={colors.brandSecondary} fontSize={8} fontWeight="bold" textAnchor="middle">BRAKE</SvgText>
        <SvgText x={c} y={size - 3} fill={colors.muted} fontSize={8} fontWeight="bold" textAnchor="middle">ACCEL</SvgText>
      </Svg>
      <Animated.View style={[styles.dot, { left: c - DOT / 2, top: c - DOT / 2 }, dotStyle]} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  dot: {
    position: "absolute",
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: c.brandPrimary,
    borderWidth: 3,
    borderColor: c.brandTertiary,
  },
}));
