# Install Sidepage

Sidepage runs on Windows, macOS, Linux and Android as an app you install, and on any device (iPhone, iPad and Chromebook included) as a web app in the browser. It is free.

All downloads are on the [releases page](https://github.com/cLLeB/sidepage/releases/latest). Pick the file for your device from the list below.

| Device | File to download |
| --- | --- |
| Windows 10 or 11 | `Sidepage_…_x64-setup.exe` |
| Mac (Apple silicon or Intel) | `Sidepage_…_universal.dmg` |
| Linux (Ubuntu, Debian, Mint) | `Sidepage_…_amd64.deb` |
| Linux (any other) | `Sidepage_…_amd64.AppImage` |
| Android phone or tablet | `Sidepage_…_android.apk` |
| iPhone, iPad, Chromebook | No file: use the [web app](#iphone-ipad-and-chromebook) |

## Windows

1. Download `Sidepage_…_x64-setup.exe` from the [releases page](https://github.com/cLLeB/sidepage/releases/latest).
2. Open the file.
3. If Windows shows **Windows protected your PC**, click **More info**, then **Run anyway**. Windows shows this for apps that are new to it; it does not mean anything is wrong.
4. The installer finishes by itself in a few seconds. Sidepage is in the Start menu.

Sidepage installs for your account only and does not need an administrator.

## Mac

1. Download `Sidepage_…_universal.dmg`.
2. Open it and drag **Sidepage** onto the **Applications** folder.
3. Open **Applications** and double-click **Sidepage**.
4. If macOS says Sidepage **cannot be opened because it is from an unidentified developer**: open **System Settings**, then **Privacy & Security**, scroll down and click **Open Anyway** next to the message about Sidepage. You only do this once.

## Linux

**Ubuntu, Debian, Mint and others that use .deb files:**

1. Download `Sidepage_…_amd64.deb`.
2. Open it with your software installer, or in a terminal run:

   ```bash
   sudo apt install ./Sidepage_*_amd64.deb
   ```

3. Sidepage is in your applications menu.

**Any other Linux:**

1. Download `Sidepage_…_amd64.AppImage`.
2. Make it runnable: right-click it, open **Properties**, and tick **Allow executing file as program**. Or in a terminal:

   ```bash
   chmod +x Sidepage_*_amd64.AppImage
   ```

3. Double-click it to start Sidepage.

## Android phone or tablet

1. On the phone or tablet, open the [releases page](https://github.com/cLLeB/sidepage/releases/latest) and tap `Sidepage_…_android.apk` to download it.
2. Open the downloaded file (from the notification, or from **Files** then **Downloads**).
3. If Android asks whether to allow installing apps from this source, tap **Settings**, turn on **Allow from this source**, and go back.
4. Tap **Install**, then **Open**.

::: warning Installed Sidepage before version 0.35?
Those versions were signed differently, so Android will not install a new version over them. Do this once:

1. In the old Sidepage, open **More** (⋯ at the top right) and choose **Back up all notes**. Keep the file it saves.
2. Uninstall the old Sidepage.
3. Install the new one as above.
4. In the new Sidepage, open **More** and choose **Restore a backup**, then pick the file from step 1.

From version 0.35 on, every new version installs over the old one and keeps your notes.
:::

## iPhone, iPad and Chromebook

Sidepage works in the browser at **[clleb.github.io/sidepage](https://clleb.github.io/sidepage/)**, and can be added to the home screen like an app. It then opens full screen and works offline.

**iPhone or iPad (Safari):**

1. Open [clleb.github.io/sidepage](https://clleb.github.io/sidepage/) in **Safari**.
2. Tap the **Share** button (the square with an arrow).
3. Tap **Add to Home Screen**, then **Add**.

**Chromebook, or Chrome and Edge on any computer:**

1. Open [clleb.github.io/sidepage](https://clleb.github.io/sidepage/).
2. Click the **Install** icon at the right end of the address bar (a screen with a down arrow), then **Install**.

The web app can do almost everything the installed app can. What only the installed app on a computer can do: [Ask AI](/ai/ask-ai), opening any web page as an article, and keeping notes as plain files in your Documents folder. See [Where your notes are kept](/data/where-notes-live).

## Next

- [Your first book and notes](/get-started/first-book): a five minute walk through.
- [Updates](/get-started/updates): how Sidepage keeps itself up to date.
