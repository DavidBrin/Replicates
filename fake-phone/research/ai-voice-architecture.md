# AI Voice "Caller" Architecture — Design Doc

Status: design-only, no key configured. Everything below must be buildable and wired end-to-end today, and must degrade to a fully working zero-cost mode (`ScriptedProvider`) until a provider key is supplied.

Last researched: 2026-08-10.

---

## 0. TL;DR — the recommendation

- **Default architecture**: a provider-agnostic `CallVoiceProvider` interface (§3) with three implementations — `ScriptedProvider` (no network, canned dialogue, always available), `TtsProvider` (Claude for dialogue text + a TTS vendor for audio), `RealtimeAiProvider` (true speech-to-speech, e.g. OpenAI Realtime or ElevenLabs Conversational AI).
- **House-model-first**: because the parent project's model is Claude, `TtsProvider` (Claude + ElevenLabs Flash, or Claude + Deepgram Aura) is the recommended *first* paid tier to light up — it's the natural next step from "no key" and keeps the LLM on Claude. `RealtimeAiProvider` (OpenAI Realtime, or ElevenLabs Conversational AI) is the recommended upgrade when latency/naturalness matters more than staying on Claude — see §1 for the honest tradeoff.
- **Security**: the real API key never leaves the server. For `RealtimeAiProvider` (OpenAI/ElevenLabs), the Next.js route only mints a short-lived ephemeral token; the browser then connects **directly** to the provider (WebRTC), so your server never touches audio. For `TtsProvider`, your server unavoidably proxies both the Claude text stream and the TTS audio stream, because Claude and most TTS vendors have no browser-safe ephemeral-token/WebRTC path.
- **Vercel**: Hobby tier now supports **native WebSocket connections in Functions** (public beta, June 2026) and functions run up to **300s** (5 min) on Hobby. A fake call capped at ~5 minutes (see §6) fits inside a single Hobby function invocation even for the `TtsProvider` proxy path.
- **Graceful degradation**: a single factory (`createVoiceProvider(env)`) inspects env vars at request time and returns whichever provider has its required keys, falling back to `ScriptedProvider` — the UI layer never knows or cares which one it got.

---

## 1. Provider comparison

| Provider | Type | Model / endpoint (2026) | Price | Time-to-first-audio | Browser integration | Abstraction difficulty |
|---|---|---|---|---|---|---|
| **OpenAI Realtime API** | speech-to-speech | `gpt-realtime` (stable alias) / `gpt-realtime-2.1`; mini variant `gpt-realtime-2.1-mini` | Audio: $32/1M in, $64/1M out tokens (full); mini $10 in/$20 out. Real-world reports (third-party, not OpenAI-published) ≈ $0.05–$0.46/min depending on caching | ~200–600ms reported (mixed primary/third-party sources — see §Sources) | Native `RTCPeerConnection` (WebRTC), **direct browser-to-OpenAI**, no SDK required | Low-medium — one interface method (`start`), but the wire protocol (WebRTC SDP + data-channel events) is unlike every other provider, so it needs its own adapter |
| **ElevenLabs Conversational AI (Agents Platform)** | speech-to-speech-like (orchestrated ASR→LLM→TTS+turn-taking, not a single S2S model) | proprietary; BYO LLM optional | Bundled minutes per plan; overage ≈ $0.08/min (third-party-estimated); Business tier ≈ $0.05/min TTS | Not officially published; low (their own turn-taking model exists specifically to minimize it) | Official React SDK + native iOS/Android SDKs; connects directly, signed/ephemeral URL minted server-side | Low — comes with a client SDK, but it's the least Claude-native option (own LLM orchestration, though you can plug in your own LLM) |
| **Claude (text) + TTS + STT** — the "house model" pipeline | assembled pipeline | Claude Sonnet 5 / Opus 5 (text) + ElevenLabs Flash v2.5 / Deepgram Aura-2 (TTS) + Deepgram Nova-3 / Web Speech API (STT, only if the user's voice must be heard by the AI — a one-sided fake call may not need STT at all) | Claude: $2–5/1M in, $10–25/1M out tokens (see `claude-api` pricing table). ElevenLabs Flash ≈ $0.05–0.10/1K chars. Deepgram Aura-2 $0.030/1K chars; Nova-3 streaming STT $0.0042–0.0058/min | TTS-model latency alone: ElevenLabs Flash ~75ms *model* latency (network + Claude's own TTFT add more); Deepgram Aura not officially published. **Total pipeline TTFA is materially worse than S2S** because it's serial: Claude TTFT → first sentence complete → TTS request → first audio byte | You must proxy both legs — no direct-to-browser path for either Claude or most TTS vendors | Highest — you own turn-taking, sentence-boundary chunking for TTS, and (if used) STT-to-Claude wiring yourself |
| **Browser-native `speechSynthesis`** | zero-cost fallback | Web Speech API, OS/browser built-in voices | $0 | Effectively instant (no network round-trip) | `window.speechSynthesis` — supported Chrome 33+/Edge 14+/Firefox 49+/Safari 7+; voice quality/selection varies a lot by OS | Trivial — but voices sound synthetic/dated and there is no natural conversational cadence; this is the `ScriptedProvider`'s audio backend |

**Honest recommendation on Claude+TTS vs. speech-to-speech**: a true S2S API (OpenAI Realtime, or ElevenLabs Conversational AI) is the better fit *specifically for this use case* — a believable one-sided phone call needs low, consistent turn latency and natural prosody (interruptable "uh-huh", overlapping breath sounds, mid-sentence pace changes), which a serial Claude→TTS pipeline cannot match no matter how well-chunked. **Say so plainly to the team**: if the product bar is "must not sound like an app," ship `RealtimeAiProvider` as the real target and treat `TtsProvider` as the cost-conscious middle tier, not the end state. Where Claude+TTS wins: cost control, staying within the house-model ecosystem for the actual *content* generation (the persona's words are still Claude's), and not depending on a second vendor's LLM safety/behavior policy for what the "caller" is allowed to say.

---

## 2. Security pattern — never ship a key to the browser

### 2.1 The three wire patterns, by provider type

| Provider | Pattern | What the Next.js route does | What the browser does |
|---|---|---|---|
| OpenAI Realtime | **Ephemeral token → direct WebRTC** | `POST https://api.openai.com/v1/realtime/client_secrets` with the real key server-side; returns a token valid **60 seconds** (mint just-in-time, do not pre-mint/cache) | Uses the ephemeral token as the `Authorization: Bearer` on a single `POST .../v1/realtime/calls` carrying its WebRTC SDP offer; sets the remote SDP answer; audio/data flow **directly to OpenAI**, never touching your server again |
| ElevenLabs Conversational AI | **Signed URL / conversation token → direct WebSocket (SDK-managed)** | Server calls ElevenLabs' signed-URL/conversation-token endpoint with the real key; returns the short-lived URL/token | Official React SDK opens the connection directly using that token |
| Claude + TTS (`TtsProvider`) | **Server-proxied stream** — no direct-to-browser option exists | Route Handler holds `ANTHROPIC_API_KEY` and the TTS vendor key; calls Claude with `stream: true`, chunks completed sentences to the TTS vendor's streaming endpoint, and re-streams the resulting audio to the browser | Opens **one connection to your own route** (SSE or WebSocket) and receives audio chunks + caption events from it |
| `ScriptedProvider` | **No network at all** | Nothing — script + audio (browser `speechSynthesis`, or a bundled static audio asset) never leaves the client | Plays canned dialogue locally |

### 2.2 Route Handler shape (App Router)

Three route handlers, matching the three network-touching providers:

```
app/api/voice/token/route.ts       # POST — mints an OpenAI/ElevenLabs ephemeral credential, returns it. Runtime: edge (it's one outbound fetch + JSON passthrough).
app/api/voice/stream/route.ts      # POST — the TtsProvider proxy: streams Claude text + TTS audio to the browser. Runtime: nodejs (needs the TTS SDK / longer streaming).
app/api/voice/config/route.ts      # GET  — returns which provider is active (no secrets) so the client can pick its transport without guessing.
```

```typescript
// app/api/voice/token/route.ts — ephemeral-token minting, Edge runtime
export const runtime = "edge";

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "realtime_not_configured" }, { status: 501 });
  }

  const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: { type: "realtime", model: "gpt-realtime" },
    }),
  });

  if (!upstream.ok) {
    return Response.json({ error: "token_mint_failed" }, { status: 502 });
  }

  const { value, expires_at } = await upstream.json();
  // Only the short-lived value ever reaches the client. expires_at ~60s out.
  return Response.json({ token: value, expiresAt: expires_at });
}
```

```typescript
// app/api/voice/stream/route.ts — TtsProvider proxy, Node runtime
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never statically optimize a live stream

export async function POST(req: Request) {
  const { personaId, transcriptSoFar } = await req.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        // 1. Ask Claude for the next line(s) of dialogue (streamed).
        // 2. As each sentence boundary completes, hand it to the TTS vendor's
        //    streaming endpoint and re-emit audio chunks as SSE `audio-chunk` events.
        // 3. Emit `caller-line` events with the text for captions/UI.
        // (Full implementation lives in lib/voice/providers/tts-provider.ts —
        // this route is a thin transport wrapper around it.)
        await runClaudeToTtsPipeline({ personaId, transcriptSoFar, onEvent: send });
        send("ended", { reason: "completed" });
      } catch (err) {
        send("error", { message: String(err), recoverable: false });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

### 2.3 Streaming transport: SSE vs WebSocket vs WebRTC

| Transport | Use it for | Why |
|---|---|---|
| **WebRTC** | OpenAI Realtime, any true S2S provider | The only transport with sub-200ms audio round trips at the protocol level; also the only one where your server can hand off and disappear (ephemeral token pattern) |
| **SSE (Server-Sent Events)** | `TtsProvider` proxy, on Vercel, today | Simple, one-directional (server→client, which is all a one-sided fake call needs — the human doesn't need to send audio back to Claude unless you add STT), works over plain HTTP, and Next.js Route Handlers stream `ReadableStream` responses natively. Bound by the function's `maxDuration`. |
| **WebSocket (native Vercel Functions)** | `TtsProvider` proxy, if you need bidirectional (e.g. barge-in / STT-in-the-loop) | Vercel Functions gained **native WebSocket support in public beta (June 2026)** — `ws`/Socket.IO/Express/Hono all work. A connection is pinned to one function instance for that instance's `maxDuration` (≤300s Hobby); reconnect logic is required for anything longer, and in-memory session state does not survive an instance swap (use an external store, e.g. Vercel KV/Redis, if you need to). Prefer SSE unless you specifically need the human's voice to interrupt the AI mid-sentence. |

### 2.4 Vercel constraints — what actually matters here

- **Hobby tier function duration**: 300 seconds (5 minutes) max, with Fluid Compute enabled by default. Pro: 800s GA, up to 1800s in extended beta (Node 20/22/24, Python 3.12–3.14 only).
- **Native WebSockets in Vercel Functions**: public beta as of June 2026, strongest on the **Node.js runtime** (Edge WebSocket support is not yet production-stable) — put `stream/route.ts` on `runtime: "nodejs"`.
- **Edge runtime**: Web-standard APIs only (`fetch`, Streams, Web Crypto) — no Node-native modules, but perfectly capable of the token-mint route above, since that's a single outbound `fetch`.
- **The key architectural win**: for OpenAI Realtime (and ElevenLabs Conversational AI), your Vercel function's job is a **sub-second token mint**, not holding the call open — so Hobby's 300s cap is irrelevant to the actual voice session for those providers. It only matters for the `TtsProvider` proxy path, where your server genuinely holds the connection for the call's duration — which is exactly why §6 caps call duration well under that ceiling regardless of provider, as a cost control in its own right.

---

## 3. The abstraction — provider-agnostic `CallVoiceProvider`

Design goals: (1) the UI layer imports only from `lib/voice/types.ts` — never a provider SDK type; (2) every provider implements the same three-method surface; (3) the factory degrades to `ScriptedProvider` with zero configuration.

```typescript
// lib/voice/types.ts — the ONLY file the UI layer is allowed to import from.
// No provider SDK types (no `openai`, `@elevenlabs/*`, `@anthropic-ai/sdk` types) may appear here.

/** A caller identity + script/prompt config. Provider-agnostic. */
export interface CallerPersona {
  id: string;
  /** Shown as the "incoming call" name/photo in the UI. */
  displayName: string;
  avatarUrl?: string;
  /** Feeds prompt construction for LLM-backed providers; ignored by ScriptedProvider. */
  relationship: string; // e.g. "mom", "roommate", "coworker"
  /** How urgent/insistent the caller should sound — shapes pacing across all providers. */
  urgency: "low" | "medium" | "high";
  /** Provider-agnostic voice preference key (e.g. "warm-female-30s"); each provider
   *  resolves this to its own voice/model ID internally. Optional — providers fall
   *  back to a sensible default. */
  voicePreference?: string;
  /** Used by ScriptedProvider. Ignored by LLM-backed providers. */
  script?: ScriptLine[];
  /** Used by TtsProvider / RealtimeAiProvider to build the system prompt (see §4). */
  systemPromptOverrides?: Partial<PersonaPromptFields>;
}

export interface PersonaPromptFields {
  /** e.g. "I'm two minutes away, by the bike rack" — grounds the caller in a place */
  proximityHint?: string;
  /** e.g. "mildly annoyed you're late" — tone, not literal instructions to the model */
  emotionalTone?: string;
}

export interface ScriptLine {
  text: string;
  /** Simulated "listening to the other person" pause after this line, in ms. */
  pauseAfterMs: number;
}

/** Events a CallSession emits. UI subscribes to these; never touches transport. */
export type CallEvent =
  | { type: "connecting" }
  | { type: "audio-chunk"; data: ArrayBuffer; mimeType: string }
  | { type: "caller-line"; text: string } // for live captions/transcript UI
  | { type: "listening-pause"; durationMs: number } // "the other person is talking"
  | { type: "error"; message: string; recoverable: boolean }
  | { type: "ended"; reason: "completed" | "user-hangup" | "timeout" | "budget-exceeded" | "error" };

export interface CallSession {
  readonly id: string;
  readonly providerKind: VoiceProviderKind;
  /** Async event stream the UI subscribes to. */
  events: AsyncIterable<CallEvent>;
  /** User tapped "hang up". Must be safe to call multiple times. */
  hangUp(): Promise<void>;
}

export type VoiceProviderKind = "scripted" | "tts" | "realtime";

/** The core abstraction. Every provider — scripted, TTS-pipeline, or full
 *  speech-to-speech — implements exactly this. */
export interface CallVoiceProvider {
  readonly kind: VoiceProviderKind;
  /** Human-readable name for logs/debug UI, e.g. "Claude + ElevenLabs Flash". */
  readonly label: string;
  /** Whether this provider is actually usable right now (keys present, etc).
   *  The factory uses this to select; a provider should never be constructed
   *  without first passing its own isAvailable() check. */
  isAvailable(): boolean;
  start(persona: CallerPersona, signal: AbortSignal): Promise<CallSession>;
}
```

```typescript
// lib/voice/providers/scripted-provider.ts
import type { CallVoiceProvider, CallerPersona, CallSession, CallEvent } from "../types";

/** Zero-network fallback. Plays a persona's canned script via the browser's
 *  speechSynthesis API (or, if unavailable, emits text-only caller-line events
 *  for a caption-only UI). Always available — this is the floor every other
 *  provider must degrade to. */
export class ScriptedProvider implements CallVoiceProvider {
  readonly kind = "scripted" as const;
  readonly label = "Scripted (no network)";

  isAvailable(): boolean {
    return true; // never gated on env config
  }

  async start(persona: CallerPersona, signal: AbortSignal): Promise<CallSession> {
    const script = persona.script ?? DEFAULT_SCRIPTS[persona.urgency];
    const id = crypto.randomUUID();

    async function* run(): AsyncIterable<CallEvent> {
      yield { type: "connecting" };
      for (const line of script) {
        if (signal.aborted) {
          yield { type: "ended", reason: "user-hangup" };
          return;
        }
        yield { type: "caller-line", text: line.text };
        // Audio playback (speechSynthesis or bundled clip) is driven client-side
        // by the UI layer in response to caller-line events — ScriptedProvider
        // itself never touches the DOM/Audio API, keeping it usable in tests.
        yield { type: "listening-pause", durationMs: line.pauseAfterMs };
        await sleep(line.pauseAfterMs, signal);
      }
      yield { type: "ended", reason: "completed" };
    }

    return { id, providerKind: this.kind, events: run(), hangUp: async () => {} };
  }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

const DEFAULT_SCRIPTS: Record<CallerPersona["urgency"], ScriptLine[]> = {
  low: [/* … see §4 for real example lines … */] as any,
  medium: [] as any,
  high: [] as any,
};
```

```typescript
// lib/voice/providers/tts-provider.ts
import type { CallVoiceProvider, CallerPersona, CallSession, CallEvent } from "../types";

/** Claude (text) + a TTS vendor (audio), proxied through our own server route.
 *  Requires ANTHROPIC_API_KEY + (ELEVENLABS_API_KEY | DEEPGRAM_API_KEY). */
export class TtsProvider implements CallVoiceProvider {
  readonly kind = "tts" as const;
  readonly label = "Claude + TTS";

  constructor(private readonly env: VoiceEnvConfig) {}

  isAvailable(): boolean {
    return Boolean(this.env.ANTHROPIC_API_KEY) &&
      Boolean(this.env.ELEVENLABS_API_KEY || this.env.DEEPGRAM_API_KEY);
  }

  async start(persona: CallerPersona, signal: AbortSignal): Promise<CallSession> {
    const id = crypto.randomUUID();
    const res = await fetch("/api/voice/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: persona.id }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error("voice_stream_failed");

    const events = parseServerSentEvents(res.body, signal) as AsyncIterable<CallEvent>;
    return {
      id,
      providerKind: this.kind,
      events,
      hangUp: async () => { /* AbortController drives this via `signal` */ },
    };
  }
}

declare function parseServerSentEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<unknown>;
interface VoiceEnvConfig {
  ANTHROPIC_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
}
```

```typescript
// lib/voice/providers/realtime-provider.ts
import type { CallVoiceProvider, CallerPersona, CallSession, CallEvent } from "../types";

/** True speech-to-speech (OpenAI Realtime today; ElevenLabs Conversational AI
 *  is a drop-in alternate backend behind the same interface — see the `backend`
 *  field). Connects DIRECTLY to the provider after minting an ephemeral token
 *  from our own server — our server never sees call audio. */
export class RealtimeAiProvider implements CallVoiceProvider {
  readonly kind = "realtime" as const;
  readonly label: string;

  constructor(
    private readonly env: VoiceEnvConfig,
    private readonly backend: "openai" | "elevenlabs-agent" = "openai",
  ) {
    this.label = backend === "openai" ? "OpenAI Realtime" : "ElevenLabs Conversational AI";
  }

  isAvailable(): boolean {
    return this.backend === "openai"
      ? Boolean(this.env.OPENAI_API_KEY)
      : Boolean(this.env.ELEVENLABS_AGENT_ID && this.env.ELEVENLABS_API_KEY);
  }

  async start(persona: CallerPersona, signal: AbortSignal): Promise<CallSession> {
    const id = crypto.randomUUID();
    const tokenRes = await fetch("/api/voice/token", { method: "POST", signal });
    if (!tokenRes.ok) throw new Error("token_mint_failed");
    const { token } = await tokenRes.json();

    // Opens an RTCPeerConnection directly to the provider using `token`.
    // Implementation lives in a backend-specific adapter (openai-webrtc.ts /
    // elevenlabs-agent-sdk.ts) — never leaks WebRTC/SDK types past this file.
    const events = await connectDirectToProvider(this.backend, token, persona, signal);
    return { id, providerKind: this.kind, events, hangUp: async () => { /* close RTCPeerConnection */ } };
  }
}

declare function connectDirectToProvider(
  backend: "openai" | "elevenlabs-agent",
  token: string,
  persona: CallerPersona,
  signal: AbortSignal,
): Promise<AsyncIterable<CallEvent>>;
interface VoiceEnvConfig {
  OPENAI_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_API_KEY?: string;
}
```

```typescript
// lib/voice/registry.ts — the factory. This is the ONLY place that reads env vars
// or decides which provider wins. Everything downstream just calls provider.start().
import { ScriptedProvider } from "./providers/scripted-provider";
import { TtsProvider } from "./providers/tts-provider";
import { RealtimeAiProvider } from "./providers/realtime-provider";
import type { CallVoiceProvider, VoiceProviderKind } from "./types";

export interface VoiceEnvConfig {
  VOICE_PROVIDER?: "scripted" | "claude-tts" | "openai-realtime" | "elevenlabs-agent";
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_AGENT_ID?: string;
  DEEPGRAM_API_KEY?: string;
}

/** Selects a provider by explicit env override, else by which keys are present,
 *  else falls back to ScriptedProvider. Never throws — there is always a
 *  usable provider. Call this server-side (it reads `process.env`) and expose
 *  the *kind* (not the keys) to the client via /api/voice/config. */
export function createVoiceProvider(env: VoiceEnvConfig): CallVoiceProvider {
  const candidates: CallVoiceProvider[] = [];

  if (!env.VOICE_PROVIDER || env.VOICE_PROVIDER === "openai-realtime") {
    candidates.push(new RealtimeAiProvider(env, "openai"));
  }
  if (!env.VOICE_PROVIDER || env.VOICE_PROVIDER === "elevenlabs-agent") {
    candidates.push(new RealtimeAiProvider(env, "elevenlabs-agent"));
  }
  if (!env.VOICE_PROVIDER || env.VOICE_PROVIDER === "claude-tts") {
    candidates.push(new TtsProvider(env));
  }

  for (const provider of candidates) {
    if (provider.isAvailable()) return provider;
  }

  // Explicit override to "scripted", OR no keys configured at all: same result.
  return new ScriptedProvider();
}

export function describeActiveProvider(env: VoiceEnvConfig): { kind: VoiceProviderKind; label: string } {
  const p = createVoiceProvider(env);
  return { kind: p.kind, label: p.label };
}
```

**Degradation rule, stated plainly**: `createVoiceProvider` never throws and never requires configuration. With zero env vars set, the app ships a fully working fake-call experience via `ScriptedProvider` — canned, provider-agnostic script lines with `speechSynthesis` playback. Every paid provider is strictly additive: set its keys, and the factory promotes automatically on the next request. No code path exists where a missing key produces a broken UI instead of a scripted call.

---

## 4. Persona and prompt design

### 4.1 What real fake-call apps actually do (and don't)

Research turned up several real, shipping "fake call" safety apps — **SafelyHome**, **Fake Call** (and clones), and the adjacent **Companion** app (live friend-tracking rather than a scripted call). None of them publish their actual dialogue scripts, and — importantly — **none of them use a live LLM**: they all ship **pre-recorded audio** with a script the user can glance at to "follow along," triggered on a delay timer so it looks like a real incoming call. SafelyHome advertises "40+ calls, 120 minutes of recorded audio" as its content library. The one piece of real UX guidance found (imsafe.app) is behavioral, not scripted: *answer like it's real, respond to the voice, and excuse yourself calmly — don't overact, the goal is to exit the situation, not perform a scene.*

The nearest LLM-driven precedent is **not** a safety app — it's ScamAgent (arXiv 2508.06457), an LLM-based scam-call agent that uses "persona anchoring" and dialogue memory to sound convincingly human over multi-turn calls. The technique is legitimately the same one this feature needs (a consistent, grounded persona that adapts turn to turn); the difference is entirely in the guardrails — consented use, no deception of real people or real emergency systems, and an explicit exit path for the user. That distinction is what §4.3 encodes.

### 4.2 What makes a one-sided call sound real

Synthesized from general phone-conversation-realism principles (not sourced from a published fake-call script, since none exist publicly — stated here honestly per the research above):

- **Pauses that imply listening.** After every line, a silence of realistic length (1.5–4s depending on how "long" the implied other-party response would be) before the caller speaks again. This is the single most important cue — a script with no gaps reads instantly as a monologue, not a call.
- **Filler and backchannel words** at the *start* of turns, implying a reaction to something just heard: "Wait, really?" / "Oh no." / "Uh-huh, no I know." / "Hold on—" These should open roughly a third of the caller's lines, not all of them (constant filler reads as fake too).
- **Proximity and specificity.** "I'm turning onto your street", "I can see the corner shop from here", "I'm parking now" — concrete, checkable-sounding details that imply the caller is physically closing in. This is the strongest signal to a nearby bystander that someone is en route.
- **Escalating urgency across the call**, not flat urgency throughout — start mundane/logistics ("Hey, are you almost done?"), then step up if the persona's `urgency` is `medium`/`high` ("Seriously, I'm like two minutes away, just head outside").
- **Self-interruption and mid-sentence redirects** ("So I was gonna say — actually never mind, tell me when you're— okay, cool, see you in a sec") reads as far more human than grammatically clean sentences.
- **Never a monologue.** Every line should be short (5–15 words is typical for one side of a real call); long uninterrupted paragraphs are the fastest way to break the illusion.

### 4.3 System prompt shape (for `TtsProvider` / `RealtimeAiProvider`)

```
You are playing the role of {relationship} calling {user_name_or_you} on the phone.
This is a SAFETY TOOL: the user has activated a fake incoming call to help them
exit a situation that feels uncomfortable or unsafe. Your only job is to sound
like a real, specific person who is on their way and needs the user right now.

CHARACTER
- Relationship to the user: {relationship}
- Tone: {emotional_tone}  (e.g. "a little annoyed you're late", "worried, wants
  to know you're okay", "casual, just checking in")
- You are physically approaching: reference concrete, nearby-sounding details
  as the call goes on (a landmark, "I'm turning onto your street", "two minutes
  out") to make it sound like someone is about to arrive.

HOW TO TALK
- You can only hear one side of this — the user's actual replies never reach
  you as text; you are performing BOTH the illusion of a real call. Leave
  natural pauses as if listening, then continue as though you heard a response.
- Speak in short lines (one or two sentences). Real phone calls are not
  monologues.
- Open some lines with a reaction to something you'd have "just heard": "wait,
  really?", "oh no", "uh-huh". Don't do this on every line.
- Escalate urgency gradually across the call if urgency is medium or high;
  start ordinary, become more insistent.
- Self-interrupt occasionally. Real speech doubles back on itself.

HARD RULES — NEVER BREAK THESE
- NEVER claim to be, imply you are, or impersonate police, 911, a 911
  dispatcher, security, or any emergency service. If the scene calls for
  urgency, escalate as a worried friend/family member, not as authority.
- NEVER give the user instructions that could make a real unsafe situation
  worse (e.g. do not tell them to confront anyone, do not tell them to stay
  in a dangerous location "just a bit longer").
- If anything in this conversation suggests the user may be in immediate real
  danger, stay in character but steer the "caller" toward getting the user to
  a safe, public location right now — and the surrounding app UI (not you)
  is responsible for surfacing real emergency resources; you are a fictional
  voice, not a safety decision-maker.
- Keep the fiction contained to this call: never claim to know real facts
  about real people, places, or events beyond what's needed for the persona.
- If asked directly "are you real" / "is this an AI": stay in character and
  deflect naturally as a human would ("what? Of course I'm real, why—"),
  do not break the fourth wall — the user activated this tool on purpose and
  breaking character defeats its purpose, but never claim to be an emergency
  responder while doing so.

CALL SHAPE
- Total call target length: {target_seconds} seconds.
- Persona: {display_name} ({relationship}).
- Urgency: {urgency}.
{proximity_hint ? `- Lead with or work toward: "${proximity_hint}"` : ""}
```

**Notes on the guardrails**: the "never impersonate police/911" rule is not just good practice — falsely impersonating a police officer or emergency dispatcher is a criminal offense in most US jurisdictions (misdemeanor to felony depending on jurisdiction and outcome). This must be a hard constraint in the prompt, not a soft suggestion, and should also be enforced by the harness (§6) — e.g. a keyword/regex guard on generated text for "this is the police" / "I'm an officer" / "I'm 911" patterns, with the line dropped and replaced by a safe fallback if it ever slips through.

---

## 5. Latency budget

A believable phone call has to feel like it connects the moment the user answers — any perceptible "the app is loading" gap breaks the illusion immediately. Target budget, allocated across the pipeline:

| Stage | Target | Notes |
|---|---|---|
| User taps "answer" → ring/connect UI | 0ms | Purely local; play the ringtone/vibration immediately, no network dependency |
| Token mint (RealtimeAiProvider) | <300ms | Single server round trip; do this **before** the user answers if possible (pre-mint while the "incoming call" screen is showing) — a 60s-TTL token minted 2–3s before answer is still valid |
| WebRTC handshake → first audio frame (RealtimeAiProvider) | <600ms typical (per third-party reports on `gpt-realtime` family; not an OpenAI-published SLA) | This is the true "time to first audio" for S2S |
| Claude TTFT → first sentence complete (TtsProvider) | ~300–800ms depending on effort/model | Use `effort: "low"` or `"medium"` for this specific call, not `high`/`xhigh` — latency matters far more than depth of reasoning for one-sided small talk |
| TTS request → first audio byte (TtsProvider) | ElevenLabs Flash model latency ~75ms + network; Deepgram Aura-2 not officially published, budget ~150–250ms | Stream TTS per-sentence, not per-full-response — never wait for Claude's full reply before starting audio |
| **Total: user answers → caller's first audible word** | **RealtimeAiProvider: <1s. TtsProvider: 1–2s if unmasked.** | See below for how to make the slower path feel as fast as the fast one |

**What to do while waiting for first audio** — this is the actual UX lever, more so than shaving milliseconds off any single stage:

1. **Play a pre-recorded, provider-agnostic "pickup" sound the instant the user answers** — a short breath/rustle/"hey—" clip that plays locally with zero network dependency, identical across all three providers. This masks the entire token-mint / TTFT / first-TTS-byte gap; by the time it finishes (~500–800ms), real audio should be ready to take over seamlessly.
2. **Never show a spinner or "connecting" text once the call UI is up** — a phone call screen with a loading indicator is the single fastest way to break the fiction. If audio genuinely isn't ready, extend the pickup-sound loop (a soft ambient "on the move" background, footsteps, car interior) rather than showing app chrome.
3. **For `TtsProvider`, pre-generate and cache the persona's opening line's audio** at persona-selection time (before the user even triggers the call), so the very first line is already a finished audio file and only the *second* line onward pays the live Claude→TTS latency. This converts the visible-worst-case pipeline into a one-time background cost.
4. **Degrade the persona's urgency-appropriate opener to something latency-tolerant** — a slightly delayed "Hey! ...Sorry, bad signal for a sec—" line doubles as both a natural human phone-call moment *and* cover for network jitter, on any provider.

---

## 6. Cost and rate-limit guardrails (design in from day one)

None of this is optional — it must exist in the harness even while running on `ScriptedProvider`, so that flipping on a paid provider never accidentally ships without limits.

| Guardrail | Recommended default | Where enforced |
|---|---|---|
| **Max call duration** | 4 minutes (240s) hard cutoff, regardless of provider | Server-side timer tied to the `CallSession`; independent of and stricter than Vercel's own `maxDuration`, so behavior is identical across Hobby/Pro |
| **Max calls per session/device per day** | 5 (configurable) | A simple counter keyed to a client-set anonymous ID (no auth required for a tool like this); enforced in the same route that mints tokens / starts the TTS proxy |
| **Per-call token/character cap** | Claude: ~2,000 output tokens; TTS: ~3,000 characters | Passed as `max_tokens` on the Claude call and as a running character budget the TTS proxy stops emitting past; once hit, the harness ends the call gracefully ("gotta go, see you in a sec!") rather than hard-cutting mid-word |
| **Per-session dollar budget** | e.g. $0.25/session soft cap, computed from provider's published per-minute/per-token rates as the call streams | Tracked server-side in the proxy route; on breach, emit `{ type: "ended", reason: "budget-exceeded" }` — never silently truncate audio, always end the call in-persona |
| **Global daily spend cap** | Configurable env var (e.g. `VOICE_DAILY_BUDGET_USD`), checked before minting any token or starting any proxy stream | If exceeded, `createVoiceProvider` should refuse to promote past `ScriptedProvider` for the rest of the day — this is exactly why the factory pattern (§3) matters: the fallback is automatic, not a special-cased error path |
| **Rate limiting the token-mint / stream-start routes** | IP- or device-id-keyed limiter (even a simple in-memory/edge-KV token bucket) on `/api/voice/token` and `/api/voice/stream` | Prevents a single client from hammering ephemeral-token minting or opening many concurrent Claude+TTS streams |
| **Timeout on "no answer" / abandoned calls** | Auto-hang-up after e.g. 90s of the call screen sitting unanswered before triggering start | Avoids paying for a provider session that never actually got used |

**Env var contract** (exact names, matching the factory in §3):

```
VOICE_PROVIDER=              # optional override: scripted | claude-tts | openai-realtime | elevenlabs-agent
ANTHROPIC_API_KEY=           # Claude, for TtsProvider dialogue generation
OPENAI_API_KEY=              # OpenAI Realtime, for RealtimeAiProvider (openai backend)
ELEVENLABS_API_KEY=          # ElevenLabs, for TtsProvider audio and/or RealtimeAiProvider (elevenlabs-agent backend)
ELEVENLABS_VOICE_ID=         # which ElevenLabs voice for TtsProvider TTS calls
ELEVENLABS_AGENT_ID=         # which Conversational AI agent for RealtimeAiProvider (elevenlabs-agent backend)
DEEPGRAM_API_KEY=            # optional alternate TTS/STT vendor for TtsProvider
VOICE_CALL_MAX_DURATION_SECONDS=240
VOICE_CALL_MAX_TOKENS=2000
VOICE_CALL_MAX_TTS_CHARS=3000
VOICE_SESSION_BUDGET_USD=0.25
VOICE_DAILY_BUDGET_USD=      # optional org-wide cap
```

With none of these set, the app runs entirely on `ScriptedProvider` — no network calls, no cost, fully functional fake-call UX.

---

## Sources

**OpenAI Realtime API**
- Realtime guide (models, transport): https://developers.openai.com/api/docs/guides/realtime
- WebRTC integration guide (ephemeral token flow): https://developers.openai.com/api/docs/guides/realtime-webrtc
- Pricing (audio/text/image token rates): https://developers.openai.com/api/docs/pricing
- Ephemeral client-secret endpoint reference (partially fetched, corroborated via search): https://platform.openai.com/docs/api-reference/realtime-sessions/create-realtime-client-secret

**ElevenLabs**
- TTS model catalog and latency figures: https://elevenlabs.io/docs/models
- Pricing: https://elevenlabs.io/pricing
- Conversational AI / Agents Platform overview: https://elevenlabs.io/docs/conversational-ai/overview
- Third-party pricing cross-checks (not official, used only to sanity-check $/min figures): https://texttolab.com/blog/elevenlabs-pricing, https://developer.puter.com/tutorials/elevenlabs-api-pricing/, https://www.cekura.ai/blogs/elevenlabs-pricing, https://www.cloudtalk.io/blog/elevenlabs-pricing/

**Deepgram**
- Pricing (Aura TTS, Nova-3 STT, Voice Agent API): https://deepgram.com/pricing

**Cartesia**
- Pricing/tiers (Sonic-3.5 confirmed as current model): https://cartesia.ai/pricing
- Third-party latency claim (40ms TTFA — NOT confirmed on Cartesia's own pricing page): https://www.eesel.ai/blog/cartesia-sonic-3-pricing

**Browser-native Web Speech API**
- SpeechRecognition browser support (MDN): https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition

**Vercel / Next.js**
- Function duration limits (Hobby 300s, Pro 800s GA / 1800s extended beta): https://vercel.com/docs/functions/configuring-functions/duration
- Native WebSocket support in Vercel Functions (public beta, June 2026): https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- Third-party corroboration on Vercel WebSocket beta: https://ably.com/vercel/websockets-on-vercel
- Next.js Edge vs Node.js runtime docs: https://github.com/vercel/next.js/blob/0e4a758c7bcfd0ba4e7fdd9c296484dbe8a396f7/docs/02-app/01-building-your-application/02-rendering/02-edge-and-nodejs-runtimes.mdx

**Fake-call safety apps and persona precedent**
- SafelyHome (Google Play listing): https://play.google.com/store/apps/details?id=com.appatree.safelyhome&hl=en-US
- "How Fake Phone Calls in Personal Safety Apps Help You Escape" (imsafe.app): https://www.imsafe.app/post/need-an-exit-how-fake-phone-calls-offer-a-safe-escape-from-risky-situations
- DIY fake-call project confirming pre-recorded-audio norm (Show HN): https://news.ycombinator.com/item?id=45210153
- Companion app coverage (adjacent safety-tech, live tracking not scripted calls): https://www.cbsnews.com/amp/miami/news/never-walk-alone-again-with-companion-app
- ScamAgent — LLM-driven multi-turn scam-call persona-anchoring research (cautionary technical parallel, not a safety-app source): https://arxiv.org/html/2508.06457
- Legality of impersonating police/911 (US, informs the hard guardrail in §4.3): https://legaloverview.com/is-it-illegal-to-prank-call-911/

**Claude / Anthropic API** (model IDs, pricing, streaming, ephemeral-token-equivalent patterns)
- Current as cached in this environment's `claude-api` skill reference (Claude Opus 5 / Sonnet 5 / Haiku 4.5 pricing and streaming patterns); for live figures see https://platform.claude.com/docs/en/about-claude/models/overview and https://platform.claude.com/docs/en/pricing

*Figures marked "third-party" or "not officially published" above are called out inline in the comparison table and latency sections — treat those as directionally useful, not contractual.*
