import { LockSimple } from "phosphor-react-native";
import { useState } from "react";
import { Modal, Pressable, StatusBar, Text, View } from "react-native";

import { fonts, makeStyles, useTheme } from "@/src/theme";

export function PocketBlackout({ visible, onUnlock }: { visible: boolean; onUnlock: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [holding, setHolding] = useState(false);
  return (
    <Modal visible={visible} animationType="fade" transparent={false} statusBarTranslucent onRequestClose={() => {}}>
      <StatusBar hidden={visible} />
      <Pressable
        testID="pocket-blackout-overlay"
        style={styles.fill}
        delayLongPress={1500}
        onPressIn={() => setHolding(true)}
        onPressOut={() => setHolding(false)}
        onLongPress={() => {
          setHolding(false);
          onUnlock();
        }}
      >
        <View style={styles.center}>
          <LockSimple size={28} weight="bold" color={holding ? colors.muted : colors.blackoutText} />
          <Text style={[styles.text, holding && { color: colors.muted }]}>
            {holding ? "KEEP HOLDING..." : "HOLD TO UNLOCK"}
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  fill: { flex: 1, backgroundColor: c.blackout, alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", gap: 8 },
  text: { color: c.blackoutText, fontFamily: fonts.displaySemi, fontSize: 13, letterSpacing: 2 },
}));
