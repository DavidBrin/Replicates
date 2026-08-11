# Replicates

Exploring Agentic Software Development through building established software products from scratch in just a few prompts.

Each folder is a self-contained project with its own README, spec, decision log
and research notes.

---

## [fake-phone](fake-phone) — a staged incoming call, for when you feel unsafe

> **never feel alone**

A personal-safety web app that replicates the iOS and Android phone call screens,
plus a live-stream mode over the real camera. Open it and a call arrives; to
anyone watching, someone knows where you are and is on the way.

| iOS incoming | iOS in-call | Android swipe-to-answer |
|---|---|---|
| <img src="fake-phone/docs/screenshots/ios-incoming.png" width="240" alt="iOS incoming call screen"> | <img src="fake-phone/docs/screenshots/ios-in-call.png" width="240" alt="iOS in-call screen with mute engaged"> | <img src="fake-phone/docs/screenshots/android-incoming.png" width="240" alt="Android swipe-to-answer screen"> |

| Home / settings | Live-stream mode | Delayed ring |
|---|---|---|
| <img src="fake-phone/docs/screenshots/home.png" width="240" alt="Home and settings screen"> | <img src="fake-phone/docs/screenshots/live-streaming.png" width="240" alt="Live stream mode with viewer count and comments"> | <img src="fake-phone/docs/screenshots/ring-countdown.png" width="240" alt="Ring delay countdown"> |

Next.js · three voice tiers (silent / scripted / AI-ready) · installable PWA ·
363 unit tests · 89 e2e across mobile Safari, mobile Chrome and desktop.
Built from six parallel research lanes, then six parallel build slices.

**[Read the README →](fake-phone/README.md)** ·
[Spec](fake-phone/SPEC.md) · [Decisions](fake-phone/DECISIONS.md) · [Research](fake-phone/research)

---

## [bet](bet) — a private, friend-first prediction market

Play-money prediction markets for small groups, priced with Hanson's LMSR rather
than an order book, because a central limit order book with six participants is
an empty book.

**[Read the README →](bet/README.md)** ·
[Spec](bet/SPEC.md) · [Decisions](bet/DECISIONS.md) · [Research](bet/research)
