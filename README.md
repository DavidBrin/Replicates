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

---

## [dollar-pixels](dollar-pixels) — the Million Dollar Homepage, at $1 for nine pixels

> **$1 buys nine pixels**

A rebuild of the 2005 page that sold a million pixels at a dollar each. This one
sells them in blocks of nine — a 3 × 3 square for a dollar — on a 400 × 400 block
grid, and adds the thing the original could not: you can buy a page of your own.

| The wall | Selecting blocks | Making a page |
|---|---|---|
| <img src="dollar-pixels/docs/screenshots/the-wall.png" width="240" alt="The wall: a 400 by 400 block grid, a quarter sold"> | <img src="dollar-pixels/docs/screenshots/selecting.png" width="240" alt="Dragging a rectangle of blocks with the price shown live"> | <img src="dollar-pixels/docs/screenshots/new-page.png" width="240" alt="Creating an unlisted or premium page"> |

The grid is 1200 × 1200 rather than the original's 1000 × 1000 because 1000 is not
divisible by three — a nine-pixel block cannot sit on that canvas without being
split. Blocks carry a caption and artwork but no link, which is the one part of
the original deliberately not rebuilt: a 2017 study found 547 of its links dead,
and the surviving mirror has quietly rewritten 1,164 more to archive snapshots.

Play money by default, with Stripe one environment variable away — both settle
through the same code, so the switch is not a leap of faith. Unlisted pages cost
$10 and come with 69 free blocks; premium pages cost half the grid's face value
and pay their creator for every block anyone buys on them.

Next.js · canvas renderer with O(1) hit-testing · ports for storage and payment ·
365 unit and property tests · 30 e2e across desktop and mobile.
Built from five parallel research lanes, then five parallel build slices.

**[Read the README →](dollar-pixels/README.md)** ·
[Spec](dollar-pixels/SPEC.md) · [Decisions](dollar-pixels/DECISIONS.md) · [Research](dollar-pixels/research)
