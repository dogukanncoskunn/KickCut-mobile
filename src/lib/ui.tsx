import { forwardRef, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import type { PressableProps, TextInputProps } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useCSSVariable } from "uniwind";
import { useMotion } from "./Motion";

/*
 * The desktop's component kit (src/lib/ui.tsx), control for control. Same
 * names, same variants, same class strings wherever React Native can take
 * them - so a screen ported from the desktop reads the same here.
 *
 * What differs is only what the platform forces: text is never inherited in
 * React Native, so every label is its own <Text> carrying its colour; and a
 * dropdown menu is a modal rather than a portal.
 */

/* ---------------------------------------------------------------- icons -- */

/* 16x16 viewBox, 1.5 stroke. Paths only - the same paths as the desktop. */
const ICONS = {
  library: "M2.5 3.5h3v9h-3zM7 3.5h3v9H7zM11.5 4.2l2.2 8.1",
  download: "M8 2.5v7.5M8 10l-3-3M8 10l3-3M2.5 13.5h11",
  queue: "M2.5 4h11M2.5 8h11M2.5 12h6",
  settings:
    "M8 5.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6",
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3",
  search: "M7.2 12a4.8 4.8 0 1 0 0-9.6 4.8 4.8 0 0 0 0 9.6M10.8 10.8l2.7 2.7",
  play: "M5 3.2 12 8l-7 4.8z",
  pause: "M5.5 3.5v9M10.5 3.5v9",
  close: "M4 4l8 8M12 4l-8 8",
  check: "M3 8.4 6.4 12 13 4.6",
  warn: "M8 2.6 14.6 13.4H1.4zM8 6.6v3M8 11.4v.6",
  folder: "M1.8 4.2h4l1.2 1.6h7.2v6.6H1.8z",
  clock: "M8 2.4a5.6 5.6 0 1 0 0 11.2A5.6 5.6 0 0 0 8 2.4M8 5.2V8l2 1.4",
  scissors:
    "M4 3l8 8.4M12 3 4 11.4M3.6 12.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8M12.4 12.6a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8",
  chevron: "M6 3.5 10.5 8 6 12.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.2a.9.9 0 0 0 .9.8h4a.9.9 0 0 0 .9-.8l.6-8.2M6.8 7v4M9.2 7v4",
  sun: "M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6M8 1.6v1.4M8 13v1.4M14.4 8H13M3 8H1.6M12.5 3.5l-1 1M4.5 11.5l-1 1M12.5 12.5l-1-1M4.5 4.5l-1-1",
  moon: "M13 9.4A5.4 5.4 0 0 1 6.6 3a5.6 5.6 0 1 0 6.4 6.4",
  share: "M8 9.5V2.5M8 2.5 5.5 5M8 2.5 10.5 5M3.5 7.5v6h9v-6",
} as const;

export type IconName = keyof typeof ICONS;

/** One Tailwind spacing step against the 14px root: 0.25rem. */
const STEP = 3.5;

/*
 * An icon takes the desktop's own class string - `size-4 text-muted` - and
 * reads the two things an SVG needs out of it, because react-native-svg wants
 * a size and a colour value rather than classes. Colours resolve through the
 * theme tokens, so an icon follows a theme switch like text does.
 */
function useIconStyle(className: string) {
  const size = /(?:^|\s)size-(\d+(?:\.\d+)?)/.exec(className);
  const color = /(?:^|\s)text-([a-z]+(?:-[a-z]+)*)(?:\/(\d+))?(?=\s|$)/.exec(
    className.replace(/(?:^|\s)text-(mini|small|body|mid|title|page|figure)(?=\s|$)/g, " "),
  );
  const hidden = /(?:^|\s)opacity-0(?=\s|$)/.test(className);
  const token = color?.[1] ?? "body";
  const value = useCSSVariable(token === "current" ? "--color-body" : `--color-${token}`);
  const alpha = color?.[2] ? Number(color[2]) / 100 : 1;
  const rotate = /(?:^|\s)-rotate-90/.test(className) ? "-90deg" : /(?:^|\s)rotate-90/.test(className) ? "90deg" : "0deg";
  return {
    px: (size ? Number(size[1]) : 4) * STEP,
    color: typeof value === "string" ? value : "#dfe6e1",
    opacity: hidden ? 0 : alpha,
    rotate,
  };
}

export function Icon({ name, className = "size-4" }: { name: IconName; className?: string }) {
  const { px, color, opacity, rotate } = useIconStyle(className);
  return (
    <Svg
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      style={{ opacity, transform: [{ rotate }] }}
    >
      <Path d={ICONS[name]} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* -------------------------------------------------------------- entrance -- */

/*
 * The desktop's `.appear`: 140ms, 4px, opacity and transform only. Honours the
 * in-app motion switch the way the desktop's `.motionless` class does.
 */
export function Appear({ className = "", children }: { className?: string; children: ReactNode }) {
  const { motion } = useMotion();
  const t = useRef(new Animated.Value(motion ? 0 : 1)).current;
  useEffect(() => {
    if (!motion) return;
    Animated.timing(t, { toValue: 1, duration: 140, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [motion, t]);
  return (
    <Animated.View
      className={className}
      style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }] }}
    >
      {children}
    </Animated.View>
  );
}

/* -------------------------------------------------------------- surface -- */

type CardKind = "primary" | "normal" | "plain";

const cardClass: Record<CardKind, string> = {
  primary: "rounded-lg border border-line/80 bg-raised/70 shadow-xl shadow-black/30",
  normal: "rounded-lg border border-line bg-surface/80 shadow-lg shadow-black/20",
  plain: "",
};

export function Card({
  kind = "normal",
  className = "",
  children,
}: {
  kind?: CardKind;
  className?: string;
  children: ReactNode;
}) {
  return <View className={cardClass[kind] + " " + className}>{children}</View>;
}

export function Section({
  title,
  hint,
  action,
  className = "",
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <View className={"flex flex-col gap-3 " + className}>
      <View className="flex-row items-start justify-between gap-4">
        <View className="min-w-0 flex-1">
          <Text className="text-mid font-semibold text-body">{title}</Text>
          {hint ? <Text className="mt-0.5 text-small text-muted">{hint}</Text> : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

/*
 * The desktop sizes its grids from a minimum column width. The same rule here:
 * as many columns as fit at `min` rem, each stretched to share the row.
 */
export function Columns({ children, min = 19 }: { children: ReactNode[]; min?: number }) {
  const [width, setWidth] = useState(0);
  const gap = 5 * STEP;
  const cols = Math.max(1, Math.floor((width + gap) / (min * 14 + gap)));
  const itemWidth = width > 0 ? (width - gap * (cols - 1)) / cols : 0;
  return (
    <View className="flex-row flex-wrap" style={{ gap }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0
        ? children.map((child, i) => (
            <View key={i} style={{ width: itemWidth }}>
              {child}
            </View>
          ))
        : null}
    </View>
  );
}

/* -------------------------------------------------------------- buttons -- */

type ButtonKind = "primary" | "quiet" | "danger" | "warn" | "ghost";
type ButtonSize = "small" | "mid" | "large";

const buttonClass: Record<ButtonKind, string> = {
  primary: "bg-kick active:bg-kick/90",
  quiet: "border border-line bg-raised active:border-muted/40",
  danger: "border border-rose/40 bg-rose/10 active:bg-rose/20",
  warn: "bg-amber active:bg-amber/90",
  ghost: "active:bg-raised",
};

const buttonText: Record<ButtonKind, string> = {
  primary: "text-onkick font-semibold",
  quiet: "text-body",
  danger: "text-rose-text",
  warn: "text-onkick font-semibold",
  ghost: "text-muted",
};

const buttonIcon: Record<ButtonKind, string> = {
  primary: "text-onkick",
  quiet: "text-body",
  danger: "text-rose-text",
  warn: "text-onkick",
  ghost: "text-muted",
};

/* h-9 in the middle, because that is what Input and Dropdown are. */
const buttonSize: Record<ButtonSize, string> = {
  small: "h-7 px-2.5",
  mid: "h-9 px-3",
  large: "h-10 px-5",
};

const buttonTextSize: Record<ButtonSize, string> = {
  small: "text-small",
  mid: "text-body",
  large: "text-mid font-semibold",
};

export function Button({
  kind = "quiet",
  size = "mid",
  icon,
  className = "",
  disabled,
  children,
  ...rest
}: {
  kind?: ButtonKind;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
  children?: ReactNode;
} & Omit<PressableProps, "children">) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      {...rest}
      className={[
        "shrink-0 flex-row items-center justify-center gap-1.5 rounded-md",
        buttonClass[kind],
        buttonSize[size],
        disabled ? "opacity-45" : "",
        className,
      ].join(" ")}
    >
      {icon ? <Icon name={icon} className={"size-4 " + buttonIcon[kind]} /> : null}
      {typeof children === "string" || typeof children === "number" ? (
        <Text numberOfLines={1} className={buttonText[kind] + " " + buttonTextSize[size]}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/* --------------------------------------------------------------- inputs -- */

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View className="flex flex-col gap-1.5">
      <Text className="text-small font-medium text-muted">{label}</Text>
      {children}
      {hint ? <Text className="text-small text-muted/80">{hint}</Text> : null}
    </View>
  );
}

const controlClass = "h-9 w-full rounded-md border border-line bg-ink px-2.5 py-0 text-body text-body";

export const Input = forwardRef<TextInput, TextInputProps & { className?: string }>(function Input(
  { className = "", editable, ...rest },
  ref,
) {
  const placeholder = useCSSVariable("--color-muted");
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={typeof placeholder === "string" ? placeholder + "99" : undefined}
      editable={editable}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      className={
        controlClass + (focused ? " border-muted/50" : "") + (editable === false ? " opacity-45" : "") + " " + className
      }
    />
  );
});

export type Option = { value: string; label: string };

/*
 * A dropdown of our own, as on the desktop - its menu opens directly under the
 * control, in the palette, rather than as the platform's picker sheet.
 */
export function Dropdown({
  value,
  options,
  onChange,
  className = "",
  textClassName = "text-body",
  ariaLabel,
}: {
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  className?: string;
  textClassName?: string;
  ariaLabel?: string;
}) {
  const anchor = useRef<View>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const { height: screenHeight } = useWindowDimensions();
  const current = options.find((o) => o.value === value);
  const open = box !== null;

  function toggle() {
    if (open) return setBox(null);
    anchor.current?.measureInWindow((x, y, w, h) => {
      setBox({ left: x, top: y + h + 4, width: Math.max(w, 140) });
    });
  }

  return (
    <>
      <Pressable
        ref={anchor}
        accessibilityRole="button"
        accessibilityLabel={ariaLabel}
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        className={
          "h-9 flex-row items-center justify-between gap-2 rounded-md border border-line bg-ink px-2.5 " + className
        }
      >
        <Text numberOfLines={1} className={"shrink text-body " + textClassName}>
          {current?.label ?? value}
        </Text>
        <Icon name="chevron" className={"size-3.5 text-muted " + (open ? "-rotate-90" : "rotate-90")} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => setBox(null)}>
        <Pressable className="flex-1" onPress={() => setBox(null)}>
          {box ? (
            <Appear className="absolute" key={String(open)}>
              <View
                className="overflow-hidden rounded-md border border-line bg-surface py-1 shadow-xl shadow-black/40"
                style={{
                  position: "absolute",
                  left: box.left,
                  top: box.top,
                  minWidth: box.width,
                  maxHeight: Math.max(160, screenHeight - box.top - 24),
                }}
              >
                <ScrollView>
                  {options.map((option) => {
                    const on = option.value === value;
                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="menuitem"
                        accessibilityState={{ selected: on }}
                        onPress={() => {
                          onChange(option.value);
                          setBox(null);
                        }}
                        className={"flex-row items-center gap-2 px-3 py-2 " + (on ? "bg-raised" : "active:bg-raised/60")}
                      >
                        <Icon name="check" className={"size-3.5 " + (on ? "text-kick-text" : "opacity-0")} />
                        <Text numberOfLines={1} className={"text-body " + (on ? "font-medium text-body" : "text-muted")}>
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </Appear>
          ) : null}
        </Pressable>
      </Modal>
    </>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => onChange(!checked)}
      className={
        "relative h-5 w-9 shrink-0 rounded-full border " + (checked ? "border-kick/50 bg-kick/30" : "border-line bg-ink")
      }
    >
      <View
        className={"absolute top-0.5 size-3.5 rounded-full " + (checked ? "bg-kick" : "bg-muted")}
        style={{ left: checked ? 4.5 * STEP : 0.5 * STEP }}
      />
    </Pressable>
  );
}

/* ---------------------------------------------------------------- notes -- */

type NoteKind = "error" | "warn" | "ok";

const noteBox: Record<NoteKind, string> = {
  error: "border-rose/40 bg-rose/10",
  warn: "border-amber/40 bg-amber/10",
  ok: "border-kick/40 bg-kick/10",
};

export const noteText: Record<NoteKind, string> = {
  error: "text-rose-text",
  warn: "text-amber-text",
  ok: "text-kick-text",
};

const noteIcon: Record<NoteKind, IconName> = { error: "warn", warn: "warn", ok: "check" };

/*
 * `children` may be a string, which becomes the note's text, or elements the
 * caller styles - use `noteText[kind]` for their colour.
 */
export function Note({ kind, children, action }: { kind: NoteKind; children: ReactNode; action?: ReactNode }) {
  return (
    <Appear>
      <View className={"flex-row items-start gap-2.5 rounded-md border px-3 py-2.5 " + noteBox[kind]}>
        <View className="mt-0.5">
          <Icon name={noteIcon[kind]} className={"size-4 " + noteText[kind]} />
        </View>
        <View className="min-w-0 flex-1">
          {typeof children === "string" ? <Text className={"text-body " + noteText[kind]}>{children}</Text> : children}
        </View>
        {action}
      </View>
    </Appear>
  );
}

export function Badge({ kind = "neutral", children }: { kind?: NoteKind | "neutral"; children: ReactNode }) {
  const box = kind === "neutral" ? "border-line bg-raised" : noteBox[kind] + " bg-transparent";
  const text = kind === "neutral" ? "text-muted" : noteText[kind];
  return (
    <View className={"flex-row items-center self-start rounded border px-1.5 py-0.5 " + box}>
      <Text className={"font-mono text-mini uppercase tracking-wide " + text}>{children}</Text>
    </View>
  );
}

/* -------------------------------------------------------------- signals -- */

export function EmptyState({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View className="flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-10">
      <Icon name={icon} className="size-7 text-muted/50" />
      <Text className="max-w-[28rem] text-center text-body text-muted">{children}</Text>
    </View>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <View className={"overflow-hidden rounded bg-raised " + className} />;
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  const { px, color } = useIconStyle(className);
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <Animated.View style={{ width: px, height: px, transform: [{ rotate }] }}>
      <Svg width={px} height={px} viewBox="0 0 16 16" fill="none">
        <Circle cx="8" cy="8" r="6" stroke={color} strokeOpacity={0.25} strokeWidth={2} />
        <Path d="M14 8a6 6 0 0 0-6-6" stroke={color} strokeWidth={2} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}

/*
 * `value` is 0..1, or null for a stage that genuinely cannot report a
 * percentage, which gets a sweep instead of a lie about how far along it is.
 */
export function ProgressBar({ value, kind = "ok" }: { value: number | null; kind?: NoteKind }) {
  const fill: Record<NoteKind, string> = { ok: "bg-kick", warn: "bg-amber", error: "bg-rose" };
  return (
    <View className="h-1.5 w-full overflow-hidden rounded-full bg-line">
      {value === null ? (
        <Sweep className={"h-full w-1/3 rounded-full " + fill[kind]} />
      ) : (
        <View
          className={"h-full rounded-full " + fill[kind]}
          style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      )}
    </View>
  );
}

/* The desktop's `.bar-sweep`: -100% to 300% of its own width, 1.4s. */
function Sweep({ className }: { className: string }) {
  const { motion } = useMotion();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motion) return;
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [motion, x]);
  return (
    <Animated.View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className={className}
      style={{ transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-width, 3 * width] }) }] }}
    />
  );
}

/* The running-job pulse: ambient state, not an alert. 3.2s, 0.45 to 1. */
export function PulseDot({ className = "" }: { className?: string }) {
  const { motion } = useMotion();
  const o = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (!motion) {
      o.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.45, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [motion, o]);
  return (
    <View className="size-3 items-center justify-center rounded-full bg-kick/20">
      <Animated.View className={"size-1.5 rounded-full bg-kick " + className} style={{ opacity: o }} />
    </View>
  );
}
