import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useT } from "../i18n";
import { api } from "./api";
import { localStorage } from "./storage";
import { Toggle } from "./ui";

/*
 * Whether a download that came up short puts itself back in the queue. On by
 * default: leaving a multi-hour download unattended is the normal way to use
 * this, and a retry re-fetches only the segments that are actually missing.
 */
const STORAGE_KEY = "kickcut.autoResume";

export function AutoResumeControl() {
  const t = useT();
  const [on, setOn] = useState(() => localStorage.getItem(STORAGE_KEY) !== "0");

  // Pushed on mount too: the engine starts with its own default.
  useEffect(() => {
    void api.setAutoResume(on).catch(() => {});
  }, [on]);

  return (
    <View className="flex-row items-center gap-2.5">
      <Toggle
        checked={on}
        label={t("queue.autoResume")}
        onChange={(next) => {
          localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          setOn(next);
        }}
      />
      <Text className="text-body text-body">{on ? t("settings.motion.on") : t("settings.motion.off")}</Text>
    </View>
  );
}
