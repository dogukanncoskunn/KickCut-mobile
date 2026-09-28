package com.unsatisfied0.kickcut.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Ported one for one from `src-tauri/src/hls.rs` and `kick.rs`. */
class HlsTest {
  /** The unmodified 1080p60 playlist of a real 8-hour Kick VOD. */
  private val real: String = javaClass.classLoader!!.getResource("kick-vod-1080p60.m3u8")!!.readText()
  private val base = "https://stream.kick.com/x/ivs/v1/1/S/2026/9/6/0/14/G/media/hls/1080p60/playlist.m3u8"

  private fun real() = Hls.parseMedia(real, base)

  private fun assertThrows(block: () -> Unit) {
    try {
      block()
    } catch (e: HlsException) {
      return
    }
    fail("expected an error")
  }

  @Test fun reads_the_real_playlist_exactly() {
    val p = real()
    assertEquals(2932, p.segments.size)
    assertTrue("total was ${p.total}", Math.abs(p.total - 29355.435) < 0.001)
    assertTrue("EXT-X-ENDLIST should mark this VOD complete", p.complete)
    assertEquals(listOf(1001), p.discontinuities)
    assertEquals("2026-09-06T00:14:55.337Z", p.programStart)
    assertEquals("https://stream.kick.com/x/ivs/v1/1/S/2026/9/6/0/14/G/media/hls/1080p60/0.ts", p.segments[0].url)
  }

  /** The bug this module exists to prevent. */
  @Test fun assuming_fixed_length_segments_would_cut_in_the_wrong_place() {
    val p = real()
    val twoHours = 7200.0
    val correct = p.indexAt(twoHours)
    val naive = (twoHours / 10.0).toInt()
    assertEquals(718, correct)
    assertEquals(720, naive)
    assertTrue(p.starts[naive] - twoHours > 18.0)
    assertTrue(p.starts[correct] <= twoHours)
    assertTrue(p.starts[correct] + p.segments[correct].duration > twoHours)
  }

  @Test fun plans_the_range_from_the_original_use_case() {
    val plan = real().plan(7200.0, 19800.0, 9_584_164)
    assertEquals(718, plan.startIndex)
    assertEquals(1974, plan.endIndex)
    assertEquals(1257, plan.segmentCount)
    assertTrue(Math.abs(plan.outputSeconds - 12600.0) < 0.001)
    assertTrue(plan.downloadSeconds > plan.outputSeconds)
    assertTrue("offset ${plan.trimOffset}", Math.abs(plan.trimOffset - 1.3) < 0.01)
    assertTrue(plan.crossesDiscontinuity)
    assertTrue("${plan.estimatedBytes}", plan.estimatedBytes > 13_000_000_000L)
    assertTrue("${plan.estimatedBytes}", plan.estimatedBytes < 16_000_000_000L)
  }

  @Test fun a_range_clear_of_the_discontinuity_does_not_warn() {
    val plan = real().plan(60.0, 600.0, 9_584_164)
    assertFalse(plan.crossesDiscontinuity)
    assertEquals(6, plan.startIndex)
  }

  @Test fun whole_vod_covers_every_segment_with_no_trim() {
    val p = real()
    val plan = p.plan(0.0, p.total, 1_000_000)
    assertEquals(0, plan.startIndex)
    assertEquals(2931, plan.endIndex)
    assertEquals(2932, plan.segmentCount)
    assertEquals(0.0, plan.trimOffset, 0.0)
  }

  @Test fun clamps_an_overshooting_range_instead_of_failing() {
    val p = real()
    val plan = p.plan(-30.0, p.total + 500.0, 1_000_000)
    assertEquals(0, plan.startIndex)
    assertEquals(2931, plan.endIndex)
  }

  @Test fun rejects_a_range_that_is_not_a_range() {
    val p = real()
    assertThrows { p.plan(500.0, 500.0, 1) }
    assertThrows { p.plan(900.0, 300.0, 1) }
  }

  @Test fun a_segment_without_a_duration_is_rejected_rather_than_silently_shifting() {
    assertThrows { Hls.parseMedia("#EXTM3U\n#EXTINF:10.000,\n0.ts\n1.ts\n#EXT-X-ENDLIST\n", "https://x/p.m3u8") }
  }

  @Test fun discontinuity_is_attributed_to_the_segment_that_follows_it() {
    val body = "#EXTM3U\n#EXTINF:4.000,\n0.ts\n#EXT-X-DISCONTINUITY\n#EXTINF:6.000,\n1.ts\n#EXT-X-ENDLIST\n"
    val p = Hls.parseMedia(body, "https://x/p.m3u8")
    assertEquals(listOf(1), p.discontinuities)
    assertEquals(listOf(0.0, 4.0), p.starts)
    assertEquals(10.0, p.total, 0.0)
  }

  /* ------------------------------------------------------------ kick.rs -- */

  private val master = "#EXTM3U\n" +
    "#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"1080p60\",NAME=\"1080p60\",AUTOSELECT=YES,DEFAULT=YES\n" +
    "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=9584164,CODECS=\"avc1.64002A,mp4a.40.2\",RESOLUTION=1920x1080,VIDEO=\"1080p60\",FRAME-RATE=60.000\n" +
    "1080p60/playlist.m3u8\n" +
    "#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID=\"480p30\",NAME=\"480p\",AUTOSELECT=YES,DEFAULT=YES\n" +
    "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=1488983,CODECS=\"avc1.4D401F,mp4a.40.2\",RESOLUTION=852x480,VIDEO=\"480p30\",FRAME-RATE=30.000\n" +
    "480p30/playlist.m3u8\n"

  @Test fun parses_master_playlist_and_resolves_relative_uris() {
    val got = Master.parseMaster(master, "https://stream.kick.com/abc/ivs/v1/1/S/2026/9/6/0/14/G/media/hls/master.m3u8")
    assertEquals(2, got.size)
    assertEquals("1080p60", got[0].name)
    assertEquals(1920, got[0].width)
    assertEquals(1080, got[0].height)
    assertEquals(60.0, got[0].frameRate, 0.0)
    assertEquals(9_584_164L, got[0].bandwidth)
    assertEquals(
      "https://stream.kick.com/abc/ivs/v1/1/S/2026/9/6/0/14/G/media/hls/1080p60/playlist.m3u8",
      got[0].playlistUrl,
    )
    assertEquals("480p30", got[1].name)
  }

  @Test fun absolutize_leaves_absolute_urls_alone() {
    val b = "https://stream.kick.com/a/hls/master.m3u8"
    assertEquals("https://cdn.example/x.m3u8", Hls.absolutize("https://cdn.example/x.m3u8", b))
    assertEquals("https://stream.kick.com/a/hls/720p60/playlist.m3u8", Hls.absolutize("720p60/playlist.m3u8", b))
  }

  @Test fun rejects_a_master_with_no_variants() {
    assertThrows { Master.parseMaster("#EXTM3U\n#EXT-X-VERSION:3\n", "https://x/m.m3u8") }
  }

  private fun ladder(body: String): List<Rendition> {
    val list = Master.parseMaster(body, "https://x/hls/master.m3u8")
    list.sortByDescending { it.width * it.height }
    Master.markSource(list, Master.parseProfiles(body))
    return list
  }

  @Test fun a_top_rung_at_a_higher_profile_is_the_broadcasters_own_stream() {
    val list = ladder(master)
    assertTrue(list[0].isSource)
    assertFalse(list[1].isSource)
  }

  @Test fun a_uniform_ladder_is_not_claimed_as_source() {
    assertFalse(ladder(master.replace("avc1.64002A", "avc1.4D401F"))[0].isSource)
  }

  @Test fun a_lone_rendition_is_the_source() {
    val single = "#EXTM3U\n" +
      "#EXT-X-STREAM-INF:BANDWIDTH=6000000,CODECS=\"avc1.4D401F,mp4a.40.2\",RESOLUTION=1280x720,VIDEO=\"720p60\",FRAME-RATE=60.000\n" +
      "720p60/playlist.m3u8\n"
    assertTrue(ladder(single)[0].isSource)
  }
}
