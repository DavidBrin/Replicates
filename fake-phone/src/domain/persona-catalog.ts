/**
 * Who is calling.
 *
 * Pure data — no imports beyond the `Persona` type — so the catalog can be
 * unit-tested, rendered on the server, and shipped to the client without
 * dragging in an adapter.
 *
 * ## How these scripts were written
 *
 * No shipping fake-call app publishes its dialogue (research/ai-voice-
 * architecture.md §4.1 — they all ship pre-recorded audio), so there was
 * nothing to copy and nothing to be inspired by. Every line below is written
 * against the realism rules in §4.2:
 *
 *   - **Short lines.** Five to fifteen words, the length of one side of a real
 *     call. A paragraph is the fastest way to break the illusion.
 *   - **A listening pause after every line**, varied between 1.2s and 3.5s and
 *     sized to how long the implied reply would take. A long question earns a
 *     long gap.
 *   - **Concrete proximity cues** — "turning onto your street", "I can see the
 *     shop on the corner", "I'm the one flashing my lights". This is the part a
 *     bystander overhears, and it is the entire deterrent: someone specific
 *     knows where this person is and is arriving imminently.
 *   - **Escalating urgency**, not flat urgency. Calls open on logistics and
 *     tighten.
 *   - **Backchannel openers** on roughly a third of lines ("wait, really?",
 *     "hang on—"), implying a reaction to something just heard. On every line
 *     they read as fake too.
 *
 * ## The guardrail
 *
 * No persona may be, imply, or drift toward police, a dispatcher, or any
 * emergency service (SPEC §1). This is a legal constraint before it is a policy
 * one — impersonating an officer is a criminal offence in most jurisdictions,
 * and Apple's Guideline 1.1.6 refuses "for entertainment" as a defence. Urgency
 * is always carried by a worried friend or family member instead. A test in
 * `persona-catalog.test.ts` greps the whole catalog for those terms so a future
 * persona cannot quietly cross the line.
 */

import type { Persona } from "@/domain/persona";

export const PERSONAS: readonly Persona[] = [
  {
    // The default, referenced by `settings.ts` (`personaId` defaults to this).
    // It is first in the list, so it is also what `getPersona` falls back to.
    id: "friend-nearby",
    title: "A friend two minutes away",
    description: "Warm, unfussy, already in the car and nearly at you.",
    suggestedCallerName: "Sam",
    suggestedCallerLabel: "mobile",
    characterBrief:
      "Sam is the user's closest friend, driving over to collect them. Warm and " +
      "matter-of-fact rather than dramatic — they were already out, this is no " +
      "trouble, and they are very close. They narrate their approach in concrete " +
      "detail and get steadily more insistent that the user come outside now.",
    voiceHints: { rate: 1.02 },
    script: [
      { text: "Hey — you still there? I'm nearly at you.", pauseAfterMs: 1800 },
      { text: "Wait, really? Okay, no, stay exactly where you are.", pauseAfterMs: 2400 },
      { text: "I'm just turning onto your street now.", pauseAfterMs: 1600 },
      { text: "Yeah, I can see the shop on the corner.", pauseAfterMs: 2200 },
      { text: "Hang on— is that you outside the blue door?", pauseAfterMs: 2600 },
      { text: "Okay. Two minutes. Don't go anywhere.", pauseAfterMs: 1500 },
      { text: "No, honestly, it's fine. I was already out.", pauseAfterMs: 2800 },
      { text: "Right, I'm pulling in now. Come out when you see me.", pauseAfterMs: 2000 },
      { text: "I'm the one flashing my lights, yeah.", pauseAfterMs: 1700 },
      { text: "Okay, I'm here. Come on — I've got you.", pauseAfterMs: 1400 },
    ],
  },

  {
    id: "parent-checkin",
    title: "A parent checking in",
    description: "Not letting you off the phone until someone's collected you.",
    suggestedCallerName: "Mum",
    suggestedCallerLabel: "mobile",
    characterBrief:
      "The user's mother, ringing for no particular reason and then quietly " +
      "deciding she is not hanging up until someone has picked them up. Gentle, " +
      "a little fussy, unembarrassed about it. She offers the user's father and " +
      "the car as though it is already settled.",
    voiceHints: { rate: 0.96, pitch: 1.05 },
    script: [
      { text: "Hello love — sorry, did I catch you at a bad time?", pauseAfterMs: 2200 },
      { text: "No, no, nothing's wrong. I just wanted to hear you.", pauseAfterMs: 2600 },
      { text: "Are you still out? It's gone half nine.", pauseAfterMs: 2000 },
      { text: "Mm. And how are you getting back?", pauseAfterMs: 2900 },
      { text: "Wait, really? On your own?", pauseAfterMs: 2400 },
      { text: "Well, your dad's got the car out anyway.", pauseAfterMs: 2200 },
      { text: "He can be with you in ten minutes. Less.", pauseAfterMs: 2000 },
      { text: "Where are you exactly? By the big supermarket?", pauseAfterMs: 3000 },
      { text: "Right. Stay under the lights where it's busy.", pauseAfterMs: 1800 },
      { text: "I'll keep you on the phone until he's there.", pauseAfterMs: 1600 },
      { text: "I know, I know. Humour me.", pauseAfterMs: 2100 },
      { text: "Go on then — tell me about your week.", pauseAfterMs: 3200 },
    ],
  },

  {
    id: "partner-pickup",
    title: "A partner arriving to collect you",
    description: "Already outside, engine running, can't stay parked there long.",
    suggestedCallerName: "Alex",
    suggestedCallerLabel: "mobile",
    characterBrief:
      "The user's partner, physically outside the building right now and slightly " +
      "hassled about where they've stopped the car. The pressure is logistical, " +
      "not emotional — they cannot sit there, so the user has to come out — which " +
      "gives the user a reason to leave immediately that needs no explaining.",
    voiceHints: { rate: 1.05 },
    script: [
      { text: "Hey — I'm outside. Where do you want me?", pauseAfterMs: 2000 },
      { text: "Uh-huh. Yeah, I can see the sign.", pauseAfterMs: 2200 },
      { text: "I'm in the loading bay, by the side door.", pauseAfterMs: 2500 },
      { text: "Hang on— someone's beeping at me, one sec.", pauseAfterMs: 1800 },
      { text: "Yeah, sorry. I can't stay here long.", pauseAfterMs: 2000 },
      { text: "Are you coming out now, or in a minute?", pauseAfterMs: 2700 },
      { text: "Okay, I'll leave the engine running.", pauseAfterMs: 1700 },
      { text: "No, don't worry about the bag — I'll get it.", pauseAfterMs: 2300 },
      { text: "I can see the door from here. Come straight out.", pauseAfterMs: 1500 },
      { text: "Yep. I'm literally right here.", pauseAfterMs: 1300 },
    ],
  },

  {
    id: "housemate-home",
    title: "A housemate who needs you home",
    description: "Something's leaking, and they don't know where the stopcock is.",
    suggestedCallerName: "Jess",
    suggestedCallerLabel: "home",
    characterBrief:
      "The user's housemate, dealing with water coming out from under the kitchen " +
      "sink and out of their depth. Flustered but not frightened — the tone is " +
      "'please come back', not alarm. Gives the user an unarguable domestic reason " +
      "to leave right now, with no reference to the situation they are actually in.",
    script: [
      { text: "Hey, sorry — are you far? The water's going everywhere.", pauseAfterMs: 2400 },
      { text: "Under the sink, I think. I've turned the tap thing.", pauseAfterMs: 2800 },
      { text: "No, I don't know where the stopcock is. That's why I'm ringing.", pauseAfterMs: 2600 },
      { text: "Okay. Okay. How long are you?", pauseAfterMs: 2200 },
      { text: "Wait — is it the cupboard by the boiler?", pauseAfterMs: 3000 },
      { text: "Right, I've got towels down. It's slowing.", pauseAfterMs: 2000 },
      { text: "Can you just come back? I'd feel better with you here.", pauseAfterMs: 2400 },
      { text: "I'll put the kettle— no. I'm not touching anything.", pauseAfterMs: 1900 },
      { text: "Okay. Message me when you're walking.", pauseAfterMs: 2000 },
      { text: "Yeah. See you in a bit. Thank you.", pauseAfterMs: 1400 },
    ],
  },

  {
    id: "work-urgent",
    title: "A manager with something that can't wait",
    description: "Apologetic, out of hours, and needs you at a laptop tonight.",
    suggestedCallerName: "Priya",
    suggestedCallerLabel: "work",
    characterBrief:
      "The user's manager, ringing out of hours and apologising for it. Brisk, " +
      "professional, genuinely sorry — a client moved a deadline and she needs the " +
      "user somewhere quiet with a laptop tonight. Useful when the user needs a " +
      "reason to leave that is nobody's business and invites no follow-up.",
    voiceHints: { rate: 1.08 },
    script: [
      { text: "Hi — sorry to do this to you out of hours.", pauseAfterMs: 2200 },
      { text: "Have you got two minutes? It's the Thursday deadline.", pauseAfterMs: 2600 },
      { text: "Yeah. The client moved it. I know.", pauseAfterMs: 2400 },
      { text: "So I need you back at a laptop tonight, if you can.", pauseAfterMs: 3000 },
      { text: "Uh-huh. No, I've told them that already.", pauseAfterMs: 2200 },
      { text: "How soon can you get somewhere quiet?", pauseAfterMs: 2700 },
      { text: "Okay, good. I'll send the file over now.", pauseAfterMs: 1800 },
      { text: "Don't try and read it on your phone, it's unreadable.", pauseAfterMs: 2100 },
      { text: "Right — go. I'll stay on until you're moving.", pauseAfterMs: 1600 },
      { text: "Thanks. Genuinely. I owe you one.", pauseAfterMs: 1500 },
    ],
  },

  {
    id: "friend-calm",
    title: "A friend with nothing urgent",
    description: "No drama at all — a long, ordinary chat that just doesn't end.",
    suggestedCallerName: "Nadia",
    suggestedCallerLabel: "mobile",
    characterBrief:
      "A close friend ringing for no reason, in no hurry, happy to talk for as " +
      "long as it takes. Deliberately low-key: escalation is not always the safe " +
      "move, and an unhurried call the user simply cannot get off is often the " +
      "better way out of a conversation. She mentions walking up towards the user " +
      "once, lightly, without making it the point.",
    voiceHints: { rate: 0.98 },
    script: [
      { text: "Hey you. Nothing urgent — I just had a minute.", pauseAfterMs: 2400 },
      { text: "Are you still out and about?", pauseAfterMs: 2600 },
      { text: "Mm, same. I've been in all day.", pauseAfterMs: 2800 },
      { text: "Oh — did you decide about Saturday?", pauseAfterMs: 3000 },
      { text: "Wait, really? That's brilliant.", pauseAfterMs: 2400 },
      { text: "No, go on. Tell me the rest.", pauseAfterMs: 3400 },
      { text: "I'm walking up your way anyway. Are you near the square?", pauseAfterMs: 2200 },
      { text: "Right, well — I'll stay on until you're moving.", pauseAfterMs: 2000 },
      { text: "Uh-huh. Yeah, no, I know exactly what you mean.", pauseAfterMs: 2900 },
      { text: "Take your time. I'm not going anywhere.", pauseAfterMs: 2600 },
    ],
  },
];

/**
 * Never throws, and never returns null.
 *
 * An unknown id is not an exceptional situation here — it is what a settings
 * blob written by an older build, or a persona removed in a later one, looks
 * like. The app must open into a ringing call regardless, so an unrecognised id
 * quietly becomes the default persona rather than an error screen at the moment
 * someone needs the app (the same repairing philosophy as `parseSettings`).
 */
export function getPersona(id: string): Persona {
  return PERSONAS.find((persona) => persona.id === id) ?? PERSONAS[0];
}
