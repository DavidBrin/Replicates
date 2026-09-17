/**
 * Painter unit tests against a recording `DrawSurface` — no jsdom canvas, no
 * `node-canvas`, no image snapshots (SPEC §7).
 *
 * The fake records every fill as `{ color, x, y, width, height }`, so the
 * assertions read as questions about the *picture*: is there a `#BCF1C6` block
 * at the note's tick? does the bar line use the darkest of the three greys?
 * does the label shrink when the note does? That is the layer where a piano
 * roll actually goes wrong.
 */

import { describe, expect, it } from "vitest";

import {
  PATTERN_LENGTH_TICKS,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  TICKS_PER_STEP,
  type Note,
} from "@/domain/types";

import {
  KEYBOARD_WIDTH,
  ROW_HEIGHT,
  createViewport,
  gripRect,
  noteRect,
  pitchToY,
  rowHeight,
  tickToX,
  velocityToY,
} from "./geometry";
import {
  DEFAULT_ROLL_THEME,
  drawGridlines,
  drawKeyboard,
  drawLanes,
  drawNotes,
  drawOutOfPatternOverlay,
  drawPlayhead,
  drawVelocityLane,
  renderPianoRoll,
  truncateLabel,
  type DrawGradient,
  type DrawSurface,
} from "./renderer";

/* ----------------------------------------------------------- the fake -- */

interface FillRecord {
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TextRecord {
  color: string;
  text: string;
  x: number;
  y: number;
}

class RecordingSurface implements DrawSurface {
  fillStyle: string | DrawGradient = "#000000";
  globalAlpha = 1;
  font = "";
  textBaseline = "alphabetic";
  fills: FillRecord[] = [];
  texts: TextRecord[] = [];
  cleared = 0;
  /** 5 px per glyph, 2 px for a dot — enough to exercise the truncation ladder. */
  glyphWidth = 5;
  private stack: { fillStyle: string | DrawGradient; globalAlpha: number }[] = [];

  save(): void {
    this.stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous === undefined) return;
    this.fillStyle = previous.fillStyle;
    this.globalAlpha = previous.globalAlpha;
  }

  clearRect(): void {
    this.cleared += 1;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.fills.push({ color: this.colorName(), x, y, width, height });
  }

  fillText(text: string, x: number, y: number): void {
    this.texts.push({ color: this.colorName(), text, x, y });
  }

  measureText(text: string): { width: number } {
    let width = 0;
    for (const char of text) width += char === "." ? 2 : this.glyphWidth;
    return { width };
  }

  createLinearGradient(): DrawGradient {
    return { addColorStop: () => {} };
  }

  private colorName(): string {
    return typeof this.fillStyle === "string" ? this.fillStyle : "gradient";
  }

  colored(color: string): FillRecord[] {
    return this.fills.filter((fill) => fill.color.toLowerCase() === color.toLowerCase());
  }

  hasFillAt(color: string, x: number, y: number): boolean {
    return this.colored(color).some(
      (fill) =>
        x >= fill.x && x <= fill.x + fill.width && y >= fill.y && y <= fill.y + fill.height,
    );
  }
}

const theme = DEFAULT_ROLL_THEME;

const note = (patch: Partial<Note> = {}): Note => ({
  id: "n-1",
  channelId: "ch-1",
  positionTicks: 0,
  lengthTicks: TICKS_PER_BEAT,
  // G5: inside the roll's default vertical window (C6 at the top).
  pitch: 67,
  velocity: 0.8,
  ...patch,
});

/* --------------------------------------------------------------- tests -- */

describe("lane shading", () => {
  it("tints black-key rows differently from white-key rows", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 400, height: 300 });
    drawLanes(surface, view, theme);

    // G5 (67) is a white key, G#5 (68) is black — adjacent rows, different fill.
    expect(surface.hasFillAt(theme.laneWhite, 200, pitchToY(view, 67) + 2)).toBe(true);
    expect(surface.hasFillAt(theme.laneBlack, 200, pitchToY(view, 68) + 2)).toBe(true);
  });

  it("bands alternating beat columns on top of the row shading", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 400, height: 300 });
    drawLanes(surface, view, theme);

    const bands = surface.colored(theme.beatBand);
    expect(bands.length).toBeGreaterThan(0);
    // Beat 0 is unbanded, beat 1 is banded (lane 1 §3.2).
    expect(bands.some((band) => Math.abs(band.x - tickToX(view, TICKS_PER_BEAT)) < 1)).toBe(true);
    expect(bands.some((band) => Math.abs(band.x - tickToX(view, 0)) < 1)).toBe(false);
  });

  it("never paints over the keyboard column", () => {
    const surface = new RecordingSurface();
    drawLanes(surface, createViewport({ width: 400, height: 300 }), theme);
    expect(surface.fills.every((fill) => fill.x >= KEYBOARD_WIDTH)).toBe(true);
  });
});

describe("gridlines", () => {
  const surface = new RecordingSurface();
  const view = createViewport({ width: 500, height: 300 });
  drawGridlines(surface, view, theme);

  it("draws all three weights, heaviest on the bar", () => {
    const bar = surface.colored(theme.gridBar);
    const beat = surface.colored(theme.gridBeat);
    const step = surface.colored(theme.gridStep);
    expect(bar.length).toBeGreaterThan(0);
    expect(beat.length).toBeGreaterThan(0);
    expect(step.length).toBeGreaterThan(0);
    expect(bar[0]?.width).toBeGreaterThan(beat[0]?.width ?? 0);
    expect(beat[0]?.width).toBe(step[0]?.width);
  });

  it("puts the bar line on the bar, the beat line on the beat", () => {
    expect(
      surface
        .colored(theme.gridBar)
        .some((line) => Math.abs(line.x - tickToX(view, TICKS_PER_BAR)) <= 1),
    ).toBe(true);
    expect(
      surface
        .colored(theme.gridBeat)
        .some((line) => Math.abs(line.x - tickToX(view, TICKS_PER_BEAT)) <= 1),
    ).toBe(true);
  });

  it("flanks each beat line with the lighter hairline", () => {
    expect(surface.colored(theme.gridBeatFlank).length).toBe(
      surface.colored(theme.gridBeat).length,
    );
  });

  it("draws a step line every step and only there", () => {
    const xs = surface.colored(theme.gridStep).map((line) => line.x);
    expect(xs).toContain(Math.round(tickToX(view, TICKS_PER_STEP)));
    expect(xs).not.toContain(Math.round(tickToX(view, TICKS_PER_STEP / 2)));
  });
});

describe("notes", () => {
  it("paints a square-cornered block with top edge, shadow and grip", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 500, height: 320 });
    const target = note({ positionTicks: TICKS_PER_BEAT });
    drawNotes(surface, view, theme, [target]);

    const rect = noteRect(view, target);
    const grip = gripRect(view, target);
    const body = surface.colored(theme.noteBody)[0];
    expect(body).toMatchObject({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });

    const top = surface.colored(theme.noteTop)[0];
    expect(top?.height).toBe(1);
    expect(top?.y).toBe(rect.y);

    const shadow = surface.colored(theme.noteShadow)[0];
    expect(shadow?.y).toBe(rect.y + rect.height - 1);

    const gripFill = surface.colored(theme.noteGrip)[0];
    expect(gripFill?.x).toBeCloseTo(grip.x, 6);
    expect(gripFill?.width).toBeCloseTo(grip.width, 6);
  });

  it("dims a quiet note and brightens a loud one", () => {
    const alphaOf = (velocity: number): number => {
      const surface = new RecordingSurface();
      let recorded = 1;
      const original = surface.fillRect.bind(surface);
      surface.fillRect = (x, y, w, h) => {
        if (surface.fillStyle === theme.noteBody) recorded = surface.globalAlpha;
        original(x, y, w, h);
      };
      drawNotes(surface, createViewport(), theme, [note({ velocity })]);
      return recorded;
    };
    expect(alphaOf(0.2)).toBeLessThan(alphaOf(1));
  });

  it("marks the selection without moving the block", () => {
    const surface = new RecordingSurface();
    const view = createViewport();
    const target = note();
    drawNotes(surface, view, theme, [target], [target.id]);
    expect(surface.colored(theme.noteSelected).length).toBeGreaterThan(0);
    expect(surface.colored(theme.noteBody)[0]?.x).toBe(noteRect(view, target).x);
  });

  it("labels the note with its pitch name, inside its left end", () => {
    const surface = new RecordingSurface();
    const view = createViewport();
    const target = note({ pitch: 71, lengthTicks: TICKS_PER_BAR });
    drawNotes(surface, view, theme, [target]);
    const label = surface.texts[0];
    expect(label?.text).toBe("B5");
    expect(label?.x).toBeCloseTo(noteRect(view, target).x + 2, 6);
  });

  it("skips notes scrolled outside the grid", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 400, height: 300 });
    drawNotes(surface, view, theme, [note({ pitch: 0 })]);
    expect(surface.colored(theme.noteBody)).toHaveLength(0);
  });

  it("paints ghost notes flat grey, behind and unlabelled", () => {
    const surface = new RecordingSurface();
    const view = createViewport();
    renderPianoRoll(surface, view, { notes: [], ghostNotes: [note({ id: "ghost" })] });
    expect(surface.colored(theme.ghostNote).length).toBe(1);
    expect(surface.texts.every((text) => text.color !== theme.noteLabel)).toBe(true);
  });
});

describe("label truncation", () => {
  const surface = new RecordingSurface();

  it("keeps the full name when it fits", () => {
    expect(truncateLabel(surface, "C#5", 100)).toBe("C#5");
  });

  it("degrades to a dotted stub as the note narrows (lane 1 §3.3)", () => {
    expect(truncateLabel(surface, "C#5", 13)).toBe("C#."); // 15 px → 12 px
    expect(truncateLabel(surface, "C#5", 8)).toBe("C."); // 12 px → 7 px
    expect(truncateLabel(surface, "C#5", 5)).toBe(".."); // 7 px → 4 px
    expect(truncateLabel(surface, "C#5", 3)).toBe("");
  });

  it("draws nothing at all when there is no room", () => {
    expect(truncateLabel(surface, "B5", 0)).toBe("");
    expect(truncateLabel(surface, "B5", -20)).toBe("");
  });
});

describe("keyboard column", () => {
  const surface = new RecordingSurface();
  const view = createViewport({ width: 400, height: 320 });
  drawKeyboard(surface, view, theme);

  it("fills white keys with the gradient and black keys with the flat inset bar", () => {
    expect(surface.colored("gradient").length).toBeGreaterThan(0);
    const black = surface.colored(theme.keyBlack);
    expect(black.length).toBeGreaterThan(0);
    // Black keys are shorter — inset from the left edge (lane 1 §3.2).
    expect(black[0]?.width).toBeLessThan(KEYBOARD_WIDTH);
  });

  it("stays inside its 104 px column", () => {
    expect(surface.fills.every((fill) => fill.x + fill.width <= KEYBOARD_WIDTH)).toBe(true);
  });

  it("labels the Cs only", () => {
    expect(surface.texts.length).toBeGreaterThan(0);
    expect(surface.texts.every((text) => text.text.startsWith("C"))).toBe(true);
  });

  it("lights the held preview key", () => {
    const pressed = new RecordingSurface();
    drawKeyboard(pressed, view, theme, 67); // G5 — a white key in view
    expect(pressed.colored(theme.keyPressed).length).toBe(1);
  });
});

describe("velocity lane", () => {
  it("draws one stem per note, at the note's tick and its velocity height", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 500, height: 320 });
    const loud = note({ id: "loud", velocity: 1, positionTicks: 0 });
    const quiet = note({ id: "quiet", velocity: 0.2, positionTicks: TICKS_PER_BEAT });
    drawVelocityLane(surface, view, theme, [loud, quiet]);

    const stems = surface.colored(theme.velocityStem);
    expect(stems.length).toBe(4); // stem + handle cap per note
    const loudStem = stems.find((stem) => stem.x === Math.round(tickToX(view, 0)));
    expect(loudStem?.y).toBeCloseTo(velocityToY(view, 1), 6);
    const quietStem = stems.find(
      (stem) => stem.x === Math.round(tickToX(view, TICKS_PER_BEAT)),
    );
    expect(quietStem?.y).toBeGreaterThan(loudStem?.y ?? 0);
  });

  it("dims the stems of unselected notes once something is selected", () => {
    const surface = new RecordingSurface();
    const view = createViewport();
    drawVelocityLane(
      surface,
      view,
      theme,
      [note({ id: "a" }), note({ id: "b", positionTicks: TICKS_PER_BEAT })],
      ["a"],
    );
    expect(surface.colored(theme.velocityStemDim).length).toBeGreaterThan(0);
    expect(surface.colored(theme.velocityStem).length).toBeGreaterThan(0);
  });

  it("draws nothing when the lane is collapsed", () => {
    const surface = new RecordingSurface();
    drawVelocityLane(surface, createViewport({ velocityLaneHeight: 0 }), theme, [note()]);
    expect(surface.fills).toHaveLength(0);
  });
});

describe("playhead", () => {
  it("draws a full-height line at the playing tick", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 500, height: 320 });
    drawPlayhead(surface, view, theme, TICKS_PER_BEAT);
    const line = surface.colored(theme.playhead)[0];
    expect(line?.x).toBe(Math.round(tickToX(view, TICKS_PER_BEAT)));
    expect(line?.height).toBe(view.height);
    expect(line?.width).toBe(1);
  });

  it("draws nothing when stopped or off-screen", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 300 });
    drawPlayhead(surface, view, theme, null);
    drawPlayhead(surface, view, theme, undefined);
    drawPlayhead(surface, view, theme, 100000);
    expect(surface.fills).toHaveLength(0);
  });
});

describe("full frame", () => {
  it("clears once and paints chrome last, so nothing overlaps the keyboard", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 600, height: 400 });
    renderPianoRoll(surface, view, {
      notes: [note({ positionTicks: TICKS_PER_STEP })],
      selectedNoteIds: [],
      playheadTick: TICKS_PER_BEAT,
    });

    expect(surface.cleared).toBe(1);
    const lastKeyFill = surface.fills.findLastIndex((fill) => fill.color === theme.keyBlack);
    const lastNoteFill = surface.fills.findLastIndex((fill) => fill.color === theme.noteBody);
    expect(lastKeyFill).toBeGreaterThan(lastNoteFill);
  });

  it("paints a whole frame with an empty pattern without throwing", () => {
    const surface = new RecordingSurface();
    expect(() =>
      renderPianoRoll(surface, createViewport({ width: 0, height: 0 }), { notes: [] }),
    ).not.toThrow();
  });

  it("puts row shading exactly one ROW_HEIGHT apart", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 400, height: 300 });
    drawLanes(surface, view, theme);
    const rows = surface.fills.filter(
      (fill) => fill.color === theme.laneWhite || fill.color === theme.laneBlack,
    );
    const first = rows[0];
    const second = rows[1];
    expect(Math.abs((second?.y ?? 0) - (first?.y ?? 0))).toBe(ROW_HEIGHT);
  });

  it("scales row spacing with vertical zoom", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 400, height: 300, zoomY: 2 });
    drawLanes(surface, view, theme);
    const rows = surface.fills.filter(
      (fill) => fill.color === theme.laneWhite || fill.color === theme.laneBlack,
    );
    const first = rows[0];
    const second = rows[1];
    expect(Math.abs((second?.y ?? 0) - (first?.y ?? 0))).toBe(rowHeight(view));
    expect(rowHeight(view)).toBe(ROW_HEIGHT * 2);
  });
});

describe("out-of-pattern overlay", () => {
  it("dims the grid past the pattern's end, and nothing before it", () => {
    const surface = new RecordingSurface();
    // Zoomed out enough that the 1-bar pattern's end is inside the canvas.
    const view = createViewport({ width: 900, height: 300, zoomX: 1 });
    drawOutOfPatternOverlay(surface, view, theme);

    const patternEndX = tickToX(view, PATTERN_LENGTH_TICKS);
    expect(surface.fills.some((fill) => fill.x >= Math.round(patternEndX))).toBe(true);
    expect(surface.fills.every((fill) => fill.x >= Math.round(patternEndX))).toBe(true);
  });

  it("draws nothing when the pattern's end is off the right edge", () => {
    const surface = new RecordingSurface();
    // Zoomed in far enough that tick 384 is well past a 400 px canvas.
    const view = createViewport({ width: 400, height: 300, zoomX: 4 });
    drawOutOfPatternOverlay(surface, view, theme);
    expect(surface.fills).toHaveLength(0);
  });

  it("is part of the full frame, painted before notes and ghost notes", () => {
    const surface = new RecordingSurface();
    const view = createViewport({ width: 900, height: 300 });
    renderPianoRoll(surface, view, { notes: [note({ positionTicks: 0 })] });
    const overlayIndex = surface.fills.findIndex(
      (fill) => fill.x >= Math.round(tickToX(view, PATTERN_LENGTH_TICKS)),
    );
    const noteIndex = surface.fills.findIndex((fill) => fill.color === theme.noteBody);
    expect(overlayIndex).toBeGreaterThanOrEqual(0);
    expect(overlayIndex).toBeLessThan(noteIndex);
  });
});
