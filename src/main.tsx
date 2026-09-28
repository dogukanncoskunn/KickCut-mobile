import "./global.css";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
import { MotionProvider } from "./lib/Motion";
import { ThemeProvider } from "./lib/Theme";
import { FfmpegProvider } from "./lib/Ffmpeg";
import { QueueProvider } from "./lib/Queue";
import { SpeedProvider } from "./lib/Speed";
import { SelectionProvider } from "./lib/Selection";

/* The desktop's provider stack, in the desktop's order. */
export function Root() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <LocaleProvider>
          <MotionProvider>
            <FfmpegProvider>
              <SpeedProvider>
                <QueueProvider>
                  <SelectionProvider>
                    <App />
                  </SelectionProvider>
                </QueueProvider>
              </SpeedProvider>
            </FfmpegProvider>
          </MotionProvider>
        </LocaleProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
