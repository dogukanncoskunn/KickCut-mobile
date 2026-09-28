package com.unsatisfied0.kickcut.engine

import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream

/*
 * Port of `src-tauri/src/mux.rs`. The reasoning lives there; the short form:
 *
 * - The segments are joined into ONE transport stream before ffmpeg sees them.
 *   The concat demuxer stamps 60 fps as 59.95 fps, which an editor turns into
 *   audio drift of about nine seconds over three hours.
 * - `-bsf:a aac_adtstoasc` converts ADTS framing to what MP4 expects.
 * - `-movflags +faststart` puts the index at the front.
 * - Nothing rewrites timestamps. The tests pin all of this.
 */

enum class MuxMode(val wire: String) {
  /** Stream copy. Minutes, no generational loss. */
  Copy("copy"),

  /** Re-encode to constant frame rate: exact-frame cuts, breaks dissolved. */
  Reencode("reencode");

  companion object {
    fun from(wire: String?): MuxMode = entries.firstOrNull { it.wire == wire } ?: Copy
  }
}

data class MuxRequest(
  /** The joined transport stream to read. */
  val source: String,
  val output: String,
  val mode: MuxMode,
  /** Seconds to drop from the front of the first segment. */
  val trimOffset: Double,
  /** Length of the finished file. */
  val outputSeconds: Double,
  /** Only used when re-encoding, to pin a constant frame rate. */
  val frameRate: Double,
  /**
   * Where `-progress` writes. `pipe:1` on the desktop; on Android ffmpeg runs
   * in-process with no stdout to read, so it is a file the runner polls.
   */
  val progressTarget: String = "pipe:1",
)

object Mux {
  private fun f3(x: Double) = String.format(java.util.Locale.ROOT, "%.3f", x)

  fun buildArgs(request: MuxRequest): List<String> {
    val args = mutableListOf("-hide_banner", "-nostdin", "-y")

    // Input-side seek on a single continuous stream: jump to a keyframe and
    // copy from there, rather than re-stamping the part that is kept.
    if (request.trimOffset > 0.05) {
      args += listOf("-ss", f3(request.trimOffset))
    }
    args += listOf("-i", request.source)

    if (request.outputSeconds > 0.0) {
      args += listOf("-t", f3(request.outputSeconds))
    }

    when (request.mode) {
      MuxMode.Copy -> {
        args += listOf("-c", "copy")
        // The audio fix: ADTS framing out, AudioSpecificConfig in.
        args += listOf("-bsf:a", "aac_adtstoasc")
      }
      MuxMode.Reencode -> {
        args += listOf(
          "-c:v", "libx264",
          "-preset", "medium",
          "-crf", "18",
          "-pix_fmt", "yuv420p",
          // Constant frame rate is the whole point of this mode.
          "-fps_mode", "cfr",
          "-c:a", "aac",
          "-b:a", "192k",
        )
        if (request.frameRate > 0.0) args += listOf("-r", f3(request.frameRate))
      }
    }

    args += listOf(
      "-movflags", "+faststart",
      "-progress", request.progressTarget,
      "-nostats",
      request.output,
    )
    return args
  }

  /**
   * Join the segments into one continuous transport stream, byte for byte and
   * in order. A missing segment stops the mux rather than silently dropping ten
   * seconds out of the middle.
   */
  fun joinSegments(dir: File, start: Int, end: Int): File {
    val joined = File(dir, "joined.ts")
    try {
      BufferedOutputStream(FileOutputStream(joined), 1 shl 20).use { out ->
        for (index in start..end) {
          val part = File(dir, "$index.ts")
          if (!part.isFile) {
            throw HlsException("Segment $index is missing, so this clip cannot be assembled. Resume the download.")
          }
          part.inputStream().use { it.copyTo(out, 1 shl 20) }
        }
      }
    } catch (e: HlsException) {
      joined.delete()
      throw e
    } catch (e: Exception) {
      joined.delete()
      throw HlsException("The joined stream could not be finished: ${e.message}")
    }
    return joined
  }

  /**
   * Pick a name that does not overwrite anything. `exists` is asked about a
   * file name; on Android the destination is a SAF folder, not a path.
   */
  fun freeOutputName(stem: String, exists: (String) -> Boolean): String {
    val first = "$stem.mp4"
    if (!exists(first)) return first
    for (n in 2 until 1000) {
      val candidate = "$stem ($n).mp4"
      if (!exists(candidate)) return candidate
    }
    return "$stem (${android.os.Process.myPid()}).mp4"
  }

  /** Last `out_time_us` in a `-progress` file, as a 0..1 fraction. */
  fun progressFraction(progressText: String, outputSeconds: Double): Double? {
    val totalUs = maxOf(outputSeconds * 1_000_000.0, 1.0)
    val last = progressText.lineSequence()
      .filter { it.startsWith("out_time_us=") }
      .lastOrNull()
      ?.removePrefix("out_time_us=")
      ?.trim()
      ?.toDoubleOrNull() ?: return null
    return (last / totalUs).coerceIn(0.0, 1.0)
  }

  /** What ffprobe reported about a finished file. */
  data class Verified(
    val seconds: Double,
    val hasVideo: Boolean,
    val hasAudio: Boolean,
    val impliedFps: Double,
    val declaredFps: Double,
  )

  /**
   * The pass marks from `mux.rs::verify`. The frame rate is recorded, not
   * enforced beyond "most of the video is missing" - Kick's transcoded rungs
   * have real gaps, and a faithful copy of a gappy source is itself gappy.
   */
  fun judge(result: Verified, expectedSeconds: Double) {
    if (!result.hasVideo) throw HlsException("The finished file has no video track.")
    if (!result.hasAudio) throw HlsException("The finished file has no audio track.")
    if (result.declaredFps > 0.0 && result.impliedFps > 0.0) {
      if (result.impliedFps / result.declaredFps < 0.5) {
        throw HlsException(
          "The finished file holds ${"%.4f".format(result.impliedFps)} fps of picture against a declared " +
            "${"%.4f".format(result.declaredFps)}, so most of the video is missing.",
        )
      }
    }
    // A stream copy cuts on a keyframe, so a couple of seconds either way is
    // expected; anything past that means the wrong media was assembled.
    val drift = Math.abs(result.seconds - expectedSeconds)
    if (expectedSeconds > 0.0 && drift > 5.0 && drift / expectedSeconds > 0.01) {
      throw HlsException(
        "The finished file is ${Math.round(result.seconds)} s long but should be about ${Math.round(expectedSeconds)} s.",
      )
    }
  }

  /** "60/1" as ffprobe writes it. */
  fun ratio(raw: String?): Double {
    val parts = raw?.split('/') ?: return 0.0
    if (parts.size != 2) return 0.0
    val n = parts[0].toDoubleOrNull() ?: return 0.0
    val d = parts[1].toDoubleOrNull() ?: return 0.0
    return n / maxOf(d, 1.0)
  }
}

/**
 * Strip what a file system will not accept in a name, and collapse the result
 * to something that still reads like the stream title it came from. Same rules
 * as the desktop so a title produces the same file name on every platform.
 */
fun safeFileName(raw: String): String {
  val cleaned = buildString {
    for (c in raw) {
      append(
        when {
          c in "\\/:*?\"<>|" -> ' '
          c.code < 0x20 -> ' '
          // Unicode whitespace collapses like a space. Done here rather than
          // with `(?U)` in the regex below: Android's ICU engine rejects it.
          c.isWhitespace() -> ' '
          else -> c
        },
      )
    }
  }
  val collapsed = cleaned.split(' ').filter { it.isNotEmpty() }.joinToString(" ")
  val trimmed = collapsed.trim('.', ' ')
  // 120 characters, not UTF-16 units, so an emoji is never cut in half.
  val chars = minOf(120, trimmed.codePointCount(0, trimmed.length))
  val limited = trimmed.substring(0, trimmed.offsetByCodePoints(0, chars)).trimEnd()
  return limited.ifEmpty { "kick-vod" }
}
