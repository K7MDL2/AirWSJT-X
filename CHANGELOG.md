# Changelog

## Unreleased

### Added
- Desktop: new **dump1090 source** section below **Aircraft accounts** to set the IP address or hostname of a remote dump1090/readsb receiver (port stays 30003). The address is saved, applied immediately, and defaults to `127.0.0.1`.
- dump1090 activity is now visible: the desktop log and Scatter Aircraft panel show messages received, aircraft count, aircraft with position and time since the last message (or "no aircraft received" while the receiver is idle), and the mobile status badge does the same.
- Mobile: new **dump1090 source** section in Settings, below **Aircraft accounts**, to read aircraft from a dump1090/readsb receiver on the local network (port 30003). Saving an address selects the new "dump1090 (network)" aircraft source; **Disable dump1090** clears it and returns to OpenSky. iOS builds declare a local-network usage description for this.
- Receiver host tooling (`docs/remote-dump1090`): a small systemd service that lets one RTL-SDR be shared between dump1090 and `rtl_tcp` on a remote host. The first client to connect starts the matching service, the other is refused while it is held, and the dongle is released after the last client disconnects.
- dump1090 "busy" state: when the shared receiver is in use by another program, AirWSJT-X (desktop and mobile) shows a yellow "dump1090 busy" status with the reason, logs it, and keeps retrying, instead of reporting "connected" with no data. A connection that the host closes straight away is no longer reported as connected either.

## 0.3.15

### Fixed
- Android: the main page now scrolls as a whole, so the aircraft list is reachable on small screens. The list is also shown in landscape.
- iOS: builds declare no non-exempt encryption, so TestFlight no longer holds them for export-compliance review.

## 0.3.14

### Added
- Aircraft elevation now uses a K = 4/3 effective Earth radius (standard atmospheric refraction), so the radio horizon is more realistic.
- Station altitude is now part of the elevation and slant-range geometry. Desktop: new "Alt m" field next to MY callsign/grid. Mobile: the device GPS altitude is used automatically (location permission added for iOS and Android).
- Android speech callouts now use the phone's native text-to-speech engine, since the Android WebView has no Web Speech API.
- iOS app (TestFlight) and Mac App Store/TestFlight builds, both using bundle ID `us.ad7np.airwsjt-x`.

### Fixed
- Speech callouts now announce whenever azimuth or elevation changes by at least 1° (previously 3°); changes that arrived inside the minimum interval are no longer dropped, and the mobile app handles azimuth wrap-around at north.
- The mobile aircraft list now scrolls on Android.
- Mac App Store / TestFlight: nested executables are signed without the application-identifier entitlement (ITMS-90885), and the app declares a 12.0 minimum macOS (error 90869).
- Rebased the iOS/macOS TestFlight workflow on top of the current Android signing/flavor workflow, fixing "Expected multiple APK flavors, found 1" in manual Mobile Build runs.

> Note: the macOS bundle ID change moves the app's settings folder, so existing Mac installs lose saved aircraft settings once (Keychain credentials are unaffected).

## 0.3.12

### Fixed
- Android APKs are now signed with a persistent release key (repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`) instead of a throwaway debug key regenerated on every run. A different key per release made Android reject in-place updates with a signature mismatch. The workflow now fails if the secrets are missing, if an APK is debug-signed, or if the ARM and x86_64 APKs use different certificates.
- Removed the macOS Intel build from the release workflow; the `macos-13` runner never started, which also blocked the website deploy job.

> Upgrade note: devices with an earlier debug-signed APK (v0.3.9–v0.3.11) must uninstall once before installing a release signed with the new key.

## 0.3.11

### Fixed
- Aircraft elevation and slant range now account for Earth curvature. Previously a flat-earth formula showed distant aircraft (e.g. FL369 at 8700 km) at ~0° EL instead of below the horizon, so unreachable aircraft were scored and auto-locked (#75).
- A DX grid selected in the app is no longer overwritten by WSJT-X's DX grid, so scoring, lock, and "From DX Station" AZ/EL use the chosen DX station (#76).
- Android release builds now produce separate signed ARM and x86_64 APKs, fixing the APK flavor validation/signing failure seen in v0.3.10.

### Validation
- `python -m unittest discover -s tests -v`
- `npx tsc --noEmit`

## 0.3.10

### Fixed
- Manual desktop speech callouts now follow the tracked aircraft azimuth/elevation in **Manual** mode even when the operator does not touch the pointing arcs.
- The desktop **Speech on** toggle now previews the current azimuth/elevation on hover so Windows users can confirm audio output immediately.

### Changed
- Restored the broader Android GitHub Actions APK flavor build so release automation signs and uploads the full generated APK set instead of the reduced ARM-only path.

### Validation
- `npm run build`
- `python -m unittest discover -s tests -v`
- `npx playwright test`

## 0.3.9

### Fixed
- Restored a visible, usable desktop speech-announcement control on Windows by surfacing **Speech callouts** before rotator connection instead of hiding it behind a live `rotctld` session.
- Added a prominent one-click **Speech on / Speech off** toggle in the rotator/manual status bar so azimuth/elevation announcements can be enabled or disabled quickly.
- Restored desktop azimuth/elevation speech behavior for manual pointing mode so Windows users can get spoken target updates without a connected rotator.

### Validation
- `npm run build`
- `npx playwright test e2e/speech-callouts.spec.ts`

## 0.3.5

### Fixed
- **macOS packaged app OpenSky TLS failure (root cause fix)**: The SSL context created by `_ssl_context()` was never actually passed to `urllib.request.urlopen`. All three HTTPS call sites — `OpenSkyFeed.fetch_once`, `OpenSkyFeed._get_token`, and `ADSBExchangeFeed.fetch_once` — now pass `context=` explicitly. Without this, Python's `urlopen` always used its default certificate search path which fails in a packaged macOS `.app` bundle.

### Notes for future maintainers
- The `_ssl_context()` helper returns a context built from `certifi` when available, or the system trust store. **But the context must be passed to every `urlopen` call — just creating it is not enough.**
- Any future HTTPS call added to `airscout.py` must pass `context=self._ssl_context()`.
- Test in a packaged `.app` bundle (not just `tauri dev`) before shipping macOS releases. The packaged runtime does not inherit the developer's system trust chain.

## 0.3.4

### Fixed
- Restored OpenSky connectivity in packaged macOS builds by explicitly using the local CA trust store (`certifi` when available, otherwise the system defaults) before creating outbound HTTPS requests.
- Added station locator normalization and a wider fallback bounding box so the feed remains usable even when one station is configured or a locator is partially malformed.
- Documented the packaging regression path for signed/distributed builds so future macOS releases validate runtime certificate trust before shipping.

### Why it regressed
A packaged macOS build was still using the app’s runtime trust chain instead of the system CA bundle. That caused HTTPS validation failures against `opensky-network.org` even though the API itself was healthy.

### Release validation
- Verified the OpenSky fetch path creates an explicit SSL context and uses it for `urllib.request.urlopen`.
- Confirmed the signed/distribution bundle metadata and bundle identifier were aligned for the macOS release target.
- Retained a verification note for future release candidates to check outbound HTTPS from the packaged binary before notarization/upload.
