import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, Text, View, useWindowDimensions } from "react-native";
import type { LayoutRectangle } from "react-native";
import { useT } from "../i18n";
import { isActive, JobCard } from "../panes/JobCard";
import { useConfirmedCancel, useQueue } from "./Queue";
import { localStorage } from "./storage";
import { Icon, PulseDot } from "./ui";

/*
 * The running download, following you around the app - the same card,
 * floating, the way a video keeps playing in a corner. Draggable by its
 * header, because wherever it defaults to will be over something someone
 * wants to read, and the position is remembered once it has been moved.
 *
 * Bottom left by default, as on the desktop: that corner is otherwise dead
 * space, and arriving there reads as docked.
 */
const POSITION_KEY = "kickcut.floating";
const MARGIN = 12;

type Point = { x: number; y: number };

export function FloatingDownload({ enabled = true, bottomInset = 0 }: { enabled?: boolean; bottomInset?: number }) {
  const t = useT();
  const { jobs, pause, resume } = useQueue();
  const cancel = useConfirmedCancel();
  const [collapsed, setCollapsed] = useState(false);
  const { width: screenW, height: screenH } = useWindowDimensions();
  const box = useRef<LayoutRectangle | null>(null);
  const start = useRef<Point>({ x: 0, y: 0 });

  const [at, setAt] = useState<Point | null>(() => {
    try {
      const saved = localStorage.getItem(POSITION_KEY);
      return saved ? (JSON.parse(saved) as Point) : null;
    } catch {
      return null;
    }
  });
  const atRef = useRef(at);
  atRef.current = at;

  const clamp = (p: Point): Point => {
    const w = box.current?.width ?? 0;
    const h = box.current?.height ?? 0;
    return {
      x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, screenW - w - MARGIN)),
      y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, screenH - h - MARGIN - bottomInset)),
    };
  };
  const clampRef = useRef(clamp);
  clampRef.current = clamp;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // A tap on the header's button must stay a tap; only a real move drags.
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
        onPanResponderGrant: () => {
          // Once dragged, the panel is positioned rather than anchored.
          start.current = atRef.current ?? { x: box.current?.x ?? MARGIN, y: box.current?.y ?? MARGIN };
        },
        onPanResponderMove: (_, g) => {
          setAt(clampRef.current({ x: start.current.x + g.dx, y: start.current.y + g.dy }));
        },
        onPanResponderRelease: () => {
          if (atRef.current) localStorage.setItem(POSITION_KEY, JSON.stringify(atRef.current));
        },
      }),
    [],
  );

  // Nothing to follow you around on the screen that already shows the queue.
  const job = jobs.find(isActive);
  if (!job || !enabled) return null;

  // A rotated or resized screen can leave a saved position off-screen.
  const place = at ? clamp(at) : null;

  return (
    <View
      onLayout={(e) => (box.current = e.nativeEvent.layout)}
      className="absolute z-40"
      style={[
        { width: Math.min(22 * 14, screenW - 24) },
        place ? { left: place.x, top: place.y } : { left: 14, bottom: 12 + bottomInset },
      ]}
    >
      <View className="overflow-hidden rounded-lg border border-line bg-surface shadow-2xl shadow-black/50">
        <View
          {...pan.panHandlers}
          className="flex-row items-center justify-between gap-2 border-b border-line bg-raised px-3 py-1.5"
        >
          <View className="flex-row items-center gap-2">
            <PulseDot />
            <Text className="text-small font-medium text-muted">{t("queue.floating")}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("queue.floating")}
            hitSlop={10}
            onPress={() => setCollapsed((v) => !v)}
            className="size-6 items-center justify-center rounded active:bg-surface"
          >
            <Icon name="chevron" className={"size-3.5 text-muted " + (collapsed ? "-rotate-90" : "rotate-90")} />
          </Pressable>
        </View>

        {!collapsed ? (
          <View className="p-2">
            <JobCard job={job} onPause={pause} onResume={resume} onCancel={cancel} compact />
          </View>
        ) : null}
      </View>
    </View>
  );
}
