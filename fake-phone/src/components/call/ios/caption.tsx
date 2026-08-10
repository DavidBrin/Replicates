/**
 * The spoken line, on screen.
 *
 * This is the one element here with no counterpart in the real Phone app, and
 * it is not decoration: `speechSynthesis` on iOS Safari is unreliable — empty
 * voice list until `voiceschanged`, speech cut when backgrounded, gesture
 * required (SPEC §4.5) — so the scripted caller degrades to text. The call has
 * to still read as real with no sound at all, which is also exactly what happens
 * when the phone is on silent, which is most phones.
 *
 * Styled as a soft caption rather than a chat bubble: a bubble would look like
 * a messaging app pretending to be a call.
 */

import { CALL_TEST_IDS } from "../types";

export function SubtitleCaption({ text }: { text: string }) {
  return (
    <p
      data-testid={CALL_TEST_IDS.subtitle}
      className="mx-auto mb-7 max-w-[82%] rounded-[18px] bg-black/35 px-4 py-2 text-center text-[15px] leading-snug text-white/85 backdrop-blur-[12px]"
    >
      {text}
    </p>
  );
}
