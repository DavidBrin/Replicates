/**
 * Press-to-join (Plan 6, Task 30): on the character select, a pad that is not seated
 * claims a seat by pressing A (standard button 0) or Start (9). Pure: the caller polls
 * and seats (`useMatchConfig.seatPad`, ruling R-P6-11).
 */

const JOIN_BUTTONS = [0, 9] as const;

/**
 * The indices of the connected pads, not in `seated`, whose A or Start went down since
 * the last call. `last` is the caller's, kept between calls: each pad's press, so a held
 * button joins once.
 */
export function joinPresses(pads: readonly (Gamepad | null)[], seated: ReadonlySet<number>, last: Map<number, boolean>): number[] {
  const out: number[] = [];
  for (const pad of pads) {
    if (pad === null || !pad.connected) continue;
    const down = JOIN_BUTTONS.some((b) => pad.buttons[b]?.pressed === true);
    const was = last.get(pad.index) ?? false;
    last.set(pad.index, down);
    if (down && !was && !seated.has(pad.index)) out.push(pad.index);
  }
  return out;
}
