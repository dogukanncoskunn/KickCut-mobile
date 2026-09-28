import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Text, View } from "react-native";
import { useT } from "../i18n";
import { fullTimecode, parseTimecode, timecode } from "../lib/format";
import { Input } from "../lib/ui";

/*
 * Picking a range out of an eight-hour broadcast.
 *
 * Two controls for one value, on purpose. The timecode boxes are how someone
 * says "02:00:00 to 05:30:00" and they stay authoritative. The track is how
 * they see where that lands - which matters most for the discontinuity marks,
 * because whether a break falls inside the cut decides the mux mode.
 */

const MIN_SPAN = 1;

export type Range = { start: number; end: number };

export function RangePicker({
  total,
  discontinuities,
  value,
  onChange,
}: {
  total: number;
  discontinuities: number[];
  value: Range;
  onChange: (next: Range) => void;
}) {
  const t = useT();

  return (
    <View className="flex-col gap-4">
      <Track
        total={total}
        discontinuities={discontinuities}
        value={value}
        onChange={onChange}
        startLabel={t("setup.range.startHandle")}
        endLabel={t("setup.range.endHandle")}
      />

      <View className="flex-row flex-wrap items-start gap-4">
        <TimeBox
          label={t("setup.range.start")}
          invalid={t("setup.range.invalid")}
          seconds={value.start}
          max={total}
          onCommit={(s) => onChange({ start: Math.min(s, value.end - MIN_SPAN), end: value.end })}
        />
        <TimeBox
          label={t("setup.range.end")}
          invalid={t("setup.range.invalid")}
          seconds={value.end}
          max={total}
          onCommit={(s) => onChange({ start: value.start, end: Math.max(s, value.start + MIN_SPAN) })}
        />
        <View className="flex-col gap-1.5">
          <Text className="text-small font-medium text-muted">{t("setup.plan.output")}</Text>
          <View className="h-9 justify-center">
            <Text className="font-mono text-mid text-body">{timecode(value.end - value.start)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ---------------------------------------------------------------- track -- */

type Handle = "start" | "end";

/* Grip is size-6 on the desktop; a finger needs the same dot with more room. */
const GRIP = 6 * 3.5;

function Track({
  total,
  discontinuities,
  value,
  onChange,
  startLabel,
  endLabel,
}: {
  total: number;
  discontinuities: number[];
  value: Range;
  onChange: (next: Range) => void;
  startLabel: string;
  endLabel: string;
}) {
  const [width, setWidth] = useState(0);
  const pct = (seconds: number) => (total > 0 ? (seconds / total) * 100 : 0);

  // The responder is built once; everything it reads goes through a ref.
  const live = useRef({ value, onChange, total, width });
  live.current = { value, onChange, total, width };
  const dragging = useRef<Handle>("start");

  const pan = useMemo(() => {
    const secondsAt = (x: number) => {
      const { total: tot, width: w } = live.current;
      if (w === 0) return 0;
      return Math.min(1, Math.max(0, x / w)) * tot;
    };
    const move = (handle: Handle, seconds: number) => {
      const { value: v, onChange: set } = live.current;
      // Handles cannot cross; the one being dragged stops a second short.
      if (handle === "start") set({ start: Math.min(seconds, v.end - MIN_SPAN), end: v.end });
      else set({ start: v.start, end: Math.max(seconds, v.start + MIN_SPAN) });
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // A vertical scroll of the page must not steal a drag in progress.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const seconds = secondsAt(e.nativeEvent.locationX);
        const v = live.current.value;
        // Touching the track moves whichever end is nearer.
        dragging.current = Math.abs(seconds - v.start) <= Math.abs(seconds - v.end) ? "start" : "end";
        startX.current = e.nativeEvent.locationX;
        move(dragging.current, seconds);
      },
      onPanResponderMove: (_, g) => move(dragging.current, secondsAt(startX.current + g.dx)),
    });
  }, []);
  const startX = useRef(0);

  return (
    <View className="flex-col gap-2">
      <View
        {...pan.panHandlers}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        // A grip at either end hangs half outside the track; without this the
        // finger lands on it and nothing answers. Positions out there clamp.
        hitSlop={{ left: GRIP, right: GRIP, top: 6, bottom: 6 }}
        className="relative h-11 justify-center"
        accessibilityRole="adjustable"
        accessibilityLabel={`${startLabel} ${fullTimecode(value.start)}, ${endLabel} ${fullTimecode(value.end)}`}
      >
        <View pointerEvents="none" className="h-2 w-full rounded-full bg-line" />

        <View
          pointerEvents="none"
          className="absolute h-2 rounded-full bg-kick/70"
          style={{ left: `${pct(value.start)}%`, width: `${pct(value.end - value.start)}%` }}
        />

        {/* Breaks in the broadcast, amber, drawn over the selection. */}
        {discontinuities.map((seconds) => (
          <View
            key={seconds}
            pointerEvents="none"
            className="absolute h-5 w-0.5 rounded bg-amber"
            style={{ left: `${pct(seconds)}%`, marginLeft: -1 }}
          />
        ))}

        <Grip position={pct(value.start)} />
        <Grip position={pct(value.end)} />
      </View>

      <View className="flex-row justify-between">
        <Text className="font-mono text-mini text-muted">0:00</Text>
        <Text className="font-mono text-mini text-muted">{timecode(total)}</Text>
      </View>
    </View>
  );
}

function Grip({ position }: { position: number }) {
  return (
    <View
      pointerEvents="none"
      className="absolute rounded-full border-2 border-kick bg-ink"
      style={{ left: `${position}%`, width: GRIP, height: GRIP, marginLeft: -GRIP / 2 }}
    />
  );
}

/* -------------------------------------------------------------- timebox -- */

/*
 * Lay bare digits out as HH:MM:SS while they are typed, so a range is entered
 * in one run of the number keys.
 */
function maskTimecode(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 6);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}:${d.slice(2)}`;
  return `${d.slice(0, 2)}:${d.slice(2, 4)}:${d.slice(4)}`;
}

/*
 * Held as text while it is being typed, and pushed out on blur or Done, so
 * "02:" is never read as a time. Rejected input stays on screen with the field
 * marked instead of silently snapping back.
 */
function TimeBox({
  label,
  invalid,
  seconds,
  max,
  onCommit,
}: {
  label: string;
  invalid: string;
  seconds: number;
  max: number;
  onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(() => fullTimecode(seconds));
  const [editing, setEditing] = useState(false);

  // While the track is being dragged this field is an output, so it follows.
  useEffect(() => {
    if (!editing) setText(fullTimecode(seconds));
  }, [seconds, editing]);

  /*
   * A half-typed value is read as the start of a time: "05" is five hours, so
   * the missing places are filled with zeros, which is what the mask shows.
   */
  const padded = text.replace(/\D/g, "").padEnd(6, "0").slice(0, 6);
  const parsed = text.trim() === "" ? null : parseTimecode(maskTimecode(padded));
  const bad = parsed === null || parsed > max;

  function commit() {
    setEditing(false);
    if (parsed !== null) onCommit(Math.min(parsed, max));
    else setText(fullTimecode(seconds));
  }

  return (
    <View className="w-36 flex-col gap-1.5">
      <Text className="text-small font-medium text-muted">{label}</Text>
      <Input
        value={text}
        keyboardType="number-pad"
        accessibilityLabel={label}
        onFocus={() => setEditing(true)}
        onChangeText={(v) => setText(maskTimecode(v))}
        onBlur={commit}
        onSubmitEditing={commit}
        className={"font-mono " + (bad ? "border-rose/60" : "")}
      />
      <Text className={"text-small " + (bad ? "text-rose-text" : "text-muted/80")}>{bad ? invalid : " "}</Text>
    </View>
  );
}
