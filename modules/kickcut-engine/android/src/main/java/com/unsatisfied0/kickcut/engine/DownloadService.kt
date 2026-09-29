package com.unsatisfied0.kickcut.engine

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/*
 * Keeps the process alive while a job runs, which is the mobile answer to the
 * desktop's "leave it running overnight". It owns nothing: the queue lives in
 * `Engine`, and this only mirrors the running job into a notification.
 *
 * Android 15 caps `dataSync` services at six hours a day. When the system says
 * time is up the running job is paused - the segments on disk are the state,
 * so resuming later loses nothing.
 */
class DownloadService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL, labels.channel, NotificationManager.IMPORTANCE_LOW),
    )
    Engine.onActivity = { running -> if (running == null) stopSelfSafely() else update(running) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(null)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(ID, notification)
    }
    if (!Engine.isBusy()) stopSelfSafely()
    return START_NOT_STICKY
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    Engine.pauseRunning()
    stopSelfSafely()
  }

  override fun onDestroy() {
    Engine.onActivity = null
    super.onDestroy()
  }

  private fun stopSelfSafely() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private var lastUpdate = 0L

  private fun update(job: Map<String, Any?>) {
    // The engine emits four times a second; a notification needs far less.
    val now = System.currentTimeMillis()
    if (now - lastUpdate < 1000) return
    lastUpdate = now
    getSystemService(NotificationManager::class.java).notify(ID, build(job))
  }

  private fun build(job: Map<String, Any?>?): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val builder = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      // The file name, as on the job cards: stream titles are long and emoji-heavy.
      .setContentTitle(job?.get("fileName") as? String ?: labels.channel)

    if (job != null) {
      val mux = job["muxFraction"] as? Double
      if (job["state"] == JobState.Muxing.wire) {
        builder.setContentText(labels.muxing)
        if (mux != null) builder.setProgress(1000, (mux * 1000).toInt(), false) else builder.setProgress(0, 0, true)
      } else {
        val done = (job["segmentsDone"] as? Number)?.toInt() ?: 0
        val total = (job["segmentsTotal"] as? Number)?.toInt() ?: 1
        builder.setContentText("${labels.downloading} · $done / $total")
        builder.setProgress(total, done, false)
      }
    }
    return builder.build()
  }

  /** Notification wording, handed over from JS so it follows the app's language. */
  data class Labels(val channel: String, val downloading: String, val muxing: String)

  companion object {
    private const val CHANNEL = "downloads"
    private const val ID = 1
    @Volatile var labels = Labels("Downloads", "Downloading", "Assembling")

    fun start(context: Context) {
      ContextCompat.startForegroundService(context, Intent(context, DownloadService::class.java))
    }
  }
}
