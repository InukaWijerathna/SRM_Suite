# SRM Suite security assessment

Date: 2026-11-14. Scope: current repository, dependency audit, isolated backend tests, and one non-mutating request to the saved live deployment. This is a targeted code review, not a penetration test or compliance certification. High-risk findings remain before broad deployment with children's personal and health records.

## Verified protections

- The live roster endpoint rejected a request without a session token with `AUTH_REQUIRED`; it returned no roster. The installation API key alone did not authorize the read.
- The backend checks server-held sessions before roster reads and writes. Viewer accounts cannot submit attendance or edit students. Existing regression tests cover forged roles, expiry, account disablement, password changes, and logout.
- Server sessions have a six-hour absolute expiry. Session tokens travel in POST bodies in the app, rather than URLs. Delayed authentication failures from an older session do not invalidate a newer login.
- Connection failures and old backend versions do not unlock cached student data. React renders text normally; this review did not identify a `dangerouslySetInnerHTML` sink or demonstrate DOM XSS.
- Attendance sync uses a server lock and deduplicates log IDs on retry. These address concurrency and retry safety, not whether an attendance mark is truthful.

## Findings and recommended actions

### 1. High: weak password storage and unrestricted password guessing

Evidence: `apps-script/Code.gs`, `login_`, `setUserPassword`, and `sha256Hex_`. Passwords are stored as one unsalted SHA-256 digest. Login has no application-level attempt counter, backoff, lockout, or second factor. The account password shared earlier in this conversation was trivial; whether it has subsequently changed was not retested in this review.

Impact: a leaked credentials sheet permits rapid offline guessing. A reachable login endpoint also permits online guessing subject to Google's platform limits, which are not a substitute for account-specific throttling. No brute-force attempt was performed.

Action: rotate the previously shared administrator password immediately. Prefer a managed identity provider with MFA. If retaining password authentication, use a vetted salted password KDF with a suitable cost, plan migration of existing hashes, and implement server-side throttling without enabling easy account-lockout denial of service. Never put a new password in a chat message.

References: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).

### 2. High: spreadsheet formula injection in student edits

Evidence: `apps-script/Code.gs`, `writePatch_`, passes caller-provided values directly to `Range.setValue`. An isolated probe of the actual function confirmed that `=1+1` is forwarded unchanged as a cell value. Google documents that values beginning with `=` are interpreted as formulas. Registration also forwards form values through `setValues`; its text number format should not be relied on as the sole formula-injection defense.

Impact: an editor can insert formulas in fields intended to hold literal student information. Formulas could alter displayed data and reference other tabs, potentially including credential hashes, which could then appear in roster results. This cross-tab disclosure impact is inferred from Sheets formula behavior; it was not executed against the live sheet. External-network exfiltration was not tested or established.

Action: neutralize formula-leading input at every untrusted write boundary, validate field types, and reserve deliberate formulas such as BMI for separate trusted code. Apply the same policy to registration and imports.

Reference: [Google Range.setValue/setValues](https://developers.google.com/apps-script/reference/spreadsheet/range#setValue(Object)).

### 3. High on shared or compromised devices: readable cached data and bearer tokens

Evidence: `src/services/storage.ts` stores the roster, queue, organization configuration, API key, and session token as JSON in localStorage. `logout` in `src/context/AppContext.tsx` removes the session but leaves cached roster and attendance data. `android/app/src/main/AndroidManifest.xml` enables backups without explicit data-exclusion rules in this manifest.

Impact: the login screen hides data but does not encrypt it. Same-origin script execution, debug access, a compromised device, or an applicable backup/transfer path can expose cached personal/health data and tokens. Backup inclusion was not experimentally established and depends on Android/version and device policy. No XSS exploit or device extraction was demonstrated.

Action: use platform-protected credential storage and an appropriate encrypted offline database on Android. Consider a backend-for-frontend with HttpOnly session cookies for the web app. Define explicit backup exclusions and a shared-device logout/cache-retention policy that preserves unsynced work safely. Encryption keys must not be stored beside the encrypted data in localStorage.

Reference: [OWASP HTML5 storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/HTML5_Security_Cheat_Sheet.html).

### 4. Medium: writable fields and default privileges are broader than necessary

Evidence: `writePatch_` allows any matching column in the student/health tabs. An isolated probe confirmed that the child ID column can be overwritten. There is no server allowlist, length limit, or field-specific validation for the patch. Separately, missing or blank Role values default to editor access in login/session validation.

Impact: an editor can change identifiers or other columns absent from the normal edit UI, breaking roster joins and attendance associations. An incomplete account row can receive full editing privileges unintentionally. This is not an anonymous bypass of the session requirement.

Action: allowlist editable fields, prohibit identity/schema changes through this endpoint, validate values and lengths, and require an explicit valid role with viewer as the safer default. Keep sheet administrators separate from app editors.

### 5. Medium: offline revocation, idle timeout, and audit limitations

Evidence: a valid saved session unlocks the cache offline until its original six-hour expiry. The application has no idle timeout. Logout attempts server revocation but ignores network failure. Attendance logs contain only log ID, timestamp, child ID, and status; no authenticated actor is stored.

Impact: disabling an account cannot immediately remove offline cached access. An unattended unlocked device stays usable until absolute expiry. A token not revoked because of a network failure can remain valid until server expiry. Attendance and student changes lack a durable per-user audit trail.

Action: define an inactivity/device-lock policy, explain offline limits to administrators, support device/session management, and record the authenticated actor server-side for writes. Never accept a client-supplied username as the audit identity. Offline availability and immediate remote revocation require an explicit tradeoff.

### 6. Medium/high for developer environments: vulnerable build dependencies

`npm audit --omit=dev --json` reported zero known vulnerabilities in production npm dependencies. The full `npm audit --json` reported 19 affected package entries: one critical, five high, ten moderate, and three low. These package counts include transitive/metavulnerability entries and are not 19 proven exploitable attack paths.

Examples include `tar` (critical audit severity, including archive-processing denial of service), `vite` (high), and `sharp` (high). Direct development packages affected include Capacitor tooling and the PWA toolchain. Their exposure depends on development-server access, processing untrusted archives/assets, and actual reachable code paths. This scan does not establish that the packaged APK contains the vulnerable Node.js tooling.

Action: update compatible tools in a separate change, review major upgrades rather than running a forced automatic fix, and repeat web/Android builds and QR/offline tests. Keep development servers off untrusted networks and avoid untrusted build inputs until addressed. Raw audit results are under ignored `.tools/audit-production.json` and `.tools/audit-all.json`.

Examples: [node-tar advisory](https://github.com/advisories/GHSA-23hp-3jrh-7fpw), [Vite advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [sharp advisory](https://github.com/advisories/GHSA-f88m-g3jw-g9cj).

### 7. Release and privacy considerations

The original reviewed emulator APK was a debug build intended for testing. The v0.3.0-beta packaging update adds a release-variant APK with Android debugging disabled, signed with the existing debug/testing certificate; production signing is still not configured. Review signing-key management, backup and WebView settings before production. The QR generator sends child IDs to external QR services, although not names or medical fields. Static QR IDs can be copied and are not proof of identity; staff should verify the displayed student/photo when that matters. External photos can contact arbitrary configured HTTP/HTTPS hosts; restrict trusted image sources and prefer HTTPS. The avatar already uses a no-referrer policy.

Deployment headers/CSP, Google account MFA and Drive sharing, script-owner access, form access/spam controls, release signing and mobile data extraction were not fully assessed. No conclusion about compliance or production hosting configuration is made.

## Validation and next steps

- 19 automated authentication/client regression tests passed.
- TypeScript, production Vite/PWA build, and Android debug APK build passed.
- All four requested UI changes were implemented. Rendering checks verified the empty/loading distinction, connected header with a blank organization name, password control presence, and absence of autofocus. The installed emulator app's attendance footer was measured above the bottom navigation.
- Live anonymous roster access was checked once, without mutating live data. Formula/column probes used isolated test doubles only. No brute-force, live injection, destructive changes, or credential enumeration were performed.
- Security findings above are assessment results, not fixes applied by this UI change. Prioritize password rotation, authentication hardening, formula-safe writes and field allowlists, then local-data/release hardening and toolchain upgrades.
