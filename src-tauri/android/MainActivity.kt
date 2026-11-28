package io.github.clleb.sidepage

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray
import org.json.JSONObject

// Sidepage's Android screen. The release workflow copies this over the one Tauri generates.
private const val TEST_BUILD = false

class MainActivity : TauriActivity() {
  // Books handed to Sidepage by another app ("Open with", Share) and not yet taken by the page.
  private val opened = mutableListOf<Uri>()
  private var web: WebView? = null

  // A folder the reader picks in Android's own folder picker. Sidepage keeps the leave to read it (and what is
  // inside, folders within folders too), so it is read where it is, like a folder on a computer.
  private val pickTree = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
    val told = JSONObject()
    if (uri != null) {
      try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) { }
      told.put("uri", uri.toString()).put("name", treeName(uri))
    }
    web?.post { web?.evaluateJavascript("window.dispatchEvent(new CustomEvent('sidepage:android-folder', { detail: $told }))", null) }
  }

  private fun treeName(tree: Uri): String = try {
    val root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
    contentResolver.query(root, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)
      ?.use { found -> if (found.moveToFirst()) found.getString(0) ?: "" else "" } ?: ""
  } catch (e: Exception) {
    ""
  }.ifBlank { DocumentsContract.getTreeDocumentId(tree).substringAfterLast(':').substringAfterLast('/').ifBlank { "Folder" } }

  private data class Item(val id: String, val name: String, val folder: Boolean, val size: Long)

  private fun childrenOf(tree: Uri, documentId: String): List<Item> {
    val items = mutableListOf<Item>()
    val kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, documentId)
    val columns = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
    )
    contentResolver.query(kids, columns, null, null, null)?.use { found ->
      while (found.moveToNext()) {
        items.add(Item(found.getString(0), found.getString(1) ?: "", found.getString(2) == DocumentsContract.Document.MIME_TYPE_DIR, if (found.isNull(3)) 0 else found.getLong(3)))
      }
    }
    return items
  }

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
    webView.addJavascriptInterface(Folders(), "SidepageFolders")
    webView.addJavascriptInterface(Share(), "SidepageShare")
    // The device's "font size" setting would stretch the writing but not the paper's rules under it.
    // Sidepage has its own text sizes, for books and for notes.
    webView.settings.textZoom = 100
    // Test builds (never a release) can be inspected from a computer, to try touches on a real screen.
    if (TEST_BUILD) WebView.setWebContentsDebuggingEnabled(true)
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
  // Sharing: Android's own share sheet, with the book (put in the cache by Sidepage) as a file WhatsApp, Gmail,
  // Drive or any other app can take.
  inner class Share {
    // The book arrives in pieces (base64), as the web view can hand over only text, and is written to the cache.
    private var writing: java.io.FileOutputStream? = null
    private var written: File? = null

    @JavascriptInterface
    fun begin(name: String): Boolean = try {
      writing?.close()
      val dir = File(cacheDir, "share")
      dir.deleteRecursively()
      dir.mkdirs()
      val plain = name.replace(Regex("[/\\\\:*?\"<>|]"), "_").ifBlank { "book" }
      written = File(dir, plain)
      writing = java.io.FileOutputStream(written)
      true
    } catch (e: Exception) {
      false
    }

    @JavascriptInterface
    fun add(piece: String): Boolean = try {
      writing?.write(android.util.Base64.decode(piece, android.util.Base64.DEFAULT))
      writing != null
    } catch (e: Exception) {
      false
    }

    @JavascriptInterface
    fun send(type: String, title: String): Boolean {
      try { writing?.close() } catch (e: Exception) {}
      writing = null
      val file = written ?: return false
      return share(file.absolutePath, type, title)
    }

    @JavascriptInterface
    fun share(path: String, type: String, title: String): Boolean = try {
      val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", File(path))
      val send = Intent(Intent.ACTION_SEND)
        .setType(type.ifBlank { "application/octet-stream" })
        .putExtra(Intent.EXTRA_STREAM, uri)
        .putExtra(Intent.EXTRA_TITLE, title)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      send.clipData = android.content.ClipData.newRawUri(title, uri)
      runOnUiThread { startActivity(Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
      true
    } catch (e: Exception) {
      false
    }
  }
  inner class Folders {
    @JavascriptInterface
    fun pick() { runOnUiThread { pickTree.launch(null) } }

    // Whether Sidepage still has the leave to read the folder.
    @JavascriptInterface
    fun has(reference: String): Boolean = contentResolver.persistedUriPermissions.any { it.uri.toString() == reference && it.isReadPermission }

    @JavascriptInterface
    fun forget(reference: String) {
      try { contentResolver.releasePersistableUriPermission(Uri.parse(reference), Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e: Exception) { }
    }

    // The folder's files of the kinds asked for, as a tree: [{ id: "path/within/it", name, size, children? }].
    @JavascriptInterface
    fun list(reference: String, kinds: String): String {
      val tree = Uri.parse(reference)
      val wanted = JSONArray(kinds).let { list -> (0 until list.length()).map { list.getString(it) }.toSet() }
      var budget = 5000
      fun walk(documentId: String, prefix: String, depth: Int): JSONArray {
        val found = JSONArray()
        for (item in childrenOf(tree, documentId)) {
          if (budget <= 0 || item.name.startsWith(".")) continue
          val id = if (prefix.isEmpty()) item.name else "$prefix/${item.name}"
          if (item.folder) {
            if (depth < 8) {
              val inside = walk(item.id, id, depth + 1)
              if (inside.length() > 0) found.put(JSONObject().put("id", id).put("name", item.name).put("size", 0).put("children", inside))
            }
          } else if (item.name.substringAfterLast('.', "").lowercase() in wanted) {
            budget--
            found.put(JSONObject().put("id", id).put("name", item.name).put("size", item.size))
          }
        }
        return found
      }
      return try { walk(DocumentsContract.getTreeDocumentId(tree), "", 0).toString() } catch (e: Exception) { "" }
    }

    // One file of the folder, by its path within it, copied into the app's own space to be opened. Gives its path.
    @JavascriptInterface
    fun read(reference: String, path: String): String = try {
      val tree = Uri.parse(reference)
      var documentId = DocumentsContract.getTreeDocumentId(tree)
      for (part in path.split('/')) documentId = childrenOf(tree, documentId).first { it.name == part }.id
      val folder = File(cacheDir, "folder").apply { mkdirs(); listFiles()?.forEach { it.delete() } }
      val copy = File(folder, path.substringAfterLast('/').replace(Regex("[\\\\/:*?\"<>|]"), "_"))
      contentResolver.openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, documentId))?.use { input -> copy.outputStream().use { input.copyTo(it) } }
      copy.absolutePath
    } catch (e: Exception) {
      ""
    }
  }
}
