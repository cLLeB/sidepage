# Publishing Sidepage on Google Play

Everything Google Play asks for, in the order the Play Console asks for it, with Sidepage's answers. The files referred to are in this folder.

## 1. Create the app

| Field | Answer |
| --- | --- |
| App name | Sidepage |
| Package name (if asked) | `io.github.clleb.sidepage` (it must be exactly this: it is the app's own identifier, and it can never be changed) |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free (a free app can never become paid) |
| Declarations | Tick both after reading them |

## 2. The app bundle

Every release on GitHub now carries `Sidepage_X.Y.Z_play.aab`: the Android App Bundle for Play. It is signed with Sidepage's own key, which Play uses as the **upload key**. It never looks for updates itself: Play updates it.

**App signing (asked at the first upload).** Two choices:

- **Recommended: use Sidepage's own key as the app signing key.** Then the copies installed from GitHub and from Play are the same app, and people can move between them without losing their notes. In **Setup, App signing**, choose **Use a different key** then **Export and upload a key from Java keystore**, download `pepk.jar` and the encryption public key Google shows, and run (with the files from `C:\Users\kyere\.sidepage-keys`):

  ```bash
  java -jar pepk.jar --keystore=sidepage-android.jks --alias=sidepage --output=sidepage-signing-key.zip --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
  ```

  It asks for the keystore password twice (in `android-password.txt`). Upload `sidepage-signing-key.zip`.
- **Or let Google create the app signing key.** Simpler, but the Play copy and the GitHub copy then cannot update each other: someone moving from one to the other has to back up, uninstall and restore.

## 3. Testing first (new personal accounts)

Personal developer accounts created after November 2023 must run a **closed test with at least 12 testers for 14 days in a row** before they can publish to everyone.

1. **Testing, Closed testing**, create a track, upload the `.aab`.
2. Add the testers' Gmail addresses (classmates, friends: at least 12), and share the opt-in link with them.
3. They install Sidepage from Play through the link and keep it for 14 days.
4. Then **Apply for production** on the Dashboard.

## 4. Store listing (Grow, Store presence, Main store listing)

| Field | What to use |
| --- | --- |
| App name, short description, full description | `listing-en.md` (and `listing-fr.md` for a French translation: **Add translations**, French, France) |
| App icon (512 by 512) | `icon-512.png` |
| Feature graphic (1024 by 500) | `feature-graphic.png` |
| Phone screenshots (2 to 8) | `screenshots/phone-book.png`, `phone-notes.png`, `phone-guide.png`, `phone-review.png` |
| 7 inch tablet screenshots | `screenshots/tablet7-reading.png` |
| 10 inch tablet screenshots | `screenshots/tablet10-reading.png`, `tablet10-guide.png` |
| App category | Education |
| Tags | Education, Productivity, Books and reference |
| Contact email | Your own email (shown publicly on the listing) |
| Website | https://clleb.github.io/sidepage/docs/ |

The screenshots show a sample document written for them (`sample/the-living-cell.pdf`), so no one else's copyright is shown.

## 5. App content (Policy, App content)

| Section | Answer |
| --- | --- |
| Privacy policy | https://clleb.github.io/sidepage/docs/privacy-policy |
| App access | All functionality is available without special access (no login) |
| Ads | No, the app does not contain ads |
| Content rating | Fill in the questionnaire: category **Reference, News, or Educational**; answer **No** to violence, sexuality, language, controlled substances, gambling. Users can interact or exchange content: **No**. Shares location: **No**. Unrestricted internet (the app can open any web page the reader types): **Yes**. Expected rating: Everyone / PEGI 3 |
| Target audience | 13 and over (it is a study tool for students and adults; choosing ages under 13 brings extra Families policy requirements) |
| News app | No |
| Data safety | See below |
| Government app | No |
| Financial features | None |
| Health | None |

### Data safety answers

| Question | Answer |
| --- | --- |
| Does the app collect or share any of the required user data types? | **Yes** (text the reader chooses to look up, translate or check is sent to those services) |
| Is all data encrypted in transit? | **Yes** (every service is reached over HTTPS) |
| Can users ask for data to be deleted? | Nothing is kept by us; answer **No** to providing a deletion request method, or explain that no account exists |
| Data types | **App activity, Other user-generated content**: collected, **not shared**, **processed ephemerally**, **optional**, purpose **App functionality** |
| Audio | **Not collected** (recordings and speech to text stay on the device) |
| Personal info, location, contacts, photos, files, identifiers | **Not collected** |

These answers describe what Sidepage does as built. You are responsible for them in the Console: read each question and check it matches.

## 6. Release

1. **Production** (after the closed test), **Create new release**, upload the newest `Sidepage_X.Y.Z_play.aab` from the [releases page](https://github.com/cLLeB/sidepage/releases).
2. Release notes: the first lines of that version's GitHub release notes.
3. **Review release**, then **Start rollout to production**. Google's review usually takes a few days.

## Later versions

Each GitHub release carries a new `.aab` with a higher version code. Upload it as a new release in the same track. Its version code always increases (0.35.2 is 35002), as Play requires.
