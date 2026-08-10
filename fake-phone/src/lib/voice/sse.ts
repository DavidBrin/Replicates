/**
 * Server-Sent Events framing for `/api/voice/turn`.
 *
 * SSE rather than WebSockets, per `research/ai-voice-architecture.md` §2.3: a
 * one-sided call is server→client only, SSE is plain HTTP, Next Route Handlers
 * stream a `ReadableStream` natively, and it works on Vercel today without the
 * WebSocket beta. If the human's voice ever needs to interrupt mid-sentence
 * (barge-in, STT in the loop) that is the moment to revisit — and the reason the
 * transport lives behind this module rather than being inlined in the route.
 */

/** The event names the wire carries. Mapped to `CallEvent` by the AI adapter. */
export type VoiceSseEvent = "connected" | "line" | "listening" | "usage" | "error" | "ended";

export type VoiceEndReason =
  | "completed"
  | "duration_cap"
  | "token_cap"
  | "unconfigured"
  | "error";

export interface VoiceSseEmitter {
  send(event: VoiceSseEvent, data: unknown): void;
}

/** One SSE frame. Exported for the framing test — the blank line is load-bearing. */
export function sseFrame(event: VoiceSseEvent, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface SseResponseOptions {
  readonly status?: number;
}

/**
 * Wraps a producer in a `text/event-stream` response.
 *
 * The producer never rejects into the transport: any throw is turned into an
 * `error` frame followed by `ended`, because a client that receives a truncated
 * stream shows a broken call screen, while a client that receives `error` +
 * `ended` shows a call that finished. That difference is the whole reason this
 * helper exists rather than each route closing its own controller.
 */
export function createVoiceSseResponse(
  produce: (emit: VoiceSseEmitter) => Promise<void>,
  options: SseResponseOptions = {},
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit: VoiceSseEmitter = {
        send(event, data) {
          if (closed) return;
          controller.enqueue(encoder.encode(sseFrame(event, data)));
        },
      };

      try {
        await produce(emit);
      } catch (cause) {
        emit.send("error", {
          code: "voice_stream_failed",
          message: cause instanceof Error ? cause.message : "The call stream failed.",
        });
        emit.send("ended", { reason: "error" satisfies VoiceEndReason });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // `no-transform` matters as much as `no-cache`: a compressing proxy will
      // otherwise buffer the whole stream and deliver the call in one lump.
      "cache-control": "no-cache, no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
