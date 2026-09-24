# DALI OS iOS

Native SwiftUI app for DALI OS. It is a single universal target for iPhone and iPad (iOS 18+). It talks to the same `dali-api` backend as the web and desktop apps.

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
  App/        entry point + RootView (tab bar on iPhone, sidebar on iPad)
  Core/       AppEnvironment (server URLs), AppSettings, APIClient
  Features/   one folder per screen area (Home, Settings, …)
  Assets.xcassets
DaliOSTests/  Swift Testing unit tests
```

The project uses Xcode's synchronized folders. Any file you add under `DaliOS/` or `DaliOSTests/` is picked up automatically, so you don't need to edit the `.pbxproj` for new files.

## Servers

Debug builds default to **staging**. You can switch between Production, Staging, and Local (`http://localhost:3001`, i.e. `npm run dev`) in Settings → Developer. Release builds always use production.

## Signing

The app signs with the same Apple Developer team as the desktop app: **BrunchLabs, LLC (`JQ28K6Y7JE`)**, using automatic signing. The desktop app's *Developer ID Application* certificate is only for distributing macOS apps outside the App Store, so it can't sign iOS builds. Xcode issues the Apple Development and Distribution certificates for iOS under that same team. To build to a device, sign in to Xcode with an Apple ID on that team.

Bundle ID: `edu.dartmouth.dali.os.ios`.

## TODO before TestFlight

- App icon: add a 1024×1024 opaque PNG to `Assets.xcassets/AppIcon`. `desktop/app-icon.png` has transparent padded corners, so it isn't suitable as-is.
- Sign-in. Google blocks OAuth in embedded webviews, so use `ASWebAuthenticationSession`, as the desktop pairing flow does.
- CI build/test workflow.
