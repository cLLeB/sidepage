package io.github.clleb.sidepage

import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

// Sidepage's Android screen. The release workflow copies this over the one Tauri generates.
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
    webView.addJavascriptInterface(Files(), "SidepageAndroid")
    // The device's "font size" setting would stretch the writing but not the paper's rules under it.
    // Sidepage has its own text sizes, for books and for notes.
    webView.settings.textZoom = 100
  }

  // Android's file picker hands a book over as an internal reference ("document:19111"), not by name.
  // The app asks here for the name the person actually sees in their files.
  inner class Files {
    @JavascriptInterface
    fun nameOf(reference: String): String = try {
      contentResolver.query(Uri.parse(reference), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
        ?.use { found -> if (found.moveToFirst()) found.getString(0) ?: "" else "" } ?: ""
    } catch (e: Exception) {
      ""
    }
  }
}
