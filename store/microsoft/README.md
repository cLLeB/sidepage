# Publishing Sidepage on the Microsoft Store

Everything Partner Center asks for, in the order it asks, with Sidepage's answers. Sidepage is already reserved there: **Store ID 9NQ4B0151LNS**.

## 1. The package

Every release on GitHub carries `Sidepage_X.Y.Z_x64.msix`. It is built with the identity Partner Center gave Sidepage (**Product management, Product identity**):

| Field | Value |
| --- | --- |
| Package/Identity/Name | `CalebKwabenaKyereBoateng.Sidepage` |
| Package/Identity/Publisher | `CN=6EE69D7C-8974-4D42-8DAD-1C77D5292526` |
| Package/Properties/PublisherDisplayName | Caleb Kwabena Kyere Boateng |

The package is left unsigned: the Store signs it after certification. Store copies never look for updates themselves, because the Store updates them. To build one by hand on Windows (needs the Windows SDK for `makeappx`):

```bash
SIDEPAGE_STORE=msstore npx tauri build --no-bundle
node scripts/msix.mjs src-tauri/target/release/sidepage.exe Sidepage_x64.msix
```

The version in the package is the app's version with `.0` added (0.35.3 becomes 0.35.3.0). Each submission needs a higher version than the last one.

## 2. Start a submission

In Partner Center, open **Apps and games**, then **Sidepage**, then **Start your submission**.

## 3. Pricing and availability

| Field | Answer |
| --- | --- |
| Markets | All markets |
| Visibility | Public audience, discoverable in the Store |
| Pricing | Free |
| Free trial | No free trial |

## 4. Properties

| Field | Answer |
| --- | --- |
| Category | Education (subcategory Study tools if offered; otherwise Books and reference as the secondary category) |
| Privacy policy URL | https://clleb.github.io/sidepage/docs/privacy-policy |
| Website | https://clleb.github.io/sidepage/docs/ |
| Support contact info | https://github.com/cLLeB/sidepage/issues |
| Product declarations | Tick **This app has been tested to meet accessibility guidelines** only if you have checked it; leave the others unticked |
| System requirements | Keyboard and mouse recommended; touch supported. Memory 4 GB recommended |

## 5. Age ratings

Fill in the IARC questionnaire:

- Category: **Reference, News, or Educational**.
- Violence, sexuality, language, controlled substances, gambling: **No**.
- Users can interact or exchange content with each other: **No**.
- Shares the user's location: **No**.
- Allows purchases of digital goods: **No**.
- Unrestricted internet access (a web page can be opened by its address): **Yes**.

The expected rating is Everyone (PEGI 3).

## 6. Packages

Drag `Sidepage_X.Y.Z_x64.msix` from the GitHub release into the upload area. Under **Device family availability**, keep **Windows 10/11 Desktop** ticked and the others unticked.

## 7. Store listings

Add **English (United States)** and, for a French listing, **French (France)**.

| Field | What to use |
| --- | --- |
| Description | The full description in `../play/listing-en.md` (French: `../play/listing-fr.md`) |
| Short description | The short description from the same files |
| What's new in this version | The release notes of the version on GitHub |
| Product features (up to 20) | The lines starting with • in the description, one per field |
| Screenshots (at least one, 1366 by 768 or larger) | `screenshots/desktop-reading.png`, `desktop-guide.png`, `desktop-review.png` |
| Store logos | Optional: the Store uses the icons in the package. For a 1:1 box art, `../play/icon-512.png` |
| Search terms (up to 7) | PDF reader, ebook reader, EPUB, study notes, flashcards, note taking, students |
| Copyright | © 2026 Caleb Kwabena Kyere Boateng |
| Additional license terms | GPL 3.0: https://github.com/cLLeB/sidepage/blob/main/LICENSE |

The screenshots show a sample document written for them, so no one else's copyright appears.

## 8. Submission options

The package asks for **runFullTrust**, a restricted capability, because Sidepage is a desktop app. Partner Center asks why; answer:

> Sidepage is a desktop reader and note taking app. It runs as a full trust desktop application to open the documents the user chooses and save their notes in their Documents folder.

Notes for certification (optional but helpful):

> No account or login is needed. Open any PDF or EPUB with Open in the top bar. A sample PDF: https://github.com/cLLeB/sidepage/raw/main/store/play/sample/the-living-cell.pdf

## 9. Submit

Click **Submit to the Store**. Certification usually takes one to three working days. Partner Center emails the result; if something fails, the report says which rule and what to change.

## Later versions

Each new release on GitHub carries a new `.msix`. In Partner Center, **Update** the submission, replace the package in **Packages**, update **What's new**, and submit.
