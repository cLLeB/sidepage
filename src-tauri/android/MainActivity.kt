package io.github.clleb.sidepage

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

// Sidepage's Android screen. The release workflow copies this over the one Tauri generates.
class MainActivity : TauriActivity() {
  // Books handed to Sidepage by another app ("Open with", Share) and not yet taken by the page.
  private val opened = mutableListOf<Uri>()
  private var web: WebView? = null

  private fun remember(intent: Intent?) {
    val uri = when (intent?.action) {
      Intent.ACTION_VIEW -> intent.data
      Intent.ACTION_SEND -> @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      else -> null
    } ?: return
    synchronized(opened) { opened.add(uri) }
  }

  // Another book opened with Sidepage while it is open: the page is told to take it.
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    remember(intent)
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new Event('sidepage:android-open'))", null) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    remember(intent)
    // Android lets an app draw under the status bar (clock, battery), the navigation bar and the on-screen
    // keyboard. Sidepage should not: its top bar belongs right below the status bar, and what is being written
    // must stay above the keyboard. So the room those take is turned into padding around the app.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val taken = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(taken.left, taken.top, taken.right, taken.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Files(), "SidepageAndroid")
    webView.addJavascriptInterface(Updates(), "SidepageUpdates")
    // The device's "font size" setting would stretch the writing but not the paper's rules under it.
    // Sidepage has its own text sizes, for books and for notes.
    webView.settings.textZoom = 100
  }

  // Android's file picker hands a book over as an internal reference ("document:19111"), not by name.
  // The app asks here for the name the person actually sees in their files.
  inner class Files {
    // The books waiting, each copied into the app's own space under its real name (another app's file may only
    // be read while Android allows it), as a JSON list of paths.
    @JavascriptInterface
    fun takeOpened(): String {
      val waiting = synchronized(opened) { opened.toList().also { opened.clear() } }
      val paths = JSONArray()
      val folder = File(cacheDir, "opened").apply { mkdirs() }
      for (uri in waiting) {
        try {
          val name = nameOf(uri.toString()).ifBlank { uri.lastPathSegment?.substringAfterLast('/') ?: "book" }
          val copy = File(folder, name.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
          contentResolver.openInputStream(uri)?.use { input -> copy.outputStream().use { input.copyTo(it) } }
          paths.put(copy.absolutePath)
        } catch (e: Exception) {
          // Not readable any more: left out.
        }
      }
      return paths.toString()
    }

    @JavascriptInterface
    fun nameOf(reference: String): String = try {
      contentResolver.query(Uri.parse(reference), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { found -> if (found.moveToFirst()) found.getString(0) ?: "" else "" } ?: ""
    } catch (e: Exception) {
      ""
    }
  }
  // A new version of Sidepage, fetched here like on a computer, then handed to Android's installer. It carries the
  // same signature as this copy, so it installs over it and keeps everything. Android asks the person to confirm.
  inner class Updates {
    private val apk get() = File(File(cacheDir, "update"), "Sidepage.apk")

    private fun tell(what: JSONObject) {
      web?.post { web?.evaluateJavascript("window.dispatchEvent(new CustomEvent('sidepage:android-update', { detail: $what }))", null) }
    }

    @JavascriptInterface
    fun download(url: String) {
      Thread {
        try {
          val file = apk
          file.parentFile?.apply { mkdirs(); listFiles()?.forEach { it.delete() } }
          val part = File(file.parentFile, "Sidepage.part")
          val connection = URL(url).openConnection() as HttpURLConnection
          connection.instanceFollowRedirects = true
          connection.connectTimeout = 20000
          connection.readTimeout = 30000
          if (connection.responseCode !in 200..299) throw Exception("The download answered ${connection.responseCode}.")
          val total = connection.contentLengthLong
          connection.inputStream.use { input ->
            part.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              var got = 0L
              var told = 0L
              while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                got += read
                if (total > 0 && got - told >= total / 100) {
                  told = got
                  tell(JSONObject().put("state", "progress").put("share", got.toDouble() / total))
                }
              }
            }
          }
          if (!part.renameTo(file)) throw Exception("The download could not be kept.")
          tell(JSONObject().put("state", "done"))
        } catch (e: Exception) {
          tell(JSONObject().put("state", "failed").put("message", e.message ?: "The download broke off."))
        }
      }.start()
    }

    // Opens Android's installer on the version fetched. The first time, Android asks to let Sidepage install apps.
    @JavascriptInterface
    fun install(): Boolean = try {
      val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", apk)
      val open = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, "application/vnd.android.package-archive")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      runOnUiThread { startActivity(open) }
      apk.exists()
    } catch (e: Exception) {
      false
    }
  }
}
