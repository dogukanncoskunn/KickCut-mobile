import { useCallback, useEffect, useState } from "react";
import { AppState, Image, Text, View } from "react-native";
import { useLocale, useT } from "../i18n";
import type { Vod } from "../lib/api";
import { channelVods, resolveVod } from "../lib/kickApi";
import { cleanError } from "../lib/errors";
import { compactCount, shortDate, timecode } from "../lib/format";
import { useSelection } from "../lib/Selection";
import { Appear, Badge, Button, Card, Columns, EmptyState, Icon, Input, Note, Skeleton } from "../lib/ui";
import type { IconName } from "../lib/ui";

/*
 * Two ways in, on purpose. The channel box covers the normal case; the link
 * box covers the case it cannot, because Kick's videos endpoint is not
 * paginated and only returns the most recent broadcasts.
 */

/*
 * How often a listed channel is asked again. Kick publishes a broadcast as a
 * VOD a little after the stream ends, so a list fetched while someone was still
 * live goes stale the moment they stop.
 */
const REFRESH_MS = 60_000;

export function Library() {
  const t = useT();
  const { locale } = useLocale();
  const { vod: selected, select } = useSelection();

  const [channel, setChannel] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<null | "channel" | "link">(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ channel: string; vods: Vod[] } | null>(null);
  // The slug the list on screen came from, so a refresh re-asks the same
  // question. A pasted link has nothing to re-ask, so it clears this.
  const [watching, setWatching] = useState<string | null>(null);

  async function listChannel() {
    if (!channel.trim() || busy) return;
    setBusy("channel");
    setError(null);
    try {
      const vods = await channelVods(channel);
      setResults({ channel: vods[0]?.channel || channel.trim(), vods });
      setWatching(channel.trim());
    } catch (err) {
      setError(cleanError(err));
      setResults(null);
      setWatching(null);
    } finally {
      setBusy(null);
    }
  }

  /*
   * Keep the listed channel current on its own. The list is replaced only when
   * the answer actually differs, and a failed refresh is swallowed: it is a
   * background courtesy, not a request the user made.
   */
  const refresh = useCallback(async () => {
    if (!watching || AppState.currentState !== "active") return;
    try {
      const vods = await channelVods(watching);
      setResults((current) => {
        if (!current) return current;
        const unchanged =
          current.vods.length === vods.length && current.vods.every((v, i) => v.uuid === vods[i].uuid);
        return unchanged ? current : { channel: vods[0]?.channel || current.channel, vods };
      });
    } catch {
      /* stale for another minute is better than an error nobody asked for */
    }
  }, [watching]);

  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    // Coming back to the app is the moment someone is most likely to be
    // checking whether the broadcast has landed.
    const sub = AppState.addEventListener("change", (s) => s === "active" && void refresh());
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [watching, refresh]);

  async function openLink() {
    if (!link.trim() || busy) return;
    setBusy("link");
    setError(null);
    try {
      const one = await resolveVod(link);
      setResults({ channel: one.channel, vods: [one] });
      setWatching(null);
      select(one);
    } catch (err) {
      setError(cleanError(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="flex-col gap-7">
      {/* Both entry points get the identical three-row shape, so they line up. */}
      <Columns min={21}>
        {[
          <SearchRow
            key="channel"
            label={t("library.channel.label")}
            hint={t("library.channel.hint")}
            value={channel}
            onValue={setChannel}
            placeholder={t("library.channel.placeholder")}
            onSubmit={() => void listChannel()}
            submitLabel={busy === "channel" ? t("common.loading") : t("library.channel.submit")}
            submitKind="primary"
            submitIcon="search"
            busy={busy !== null}
          />,
          <SearchRow
            key="link"
            label={t("library.link.label")}
            hint={t("library.link.hint")}
            value={link}
            onValue={setLink}
            placeholder={t("library.link.placeholder")}
            onSubmit={() => void openLink()}
            submitLabel={busy === "link" ? t("common.loading") : t("library.link.submit")}
            submitKind="quiet"
            submitIcon="download"
            busy={busy !== null}
          />,
        ]}
      </Columns>

      {error ? <Note kind="error">{error}</Note> : null}

      {busy === "channel" ? (
        <Columns>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="aspect-video w-full rounded-none" />
              <View className="flex-col gap-2 p-3.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-2/5" />
              </View>
            </Card>
          ))}
        </Columns>
      ) : null}

      {!busy && !results ? <EmptyState icon="search">{t("empty.library")}</EmptyState> : null}

      {!busy && results ? (
        <View className="flex-col gap-3">
          <Text className="text-small text-muted">
            {t("library.results", { count: results.vods.length, channel: results.channel })}
          </Text>
          <Columns>
            {results.vods.map((v) => (
              <VodCard
                key={v.uuid}
                vod={v}
                locale={locale}
                active={selected?.uuid === v.uuid}
                onSelect={() => select(v)}
                selectLabel={t("library.select")}
                selectedLabel={t("library.selected")}
                viewsLabel={t("library.views", { count: compactCount(v.views, locale) })}
              />
            ))}
          </Columns>
        </View>
      ) : null}
    </View>
  );
}

function VodCard({
  vod,
  locale,
  active,
  onSelect,
  selectLabel,
  selectedLabel,
  viewsLabel,
}: {
  vod: Vod;
  locale: string;
  active: boolean;
  onSelect: () => void;
  selectLabel: string;
  selectedLabel: string;
  viewsLabel: string;
}) {
  // A pruned VOD keeps its record but loses its thumbnail; an empty frame
  // looks deliberate, a broken image does not.
  const [thumbOk, setThumbOk] = useState(true);
  return (
    <Appear>
      <Card kind={active ? "primary" : "normal"} className={"flex-col overflow-hidden " + (active ? "border-kick/50" : "")}>
        <View className="relative aspect-video bg-ink">
          {vod.thumbnail && thumbOk ? (
            <Image
              source={{ uri: vod.thumbnail }}
              className="size-full"
              resizeMode="cover"
              onError={() => setThumbOk(false)}
            />
          ) : null}
          <View className="absolute right-2 bottom-2 rounded bg-ink/85 px-1.5 py-0.5">
            <Text className="font-mono text-mini text-body">{timecode(vod.durationMs / 1000)}</Text>
          </View>
        </View>

        <View className="flex-1 flex-col gap-2.5 p-3.5">
          <Text numberOfLines={2} className="text-body font-medium text-body">
            {vod.title}
          </Text>
          <View className="flex-row items-center gap-2">
            <Icon name="clock" className="size-3.5 text-muted" />
            <Text className="font-mono text-mini text-muted">{shortDate(vod.startedAt, locale)}</Text>
            <Text className="font-mono text-mini text-muted">·</Text>
            <Text className="font-mono text-mini text-muted">{viewsLabel}</Text>
          </View>
          <View className="mt-auto flex-row items-center justify-between gap-2 pt-1">
            {active ? <Badge kind="ok">{selectedLabel}</Badge> : <View />}
            <Button kind={active ? "quiet" : "primary"} size="small" icon="scissors" onPress={onSelect}>
              {selectLabel}
            </Button>
          </View>
        </View>
      </Card>
    </Appear>
  );
}

/* One entry point: a label, an input paired with its submit button, a hint. */
function SearchRow({
  label,
  hint,
  value,
  onValue,
  placeholder,
  onSubmit,
  submitLabel,
  submitKind,
  submitIcon,
  busy,
}: {
  label: string;
  hint: string;
  value: string;
  onValue: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
  submitLabel: string;
  submitKind: "primary" | "quiet";
  submitIcon: IconName;
  busy: boolean;
}) {
  return (
    <View className="flex-col gap-1.5">
      <Text className="text-small font-medium text-muted">{label}</Text>
      <View className="flex-row gap-2">
        <Input
          value={value}
          onChangeText={onValue}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          accessibilityLabel={label}
          className="min-w-0 flex-1"
        />
        <Button kind={submitKind} icon={submitIcon} disabled={!value.trim() || busy} onPress={onSubmit}>
          {submitLabel}
        </Button>
      </View>
      <Text className="text-small text-muted/80">{hint}</Text>
    </View>
  );
}
