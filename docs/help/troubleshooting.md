# Troubleshooting

Find what you see, then follow the steps. If nothing here helps, see [Still stuck](#still-stuck).

## Installing

### Windows says "Windows protected your PC"

Click **More info**, then **Run anyway**. Windows shows this for apps it has not seen often.

### Mac says Sidepage "cannot be opened"

Open **System Settings**, then **Privacy & Security**, scroll down and click **Open Anyway** next to the message about Sidepage.

### Android says "App not installed" or "conflicts with an existing package"

You have a Sidepage from before version 0.35, which was signed differently. Back up your notes (**More**, **Back up all notes**), uninstall the old Sidepage, install the new one, and restore (**More**, **Restore a backup**). This is needed only once. See [Install Sidepage](/get-started/install#android-phone-or-tablet).

### Android blocks the download or the install

Allow your browser (or Files app) to install apps: when Android asks, tap **Settings** and turn on **Allow from this source**.

## Opening files

### A file does not open

1. Check the file opens in another app. A file that is damaged or still downloading will not open.
2. Check its kind is in [File formats](/reference/formats).
3. **Kindle books bought from Amazon** are locked (DRM) and cannot be opened by any other app.
4. **A PDF with a password** asks for it when it opens: type it and click **Open**.

### Sidepage is not in "Open with" or in Default apps

- **Windows:** update to the latest Sidepage (0.31.1 or later registers it), then close and reopen **Settings**.
- **Mac:** right-click the file, **Open With**, **Other…**, and pick Sidepage in Applications.
- **Android:** update to 0.32 or later.

See [Make Sidepage your PDF app](/data/default-app).

### A scanned PDF cannot be searched, read aloud or studied

It is pictures of pages. Click **Scanned: make it searchable** in the book's bar. See [Scanned pages and pictures](/reading/scanned-pages).

### A web page will not open as an article

In the browser version, most sites block it: use the installed app. If the app says **No article could be found**, the address is not an article (a home page, a search page or a page behind a login).

## Notes

### My notes are gone

1. **Is it the same book?** Notes belong to a book by its name. If the file was renamed, open the file with the old name, or rename it back.
2. **Same device and browser?** Notes stay on the device (and, in the browser version, in that browser). See [Where your notes are kept](/data/where-notes-live).
3. **Earlier version?** In the note, **⋯**, **Earlier versions**.
4. **Backup?** **More**, **Restore a backup**.

### The note says it could not be saved

On a computer, check that the **Documents** folder exists and is not full or read only. Then type a letter: Sidepage tries again.

## Reading aloud

### Read aloud is missing or silent

- Choose **Natural voice** in **More**, under **Reading aloud**. Device voices are often missing on Android.
- Check the device's volume and that it is not in silent mode.
- The first time, a natural voice needs the internet to download.

## Ask AI

See the [Ask AI troubleshooting table](/ai/ask-ai#troubleshooting).

## Updates

### The update card says the download broke off

Your connection dropped. Click **Not now**, then later **More**, **Check for updates**.

### I want to stay on this version

Untick **Update by itself** in **More**, and click **Not now** when a new version is offered.

## The screen

### A button is missing

Most tools are one tap away in a menu: **⋯ Tools** in the book's bar, **Aa** and **⋯** in the note's bar, **Study** and **More** in the top bar. Or press <kbd>Ctrl</kbd> <kbd>K</kbd> and type its name. See [A tour of the screen](/get-started/tour).

### The bars disappeared

You are in Focus. Press <kbd>Esc</kbd>, or click **⤡** in the top right corner.

### Everything is dark, or tinted orange

Check **Theme**, **Warmth** and **Dim** in **More**.

## Still stuck

Open an issue at [github.com/cLLeB/sidepage/issues](https://github.com/cLLeB/sidepage/issues). Say which device and which Sidepage version (at the bottom of **More**), what you did, and what happened.
