# DALI OS Mobile

Expo (React Native) member app for iOS and Android: Time, Project, Calendar, Notes, and Pass tabs. It talks to `dali-api` through `/api/mobile/*` and records meeting notes through `/api/meeting-recordings/*` (contract: `src/api/contract.ts`). Everything is gated by the `mobile-app` feature flag; recording also needs the `ai-meeting-notes` flag and transcription configured on the server.

## Develop

Prereqs: Node 22, the Expo Go app on your phone (it must support this project's SDK, see `expo` in `package.json`) or an iOS simulator.

```bash
cd mobile
npm install
npx expo start            # scan the QR with the Camera app (iOS) or Expo Go (Android)
npx expo start --tunnel   # when the phone can't reach this machine; needs `npx expo login` in the terminal and the same account in Expo Go
```

Typecheck: `npx tsc --noEmit`.

## Servers

Debug builds default to Staging; release builds always use Production. In debug builds the profile sheet has a Server switch (Production, Staging, Local).

Local points at `http://<metro host>:3001`, or at `EXPO_PUBLIC_LOCAL_API_URL` when set (it then becomes the default). To use a local `dali-api` from a phone on another network, tunnel port 3001 (e.g. `cloudflared tunnel --url http://localhost:3001`), set `API_BASE_URL` and `FRONTEND_URL` in `dali-api/.env` to the tunnel URL, start `dali-api` with `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<tunnel host>`, and start Metro with `EXPO_PUBLIC_LOCAL_API_URL=<tunnel URL>`. Turn on the `mobile-app` flag for your user in Admin → Feature Flags.

## Sign-in

Device pairing, the same flow as the desktop app: the app calls `/auth/pair/start`, opens the DALI OS link page in the browser, you sign in and approve the code, and the app polls `/auth/pair/poll` for a Bearer token kept in the secure store.

## Time

The timer runs on the device (saved in the secure store, so it survives a restart) and logs one entry when you clock out. Entries, roles, and pay periods come from the same timesheet as the web Calendar; the Google Timesheet mirror runs for them too.

## Meeting notes

Recording uses `useAudioStream` from `expo-audio` to capture microphone PCM, resamples it to 16kHz mono, and uploads 20s chunks the same way the web recorder does. Pause ends a session and Resume starts the next segment. Finishing sends the audio to transcription, then the app asks the server to write the AI notes into the meeting's page. A quick recording (no meeting) gets a new personal note page.

Notes are edited in the real DALI OS editor: the app opens the page (`/documents/<id>?embed=1`) in a WebView, signed in once per app session through a one-time `/auth/handoff` link from `POST /api/mobile/webview`. New notes are filed in My notes or a notebook you can edit (the same notebooks as the web picker); a calendar meeting's Take notes opens that occurrence's notes page.

Recording in the background needs a development or store build (the `expo-audio` plugin in `app.json` adds the iOS background audio mode and Android permissions). In Expo Go, keep the app open while recording.

## Releasing

Releases ship from `prod` through `.github/workflows/mobile-release.yml` (EAS Build, Submit and Update):

- **Bump `version` in `app.json`** when anything native changes: a new native module, a plugin, permission or other `app.json` change, or an Expo SDK upgrade. Merging the bump to `prod` builds iOS and Android on EAS, submits them (TestFlight and the Play internal track), and tags `mobile-v<version>`.
- **Anything else in `mobile/`** that reaches `prod` goes out as an over-the-air EAS Update on the `production` channel. `runtimeVersion` follows the app version, so an update only reaches builds it's compatible with.
- Run the workflow by hand (Actions → Mobile Release → Run workflow) to force a build or an update. iOS and Android are built and submitted independently: if one platform fails, the other still ships and the release is still tagged, and the failed platform can be retried alone (kind `build`, platform `ios` or `android`).

Release builds always use the Production server, so the matching `dali-api` changes must be on prod first, with the `mobile-app` flag on for testers.

### One-time setup

1. Expo: sign in with the shared DALI Expo account, then from `mobile/` run `npx eas-cli init` (links the project and writes `extra.eas.projectId` into `app.json`) and `npx eas-cli update:configure` (writes `updates.url`). Commit the `app.json` changes.
2. Apple (the DALI developer team): create the app in App Store Connect with bundle id `edu.dartmouth.dali.os.mobile`, then run `npx eas-cli credentials -p ios` to let EAS manage the certificate and profile and to add an App Store Connect API key (used by `--auto-submit`). Add `"ios": { "ascAppId": "<App Store Connect app id>" }` under `submit.production` in `eas.json`.
3. Google: create the app in the Play Console with package `edu.dartmouth.dali.os.mobile`, upload the first build by hand (Play requires it), then add a service account key with `npx eas-cli credentials -p android`.
4. GitHub: create an Expo access token (expo.dev → Account settings → Access tokens) and save it as the repo secret `EXPO_TOKEN`. Until it exists the workflow skips with a notice.

### By hand

```bash
npx eas-cli build --platform ios --profile preview      # internal install (register devices with `eas device:create`)
npx eas-cli build --platform android --profile preview  # an APK to share
npx eas-cli build --platform all --profile production --auto-submit
npx eas-cli update --channel production --message "…"
```

## Layout

```
src/
  App.tsx        stages (landing, syncing, app) and the five tabs
  api/           contract types, fetch client, server environments
  contexts/      Auth, Data (me, projects, calendar, pass), Time (timesheet, timer), Notes (recordings, recorder)
  notes/         PCM framing and the chunk upload queue for recording
  components/    ui/ primitives, brand/ (tiles, logo loader), one folder per tab
  theme.ts       design tokens and the twrnc `tw` helper (tailwind.config.js)
```

Native `ios/` and `android/` folders are generated by `npx expo prebuild` and are not committed.
