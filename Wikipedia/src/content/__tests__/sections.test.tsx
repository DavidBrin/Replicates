import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
// Imported first and otherwise unused: forces `src/content/articles/index.ts`
// to load — and fully resolve its own module graph — before this file's own
// per-article imports below re-enter that same graph. Without this, the
// individual article imports become the entry point into a real circular
// import (article -> wiki primitives -> registry -> articles index -> the
// same article, still mid-evaluation), and the index's computed-key object
// literal reads `.meta` off an as-yet-unassigned export.
import "@/content/articles";
import { davidsInternet, sections as davidsInternetSections } from "@/content/articles/davids-internet";
import { linear, sections as linearSections } from "@/content/articles/linear";
import { notion, sections as notionSections } from "@/content/articles/notion";
import { youtube, sections as youtubeSections } from "@/content/articles/youtube";
import { superSmash, sections as superSmashSections } from "@/content/articles/super-smash";
import { fakePhone, sections as fakePhoneSections } from "@/content/articles/fake-phone";
import { bet, sections as betSections } from "@/content/articles/bet";
import { dollarPixels, sections as dollarPixelsSections } from "@/content/articles/dollar-pixels";
import { flStudio, sections as flStudioSections } from "@/content/articles/fl-studio";
import { artWall, sections as artWallSections } from "@/content/articles/art-wall";
import { verilog, sections as verilogSections } from "@/content/articles/verilog";
import { nocturnal, sections as nocturnalSections } from "@/content/articles/nocturnal";
import { signals, sections as signalsSections } from "@/content/articles/signals";
import { quantum, sections as quantumSections } from "@/content/articles/quantum";
import { hardhack, sections as hardhackSections } from "@/content/articles/hardhack";
import { esp32, sections as esp32Sections } from "@/content/articles/esp32";
import { organoids, sections as organoidsSections } from "@/content/articles/organoids";
import { spikes, sections as spikesSections } from "@/content/articles/spikes";
import { vision, sections as visionSections } from "@/content/articles/vision";
import { arxiv, sections as arxivSections } from "@/content/articles/arxiv";
import { crossteach, sections as crossteachSections } from "@/content/articles/crossteach";
import { p300, sections as p300Sections } from "@/content/articles/p300";
import { sql, sections as sqlSections } from "@/content/articles/sql";
import { modeling, sections as modelingSections } from "@/content/articles/modeling";
import { earlycode, sections as earlycodeSections } from "@/content/articles/earlycode";
import type { ArticleModule } from "@/lib/registry";

const cases: Array<{ name: string; module: ArticleModule; sections: Array<{ id: string; heading: string }> }> = [
  { name: "David's Internet", module: davidsInternet, sections: davidsInternetSections },
  { name: "Linear (replica)", module: linear, sections: linearSections },
  { name: "Notion (replica)", module: notion, sections: notionSections },
  { name: "YouTube (replica)", module: youtube, sections: youtubeSections },
  { name: "Super Smash (replica)", module: superSmash, sections: superSmashSections },
  { name: "Fake Phone", module: fakePhone, sections: fakePhoneSections },
  { name: "Bet (app)", module: bet, sections: betSections },
  { name: "Dollar Pixels", module: dollarPixels, sections: dollarPixelsSections },
  { name: "FL Studio (replica)", module: flStudio, sections: flStudioSections },
  { name: "Art Wall", module: artWall, sections: artWallSections },
  { name: "Verilog", module: verilog, sections: verilogSections },
  { name: "Nocturnal Neuro", module: nocturnal, sections: nocturnalSections },
  { name: "Signals and Systems Lab", module: signals, sections: signalsSections },
  { name: "Quantum Playground", module: quantum, sections: quantumSections },
  { name: "HardHack 2026", module: hardhack, sections: hardhackSections },
  { name: "ESP32 Thermal TinyML", module: esp32, sections: esp32Sections },
  { name: "Organoids on Psychedelics", module: organoids, sections: organoidsSections },
  { name: "Anatomy of a Spike", module: spikes, sections: spikesSections },
  { name: "Computer Vision", module: vision, sections: visionSections },
  { name: "arXiv Semantic Graph", module: arxiv, sections: arxivSections },
  { name: "Cross-Teaching Segmentation", module: crossteach, sections: crossteachSections },
  { name: "P300 Speller", module: p300, sections: p300Sections },
  { name: "SQL Playground", module: sql, sections: sqlSections },
  { name: "Early 3D Modeling", module: modeling, sections: modelingSections },
  { name: "Early Code", module: earlycode, sections: earlycodeSections },
];

describe("article sections lists match rendered <Section> headings", () => {
  it.each(cases)("$name", ({ module, sections }) => {
    const { container } = render(<>{module.body}</>);
    const headings = Array.from(container.querySelectorAll("h2")).map((h2) => ({
      id: h2.id,
      // Section's h2 wraps the heading text in its own <span>, with an
      // optional [edit] affordance sibling — read only the first child.
      heading: h2.querySelector("span")?.textContent ?? h2.textContent ?? "",
    }));

    expect(headings).toEqual(sections);
  });
});
