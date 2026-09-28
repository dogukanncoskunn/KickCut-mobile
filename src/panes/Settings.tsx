import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";
import { useT } from "../i18n";
import { useFfmpeg } from "../lib/Ffmpeg";
import { useMotion } from "../lib/Motion";
import { AutoResumeControl } from "../lib/AutoResume";
import { SpeedControl } from "../lib/SpeedControl";
import { Badge, Card, Note, Spinner, Toggle } from "../lib/ui";

/*
 * Settings as a row of cards on one uniform grid. The column count steps
 * 1 -> 2 -> 4 and deliberately skips 3, which would strand the fourth card
 * alone on a second row. The breakpoints are the desktop's md and xl.
 */
export function Settings() {
  const t = useT();
  const { motion, setMotion } = useMotion();
  const { width } = useWindowDimensions();
  const cols = width >= 80 * 14 ? 4 : width >= 48 * 14 ? 2 : 1;

  const cards = [
    <SettingCard key="ffmpeg" title={t("ffmpeg.title")} hint={t("ffmpeg.hint")}>
      <FfmpegSetting />
    </SettingCard>,
    <SettingCard key="speed" title={t("speed.label")} hint={t("speed.hint")}>
      <SpeedControl />
    </SettingCard>,
    <SettingCard key="resume" title={t("queue.autoResume")} hint={t("queue.autoResume.hint")}>
      <AutoResumeControl />
    </SettingCard>,
    <SettingCard key="motion" title={t("settings.motion")} hint={t("settings.motion.hint")}>
      <View className="flex-row items-center gap-2.5">
        <Toggle checked={motion} onChange={setMotion} label={t("settings.motion")} />
        <Text className="text-body text-body">{motion ? t("settings.motion.on") : t("settings.motion.off")}</Text>
      </View>
    </SettingCard>,
  ];

  // Rows of `cols`, each cell stretched to the row's height.
  const rows: ReactNode[][] = [];
  for (let i = 0; i < cards.length; i += cols) rows.push(cards.slice(i, i + cols));

  return (
    <View className="flex-col gap-5">
      {rows.map((row, i) => (
        <View key={i} className="flex-row items-stretch gap-5">
          {row.map((card, j) => (
            <View key={j} className="flex-1">
              {card}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function SettingCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card className="h-full flex-col gap-4 p-5">
      <View className="flex-col gap-1">
        <Text className="text-mid font-semibold text-body">{title}</Text>
        <Text className="text-small text-muted">{hint}</Text>
      </View>
      {/* Pushed to the bottom so every card's control sits on the same line. */}
      <View className="mt-auto">{children}</View>
    </Card>
  );
}

/*
 * The desktop's card installs FFmpeg. Android will not run a binary an app
 * downloads, so here it is built in: the card says so and names the build.
 */
function FfmpegSetting() {
  const t = useT();
  const { status, error } = useFfmpeg();

  if (!status) {
    return (
      <View className="flex-row items-center gap-2.5">
        <Spinner className="size-4 text-muted" />
        <Text className="text-small text-muted">{t("ffmpeg.checking")}</Text>
      </View>
    );
  }

  const missing = status.source === "missing";
  return (
    <View className="flex-col gap-3">
      <Badge kind={missing ? "warn" : "ok"}>{t(missing ? "ffmpeg.missing" : "ffmpeg.bundled")}</Badge>
      {status.version ? (
        <Text numberOfLines={1} className="font-mono text-small text-muted">
          {status.version}
        </Text>
      ) : (
        <Text className="text-small text-muted">{t("ffmpeg.blocked")}</Text>
      )}
      {error ? <Note kind="error">{error}</Note> : null}
    </View>
  );
}
