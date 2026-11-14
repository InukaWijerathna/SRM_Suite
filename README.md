# SRM Suite — Student Record Manager (PWA + Android)

Current release: **v0.3.0-beta** · Android version code **2** · Backend authentication protocol **2**.

Offline-first attendance, QR check-in and a student/health directory. React 18 + Vite + TypeScript + Tailwind, with each organization's own Google Sheet as the database (through a small Apps Script web app). Ships two ways from the same code: an installable web PWA, and a native Android app (via Capacitor).

**One app build, any number of organizations.** No organization's Google Sheet URL is built into the app. Each install connects to its own sheet from inside the app (tap the header logo → **Settings & connection**), which also has step-by-step setup instructions and a one-tap blank-template download. That connection is stored on the device and can be changed to a different sheet at any time; a fresh install walks you through connecting a sheet before it can be used.

## First launch and everyday navigation

A new installation contains no organization's Sheet connection, student roster, or signed-in account. Settings opens on first launch. If you close it, tap **Configure** in the center of the home screen to reopen it from the left. After the administrator saves a valid connection, sign in to download the student roster. Installing an update with the same package and signing certificate preserves existing app data; it does not simulate a fresh installation.

The header shows the signed-in username and role. Tap the logo or account label to open the left panel, which contains **Settings & connection**, connection/sync status, and **Log out**. Settings opens as a full-height panel from the left. Editors navigate using the bottom **Home**, **Attendance**, and **Scanner** tabs. Viewers have directory access only. The left panel does not repeat these navigation tabs.

Login includes a Show/Hide password control and does not open the keyboard automatically. An empty connected sheet shows **No students yet**. The attendance submit footer stays above the bottom navigation.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173 — set VITE_APPS_SCRIPT_URL in .env to seed a sheet for local dev
npm run build      # type-check + production build into dist/
npm run preview    # serve the build; the service worker / offline mode only runs here
```

## Android app

The Android app is the same web app wrapped by [Capacitor](https://capacitorjs.com) — not a rewrite, so every feature above (offline storage, QR scanning, Google Sheets sync) works identically. The native shell adds: a real home-screen icon, camera/vibration permission prompts handled by Android instead of the browser, and offline-by-default (the web assets are bundled into the app, so there's nothing to "install" on first run).

### One-time setup

1. **JDK 21.** The Android project compiles Java 21 sources. Use JDK 21 for the documented Gradle wrapper and point `JAVA_HOME` at it for the build (no need to change your system default):
   ```bash
   # Windows PowerShell example — adjust the install path to wherever you put it
   $env:JAVA_HOME = "C:\path\to\jdk-21"
   ```
2. **Android SDK.** If you have Android Studio installed, open the `android/` folder in it once and let it install the SDK (Settings → SDK Manager) — it will write `android/local.properties` itself. Without Android Studio, install the [command-line tools](https://developer.android.com/studio#command-tools) and run:
   ```bash
   sdkmanager --sdk_root=<path> "platform-tools" "platforms;android-36" "build-tools;36.0.0"
   sdkmanager --sdk_root=<path> --licenses
   echo "sdk.dir=<path>" > android/local.properties
   ```

### Building

```bash
npm run android:sync     # builds the web app and copies it into android/
npm run android:open     # opens the project in Android Studio (Run ▶ to install on a device/emulator)
# or, from the command line:
npm run android:build    # debug APK -> android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk:release # unsigned release APK -> android/app/build/outputs/apk/release/app-release-unsigned.apk
npm run android:release  # release bundle -> android/app/build/outputs/bundle/release/app-release.aab (needs signing — see below)
```

Run `android:sync` again after any change to `src/`, `public/`, or `capacitor.config.ts` — it is not automatic.

### Notes

- **Branding vs. the Sheet connection — two different things.** The app's own identity (home-screen icon, app name, Android package ID) is fixed at build time in `capacitor.config.ts` — that's the *product's* branding, same for every organization using this build. Which Google Sheet it talks to, and the organization name shown in its header, are entered at runtime through Settings and are **not** part of the build. Rebuilding is only needed to change the product's own branding, never to connect a new organization.
- **Permissions**: `android/app/src/main/AndroidManifest.xml` declares `CAMERA` (QR scanning) and `VIBRATE` (scan feedback). Capacitor's WebView shows the standard Android permission prompt the first time the scanner asks for the camera — no extra code needed.
- **App icon/splash**: generated from [public/icon.svg](public/icon.svg) via `resources/icon.png` and `resources/splash.png`. Regenerate both the PWA and Android assets after changing the source icon: `npm run generate-icons`.
- **Signing a release build**: `android:release` produces an *unsigned* `.aab`. Follow Android's [app signing guide](https://developer.android.com/studio/publish/app-signing) to create a keystore and configure `android/app/build.gradle` before uploading to the Play Store. Do this once you're ready to publish — it's not needed for testing on a device.
- **App ID**: set in `capacitor.config.ts` (`appId: 'com.srmsuite.app'`). This becomes the Android package name and **cannot change after your first Play Store upload** — replace it with your own reverse-DNS id if you're forking this for your own distribution.
- The PWA's service worker is skipped inside the native app ([src/main.tsx](src/main.tsx)) — redundant once the assets are bundled in the APK, and app updates come from the Play Store instead.

## Google Sheet structure

Three tabs. Row 1 holds the headers below (column order doesn't matter, the names do). A ready-made workbook with these headers lives in `public/templates/srm-suite-blank-template.xlsx` (headers only) — upload it to Google Drive and **File → Save as Google Sheets**.

| Tab | Columns |
| --- | --- |
| `children_master` | `Child_ID_LKA006XXXX_4_digits` (the ID, e.g. `LKA0060410`), `Name_of_Child`, `Gender`, `Contact_Number`, `Whatsapp_Number`, `Address`, `GN_Division`, `Father_s_Name`, `Mother_s_Name`, `School_Grade`, and optionally `Birthday`, `Child_Name_In_BC` (local-script name, as on the birth certificate), `Office_Name` (which divisional office/branch, once you track more than one), `Care_Giver`, `Religion`, `Picture_Ref`, `Status` (blank = active) |
| `health_and_conditions` | `Child_ID_LKA006XXXX_4_digits`, `Weight_Kg`, `Height_cm`, `Body_Mass_Index_BMI`, then **one TRUE/FALSE column per medical condition** (below). Optional: the same columns can live on `children_master` instead |
| `attendance_logs` | `log_id`, `timestamp`, `child_id`, `attendance_status` (`Present` / `Absent` / `Late`). Starts empty; only the app writes here |

**Medical conditions are TRUE/FALSE columns**, so a child can have any number of them, e.g. `Health_Heart_Disease`, `Health_Respiratory`, `Disability_Visual_Impairment`. Blank counts as FALSE. To add a condition, add a column and fill TRUE/FALSE: the app treats any column that holds only TRUE/FALSE as a condition, with no code change. The `Health_` / `Disability_` prefix is dropped when the name is shown. `Health_Under_Weight` and `Health_Over_Weight` are weight status instead: they drive the Underweight/Overweight badges and filters (neither ticked = healthy) and don't count as a Medical Alert.

How the app reads the data:

- The two roster tabs are joined on the ID column once at load and cached in the browser. Search and filters run in memory, so they cost no API reads and work offline.
- Header names are matched loosely (`Name_of_Child`, `name of child` and the older `full_name` all work), so existing snake_case sheets keep working, including text columns such as `medical_condition` (`Heart Disease, Respiratory` or `None`) and `weight_category`.
- If the health columns also exist on `children_master`, they're used as a fallback when a child has no row on the health tab. The health tab may be omitted entirely.
- Phone numbers that Sheets stored as numbers (leading `0` dropped) are repaired for `tel:` and WhatsApp links. Sri Lanka (+94) is assumed.
- `picture_ref` can be a Google Drive share link, an `https://` image URL, or a bare filename plus `VITE_PHOTO_BASE_URL`. Without a photo the app shows initials.

## Connecting your organization's sheet (no rebuild needed)

Open the app and tap the header logo, then **Settings & connection**. On an unconfigured installation, the central **Configure** button opens the same Settings panel. **Settings** has step-by-step instructions built in ("First time setting this up?"), including a one-tap download of a blank, correctly-headed student sheet — the same steps are repeated here for reference:

1. **Get a blank sheet.** Download it from Settings (or use [the blank template](public/templates/srm-suite-blank-template.xlsx) / your own workbook), upload to Google Drive, open it, then **File → Save as Google Sheets**.
2. In the spreadsheet: **Extensions → Apps Script**, paste [apps-script/Code.gs](apps-script/Code.gs), save. Run `setup` once and approve the permissions, then run `setUserPassword` to create the first account. Choose `editor` for attendance and editing, or `viewer` for directory-only access.
3. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
4. Optional: in **Project settings → Script properties** add `API_KEY` with any long random string.
5. Back in the app's Settings: paste the URL (and the API key, if you set one), tap **Test connection**, then **Save**.
6. Sign in using the account created with `setUserPassword`.

That's it — no `.env`, no rebuild, no redeploying the app. The connection is saved on that device; re-opening Settings and saving a different URL switches it. Switching from one organization's sheet to another's also clears that device's cached roster and any unsynced attendance, so one organization's data can never leak into another's view or get synced to the wrong sheet.

`.env` still exists purely as a **local development convenience** (see `.env.example`): if `VITE_APPS_SCRIPT_URL` is set, it pre-fills Settings the first time the app runs on a device with nothing saved yet, so `npm run dev` doesn't need re-typing credentials every session. **Leave it unset in any build meant for other organizations to install** — it has no effect once something has actually been saved through Settings, but setting it defeats the "one build, no baked-in sheet" model for a build you intend to distribute.

> **Privacy:** roster and attendance endpoints require a valid server-issued session. The optional API key identifies the installation; it is not a substitute for user login. Cached roster data remains on the device for offline use, so protect devices that store student information.

## Registering students with a Google Form

A form registers a student, creates their QR code and adds them to the sheet.

1. In the same Apps Script project as `Code.gs`, add a second file and paste [apps-script/Registration.gs](apps-script/Registration.gs). Reload the spreadsheet: a **SRM Suite** menu appears.
2. **SRM Suite → Create registration form**, and approve the permissions (Forms, Drive, Mail). It builds the form, links it to the spreadsheet and shows the link to share. Do this once; running it again just shows the existing link.
3. Each submission:
   - adds the child to `children_master` and `health_and_conditions` (ticked Health/Disability boxes become TRUE, the rest FALSE; BMI is a formula);
   - saves `<ChildID>.png` in the Drive folder **Student QR Codes**, puts the link in the `QR_Code_Link` column, and emails the QR to the registrar (the script owner, or `REGISTRAR_EMAIL` in Script properties);
   - writes the outcome in the `Registration_Status` column of the form's response tab. A duplicate or malformed ID is rejected there and nothing is added.
4. **SRM Suite → Generate missing QR codes** makes codes for children already in the sheet. It stops after about 5 minutes; run it again until it says all are done.

Notes:

- The form asks for the ID as 4 digits (`0410`) or in full (`LKA0060410`); either is stored as `LKA0060410`, which is exactly what the QR contains.
- New children appear in the tracker app on its next roster refresh (open the app, or tap **Sync** with nothing queued).
- To add a health condition, add a choice to the form's Health or Disability question. The first child ticking it gets a new TRUE/FALSE column automatically (older children are set to FALSE).
- The QR image is drawn by quickchart.io (falling back to api.qrserver.com). Only the child ID is sent to them, never a name, address or medical detail. If a service is down, the child is still registered and the status column tells you to run **Generate missing QR codes** later.

## How attendance works

- Marks (Rapid Attendance taps and QR scans) go into a queue kept in `localStorage`, so nothing is lost on a refresh or dead connection.
- **Sync N Records** (header) or **Save & Submit** posts the whole queue to `attendance_logs` in one request. With **Auto-sync** on, the queue is posted 15 s after the last change while online.
- Each mark has a `log_id`, and the Apps Script skips ids it already stored, so a retried sync never double-logs.
- One mark per child per day. Changing a submitted mark appends a new row (the log is append-only; the latest row for a day is the truth).
- QR codes contain only the `child_id`. Scanning an already-marked child plays a lower double-beep and shows "Already scanned at HH:MM".
- Camera access needs HTTPS (or `localhost`). Cloudflare Pages and Vercel both provide it.

## Deploying

Cloudflare Pages or Vercel: build command `npm run build`, output directory `dist`. No `VITE_*` variables need to be set — every organization connects its own sheet from inside the deployed app (Settings), not at deploy time. The PWA (manifest, icons, service worker) is generated by `vite-plugin-pwa`. To regenerate icons from [public/icon.svg](public/icon.svg): `npm run generate-icons`.

## Layout

```
apps-script/Code.gs        Google Apps Script backend (roster + attendance API)
apps-script/Registration.gs Google Form registration, QR codes, "SRM Suite" menu
src/services/api.ts        Google Apps Script data access
src/services/storage.ts    localStorage layer (roster, queue, prefs)
src/services/audio.ts      Web Audio beeps + vibration
src/context/AppContext.tsx roster, attendance queue, sync state
src/lib/                   sheet-row join/normalisation, phone, photo, health rules
src/components/            Header, AccountDrawer, Settings, Login, directory, attendance and scanner screens
tests/                     Backend authorization and client protocol regression tests
```


## Required login and backend upgrade

The app and `apps-script/Code.gs` use authentication protocol version 2. Update both together.
An older backend, a failed connection check, or an unsigned session never unlocks the directory.

1. Replace `Code.gs` in the spreadsheet's Apps Script project with this version.
2. Run `setUserPassword` to create the first account. It adds `login_credentials` and stores a password hash, not the password. Select `editor` or `viewer` for the account.
3. Deploy a new version through **Deploy → Manage deployments → Edit → New version → Deploy**. Retain the existing `/exec` URL. The old app will stop accessing this deployment because it cannot provide a session token.
4. Install the updated app, connect that `/exec` URL in Settings, and sign in.

Every roster read, attendance submission, and student edit validates the session on the server.
Viewer accounts can read the directory; only editors can submit attendance or edit students.
Sessions last up to six hours and may end earlier if Apps Script evicts its cache. Logout revokes
the server session when online. Disabling an account or changing its password invalidates existing
sessions; role changes apply on the next request. An offline device can use its cached roster
until its previously issued session expires. Server changes take effect when it reconnects.

Run `npm test` for backend authorization and client protocol regression tests, and `npm run build`
for TypeScript and production build validation.


## Managing accounts

Accounts are managed in the connected spreadsheet, not through an in-app administrator screen:

- Create a user or reset a password by running `setUserPassword` in Apps Script. Never edit `Password_Hash` manually.
- On `login_credentials`, set `Role` to `editor` or `viewer`, and `Status` to `active` or `inactive`.
- Disabling a user or changing a password invalidates their server sessions. An offline device can retain cached access until its session expires.
- Logout keeps unsent attendance on the device. Switching to a different organization's connection clears its old cached data and pending attendance.

## APK releases and security status

See [v0.3.0-beta release notes](docs/releases/v0.3.0-beta.md) and the [security assessment](SECURITY_ASSESSMENT.md).

The installable beta release APK uses the **release variant signed with the existing debug/testing certificate**. A debug-variant APK is also provided for diagnostics. Neither is production-signed. `android:apk:release` additionally creates a release-variant APK that remains **unsigned** until a production signing configuration is supplied; Android cannot install it as-is. Keep the same signing key for updates. Do not uninstall an older build to resolve a signature mismatch without first preserving its pending attendance and connection details.

Known security work remains: stronger password hashing and login throttling, formula-safe spreadsheet writes and editable-field validation, protection of locally cached sensitive data, and development-tool dependency upgrades. This release does not claim to resolve those assessment findings. Do not use a weak or shared administrator password.

No real Sheet URLs, API keys, account passwords, signing keys, emulator backups, or cached student records belong in the repository or release assets.


### Publishing the prepared beta

The prepared artifacts live in ignored `.tools/releases/v0.3.0-beta/`. From an authenticated PowerShell terminal, run `./scripts/publish-release.ps1` to verify checksums, commit the reviewed files, push main and the beta tag, and create the GitHub prerelease. The script stops for unexpected changed files, remote commits not integrated locally, or an existing release; it does not overwrite tags or release assets. It requires working `gh` authentication in the terminal where it is run. Credentials and signing keys are never committed or uploaded.
