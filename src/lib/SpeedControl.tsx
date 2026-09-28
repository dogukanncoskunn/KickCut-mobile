import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useT } from "../i18n";
import { DEFAULT_KB, useSpeedLimit } from "./Speed";
import { Input, Toggle } from "./ui";

/*
 * One implementation, used in Settings and on the download screen, so the two
 * can never disagree about what the current cap is.
 *
 * The number is held as text while it is being typed: parsing every keystroke
 * would turn a half-typed "80" into an 80 KB/s cap on the way to 8000.
 */
export function SpeedControl({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const { enabled, setEnabled, kbPerSecond, setKbPerSecond } = useSpeedLimit();
  const [text, setText] = useState(() => String(kbPerSecond));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(String(kbPerSecond));
  }, [kbPerSecond, editing]);

  function commit() {
    setEditing(false);
    const parsed = Number(text.replace(/\s/g, ""));
    if (Number.isFinite(parsed) && parsed >= 0) setKbPerSecond(parsed);
    else setText(String(kbPerSecond));
  }

  return (
    <View className={compact ? "flex-row items-center gap-2.5" : "flex-col gap-3"}>
      <View className="flex-row items-center gap-2.5">
        <Toggle
          checked={enabled}
          label={t("speed.label")}
          onChange={(on) => {
            setEnabled(on);
            // Turning it on with nothing set would be a limit of zero, which
            // reads as unlimited - so it starts somewhere visible instead.
            if (on && kbPerSecond === 0) setKbPerSecond(DEFAULT_KB);
          }}
        />
        {!compact ? <Text className="text-body text-body">{enabled ? t("speed.on") : t("speed.off")}</Text> : null}
      </View>

      <View className="flex-row items-center gap-2">
        <Input
          value={text}
          keyboardType="number-pad"
          editable={enabled}
          accessibilityLabel={t("speed.field")}
          onFocus={() => setEditing(true)}
          onChangeText={setText}
          onBlur={commit}
          onSubmitEditing={commit}
          className={compact ? "h-7 w-24 font-mono text-small" : "w-32 font-mono"}
        />
        <Text className={"shrink-0 text-muted " + (compact ? "text-small" : "text-body")}>KB/s</Text>
      </View>

      {!compact ? (
        <Text className="text-small text-muted">
          {enabled && kbPerSecond > 0
            ? // Two places below 100 KB/s, or a 20 KB/s cap reads as "0.0 MB/s".
              t("speed.example", { mb: (kbPerSecond / 1000).toFixed(kbPerSecond < 100 ? 2 : kbPerSecond % 1000 ? 1 : 0) })
            : t("speed.unlimited.hint")}
        </Text>
      ) : null}
    </View>
  );
}
