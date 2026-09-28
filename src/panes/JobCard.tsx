import { Pressable, Text, View } from "react-native";
import { useT } from "../i18n";
import { api } from "../lib/api";
import type { JobProgress, JobState } from "../lib/api";
import { bytes, timecode } from "../lib/format";
import { Appear, Badge, Button, Card, Icon, Note, noteText, ProgressBar, PulseDot } from "../lib/ui";

/* A job's state decides its accent, so a list is scannable at a glance. */
const TONE: Record<JobState, "ok" | "warn" | "error" | "neutral"> = {
  queued: "neutral",
  downloading: "ok",
  paused: "neutral",
  muxing: "ok",
  done: "ok",
  failed: "error",
};

export function isActive(job: JobProgress): boolean {
  return job.state !== "done" && job.state !== "failed";
}

/*
 * One card, three places: the download screen, the floating panel that
 * follows you to other tabs, and the Downloads list. `compact` drops the parts
 * that do not fit in the floating panel; everything else is driven by the
 * job's own state, so the three can never disagree about what a job is doing.
 */
export function JobCard({
  job,
  onPause,
  onResume,
  onCancel,
  onRemove,
  onForget,
  compact = false,
}: {
  job: JobProgress;
  onPause?: (id: string) => void;
  onResume?: (id: string) => void;
  /** Stops an unfinished job and throws away what it has downloaded. */
  onCancel?: (id: string) => void;
  onRemove?: (id: string) => void;
  /** Drops the record and leaves the file alone. */
  onForget?: (id: string) => void;
  compact?: boolean;
}) {
  const t = useT();
  const running = job.state === "downloading";
  const muxing = job.state === "muxing";
  const fraction = muxing ? job.muxFraction : job.segmentsTotal > 0 ? job.segmentsDone / job.segmentsTotal : 0;

  // The finished file when there is one, otherwise the folder it is headed for.
  const revealTarget = job.outputPath ?? job.outputDir;

  return (
    <Appear>
      <Card kind={running || muxing ? "primary" : "normal"} className={"flex-col gap-3 " + (compact ? "p-3.5" : "p-5")}>
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 flex-col gap-1">
            <Text numberOfLines={1} className="text-body font-medium text-body">
              {job.fileName}
            </Text>
            <Text numberOfLines={1} className="font-mono text-small text-muted">
              {job.channel} · {job.quality} · {timecode(job.outputSeconds)}
            </Text>
          </View>
          <View className="shrink-0 flex-row items-center gap-2">
            {running || muxing ? <PulseDot /> : null}
            <Badge kind={TONE[job.state]}>{t(`queue.state.${job.state}`)}</Badge>
          </View>
        </View>

        {isActive(job) ? (
          <View className="flex-col gap-2">
            <ProgressBar value={fraction} kind={job.state === "paused" ? "warn" : "ok"} />
            <View className="flex-row flex-wrap justify-between gap-x-5 gap-y-1">
              <Text className="font-mono text-small text-muted">
                {muxing ? t("queue.muxing") : t("queue.progress", { done: job.segmentsDone, total: job.segmentsTotal })}
                {!muxing && job.bytesDone > 0 ? ` · ${bytes(job.bytesDone)}` : ""}
              </Text>
              {running ? (
                <Text className="font-mono text-small text-muted">
                  {job.bytesPerSecond > 0 ? t("queue.speed", { speed: bytes(job.bytesPerSecond) }) : ""}
                  {job.etaSeconds !== null ? ` · ${t("queue.eta", { time: timecode(job.etaSeconds) })}` : ""}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {job.error && !compact ? <Note kind="error">{job.error}</Note> : null}

        {/* Which minutes are missing, not which segment numbers. */}
        {job.failedSegments.length > 0 && !compact ? (
          <Note kind="warn">
            <Text className={"text-body font-medium " + noteText.warn}>
              {t("downloads.missing.title", { count: job.failedSegments.length })}
            </Text>
            <View className="mt-1.5 flex-col gap-0.5">
              {job.failedSegments.slice(0, 8).map((seg) => (
                <Text key={seg.index} className={"font-mono text-small " + noteText.warn}>
                  {t("downloads.missing.row", {
                    index: seg.index,
                    from: timecode(seg.startSeconds),
                    to: timecode(seg.endSeconds),
                  })}
                </Text>
              ))}
              {job.failedSegments.length > 8 ? <Text className={"font-mono text-small " + noteText.warn}>…</Text> : null}
            </View>
            <Text className={"mt-1.5 text-small opacity-90 " + noteText.warn}>{t("downloads.missing.hint")}</Text>
          </Note>
        ) : null}

        <View className="flex-row flex-wrap items-center gap-2">
          {running || job.state === "queued" ? (
            <Button size="small" icon="pause" onPress={() => onPause?.(job.id)}>
              {t("queue.pause")}
            </Button>
          ) : null}
          {job.state === "paused" || job.state === "failed" ? (
            <Button kind="primary" size="small" icon="play" onPress={() => onResume?.(job.id)}>
              {t("queue.resume")}
            </Button>
          ) : null}

          <Button
            kind={job.state === "done" ? "primary" : "quiet"}
            size="small"
            icon="folder"
            onPress={() => void api.reveal(revealTarget).catch(() => {})}
          >
            {t("queue.reveal")}
          </Button>

          {/* A phone hands a finished video on; the desktop never needed to. */}
          {job.state === "done" && job.outputPath ? (
            <Button
              size="small"
              icon="share"
              onPress={() => void api.share(job.outputPath!).catch(() => {})}
            >
              {t("queue.share")}
            </Button>
          ) : null}

          {onCancel && isActive(job) ? (
            <Button kind="danger" size="small" icon="close" onPress={() => onCancel(job.id)}>
              {t("queue.cancel")}
            </Button>
          ) : null}

          {onRemove ? (
            <Button kind="danger" size="small" icon="close" onPress={() => onRemove(job.id)}>
              {t("queue.remove")}
            </Button>
          ) : null}

          {/*
            Pushed to the far corner, away from "remove": this one drops the row
            and leaves the recording alone. The gap is what tells them apart.
          */}
          {onForget ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("downloads.forget")}
              onPress={() => onForget(job.id)}
              className="ml-auto h-7 w-8 shrink-0 items-center justify-center rounded-md active:bg-rose/15"
            >
              <Icon name="trash" className="size-4.5 text-rose-text" />
            </Pressable>
          ) : null}
        </View>
      </Card>
    </Appear>
  );
}
