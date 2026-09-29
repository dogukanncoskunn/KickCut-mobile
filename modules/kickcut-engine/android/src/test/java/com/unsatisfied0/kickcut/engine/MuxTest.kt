package com.unsatisfied0.kickcut.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.file.Files

/** Ported one for one from `src-tauri/src/mux.rs` and `download.rs`. */
class MuxTest {
  private fun argsOf(mode: MuxMode, trim: Double) = Mux.buildArgs(
    MuxRequest(
      source = "C:/parts/x/joined.ts",
      output = "C:/out/clip.mp4",
      mode = mode,
      trimOffset = trim,
      outputSeconds = 12600.0,
      frameRate = 60.0,
    ),
  )

  @Test fun a_stream_copy_converts_the_audio_framing_and_leaves_the_rest_alone() {
    val args = argsOf(MuxMode.Copy, 1.3).joinToString(" ")
    assertTrue("ADTS to ASC conversion missing", args.contains("-bsf:a aac_adtstoasc"))
    assertTrue("faststart missing", args.contains("-movflags +faststart"))
    assertTrue("should not re-encode", args.contains("-c copy"))
  }

  /** The regression mux.rs was rewritten for. */
  @Test fun nothing_rewrites_timestamps() {
    for (mode in MuxMode.entries) {
      val args = argsOf(mode, 1.3).joinToString(" ")
      for (flag in listOf(
        "+genpts", "-avoid_negative_ts", "-video_track_timescale", "-copyts", "-start_at_zero",
        "-reset_timestamps", "-itsoffset", "-output_ts_offset", "-async", "-af aresample",
      )) {
        assertFalse("$flag is back in $mode mode", args.contains(flag))
      }
    }
  }

  @Test fun the_input_is_a_single_joined_stream() {
    val args = argsOf(MuxMode.Copy, 0.0)
    assertFalse("concat demuxer is back", args.contains("concat"))
    val input = args.indexOf("-i")
    assertTrue(args[input + 1].endsWith("joined.ts"))
  }

  @Test fun the_trim_seeks_the_input() {
    val args = argsOf(MuxMode.Copy, 1.3)
    val input = args.indexOf("-i")
    val ss = args.indexOf("-ss")
    assertTrue("-ss must precede -i", ss in 0 until input)
    assertEquals("1.300", args[ss + 1])
  }

  @Test fun a_zero_offset_adds_no_seek_at_all() {
    assertFalse(argsOf(MuxMode.Copy, 0.0).contains("-ss"))
  }

  @Test fun re_encoding_forces_a_constant_frame_rate() {
    val args = argsOf(MuxMode.Reencode, 0.0).joinToString(" ")
    assertTrue(args.contains("-c:v libx264"))
    assertTrue(args.contains("-fps_mode cfr"))
    assertTrue(args.contains("-r 60.000"))
    assertFalse(args.contains("-c copy"))
    assertFalse(args.contains("aac_adtstoasc"))
  }

  /** Mobile only: progress goes to a file instead of stdout, and nothing else moves. */
  @Test fun only_the_progress_target_differs_from_the_desktop() {
    val desktop = argsOf(MuxMode.Copy, 1.3)
    val mobile = Mux.buildArgs(
      MuxRequest("C:/parts/x/joined.ts", "C:/out/clip.mp4", MuxMode.Copy, 1.3, 12600.0, 60.0, "/data/p.txt"),
    )
    assertEquals(desktop.size, mobile.size)
    val diff = desktop.indices.filter { desktop[it] != mobile[it] }
    assertEquals(listOf(desktop.indexOf("pipe:1")), diff)
  }

  @Test fun a_second_download_of_the_same_clip_does_not_overwrite_the_first() {
    val taken = HashSet<String>()
    assertEquals("clip.mp4", Mux.freeOutputName("clip") { it in taken })
    taken += "clip.mp4"
    assertEquals("clip (2).mp4", Mux.freeOutputName("clip") { it in taken })
    taken += "clip (2).mp4"
    assertEquals("clip (3).mp4", Mux.freeOutputName("clip") { it in taken })
  }

  @Test fun segments_are_joined_in_order_and_a_gap_stops_the_mux() {
    val dir = Files.createTempDirectory("kickcut-join-test").toFile()
    try {
      File(dir, "0.ts").writeBytes("AAA".toByteArray())
      File(dir, "2.ts").writeBytes("CCC".toByteArray())
      try {
        Mux.joinSegments(dir, 0, 2)
        fail("should refuse")
      } catch (e: HlsException) {
        assertTrue("unhelpful message: ${e.message}", e.message!!.contains("Segment 1"))
      }
      File(dir, "1.ts").writeBytes("BBB".toByteArray())
      val joined = Mux.joinSegments(dir, 0, 2)
      assertEquals("AAABBBCCC", joined.readText())
    } finally {
      dir.deleteRecursively()
    }
  }

  @Test fun progress_reads_the_latest_out_time() {
    val text = "out_time_us=1000000\nprogress=continue\nout_time_us=5000000\nprogress=continue\n"
    assertEquals(0.5, Mux.progressFraction(text, 10.0)!!, 1e-9)
    assertEquals(null, Mux.progressFraction("progress=continue\n", 10.0))
  }

  @Test fun a_gappy_but_faithful_file_passes_and_a_missing_track_does_not() {
    // beskok's 360p30 measurement from mux.rs: 29.00 fps against 30 declared.
    Mux.judge(Mux.Verified(1096.666, true, true, 29.0, 30.0), 1096.666)
    for (bad in listOf(
      Mux.Verified(10.0, false, true, 0.0, 0.0),
      Mux.Verified(10.0, true, false, 30.0, 30.0),
      Mux.Verified(10.0, true, true, 10.0, 30.0),
      Mux.Verified(600.0, true, true, 30.0, 30.0),
    )) {
      try {
        Mux.judge(bad, 10.0)
        fail("should reject $bad")
      } catch (_: HlsException) {
      }
    }
  }

  @Test fun file_names_survive_windows() {
    assertEquals("Yayin 7 Eylul", safeFileName("Yayin 7 Eylul"))
    assertEquals("LIVE drama news today", safeFileName("LIVE: drama/news *today*?"))
    assertEquals("a b c d e f g h i j", safeFileName("a\\b/c:d*e?f\"g<h>i|j"))
    assertEquals("clip", safeFileName("clip..."))
    assertEquals("spaced", safeFileName("  spaced  "))
    // Unicode spaces collapse too - without `(?U)`, which Android's ICU rejects.
    assertEquals("a b", safeFileName("a  b"))
    assertEquals("kick-vod", safeFileName(""))
    assertEquals("kick-vod", safeFileName("???"))
    assertTrue(safeFileName("x".repeat(400)).length <= 120)
  }

  /** A title is untrusted input and becomes a file name: it must never walk out of the folder. */
  @Test fun a_title_cannot_escape_the_output_folder() {
    for (evil in listOf("../../etc/passwd", "..\\..\\x", "/sdcard/Android/data/x", "..", ".", "a/../b", "\u0000x")) {
      val name = safeFileName(evil)
      assertFalse("$evil -> $name", name.contains('/') || name.contains('\\'))
      assertFalse("$evil -> $name", name == "." || name == ".." || name.startsWith("."))
      assertFalse("$evil -> $name", name.any { it.code < 0x20 })
    }
  }
}
