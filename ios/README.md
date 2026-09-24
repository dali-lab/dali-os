# DALI OS iOS

Native SwiftUI app for DALI OS. It is a single universal target for iPhone and iPad (iOS 18+). It talks to the same `dali-api` backend as the web and desktop apps.

- **iPad: room door display.** The iPad is mounted outside a room. It shows the room as free or busy, the current and next booking, and today's schedule as a day timeline. People can walk up and "Book now" by scanning their DALI wallet pass. While a DALI event (a SelfCheckIn meeting) is running in the room, the display becomes a wallet-pass check-in scanner.
- **iPhone: member app.** This is a placeholder for now.

## Develop

Prereqs: Xcode 16 or later.

```bash
open ios/DaliOS.xcodeproj
```

Pick the `DaliOS` scheme and an iPhone or iPad simulator, then run with ⌘R. To run the tests from the command line:

```bash
xcodebuild test -project ios/DaliOS.xcodeproj -scheme DaliOS \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

## Layout

```
DaliOS/
  App/          entry point + RootView (iPad → room display, iPhone → member tabs)
  Core/         AppEnvironment (server URLs), AppSettings, APIClient, Keychain
  RoomDisplay/  the iPad door display: pairing, status panel, day timeline, pass scanner
  Features/   one folder per screen area (Home, Settings, …)
  Assets.xcassets
DaliOSTests/  Swift Testing unit tests
```

The project uses Xcode's synchronized folders. Any file you add under `DaliOS/` or `DaliOSTests/` is picked up automatically, so you don't need to edit the `.pbxproj` for new files.

## Servers

Debug builds default to **staging**. You can switch between Production, Staging, and Local (`http://localhost:3001`, i.e. `npm run dev`) in Settings → Developer. Release builds always use production.

## Room display

**Pairing.** In DALI OS, go to Core ▸ Rooms (behind the `room-booking` feature flag), pick the room, and choose **Add display**. Enter the 8-character code on the iPad; it expires after 10 minutes.

The iPad then gets its own token, which is stored in the Keychain. The token only works on `/api/room-display/*`, for that one room. Revoke it from the same page. To unpair from the iPad, press and hold the date above the timeline for 3 seconds.

**Demo mode (debug builds only).** Enter `DEMO-ROOM` or `DEMO-EVENT` as the setup code to see the display with sample data and no server. To open the display already in use, launch with the argument `-demoDisplay busy`. The simulator has no camera, so the scanner offers **Simulate a scan**.

**Kiosk setup.** On the iPad:
- Settings → Accessibility → **Guided Access** on, then triple-click the side button in the app to lock it.
- Keep it on power. The app turns off auto-lock itself.

## Signing

The app signs with the same Apple Developer team as the desktop app: **BrunchLabs, LLC (`JQ28K6Y7JE`)**, using automatic signing. The desktop app's *Developer ID Application* certificate is only for distributing macOS apps outside the App Store, so it can't sign iOS builds. Xcode issues the Apple Development and Distribution certificates for iOS under that same team. To build to a device, sign in to Xcode with an Apple ID on that team.

Bundle ID: `edu.dartmouth.dali.os.ios`.

## TODO before TestFlight

- App icon: add a 1024×1024 opaque PNG to `Assets.xcassets/AppIcon`. `desktop/app-icon.png` has transparent padded corners, so it isn't suitable as-is.
- Sign-in. Google blocks OAuth in embedded webviews, so use `ASWebAuthenticationSession`, as the desktop pairing flow does.
- CI build/test workflow.
