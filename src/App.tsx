import { useEffect, useRef, useState } from "react";
import { Animated, BackHandler, Image, Pressable, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LOCALES, LOCALE_NAMES, useLocale, useT } from "./i18n";
import type { Locale } from "./i18n";
import type { MessageKey } from "./i18n/en";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { FloatingDownload } from "./lib/FloatingDownload";
import { useMotion } from "./lib/Motion";
import { useSelection } from "./lib/Selection";
import { useTheme } from "./lib/Theme";
import { Dropdown, Icon, Note, noteText } from "./lib/ui";
import type { IconName } from "./lib/ui";
import { Library } from "./panes/Library";
import { Download } from "./panes/Download";
import { Downloads } from "./panes/Downloads";
import { Settings } from "./panes/Settings";

const logoDark = require("../assets/logo-dark.png");
const logoLight = require("../assets/logo-light.png");
const LOGO_RATIO = 206 / 72;

/*
 * Four screens, one useState - exactly as on the desktop. No router, because
 * there are no screens worth addressing, and no state library, because the
 * only things shared across panes are the selected broadcast and the queue.
 */
type TabId = "library" | "download" | "downloads" | "settings";

/*
 * Navigation is a row under the header, not a sidebar or a bottom bar, so the
 * app reads the same on a phone as on the desktop: the tabs sit on the same
 * left margin as the content they switch.
 */
const TABS: { id: TabId; icon: IconName; label: MessageKey; title: MessageKey; width: number }[] = [
  { id: "library", icon: "clock", label: "nav.library", title: "pane.library.title", width: 112 },
  { id: "download", icon: "scissors", label: "nav.download", title: "pane.setup.title", width: 112 },
  { id: "downloads", icon: "download", label: "nav.downloads", title: "pane.downloads.title", width: 84 },
  { id: "settings", icon: "settings", label: "nav.settings", title: "pane.settings.title", width: 84 },
];

export function App() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const [tab, setTab] = useState<TabId>("library");
  // On a narrow phone the tab row scrolls; the active tab is brought into view.
  const strip = useRef<ScrollView>(null);
  const tabX = useRef<Partial<Record<TabId, { x: number; width: number }>>>({});
  useEffect(() => {
    const at = tabX.current[tab];
    if (at) strip.current?.scrollTo({ x: Math.max(0, at.x - 24), animated: true });
  }, [tab]);
  const { vod } = useSelection();

  // Choosing a broadcast is the start of setting up a download, so it moves
  // there rather than leaving the user to notice a tab has become useful.
  useEffect(() => {
    if (vod) setTab("download");
  }, [vod]);

  // The back gesture walks back to the first tab before it leaves the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (tab === "library") return false;
      setTab("library");
      return true;
    });
    return () => sub.remove();
  }, [tab]);

  return (
    <View className="flex-1 bg-ink" style={{ paddingTop: insets.top }}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* The app's identity and the two preferences that belong to the whole window. */}
      <View
        className="h-11 shrink-0 flex-row items-center justify-between gap-4 border-b border-line/60 bg-surface px-6"
        style={{ paddingLeft: 24 + insets.left, paddingRight: 24 + insets.right }}
      >
        <Wordmark />
        {/*
          Language sits here rather than in Settings: it is the one preference
          someone may need on any screen - most often because the screen they
          are looking at is in the wrong language.
        */}
        <View className="flex-row items-center gap-1.5">
          <LanguagePicker />
          <ThemeSwitch />
        </View>
      </View>

      <View className="h-10 shrink-0 border-b border-line bg-surface">
        <ScrollView
          ref={strip}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="items-stretch gap-1 px-6"
          contentContainerStyle={{ paddingLeft: 24 + insets.left, paddingRight: 24 + insets.right }}
        >
          {TABS.map((x) => (
            <View
              key={x.id}
              className="flex-row"
              onLayout={(e) => {
                tabX.current[x.id] = e.nativeEvent.layout;
                // A language switch resizes the tabs; keep the active one in view.
                if (x.id === tab) strip.current?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 24), animated: true });
              }}
            >
              <TabButton icon={x.icon} label={t(x.label)} on={x.id === tab} onPress={() => setTab(x.id)} />
            </View>
          ))}
        </ScrollView>
      </View>

      <View className="min-w-0 flex-1">
        {/*
          Every pane stays mounted and the inactive ones are hidden. Unmounting
          threw away their state - the quality, the range and the folder just
          chosen, and a channel searched for. Each keeps its own scroll, too.
        */}
        {TABS.map((pane) => (
          <ScrollView
            key={pane.id}
            className="flex-1"
            style={pane.id === tab ? undefined : { display: "none" }}
            keyboardShouldPersistTaps="handled"
            contentContainerClassName="gap-4 px-6 pt-4 pb-6"
            contentContainerStyle={{
              width: "100%",
              maxWidth: pane.width * 14,
              alignSelf: "center",
              paddingLeft: 24 + insets.left,
              paddingRight: 24 + insets.right,
              // Room for the "made by" mark and the docked download panel.
              paddingBottom: 24 + insets.bottom + 28,
            }}
          >
            <Text className="text-page font-semibold tracking-tight text-body">{t(pane.title)}</Text>
            <ErrorBoundary
              fallback={(message) => (
                <Note kind="error">
                  <Text className={"text-body font-medium " + noteText.error}>{t("error.boundary")}</Text>
                  <Text className={"mt-1 font-mono text-small opacity-80 " + noteText.error}>{message}</Text>
                </Note>
              )}
            >
              {pane.id === "library" ? <Library /> : null}
              {pane.id === "download" ? <Download /> : null}
              {pane.id === "downloads" ? <Downloads /> : null}
              {pane.id === "settings" ? <Settings /> : null}
            </ErrorBoundary>
          </ScrollView>
        ))}
      </View>

      {/* Pinned to the window, not a pane, and never in the way of a touch. */}
      <Text
        pointerEvents="none"
        className="absolute left-4 font-mono text-mini text-body/45"
        style={{ bottom: 10 + insets.bottom }}
      >
        {t("app.madeBy")}
      </Text>

      {/* The queue follows you everywhere except the screen that already has it. */}
      <FloatingDownload enabled={tab !== "download"} bottomInset={insets.bottom} />
    </View>
  );
}

function TabButton({ icon, label, on, onPress }: { icon: IconName; label: string; on: boolean; onPress: () => void }) {
  const { motion } = useMotion();
  const bar = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(bar, { toValue: on ? 1 : 0, duration: motion ? 200 : 0, useNativeDriver: true }).start();
  }, [on, motion, bar]);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="relative shrink-0 flex-row items-center gap-2 px-3"
    >
      <Icon name={icon} className={"size-4 " + (on ? "text-kick-text" : "text-muted")} />
      <Text className={"text-body " + (on ? "font-medium text-body" : "text-muted")}>{label}</Text>
      {/* On the strip's own bottom border, so the tab reads as joined to the screen. */}
      <Animated.View className="absolute inset-x-0 -bottom-px h-0.5 bg-kick" style={{ opacity: bar }} />
    </Pressable>
  );
}

/* The mark is drawn in near-black ink, so it needs a variant per theme. */
function Wordmark() {
  const t = useT();
  const { theme } = useTheme();
  return (
    <Image
      source={theme === "light" ? logoLight : logoDark}
      accessibilityLabel={t("app.name")}
      className="shrink-0"
      style={{ height: 5 * 3.5, width: 5 * 3.5 * LOGO_RATIO }}
      resizeMode="contain"
    />
  );
}

/*
 * A physical switch rather than a button that swaps its icon: the knob carries
 * the theme that is on and sits on that theme's side, so the control shows its
 * state at rest.
 */
function ThemeSwitch() {
  const t = useT();
  const { motion } = useMotion();
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const next = dark ? "light" : "dark";
  const x = useRef(new Animated.Value(dark ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: dark ? 1 : 0, duration: motion ? 200 : 0, useNativeDriver: true }).start();
  }, [dark, motion, x]);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: dark }}
      accessibilityLabel={t(`theme.${next}`)}
      hitSlop={8}
      onPress={() => setTheme(next)}
      className="relative h-6 w-11 shrink-0 rounded-full border border-line bg-ink"
    >
      <Animated.View
        className="absolute top-0.5 size-4.5 items-center justify-center rounded-full bg-raised"
        style={{
          left: 0.15 * 14,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, (1.4 - 0.15) * 14] }) }],
        }}
      >
        {dark ? <Icon name="moon" className="size-3 text-body" /> : <Icon name="sun" className="size-3 text-amber-text" />}
      </Animated.View>
    </Pressable>
  );
}

function LanguagePicker() {
  const t = useT();
  const { locale, setLocale } = useLocale();
  return (
    <Dropdown
      value={locale}
      options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
      onChange={(next) => setLocale(next as Locale)}
      ariaLabel={t("settings.language")}
      className="h-7 w-[6.5rem] border-transparent bg-transparent"
      textClassName="text-small"
    />
  );
}
