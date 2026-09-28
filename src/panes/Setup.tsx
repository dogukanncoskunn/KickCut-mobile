import { useEffect, useMemo, useRef, useState } from "react";
import { Image, PermissionsAndroid, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { useLocale, useT } from "../i18n";
import { api } from "../lib/api";
import type { MuxMode, PlaylistSummary, RangePlan, Rendition } from "../lib/api";
import { cleanError } from "../lib/errors";
import { bytes, parseKickDate, shortDate, timecode } from "../lib/format";
import { useFfmpeg } from "../lib/Ffmpeg";
import { useSelection } from "../lib/Selection";
import { localStorage } from "../lib/storage";
import {
  Appear,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Note,
  Section,
  Dropdown,
  Skeleton,
  Spinner,
  Toggle,
} from "../lib/ui";
import { useConfirmedCancel, useQueue } from "../lib/Queue";
import { SpeedControl } from "../lib/SpeedControl";
import { isActive, JobCard } from "./JobCard";
import { RangePicker } from "./RangePicker";
import type { Range } from "./RangePicker";

/*
 * The output folder is remembered. Someone downloading VODs is almost always
 * putting them in the same place, and re-picking it every time is the kind of
 * small friction that makes a tool annoying to live with.
 */
const FOLDER_KEY = "kickcut.outputDir";

/* The desktop's `xl` breakpoint, where the form splits into two columns. */
const TWO_COLUMNS = 80 * 14;

/*
 * Segments, the joined stream and the finished file can all be on disk at once
 * for a moment, so a download briefly needs about three times its own size.
 */
const DISK_FACTOR = 3;

export function Setup() {
  const t = useT();
  const { locale } = useLocale();
  const { vod } = useSelection();
  const { width } = useWindowDimensions();
  const [renditions, setRenditions] = useState<Rendition[] | null>(null);
  const [qualityName, setQualityName] = useState("");
  const [summary, setSummary] = useState<PlaylistSummary | null>(null);
  const [range, setRange] = useState<Range | null>(null);
  const [plan, setPlan] = useState<RangePlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outputDir, setOutputDir] = useState(() => localStorage.getItem(FOLDER_KEY) ?? "");
  const [fileName, setFileName] = useState("");
  const [muxMode, setMuxMode] = useState<MuxMode>("copy");
  const [queued, setQueued] = useState(false);
  // Shown beside the button that caused it: on a phone the top of the form,
  // where the other errors go, is a long scroll away from here.
  const [queueError, setQueueError] = useState<string | null>(null);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  const ffmpeg = useFfmpeg();

  const masterUrl = vod?.masterUrl ?? null;
  const quality = useMemo(
    () => renditions?.find((r) => r.name === qualityName) ?? null,
    [renditions, qualityName],
  );

  /* Qualities, once per broadcast. */
  useEffect(() => {
    if (!masterUrl) {
      setRenditions(null);
      return;
    }
    // A late answer for a broadcast the user has already moved away from must
    // not overwrite the current one.
    let live = true;
    setRenditions(null);
    setSummary(null);
    setRange(null);
    setPlan(null);
    setError(null);
    api
      .renditions(masterUrl)
      .then((list) => {
        if (!live) return;
        setRenditions(list);
        setQualityName(list[0]?.name ?? "");
      })
      .catch((err) => live && setError(cleanError(err)));
    return () => {
      live = false;
    };
  }, [masterUrl]);

  /* The playlist behind the chosen quality: real duration and break marks. */
  const playlistUrl = quality?.playlistUrl ?? null;
  useEffect(() => {
    if (!playlistUrl) return;
    let live = true;
    api
      .playlistSummary(playlistUrl)
      .then((s) => {
        if (!live) return;
        setSummary(s);
        // Every rendition is the same recording, so a range already picked out
        // stays valid across a quality switch; only an empty one is filled.
        setRange((current) => current ?? { start: 0, end: s.totalSeconds });
      })
      .catch((err) => live && setError(cleanError(err)));
    return () => {
      live = false;
    };
  }, [playlistUrl]);

  /*
   * The plan is recomputed in the engine so the segment arithmetic has exactly
   * one implementation. Dragging fires continuously, so it is debounced.
   */
  const planTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!playlistUrl || !range || !quality) return;
    clearTimeout(planTimer.current);
    planTimer.current = setTimeout(() => {
      api
        .planRange(playlistUrl, range.start, range.end, quality.bandwidth)
        .then(setPlan)
        .catch((err) => setError(cleanError(err)));
    }, 220);
    return () => clearTimeout(planTimer.current);
  }, [playlistUrl, range, quality]);

  useEffect(() => {
    if (plan) setMuxMode(plan.crossesDiscontinuity ? "reencode" : "copy");
  }, [plan?.crossesDiscontinuity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Free space is only worth asking about once there is a size to compare.
  useEffect(() => {
    if (!plan) return;
    void api.freeBytes().then(setFreeBytes).catch(() => setFreeBytes(null));
  }, [plan?.estimatedBytes]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * A default name that is useful in a folder full of these: who streamed it
   * and when. The stream title is long, emoji-heavy and often identical from
   * day to day - the opposite of what a file name is for.
   */
  useEffect(() => {
    if (!vod) return;
    const day = parseKickDate(vod.startedAt);
    const stamp = day ? day.toISOString().slice(0, 10) : "";
    setFileName([vod.channel, stamp].filter(Boolean).join(" "));
    setQueued(false);
  }, [vod]);

  async function chooseFolder() {
    const picked = await api.pickFolder();
    if (typeof picked === "string") {
      localStorage.setItem(FOLDER_KEY, picked);
      setOutputDir(picked);
    }
  }

  async function addToQueue() {
    if (!vod || !plan || !quality) return;
    // The download runs with a notification so Android keeps it alive; asking
    // is only a courtesy - refused, the download still runs, just unseen.
    if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => {});
    }
    try {
      await api.enqueueJob({
        title: vod.title,
        channel: vod.channel,
        quality: quality.name,
        playlistUrl: quality.playlistUrl,
        startIndex: plan.startIndex,
        endIndex: plan.endIndex,
        trimOffset: plan.trimOffset,
        outputSeconds: plan.outputSeconds,
        crossesDiscontinuity: plan.crossesDiscontinuity,
        outputDir,
        fileName,
        muxMode,
        frameRate: quality.frameRate,
      });
      setQueued(true);
      setQueueError(null);
    } catch (err) {
      setQueued(false);
      setQueueError(cleanError(err));
    }
  }

  // No broadcast picked yet still leaves the downloads box on screen: a
  // running job has to stay reachable whether or not the next one is set up.
  if (!vod) {
    return (
      <View className="flex-col gap-4">
        <EmptyState icon="scissors">{t("empty.setup")}</EmptyState>
        <RunningDownloads />
        <SpeedLimitBox />
      </View>
    );
  }

  const whole = summary !== null && range !== null && range.start === 0 && range.end === summary.totalSeconds;
  const need = plan ? plan.estimatedBytes * DISK_FACTOR : 0;
  const folderLabel = outputDir ? api.folderLabel(outputDir) : "";
  const wide = width >= TWO_COLUMNS;

  const left = (
    <View className="min-w-0 flex-col gap-4" style={wide ? { flex: 3 } : undefined}>
      <Section title={t("setup.quality")}>
        {!renditions && !error ? (
          <Card className="flex-row items-center gap-3 p-4">
            <Spinner className="size-4 text-muted" />
            <Text className="text-small text-muted">{t("setup.quality.loading")}</Text>
          </Card>
        ) : null}
        {renditions ? (
          <Card className="p-4">
            <Field label={t("setup.quality")}>
              <Dropdown
                value={qualityName}
                onChange={setQualityName}
                className="w-full"
                ariaLabel={t("setup.quality")}
                options={renditions.map((r, i) => ({
                  value: r.name,
                  label:
                    t("setup.quality.option", { name: r.name, bitrate: (r.bandwidth / 1e6).toFixed(1) }) +
                    // The top rung is only called the source when its encoding
                    // shows it was passed through; otherwise it is the highest.
                    (i === 0 ? ` (${t(r.isSource ? "quality.source" : "quality.highest")})` : ""),
                }))}
              />
            </Field>
          </Card>
        ) : null}
      </Section>

      {renditions ? (
        <Section
          title={t("setup.range")}
          action={
            summary && range ? (
              <View className="flex-row items-center gap-2.5">
                <Text className="text-small text-muted">{t("setup.range.whole")}</Text>
                <Toggle
                  checked={whole}
                  label={t("setup.range.whole")}
                  onChange={(on) =>
                    on
                      ? setRange({ start: 0, end: summary.totalSeconds })
                      : // Narrowing from the whole broadcast needs somewhere to
                        // start; the middle half is a neutral first guess.
                        setRange({ start: summary.totalSeconds * 0.25, end: summary.totalSeconds * 0.75 })
                  }
                />
              </View>
            ) : undefined
          }
        >
          {!summary ? (
            <Card className="flex-col gap-3 p-4">
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-9 w-36" />
            </Card>
          ) : (
            <Card className="flex-col gap-4 p-4">
              {range ? (
                <RangePicker
                  total={summary.totalSeconds}
                  discontinuities={summary.discontinuitySeconds}
                  value={range}
                  onChange={setRange}
                />
              ) : null}
              {!summary.complete ? <Note kind="warn">{t("setup.warn.incomplete")}</Note> : null}
            </Card>
          )}
        </Section>
      ) : null}

      {/* On a phone the decision comes before the queue; see `right`. */}
      {wide ? (
        <>
          <RunningDownloads />
          <SpeedLimitBox />
        </>
      ) : null}
    </View>
  );

  const right = (
    <View className="min-w-0 flex-col gap-4" style={wide ? { flex: 1, minWidth: 22 * 14 } : undefined}>
      {plan ? (
        <Section title={t("setup.plan")}>
          <View className="flex-col gap-3">
            <Card className="flex-row flex-wrap items-end gap-x-8 gap-y-4 p-4">
              <Figure label={t("setup.plan.output")} value={timecode(plan.outputSeconds)} />
              <Figure label={t("setup.plan.size")} value={bytes(plan.estimatedBytes)} />
              <Figure
                label={t("setup.plan.segments", { count: plan.segmentCount })}
                value={`${plan.startIndex}–${plan.endIndex}`}
                quiet
              />
            </Card>
            {plan.downloadSeconds - plan.outputSeconds > 1 ? (
              <Text className="text-small text-muted">
                {t("setup.plan.trim", { extra: timecode(plan.downloadSeconds - plan.outputSeconds) })}
              </Text>
            ) : null}
            {plan.crossesDiscontinuity ? <Note kind="warn">{t("setup.warn.discontinuity")}</Note> : null}
          </View>
        </Section>
      ) : null}

      {plan ? (
        <Section title={t("setup.mux")}>
          <View className="flex-col gap-3">
            {(["copy", "reencode"] as const).map((mode) => (
              <ModeCard
                key={mode}
                active={muxMode === mode}
                suggested={plan.crossesDiscontinuity === (mode === "reencode")}
                title={t(`setup.mux.${mode}`)}
                hint={t(`setup.mux.${mode}.hint`)}
                suggestedLabel={t("setup.mux.suggested")}
                onPick={() => setMuxMode(mode)}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {plan ? (
        <Section title={t("setup.output")} className={wide ? "mt-auto" : ""}>
          <View className="flex-col gap-3">
            <Card className="flex-col gap-3 p-4">
              <View className="flex-col gap-1.5">
                <Text className="text-small font-medium text-muted">{t("setup.output.folder")}</Text>
                <View className="flex-row gap-2">
                  <Pressable className="min-w-0 flex-1" onPress={() => void chooseFolder()}>
                    <Input
                      value={folderLabel}
                      editable={false}
                      pointerEvents="none"
                      placeholder="…"
                      numberOfLines={1}
                      className="min-w-0 flex-1 font-mono text-small"
                      style={{ opacity: 1 }}
                    />
                  </Pressable>
                  <Button icon="folder" onPress={() => void chooseFolder()}>
                    {t("setup.output.choose")}
                  </Button>
                </View>
              </View>
              <View className="flex-col gap-1.5">
                <Text className="text-small font-medium text-muted">{t("setup.output.name")}</Text>
                <Input
                  value={fileName}
                  onChangeText={setFileName}
                  autoCorrect={false}
                  autoCapitalize="none"
                  accessibilityLabel={t("setup.output.name")}
                />
              </View>
            </Card>

            {/* ffmpeg has to exist before a job is queued, not after it finishes. */}
            {!ffmpeg.ready && ffmpeg.status ? <Note kind="warn">{t("ffmpeg.blocked")}</Note> : null}

            {freeBytes !== null && freeBytes < need ? (
              <Note kind="warn">{t("setup.warn.space", { free: bytes(freeBytes), need: bytes(need) })}</Note>
            ) : null}

            <View className="flex-row items-center gap-3">
              <Button
                kind="primary"
                size="large"
                icon="download"
                disabled={!outputDir || !fileName.trim() || !ffmpeg.ready}
                onPress={() => void addToQueue()}
                className="flex-1"
              >
                {t("setup.start")}
              </Button>
            </View>
            {queueError ? <Note kind="error">{queueError}</Note> : null}
            {queued ? (
              <Appear>
                <Text className="text-body text-kick-text">{t("setup.queued")}</Text>
              </Appear>
            ) : null}
          </View>
        </Section>
      ) : null}

      {!wide ? (
        <>
          <RunningDownloads />
          <SpeedLimitBox />
        </>
      ) : null}
    </View>
  );

  return (
    <View className="flex-col gap-4">
      {/* The broadcast is context, not a decision, so it gets one slim strip. */}
      <Card className="flex-row items-center gap-4 p-3">
        {vod.thumbnail ? (
          <Image source={{ uri: vod.thumbnail }} className="h-14 w-24 shrink-0 rounded" resizeMode="cover" />
        ) : null}
        <View className="min-w-0 flex-1 flex-col gap-1">
          <Text numberOfLines={1} className="text-mid font-semibold text-body">
            {vod.title}
          </Text>
          <Text numberOfLines={1} className="font-mono text-small text-muted">
            {vod.channel} · {shortDate(vod.startedAt, locale)} · {t("setup.length")}{" "}
            {timecode((summary?.totalSeconds ?? vod.durationMs / 1000) || 0)}
          </Text>
        </View>
      </Card>

      {error ? <Note kind="error">{error}</Note> : null}

      {wide ? (
        <View className="flex-row items-stretch gap-4">
          {left}
          {right}
        </View>
      ) : (
        <>
          {left}
          {right}
        </>
      )}
    </View>
  );
}

/*
 * The running downloads, with a permanent place on this screen: the box is here
 * before there is anything in it and stays after the last job leaves, so the
 * screen does not change shape while it is used.
 */
function RunningDownloads() {
  const t = useT();
  const { jobs, pause, resume } = useQueue();
  const cancel = useConfirmedCancel();
  const running = jobs.filter(isActive);

  return (
    <Section title={t("setup.queue")}>
      {running.length === 0 ? (
        <EmptyState icon="download">{t("empty.queue")}</EmptyState>
      ) : (
        <View className="flex-col gap-3">
          {running.map((job) => (
            <JobCard key={job.id} job={job} onPause={pause} onResume={resume} onCancel={cancel} />
          ))}
        </View>
      )}
    </Section>
  );
}

/*
 * The speed cap, within reach of the download it applies to. Settings has the
 * same control over the same value, so neither can disagree with the other.
 */
function SpeedLimitBox() {
  const t = useT();
  return (
    <Section title={t("speed.label")} hint={t("speed.hint")}>
      <Card className="p-4">
        <SpeedControl />
      </Card>
    </Section>
  );
}

function Figure({ label, value, quiet }: { label: string; value: string; quiet?: boolean }) {
  return (
    <View className="flex-col gap-1">
      <Text className="text-small font-medium text-muted">{label}</Text>
      <Text className={"font-mono " + (quiet ? "text-mid text-muted" : "text-title text-body")}>{value}</Text>
    </View>
  );
}

/*
 * A choice between two real costs - time against exactness - so both are
 * stated rather than hidden behind a label.
 */
function ModeCard({
  active,
  suggested,
  title,
  hint,
  suggestedLabel,
  onPick,
}: {
  active: boolean;
  suggested: boolean;
  title: string;
  hint: string;
  suggestedLabel: string;
  onPick: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: active }}
      onPress={onPick}
      className={
        "flex-col gap-2 rounded-lg border p-4 " +
        (active ? "border-kick/60 bg-raised/70" : "border-line bg-surface/60 active:border-muted/30")
      }
    >
      <View className="flex-row items-center gap-2">
        <View
          className={"size-3.5 shrink-0 rounded-full border-2 " + (active ? "border-kick bg-kick" : "border-muted")}
        />
        <Text className="text-body font-medium text-body">{title}</Text>
      </View>
      <Text className="text-small text-muted">{hint}</Text>
      {suggested ? (
        <View className="pt-1">
          <Badge kind="ok">{suggestedLabel}</Badge>
        </View>
      ) : null}
    </Pressable>
  );
}
