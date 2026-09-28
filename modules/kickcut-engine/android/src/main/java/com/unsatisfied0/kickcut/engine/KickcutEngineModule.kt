package com.unsatisfied0.kickcut.engine

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/*
 * The mobile side of `src/lib/api.ts`. Every function here is one of the
 * desktop's `invoke` commands under the same name, so the JS layer is the same
 * shape on both. The work itself lives in `Engine`, which outlives this module.
 */
class KickcutEngineModule : Module() {
  private var pendingFolder: Promise? = null

  private fun fail(e: Throwable): Nothing = throw CodedException("ERR_KICKCUT", e.message ?: e.toString(), e)

  private inline fun <T> guard(block: () -> T): T = try {
    block()
  } catch (e: CodedException) {
    throw e
  } catch (e: Throwable) {
    fail(e)
  }

  override fun definition() = ModuleDefinition {
    Name("KickcutEngine")
    Events("queue")

    OnCreate {
      Engine.init(appContext.reactContext!!)
      Engine.listener = { list -> sendEvent("queue", mapOf("jobs" to list)) }
    }

    OnDestroy {
      Engine.listener = null
    }

    AsyncFunction("loadJobs") { guard { Engine.loadJobs() } }

    AsyncFunction("enqueueJob") { job: Map<String, Any?> ->
      guard {
        fun s(k: String) = job[k] as? String ?: ""
        fun d(k: String) = (job[k] as? Number)?.toDouble() ?: 0.0
        fun i(k: String) = (job[k] as? Number)?.toInt() ?: 0
        Engine.enqueue(
          Engine.NewJob(
            title = s("title"), channel = s("channel"), quality = s("quality"),
            playlistUrl = s("playlistUrl"), startIndex = i("startIndex"), endIndex = i("endIndex"),
            trimOffset = d("trimOffset"), outputSeconds = d("outputSeconds"),
            crossesDiscontinuity = job["crossesDiscontinuity"] == true, outputDir = s("outputDir"),
            fileName = s("fileName"), muxMode = MuxMode.from(s("muxMode")), frameRate = d("frameRate"),
          ),
        )
      }
    }

    AsyncFunction("pauseJob") { id: String -> guard { Engine.pause(id) } }
    AsyncFunction("resumeJob") { id: String -> guard { Engine.resume(id) } }
    AsyncFunction("cancelJob") { id: String, deleteOutput: Boolean -> guard { Engine.cancel(id, deleteOutput) } }
    AsyncFunction("setSpeedLimit") { bytesPerSecond: Double -> Engine.setSpeedLimit(bytesPerSecond.toLong()) }
    AsyncFunction("setAutoResume") { enabled: Boolean -> Engine.setAutoResume(enabled) }

    AsyncFunction("renditions") { masterUrl: String ->
      guard { Engine.renditions(masterUrl).map { it.toMap() } }
    }
    AsyncFunction("playlistSummary") { playlistUrl: String ->
      guard { Engine.playlistSummary(playlistUrl).toMap() }
    }
    AsyncFunction("planRange") { playlistUrl: String, start: Double, end: Double, bandwidth: Double ->
      guard { Engine.planRange(playlistUrl, start, end, bandwidth.toLong()).toMap() }
    }

    AsyncFunction("ffmpegVersion") { Engine.ffmpegVersion() }
    AsyncFunction("freeBytes") { Engine.freeBytes().toDouble() }

    AsyncFunction("setNotificationLabels") { channel: String, downloading: String, muxing: String ->
      DownloadService.labels = DownloadService.Labels(channel, downloading, muxing)
    }

    /*
     * Open a finished file, or the folder a job saves into. The desktop shows
     * it in Explorer or Finder; the phone's equivalent is handing it to
     * whatever plays video, or to the files app.
     */
    AsyncFunction("reveal") { target: String ->
      guard {
        val context = appContext.currentActivity ?: appContext.reactContext!!
        val uri = Uri.parse(target)
        val intent = if (DocumentsContract.isTreeUri(uri) && !DocumentsContract.isDocumentUri(context, uri)) {
          val doc = DocumentsContract.buildDocumentUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
          Intent(Intent.ACTION_VIEW).setDataAndType(doc, DocumentsContract.Document.MIME_TYPE_DIR)
        } else {
          Intent(Intent.ACTION_VIEW).setDataAndType(uri, "video/mp4")
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
          context.startActivity(intent)
        } catch (e: Exception) {
          throw EngineException("That file or folder is no longer there.")
        }
      }
    }

    /** Share a finished file - the one thing a phone does with a video that a desktop does not. */
    AsyncFunction("share") { target: String ->
      guard {
        val context = appContext.currentActivity ?: appContext.reactContext!!
        val send = Intent(Intent.ACTION_SEND).setType("video/mp4")
          .putExtra(Intent.EXTRA_STREAM, Uri.parse(target))
          .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }

    /** A readable name for a SAF folder, e.g. "Movies/KickCut". */
    Function("folderLabel") { treeUri: String ->
      runCatching {
        val id = DocumentsContract.getTreeDocumentId(Uri.parse(treeUri))
        val (volume, path) = id.split(':', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
        val root = if (volume == "primary") "" else "$volume:"
        (root + path).ifEmpty { "/" }
      }.getOrDefault(treeUri)
    }

    /** Choose a folder to save into, and keep the right to write there. */
    AsyncFunction("pickFolder") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      pendingFolder?.resolve(null)
      pendingFolder = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
          Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
      )
      activity.startActivityForResult(intent, PICK_FOLDER)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != PICK_FOLDER) return@OnActivityResult
      val promise = pendingFolder ?: return@OnActivityResult
      pendingFolder = null
      val uri = payload.data?.data
      if (payload.resultCode != Activity.RESULT_OK || uri == null) {
        promise.resolve(null)
        return@OnActivityResult
      }
      runCatching {
        appContext.reactContext!!.contentResolver.takePersistableUriPermission(
          uri,
          Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
        )
      }
      promise.resolve(uri.toString())
    }
  }

  companion object {
    private const val PICK_FOLDER = 0x4b43
  }
}
