# Web Platform Constraints — iOS Safari / PWA / App Store

Research date: 2026-08-10. Scope: iOS 18 and iOS/Safari 26 (the 2026 unified version numbering — Safari 26 shipped alongside iOS 26 in fall 2025/2026), Next.js 16 App Router on Vercel. Every section has a **VERDICT**, the practical workaround, and sources.

---

## 1. Audio autoplay

**VERDICT: Works with caveats — but the caveats are severe for a "scheduled ringtone" use case.**

- Both `<audio>`/`<video>` elements and the Web Audio API (`AudioContext`) require a user gesture before they can produce sound on iOS Safari. For Web Audio specifically, `AudioContext` is created in a `suspended` state and must be unlocked by calling `resume()` (or by creating/playing a buffer) **synchronously inside** a trusted user-input event handler (`touchend`, `click`, `keydown`). ([MDN Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay), [Matt Montag — Unlock Web Audio](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos))
- What counts as a gesture: a real, trusted `touchstart`/`touchend`/`mouseup`/`keydown` — not a synthetic/dispatched event, not a promise callback, not code running after an `await`. WebKit calls this **"transient activation"** — a short-lived flag set on the document after user input. It is **not observable or measurable from JS** and WebKit deliberately does not expose its duration; the WebKit team describes it only as "a short time (a few seconds, maybe)" and reserves the right to change it. ([WebKit — The User Activation API](https://webkit.org/blog/13862/the-user-activation-api/))
- **This directly threatens the "schedule a fake call for 30s later" use case.** If you call `audioCtx.resume()` or `audio.play()` from inside a `setTimeout` callback fired 30 seconds after the tap, that callback runs **outside** transient activation and the browser will reject it (`NotAllowedError`) exactly as if no gesture had ever happened. Every report confirms `setTimeout`-deferred playback breaks on iOS Safari even though it works on desktop/Android. ([howler.js #958](https://github.com/goldfire/howler.js/issues/958), [react-player #618](https://github.com/CookPete/react-player/issues/618))
- **The correct pattern**: unlock the `AudioContext` (and/or play a silent, looping `<audio>` element) *at the moment of the tap that schedules the call*, and **keep that context/element alive and running (even silently) continuously** until the scheduled time — do not try to re-acquire permission later. A context that was resumed once and kept running does not need a fresh gesture to make noise later, because it's the same already-unlocked audio graph, not a new playback request.
  - Standard unlock pattern: on the qualifying tap, create/resume the `AudioContext`, then immediately play a ~1-frame silent buffer (or a silent/looping `<audio>` element) to fully "kick" the audio session into an active state.
  - Caveat found in current bug reports: on iOS 18.5 some developers report the `AudioContext` **re-locks after ~5 seconds** of the tab being backgrounded even after a successful unlock, which compounds problem #2 below. ([WebKit bug 237322 discussion / community reports](https://bugs.webkit.org/show_bug.cgi?id=237322))
- **`<audio>` vs Web Audio differ**: HTML5 `<audio>`/`<video>` elements and the Web Audio API are gated by the *same* initial gesture requirement, but they differ in how they interact with the ring/silent switch (see §3) and in how forgiving they are of being started slightly outside the gesture window — `<audio>` elements tend to be marginally more reliable for delayed/looping playback because they can be pre-armed (empty `src`, `loop=true`, started on gesture) rather than needing a fresh `AudioContext` node graph each time.
- **Locked screen / backgrounded tab**: See §2 — a plain Safari tab (and, largely, a standalone PWA) has its audio **suspended** the moment the screen locks or the app is backgrounded. Web Audio and WebRTC are explicitly suspended on background/lock. ([Apple Developer Forums — Safari background WebRTC audio](https://developer.apple.com/forums/thread/774239))
- **Workaround for the real product**: Do not rely on a foreground `setTimeout` to fire the ringtone. Use client-side scheduling **only** for the case where the user keeps the app open/foregrounded (acceptable for a "keep this tab open, I'm about to be rescued" flow), and use **Web Push → service worker `showNotification()`** as the actual background/lock-screen delivery mechanism (§2). Have the notification tap re-launch the PWA to a state that immediately (within the resulting gesture) plays the actual ringtone audio/video and shows the full-screen "incoming call" UI — the notification itself cannot play your custom ringtone sound (see §2 for the sound-customization limit).
- MediaSession API (`navigator.mediaSession`) helps with lock-screen *metadata and transport controls* for already-playing audio, not with waking audio from a suspended/backgrounded state. ([dbushell — iOS Web Apps and Media Session API](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/))

Sources:
- [MDN — Autoplay guide for media and Web Audio APIs](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay)
- [Matt Montag — Unlock JavaScript Web Audio in Safari and Chrome](https://www.mattmontag.com/web/unlock-web-audio-in-safari-for-ios-and-macos)
- [WebKit — The User Activation API](https://webkit.org/blog/13862/the-user-activation-api/)
- [howler.js — iOS Safari audio inside of setTimeout() #958](https://github.com/goldfire/howler.js/issues/958)
- [react-player — Playing in iOS/Safari with user interaction not working after server request #618](https://github.com/CookPete/react-player/issues/618)
- [WebKit bug 237322 — webaudio api is muted when the iOS ringer is muted](https://bugs.webkit.org/show_bug.cgi?id=237322)
- [Apple Developer Forums — Safari Should Allow Background WebRTC for Real-Time Audio Apps](https://developer.apple.com/forums/thread/774239)
- [dbushell — iOS Web Apps and Media Session API](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/)

---

## 2. Background timers

**VERDICT: Does not work for the "ring while backgrounded/locked" case — must be replaced by Web Push.**

- Safari throttles JS timers aggressively in background tabs, similarly to Chrome/Firefox: a `setInterval` scheduled for e.g. every 10ms may fire as infrequently as once per second (or effectively stop) once backgrounded. `setTimeout` delays are not guaranteed to fire on time, and audio/AudioContext playback is explicitly *suspended*, not just throttled, once the screen locks or the app loses foreground. ([Nolan Lawson — Why do browsers throttle JavaScript timers?](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/), [firt.dev — Understanding JavaScript in the Background](https://firt.dev/understanding-js-background/))
- **Standalone PWA vs. Safari tab**: standalone mode does **not** give you materially better background timer guarantees. It still runs on WebKit's page-lifecycle rules — background/suspended tabs and locked-screen standalone apps both get throttled/suspended JS execution. A standalone PWA does get one thing a tab doesn't: reliable Web Push delivery and `showNotification()` even when the app process itself isn't running at all (see next point).
- **What survives**: essentially nothing reliable for "wake up and make noise" purposes. A running `setTimeout`/`setInterval` may survive briefly if the phone doesn't lock and Safari stays the active app, but the instant the screen locks or the user switches apps, you cannot count on the timer firing on schedule, and you cannot count on audio being audible even if it does fire.
- **Web Push + service worker `showNotification()` is the viable delayed-trigger mechanism, confirmed for iOS 16.4+, with hard requirements**:
  1. The app **must** be installed to the Home Screen (manifest `display: standalone` or `fullscreen`) — Web Push is unavailable to a normal Safari tab. ([WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/))
  2. Permission for notifications must be requested **from direct user interaction** (e.g., a "Subscribe"/"Schedule my call" button tap) — cannot be requested on load.
  3. The service worker **must** call `showNotification()` inside `event.waitUntil()` for every push it receives; if it receives a push and does not display a visible notification, iOS treats that as a "silent push" and **will cancel the push subscription** — there is no silent/background-sync push on iOS. ([MagicBell — PWA Push Notifications on iOS in 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide))
  4. **No custom notification sound**: the Notification API's options object has no standardized `sound` field, and Safari does not support one — the delivered push plays only the **default system notification sound**, not your custom ringtone. To get your actual ringtone audio, the notification is a *trigger* — tapping it launches/foregrounds the PWA, and that tap is itself a fresh user gesture you can use to immediately start real ringtone audio + your full "incoming call" UI. ([Apple Developer Forums — Notification Sound settings for Web Push](https://developer.apple.com/forums/thread/736399))
  5. As of Safari 18.4 (spring 2025), **Declarative Web Push** shipped, letting a push payload declare title/body/icon directly without invoking a service worker JS handler — useful for simple cases but doesn't change the sound limitation above. ([aimtell — State of Declarative Web Push in 2026](https://aimtell.com/blog/state-of-declarative-web-push-2026))
  6. Regional gap: in the **EU**, due to the Digital Markets Act, Apple removed standalone home-screen PWA behavior as of iOS 17.4 in some periods — EU home-screen web apps opened as plain Safari tabs with no push support. This has shifted release over release; treat EU as a degraded/unsupported tier and verify current behavior before shipping (Apple's DMA compliance posture keeps changing). ([Vinova — Navigating Safari/iOS PWA Limitations](https://vinova.sg/navigating-safari-ios-pwa-limitations/))
  7. **The delivery pipeline requires a server**: a real push needs your backend to hold the subscription and fire the payload at T+30s (or whenever scheduled) via APNs (the same backing service as native push, reached through the standard Web Push protocol). There is no "local scheduled notification" API on the open web — that's a native-only capability (see §9).

Sources:
- [Nolan Lawson — Why do browsers throttle JavaScript timers?](https://nolanlawson.com/2025/08/31/why-do-browsers-throttle-javascript-timers/)
- [firt.dev — Understanding JavaScript in the Background](https://firt.dev/understanding-js-background/)
- [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [MagicBell — PWA Push Notifications on iOS in 2026: What Really Works](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Apple Developer Forums — Notification Sound settings for Web Push](https://developer.apple.com/forums/thread/736399)
- [aimtell — The State of Declarative Web Push in 2026](https://aimtell.com/blog/state-of-declarative-web-push-2026)
- [Vinova — Navigating Safari/iOS PWA Limitations and Bugs](https://vinova.sg/navigating-safari-ios-pwa-limitations/)

---

## 3. Silent switch / mute switch

**VERDICT: Works with caveats — `<audio>` ignores the silent switch by default in some configurations, Web Audio does not, and this is the single most important correctness bug for a "fake call" product.**

- Confirmed behavior: **`<audio>`/`<video>` elements are allowed to play through the hardware silent (ringer) switch**, while **raw Web Audio API output is muted when the ringer switch is set to silent/vibrate**. This is a real, documented WebKit quirk, not folklore. ([WebKit bug 237322](https://bugs.webkit.org/show_bug.cgi?id=237322), [Joodi — Why iPhone Silent Mode Breaks Web Audio](https://joodi.medium.com/why-i-os-silent-mode-breaks-audio-in-web-apps-aedcbeef7bca))
- Root cause per a WebKit engineer: the audio session's playback "type" is initially **`ambient`** in Safari, and `ambient` category audio respects the hardware mute switch — this affects Web Audio specifically because it doesn't automatically get promoted to a `playback`-category session the way a plain `<audio>` element implicitly does. ([Adactio — Web Audio API update on iOS](https://adactio.com/journal/19929))
- **The well-known workaround ("unmute" hack)**: play a very short/near-silent MP3 through a real `<audio>` element (looped or triggered) at the same time as, or just before, your Web Audio graph starts. This appears to coax WebKit into promoting the whole page's audio session out of `ambient` into a category that ignores the silent switch. This is exactly what libraries like `feross/unmute-ios-audio` and `swevans/unmute` implement, and it's corroborated by multiple independent sources. ([feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio), [swevans/unmute](https://github.com/swevans/unmute), [Audjust — Unmute Web Audio Playback on iOS](https://www.audjust.com/blog/unmute-web-audio-on-ios))
- **Emerging standard**: the new **`AudioSession` API** (W3C Editor's Draft, as of Nov 2025) lets you explicitly set `navigator.audioSession.type = "playback"` (or `"play-and-record"`, etc.) to declare that your audio should ignore the silent switch and play in the background, without needing the silent-mp3 hack. As of this research, **Safari is the only engine that has implemented it** — good news since this is an iOS-first product, but it's new enough that you should feature-detect and keep the `<audio>`-based fallback for older iOS versions. ([nattog.dev — Avoiding unmuting iOS devices for the Web Audio API](https://nattog.dev/blog/web-audio-ios-unmute))
- **Practical recommendation for this app**: play the ringtone through a real `<audio>` element (or a Web Audio graph immediately preceded by a same-tick silent `<audio>` "kick" / an explicit `navigator.audioSession.type = "playback"` set), and treat "does it actually ring through silent mode" as a must-test-on-device item — this is not reliably verifiable in simulators and regressed/changed across iOS point releases per the bug tracker history.

Sources:
- [WebKit bug 237322 — webaudio api is muted when the iOS ringer is muted](https://bugs.webkit.org/show_bug.cgi?id=237322)
- [Joodi — Why iPhone Silent Mode Breaks Web Audio](https://joodi.medium.com/why-i-os-silent-mode-breaks-audio-in-web-apps-aedcbeef7bca)
- [Adactio (Jeremy Keith) — Web Audio API update on iOS](https://adactio.com/journal/19929)
- [GitHub — feross/unmute-ios-audio](https://github.com/feross/unmute-ios-audio)
- [GitHub — swevans/unmute](https://github.com/swevans/unmute)
- [Audjust — Unmute Web Audio Playback on iOS When Ringer is Muted](https://www.audjust.com/blog/unmute-web-audio-on-ios)
- [nattog.dev — Avoiding unmuting iOS devices for the Web Audio API](https://nattog.dev/blog/web-audio-ios-unmute)

---

## 4. Vibration

**VERDICT: Does not work reliably on the open web — plan for no vibration in the PWA, and a real Haptics API only in a native wrapper.**

- `navigator.vibrate()` (the Vibration API) has **never been implemented by Safari on iOS**, and this remains the documented/official state going into 2026 per MDN/caniuse browser-compat-data. There is one unverified, unconfirmed community report (March 2026) claiming it "works now" in some Safari build, with no official WebKit changelog entry backing it up — treat as a rumor, not a shippable assumption. ([MDN browser-compat-data issue #29166](https://github.com/mdn/browser-compat-data/issues/29166), [caniuse — Navigator.vibrate](https://caniuse.com/mdn-api_navigator_vibrate))
- **Workarounds on the open web (none give real haptic "thump")**:
  - Visual/audio substitutes: strong screen flash, screen shake animation (`transform` jitter), and the ringtone/audio itself carrying the "buzzing" cue.
  - `vibrator.dev`'s "unofficial iOS vibration API" and similar polyfills rely on undocumented, fragile tricks (e.g., abusing `<input type="checkbox">` switch controls, or exploiting long-press feedback on specific form elements) that Apple has closed off before and can close off again — do not depend on these for a shipped product. ([vibrator.dev](https://vibrator.dev/))
  - iOS's own system-level vibration (e.g., the classic "silent-switch triggers a very short buzz on real phone calls") is not scriptable from the web at all.
- **What a native wrapper gives you**: Capacitor's official `@capacitor/haptics` plugin exposes `impact()`, `notification()`, `selection()`, and (on newer iOS with a Taptic Engine) custom Core Haptics patterns — real haptic feedback, indistinguishable from a native app's. On the web layer (i.e., before wrapping), the same Capacitor plugin falls back to `navigator.vibrate()` — which, per above, does nothing on iOS Safari, so **Capacitor's haptics only start working for real once you ship the native-wrapped build**, not in the PWA. ([Capacitor Haptics API docs](https://capacitorjs.com/docs/apis/haptics), [Capawesome — Capacitor Haptics Plugin](https://capawesome.io/docs/sdks/capacitor/haptics/))
- **Recommendation**: don't build the "feels like a real incoming call" promise around vibration in the web/PWA tier. Sell that specific feeling only in the wrapped-app tier once Capacitor Haptics is available, and message this honestly in the product roadmap.

Sources:
- [GitHub mdn/browser-compat-data — navigator.vibrate works on iOS Safari? #29166](https://github.com/mdn/browser-compat-data/issues/29166)
- [caniuse — Navigator API: vibrate](https://caniuse.com/mdn-api_navigator_vibrate)
- [vibrator.dev — the unofficial iOS vibration API](https://vibrator.dev/)
- [Capacitor Documentation — Haptics API](https://capacitorjs.com/docs/apis/haptics)
- [Capawesome — Capacitor Haptics Plugin for Android, iOS & Web](https://capawesome.io/docs/sdks/capacitor/haptics/)

---

## 5. getUserMedia / camera

**VERDICT: Works with caveats — camera access in a standalone (home-screen) PWA has a history of being outright broken on specific iOS versions; test against the current OS before relying on it.**

- Basic permission model: `getUserMedia({ video: { facingMode: 'user' } })` triggers the standard Safari camera-permission prompt the first time, same as any web API — no manifest entitlement needed for a plain browser tab.
- **Standalone/home-screen PWA history of breakage**:
  - Long-running bug: `getUserMedia` inside a standalone (`display: standalone`/`fullscreen`) home-screen web app has repeatedly failed to even prompt for permission — the browser silently behaves as if no camera exists. ([STRICH Knowledge Base — Camera Access Issues in iOS PWA](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa))
  - The granted permission is **not reliably persisted** across launches for a standalone PWA the way it is for a normal Safari tab — users have reported repeated re-prompting. ([Apple Developer Forums — Repeated Camera Permission Prompts in Web App on Safari (iOS)](https://developer.apple.com/forums/thread/788518))
  - Concretely regressed again in **iOS 18** for at least one reporter (worked on iOS 17, broke on iOS 18), and was reported fixed again in **iOS 18.1.1**. This pattern — regress-then-patch across point releases — has recurred multiple times historically, so **do not treat camera-in-standalone-PWA as a stable guarantee; verify on the specific iOS version you're targeting at ship time.** ([Apple Developer Forums — iOS 18.1 breaking camera in PWA](https://developer.apple.com/forums/thread/769203))
  - Documented workaround some teams use: drop the `apple-mobile-web-app-capable`/standalone behavior specifically for camera-using flows (i.e., let that flow open in a regular Safari tab context rather than the standalone shell), trading chrome-less UI for reliable camera access.
- **`facingMode: 'user'`**: supported as a constraint hint (not a hard guarantee) — Safari will pick the best-matching camera but may fall back silently if the exact facing mode isn't available (e.g., some external cameras). No iOS-specific gotcha beyond the general standalone-PWA issue above.
- **Autoplay of the preview `<video>` element**: requires both `playsinline` and `muted` attributes (plus ideally `autoplay`) or Safari will refuse to play the stream inline and/or will kick it to fullscreen/native player chrome. This has been the rule since iOS 10 and is unchanged. ([HulkApps — Fix HTML5 Video Autoplay Issues in Safari/iOS](https://www.hulkapps.com/blogs/ecommerce-hub/how-to-fix-html5-video-autoplay-issues-in-safari-and-ios-devices))
- **Orientation change**: the live `MediaStreamTrack` does not automatically re-negotiate resolution/orientation metadata on device rotation the way a native `AVCaptureSession` would; you generally need to read `screen.orientation`/`resize`/`orientationchange` events yourself and adjust your CSS/canvas transform, since the underlying stream's `videoWidth`/`videoHeight` stay fixed to the sensor's native orientation.

Sources:
- [STRICH Knowledge Base — Camera Access Issues in iOS PWA/Home Screen Apps](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa)
- [Apple Developer Forums — Repeated Camera Permission Prompts in Web App on Safari (iOS)](https://developer.apple.com/forums/thread/788518)
- [Apple Developer Forums — iOS 18.1 breaking camera in PWA](https://developer.apple.com/forums/thread/769203)
- [HulkApps — How to Fix HTML5 Video Autoplay Issues in Safari and iOS Devices](https://www.hulkapps.com/blogs/ecommerce-hub/how-to-fix-html5-video-autoplay-issues-in-safari-and-ios-devices)

---

## 6. Wake Lock API

**VERDICT: Works with caveats — supported since Safari 16.4, but was broken specifically inside installed PWAs until iOS 18.4.**

- `navigator.wakeLock.request('screen')` is supported in Safari from iOS/iPadOS 16.4 onward in a plain browser tab context. ([LambdaTest — Screen Wake Lock API Browser Compatibility on Safari](https://www.lambdatest.com/web-technologies/wake-lock-safari), [web.dev — Screen Wake Lock supported in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers))
- **Standalone/installed-PWA regression**: a long-standing bug prevented Wake Lock from actually working inside home-screen-installed PWAs even though the API was present and didn't throw — Apple fixed this specifically in **iOS 18.4**. If you need to support iOS versions before 18.4 in standalone mode, do not assume the wake lock is actually holding. ([caniuse — Screen Wake Lock API](https://caniuse.com/wake-lock), corroborated across [testmuai — Wake Lock API Browser Support](https://www.testmuai.com/learning-hub/wake-lock-api-browser-support/))
- Requirements/limits: only a **visible, active** document can acquire or hold the lock (it's released automatically on backgrounding/tab-hide — expected and by design, not a bug); it can also be denied by system-level power-saving/low-battery state.
- **Fallback for older iOS / belt-and-suspenders**: the classic "invisible looping silent video" trick (play a tiny muted/looping `<video>`) is still commonly used as a Wake-Lock-API fallback on iOS, since a genuinely playing video has historically kept the screen from auto-dimming as a side effect. Treat this as a legacy fallback, not the primary mechanism, now that the real API works from 18.4 on. ([w3tutorials — Prevent iOS Mobile Safari from Auto-Locking/Sleeping](https://www.w3tutorials.net/blog/prevent-ios-mobile-safari-from-going-idle-auto-locking-sleeping/))

Sources:
- [LambdaTest — Screen Wake Lock API Browser Compatibility On Safari](https://www.lambdatest.com/web-technologies/wake-lock-safari)
- [web.dev — The Screen Wake Lock API is now supported in all browsers](https://web.dev/blog/screen-wake-lock-supported-in-all-browsers)
- [caniuse — Screen Wake Lock API](https://caniuse.com/wake-lock)
- [testmuai — Wake Lock API: Browser Support, Features, Use Cases](https://www.testmuai.com/learning-hub/wake-lock-api-browser-support/)
- [w3tutorials — How to Prevent iOS Mobile Safari from Auto-Locking/Sleeping](https://www.w3tutorials.net/blog/prevent-ios-mobile-safari-from-going-idle-auto-locking-sleeping/)

---

## 7. Fullscreen / standalone chrome

**VERDICT: Works with caveats — needs the full legacy `apple-mobile-web-app-*` meta tag set alongside the manifest, and several persistent CSS gotchas.**

- **Manifest + meta tags, both required** (the manifest alone is not enough on iOS — this differs from Android/Chrome):
  ```html
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="YourAppName" />
  <meta name="mobile-web-app-capable" content="yes" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  ```
  and in `manifest.webmanifest`: `"display": "standalone"` (or `"fullscreen"` — on iOS both suppress Safari chrome; `standalone` is the more conventional/recommended choice; `minimal-ui` is not honored by iOS and falls back to `browser`). `apple-mobile-web-app-status-bar-style` only has an effect once `apple-mobile-web-app-capable` is set. ([Apple — Supported Meta Tags](https://developer.apple.com/library/iad/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html))
  - **iOS 26 change**: every site added to the Home Screen now defaults to opening as a "web app" (standalone-like chrome) even with **no manifest at all** — worth knowing, but don't rely on it as your only mechanism; keep the explicit manifest + meta tags for iOS 18 and any pre-26 devices you still support. ([WebKit — News from WWDC25 / Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/))
- **Safe-area insets**: only active once `viewport-fit=cover` is present in the viewport meta tag; then `env(safe-area-inset-top|right|bottom|left)` becomes usable in CSS to avoid the notch/Dynamic Island and home-indicator bar:
  ```css
  body {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  ```
- **The `100vh` bug and its fix**: `100vh` on iOS Safari is computed against the *largest possible* viewport (as if the URL bar/toolbar were fully collapsed), which is taller than what's actually visible when the page first loads with the toolbar showing — causing content to be cut off behind the browser chrome. The modern fix is the **dynamic viewport units**, supported in Safari 15.4+: use `100svh` (small viewport — safest default, matches what's visible with toolbars showing) for stable full-height layouts, and `100dvh` (dynamic — resizes live as the toolbar shows/hides) only where you deliberately want reflow as the chrome animates. ([bram.us — The Large, Small, and Dynamic Viewports](https://www.bram.us/2021/07/08/the-large-small-and-dynamic-viewports/), [modern-css.com — CSS dvh, svh, lvh](https://modern-css.com/mobile-viewport-height-without-100vh-hack/))
  ```css
  .full-screen { height: 100svh; } /* stable */
  .call-screen { height: 100dvh; } /* okay to reflow with chrome */
  ```
  Note: this is moot in `display: standalone` mode itself, since there's no Safari chrome to collapse/expand — but it matters for any flow that still runs in a plain Safari tab (e.g., first-run onboarding before "Add to Home Screen").
- **Hiding the Safari URL bar** in a plain (non-standalone) tab: no fully reliable, sanctioned technique exists; the old `window.scrollTo(0,1)` trick is unreliable on modern iOS. The real fix is getting the user into standalone mode (home-screen install), where there is no URL bar at all.
- **Disabling pull-to-refresh / overscroll bounce**:
  ```css
  html, body { overscroll-behavior: none; } /* must be set on BOTH html and body for Safari */
  ```
  (Chrome only needs it on `body`; Safari specifically needs it on `html` too.) ([Manuel Matuzovic — Day 53: disabling pull-to-refresh](https://www.matuzo.at/blog/2022/100daysof-day53), [usefulangle — Disable Pull-to-Refresh with CSS](https://usefulangle.com/post/278/html-disable-pull-to-refresh-with-css))
- **Disabling text selection / long-press callout / double-tap zoom**:
  ```css
  * {
    -webkit-touch-callout: none;   /* disables the long-press "Copy/Share" menu */
    -webkit-user-select: none;     /* disables text selection */
    user-select: none;
  }
  ```
  ```html
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  ```
  `user-scalable=no` (or `maximum-scale=1`) disables double-tap-to-zoom and pinch-zoom; combine with `touch-action: manipulation` on interactive elements to remove the ~300ms tap delay and stray zoom gestures on buttons specifically, without blanket-disabling zoom on content you do want zoomable (accessibility trade-off to weigh — Apple's own HIG discourages fully disabling zoom for accessibility reasons, so scope `user-select`/callout suppression to chrome/UI elements rather than all body text where feasible).

Sources:
- [Apple — Supported Meta Tags (Safari HTML Reference)](https://developer.apple.com/library/iad/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)
- [WebKit — News from WWDC25: WebKit in Safari 26 beta](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/)
- [bram.us — The Large, Small, and Dynamic Viewports](https://www.bram.us/2021/07/08/the-large-small-and-dynamic-viewports/)
- [modern-css.com — CSS dvh, svh, lvh: Mobile Viewport Height Fix](https://modern-css.com/mobile-viewport-height-without-100vh-hack/)
- [Manuel Matuzovic — Day 53: disabling pull-to-refresh](https://www.matuzo.at/blog/2022/100daysof-day53)
- [usefulangle — Disable Pull-to-Refresh on Mobile Browsers using CSS](https://usefulangle.com/post/278/html-disable-pull-to-refresh-with-css)

---

## 8. Web Speech API `speechSynthesis`

**VERDICT: Does not work well enough — use pre-rendered audio files for the caller's voice, not live TTS.**

- **Gesture requirement**: like audio playback generally, the first `speechSynthesis.speak()` call needs to happen inside/soon-after a user gesture, or it silently fails to produce sound — same transient-activation constraint as §1.
- **Empty voices list bug**: `speechSynthesis.getVoices()` frequently returns an **empty array** on first call in Safari; voices only become available after the async `voiceschanged` event fires, and you must gate any voice-selection UI/logic behind that event rather than assuming voices are present at page load. ([MDN — SpeechSynthesis: voiceschanged event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event), [manu.ninja — Using the Speech Synthesis Interface](https://manu.ninja/using-the-speech-synthesis-interface-of-the-web-speech-api/))
- **Backgrounding kills it mid-utterance**: if Safari is backgrounded (screen locked, app-switched) while `speechSynthesis` is actively speaking, playback **stops and does not resume** when foregrounded — the synthesizer gets stuck and typically requires a full page reload/Safari restart to recover. This is a known, reported, unresolved-as-of-research bug. ([talkrapp — Lessons Learned Using the javascript speechSynthesis API](https://talkrapp.com/speechSynthesis.html))
- **Voice quality/availability**: iOS's built-in web TTS voices are the same system voices as VoiceOver — functional but robotic-sounding relative to modern app-native TTS (e.g., on-device neural voices used by first-party Apple apps aren't necessarily exposed to the web API), and voice *availability* varies by installed language packs on the device, which you cannot control or guarantee.
- **Recommendation: ship pre-rendered audio files, not live `speechSynthesis`, for the "fake caller" voice.** Reasons: (1) it sidesteps the empty-voices-list and background-cutoff bugs entirely, since it's just `<audio>` playback (still subject to §1/§3's gesture and silent-switch handling, but at least deterministic); (2) it gives you full control over voice quality/character/consistency, which matters a lot for a product where the *believability* of the caller's voice is the point; (3) it lets you pre-generate variety (multiple "callers", multiple lines) offline via any TTS provider (or real voice actors) at build time and ship them as static assets cached by the service worker for true offline playback — something live `speechSynthesis` can never guarantee. Reserve `speechSynthesis` at most for a cheap MVP/prototype path, not the shipped experience.

Sources:
- [MDN — SpeechSynthesis: voiceschanged event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event)
- [manu.ninja — Using the Speech Synthesis Interface of the Web Speech API](https://manu.ninja/using-the-speech-synthesis-interface-of-the-web-speech-api/)
- [talkrapp — Lessons Learned Using the javascript speechSynthesis API](https://talkrapp.com/speechSynthesis.html)
- [weboutloud.io — The State of Speech Synthesis in Safari](https://weboutloud.io/bulletin/speech_synthesis_in_safari/)

---

## 9. App Store path

**VERDICT: Works with caveats — Capacitor is the right call, but shipping the PWA screens verbatim in a WebView will get rejected under 4.2; and the "fake call" concept itself is fine on the App Store only if framed and scoped as a self-directed safety tool, never anonymous calling/texting of others.**

### (a) Capacitor vs (b) plain WKWebView vs (c) React Native rewrite

- **Capacitor** wraps your existing Next.js web app in a native WKWebView shell but gives first-class, officially maintained plugin bridges to native APIs (Haptics, Local Notifications, Push, Camera, Filesystem, etc.) called directly from your existing JS/React code — no rewrite. This is the standard "web app → App Store" path used at scale (Ionic's own tooling). ([nextnative.dev — Capacitor vs React Native](https://nextnative.dev/comparisons/capacitor-vs-react-native))
- **Plain/bespoke WKWebView wrapper** (no Capacitor) gives you the same rendering layer but you'd have to hand-roll every native bridge (haptics, notifications, etc.) yourself via `WKScriptMessageHandler` — strictly more work than Capacitor for equivalent capability, with no offsetting benefit for this project. Not recommended.
- **React Native rewrite** renders to genuine native views (`UIView`/`UILabel`, not a WebView) — best possible native feel and performance, and clearly satisfies 4.2 on its own merits since it's inherently not "a repackaged website." Cost: a full second codebase/UI implementation, forfeiting "write once, ship as PWA and app" from the same Next.js code. Given this project's requirement to *also* be a first-class installable PWA on Vercel, a full RN rewrite means maintaining two UIs long-term — not recommended unless the team is prepared for that duplication.
- **Recommendation: Capacitor**, wrapping the same Next.js/React codebase that powers the PWA. This is the only option of the three that keeps "one codebase, both PWA and App Store app" true. ([nextnative.dev — Capacitor complete guide](https://pkglog.com/en/blog/capacitor-hybrid-app-guide/))

### Guideline 4.2 (Minimum Functionality)

- Apple's stated bar: *"Your app should include features, content, and UI that elevate it beyond a repackaged website. If your app is not particularly useful, unique, or 'app-like,' it doesn't belong on the App Store."* Apps that are just a WebView pointed at a marketing/content site — "web clippings" in Apple's own review-team language — are routinely rejected with feedback like "not sufficiently different from a mobile web browsing experience." ([technetexperts — App Store Guideline 4.2 Minimum Functionality](https://www.technetexperts.com/guideline-4-2-minimum-functionality/), [mobiloud — App Store Review Guidelines: Will Your Webview App Be Rejected?](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper))
- What passes review in practice: native chrome around the web content (native tab bar/navigation rather than in-page nav), native push notification handling, native offline handling, and — critically for this app — genuinely native capabilities that a mobile *website* cannot offer at all (haptics, local notifications with custom sound, background/lock-screen delivery, contacts integration).
- **Concrete native capabilities to add via Capacitor plugins, and to list explicitly in the README roadmap, to clear 4.2:**
  - `@capacitor/haptics` — real Taptic Engine feedback (the entire vibration gap in §4 disappears).
  - `@capacitor/local-notifications` — **schedule a real local notification with a custom ringtone sound**, fired by the OS even if the app is fully killed, with zero backend/Web-Push server needed and no 30-second-timer fragility from §1/§2. This is the single biggest capability upgrade the native wrapper buys — it turns "unreliable web scheduling" into a first-class, offline-capable, rock-solid scheduled call.
  - `@capacitor/push-notifications` — real APNs push (already required for iOS 16.4+ web push, but native gets richer payloads: custom sound files, badge, actionable buttons).
  - Background audio session configured natively (via a small native `Info.plist`/`AVAudioSession` config beyond what Capacitor exposes by default) to guarantee ringtone playback even from a locked/backgrounded state — solves §1/§2's core weakness outright.
  - `@capacitor/filesystem` + a service-worker-populated cache (or Capacitor's own asset bundling) for full offline operation — audio files, avatars, and app shell all available with zero network.
  - Optionally `@capacitor/contacts` (community plugin) if the product wants to let users pick a "caller name/photo" from their real contacts for realism — a capability plain mobile web cannot offer without severe limitation.

### Prank / fake-call app policy risk — and the safety framing that clears it

- Apple explicitly rejects apps that enable **anonymous or prank calling/texting of other people** — i.e., apps that let User A place a disguised/spoofed call *to* User B, or that misrepresent caller ID to a third party. Labeling such an app "for entertainment" does not exempt it. ([search results — App Store rejection reasons re: prank calling/anonymous messaging](https://developer.apple.com/forums/thread/662818))
- **This app's concept — a self-directed fake incoming call used as a personal safety/social-exit tool — is a different, well-established, currently-approved category**, distinct from anonymous-calling apps. Confirmed live examples currently on the App Store: **"Flare: Fake Call & Safety Kit"** (explicitly marketed as a personal safety toolkit — schedule/trigger a fake call, custom caller name/photo/ringtone, optional location sharing to trusted contacts) and **"Fake Call – Introscape"** (marketed for social anxiety / "felt trapped with no polite escape," also with trusted-contact location sharing on trigger). Both are live, approved App Store apps as of this research. ([Flare: Fake Call & Safety Kit — App Store](https://apps.apple.com/us/app/flare-fake-call-safety-kit/id6757112269), [Fake Call - Introscape — App Store](https://apps.apple.com/us/app/fake-call-introscape/id6752501554))
- **The dividing line, concretely**: the call must always be *to yourself* (your own device rings, triggered by you), never a mechanism to call or message someone else while disguising identity. Keep the product framing, App Store description, and any support-request flows anchored to "personal safety / social exit," and avoid any feature that could be read as enabling deception *of another specific person* (e.g., don't build a feature to actually place an outbound disguised call to a third party's phone number — that crosses into the rejected category). Given this, adding a genuine safety-adjacent feature (e.g., optional "notify a trusted contact" on trigger, matching what the approved comparables above do) both strengthens the 4.2 native-value case and reinforces the safety framing that keeps the concept itself compliant.

Sources:
- [nextnative.dev — Capacitor vs React Native: Complete Comparison 2025](https://nextnative.dev/comparisons/capacitor-vs-react-native)
- [pkglog.com — Capacitor complete guide: from web to native hybrid apps](https://pkglog.com/en/blog/capacitor-hybrid-app-guide/)
- [technetexperts — App Store Guideline 4.2 Minimum Functionality [Fixed]](https://www.technetexperts.com/guideline-4-2-minimum-functionality/)
- [mobiloud — App Store Review Guidelines: Will Your Webview App Be Rejected?](https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper)
- [Apple Developer Forums — Our prank calling app got rejected](https://developer.apple.com/forums/thread/662818)
- [Flare: Fake Call & Safety Kit — App Store](https://apps.apple.com/us/app/flare-fake-call-safety-kit/id6757112269)
- [Fake Call - Introscape — App Store](https://apps.apple.com/us/app/fake-call-introscape/id6752501554)
- [Fake Call: CallTimer — App Store](https://apps.apple.com/us/app/fake-call-calltimer/id6766994970)

---

## 10. Vercel specifics (Next.js 16 App Router)

**VERDICT: Works with caveats — Next.js 16's App Router has built-in manifest generation, but service-worker headers need explicit configuration, and dynamic routes can silently override `next.config` headers.**

- **Manifest**: Next.js App Router supports a native `app/manifest.ts` file that exports a `MetadataRoute.Manifest` object (name, short_name, display, icons, start_url, background_color, theme_color, etc.) and Next.js serves it at `/manifest.webmanifest` with the correct `application/manifest+json` content-type automatically — no custom route handler needed for the manifest itself. Reference it from `app/layout.tsx` metadata (`manifest: "/manifest.webmanifest"`) and still keep the classic `apple-mobile-web-app-*` `<meta>` tags from §7, which the manifest doesn't cover on iOS. ([Next.js docs — Guides: PWAs](https://nextjs.org/docs/app/guides/progressive-web-apps))
- **Service worker (`sw.js`)**: must be served from the **origin root** (`/sw.js`) for its scope to cover the whole app — placing it under `/public/sw.js` in Next.js achieves this. Set explicit caching headers so browsers/Vercel's edge CDN don't serve a stale worker after you ship an update:
  ```js
  // next.config.js
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  }
  ```
  `public, max-age=0, must-revalidate` on `sw.js` is the standard recommendation — you want the browser to always check-for-updates on the worker script itself (the update mechanism relies on byte-diffing the file on each check), while your worker's own `fetch`/`cache` logic handles caching of the actual app assets. ([DEV Community — PWA setup guide](https://dev.to/rakibcloud/progressive-web-app-pwa-setup-guide-for-nextjs-15-complete-step-by-step-walkthrough-2b85))
- **Known Vercel gotcha — dynamic routes override `next.config` headers**: when a route is rendered dynamically as a Vercel Function (not statically generated), that function's own response headers **take precedence over** headers declared in `next.config.js`/`.ts` for that route. Since `manifest.webmanifest` and `sw.js` should be static assets anyway, this mainly matters if you're tempted to generate either dynamically (e.g., per-user manifest) — keep them static/served from `public/` or a static route handler to guarantee the `next.config` headers actually apply. ([Vercel docs — Caching on Vercel's Edge Network](https://vercel.com/docs/edge-network/caching), [GitHub vercel/next.js discussion #89439 — Cache-Control headers not set](https://github.com/vercel/next.js/discussions/89439))
- **Auth-protected preview/production gotcha**: if Vercel's deployment protection (or a custom auth middleware) sits in front of the whole app, it can intercept the manifest/sw.js request and return a 401/redirect instead of the file — breaking installability. Explicitly allowlist `/manifest.webmanifest`, `/sw.js`, and `/icons/*` from any auth middleware/deployment-protection rule. ([vercel/next.js discussion #62867 — Manifest file 401 unauthorized](https://github.com/vercel/next.js/discussions/62867))
- **Registering the service worker**: register it from a small client component (`"use client"`) via `navigator.serviceWorker.register("/sw.js")` inside a `useEffect`, guarded by `if ('serviceWorker' in navigator)`.
- **Clean home-screen install**: to get the polished "Add to Home Screen" result (proper icon, no browser chrome flash, correct splash), you need: (1) `apple-touch-icon` link tags at multiple sizes served from static files (iOS does not generate splash screens from the manifest's `icons` array the way Android does — it either auto-generates a basic splash from your `apple-touch-icon`/theme-color or you supply explicit `<link rel="apple-touch-startup-image">` entries per device size for full control); (2) `theme-color` meta tag matching your design so the status bar area doesn't flash a mismatched color on launch; (3) HTTPS (Vercel gives you this by default) — service workers refuse to register over plain HTTP entirely.

Sources:
- [Next.js Documentation — Guides: Progressive Web Apps](https://nextjs.org/docs/app/guides/progressive-web-apps)
- [DEV Community — Progressive Web App (PWA) Setup Guide for Next.js](https://dev.to/rakibcloud/progressive-web-app-pwa-setup-guide-for-nextjs-15-complete-step-by-step-walkthrough-2b85)
- [Vercel Docs — Caching on Vercel's Edge Network](https://vercel.com/docs/edge-network/caching)
- [GitHub vercel/next.js #89439 — Cache-Control headers are not being set in the Vercel deployment](https://github.com/vercel/next.js/discussions/89439)
- [GitHub vercel/next.js #62867 — Manifest file - 401 unauthorized](https://github.com/vercel/next.js/discussions/62867)

---

## Summary table

| # | Constraint | Verdict | Core mitigation |
|---|---|---|---|
| 1 | Audio autoplay | Caveats | Unlock at tap-time, keep context alive continuously; never re-request permission in a deferred `setTimeout` |
| 2 | Background timers | Does not work (for locked/backgrounded ring) | Replace with Web Push (home-screen install required) → tap re-launches app → gesture-triggered real audio |
| 3 | Silent switch | Caveats | `<audio>` element or `navigator.audioSession.type = "playback"`/silent-mp3 kick; raw Web Audio alone is muted by the switch |
| 4 | Vibration | Does not work | No haptics in PWA; real haptics only via Capacitor `@capacitor/haptics` in the wrapped app |
| 5 | getUserMedia/camera | Caveats | Test on target iOS version; standalone-PWA camera access has regressed across point releases |
| 6 | Wake Lock | Caveats | Works from 16.4, but broken in standalone PWAs until 18.4 — silent looping video as legacy fallback |
| 7 | Fullscreen/standalone chrome | Caveats | Manifest + full `apple-mobile-web-app-*` meta set + `100svh`/`100dvh` + safe-area insets |
| 8 | speechSynthesis | Does not work well enough | Ship pre-rendered audio files for the caller voice, not live TTS |
| 9 | App Store path | Caveats | Capacitor wrapping the same Next.js app; add Local/Push Notifications, Haptics, offline, native audio session; keep the "call yourself" framing |
| 10 | Vercel/Next.js 16 | Caveats | Static `sw.js`/manifest with explicit headers; keep them out of auth middleware; verify dynamic-route header override risk |
