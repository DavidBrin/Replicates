import type { ArticleMeta } from "@/lib/registry";
import { projects } from "@/content/projects";

/**
 * Every article's `ArticleMeta` record, and nothing else.
 *
 * This module deliberately imports only `@/content/projects` (plain data)
 * and never any article body module (`./linear`, `./notion`, …). Search,
 * existence checks and "random article" all run off `articleMetas` rather
 * than the full `articles` registry in `./index.ts`, so a client component
 * that only needs metadata (`SearchBox`, `Navigation`, `WikiLink`) never
 * pulls the ~82KB of article JSX into its bundle. See
 * `src/lib/__tests__/bundle.build.test.ts` for the guard.
 */

function projectSlug(name: string): string {
  const project = projects.find((p) => p.name === name);
  if (!project) throw new Error(`no project named "${name}" in @/content/projects`);
  return project.slug;
}

export const davidsInternetMeta: ArticleMeta = {
  slug: "Davids_Internet",
  title: "David's Internet",
  shortDescription: "A search engine over a portfolio of software replicas",
  categories: ["Portfolio indexes", "Software replicas", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const linearMeta: ArticleMeta = {
  slug: projectSlug("Linear"),
  title: "Linear (replica)",
  shortDescription: "A rebuild of the Linear issue tracker",
  categories: ["Software replicas", "Issue tracking systems"],
  lastEdited: "18 August 2026",
};

export const notionMeta: ArticleMeta = {
  slug: projectSlug("Notion"),
  title: "Notion (replica)",
  shortDescription: "A rebuild of the Notion workspace tool, entirely client-side",
  categories: ["Software replicas", "Note-taking software"],
  lastEdited: "18 August 2026",
};

export const youtubeMeta: ArticleMeta = {
  slug: projectSlug("YouTube"),
  title: "YouTube (replica)",
  shortDescription: "A rebuild of YouTube's core video platform",
  categories: ["Software replicas", "Video hosting services"],
  lastEdited: "18 August 2026",
};

export const superSmashMeta: ArticleMeta = {
  slug: projectSlug("Super Smash"),
  title: "Super Smash (replica)",
  shortDescription: "A browser rebuild of Super Smash Bros. Ultimate's versus mode",
  categories: ["Software replicas", "Fighting games", "Browser games"],
  lastEdited: "18 August 2026",
};

export const fakePhoneMeta: ArticleMeta = {
  slug: projectSlug("Fake Phone"),
  title: "Fake Phone",
  shortDescription: "A personal-safety app replicating iOS and Android incoming-call screens",
  categories: ["Software replicas", "Personal safety software", "Progressive web applications"],
  lastEdited: "18 August 2026",
};

export const betMeta: ArticleMeta = {
  slug: projectSlug("Bet"),
  title: "Bet (app)",
  shortDescription: "A private, friend-first prediction market",
  categories: ["Software replicas", "Prediction markets"],
  lastEdited: "18 August 2026",
};

export const dollarPixelsMeta: ArticleMeta = {
  slug: projectSlug("Dollar Pixels"),
  title: "Dollar Pixels",
  shortDescription: "A rebuild of the Million Dollar Homepage",
  categories: ["Software replicas", "Advertising websites"],
  lastEdited: "18 August 2026",
};

export const flStudioMeta: ArticleMeta = {
  slug: projectSlug("FL Studio"),
  title: "FL Studio (replica)",
  shortDescription: "A browser rebuild of FL Studio's Channel Rack, Piano Roll, Playlist, and Mixer",
  categories: ["Software replicas", "Digital audio workstations", "Browser applications"],
  lastEdited: "1 September 2026",
};

export const verilogMeta: ArticleMeta = {
  slug: projectSlug("Verilog"),
  title: "Verilog",
  shortDescription: "An interactive demo of an 8-state Viterbi decoder and an RTL module shelf",
  categories: ["Interactive demos", "Digital design", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const nocturnalMeta: ArticleMeta = {
  slug: projectSlug("Nocturnal Neuro"),
  title: "Nocturnal Neuro",
  shortDescription: "An EEG wearable demo covering a PCB rework, a recorded brainwave, and a venture canvas",
  categories: ["Interactive demos", "Neurotechnology", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const signalsMeta: ArticleMeta = {
  slug: projectSlug("Signals and Systems Lab"),
  title: "Signals and Systems Lab",
  shortDescription: "Five ECE 101 signal-processing labs running in the browser",
  categories: ["Interactive demos", "Signal processing", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const quantumMeta: ArticleMeta = {
  slug: projectSlug("Quantum Playground"),
  title: "Quantum Playground",
  shortDescription: "A browser state-vector simulator of algorithms from a DTU quantum information course",
  categories: ["Interactive demos", "Quantum computing", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const hardhackMeta: ArticleMeta = {
  slug: projectSlug("HardHack 2026"),
  title: "HardHack 2026",
  shortDescription: "A browser simulation of a hardware-hackathon break-in detector",
  categories: ["Interactive demos", "Embedded systems", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const esp32Meta: ArticleMeta = {
  slug: projectSlug("ESP32 Thermal TinyML"),
  title: "ESP32 Thermal TinyML",
  shortDescription: "A TinyML pipeline from an 8 by 8 thermal camera to an INT8 model on an ESP32",
  categories: ["Interactive demos", "Machine learning", "Embedded systems", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const organoidsMeta: ArticleMeta = {
  slug: projectSlug("Organoids on Psychedelics"),
  title: "Organoids on Psychedelics",
  shortDescription: "A chaptered demo of cortical-organoid electrophysiology under psychedelic compounds",
  categories: ["Interactive demos", "Neuroscience", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const spikesMeta: ArticleMeta = {
  slug: projectSlug("Anatomy of a Spike"),
  title: "Anatomy of a Spike",
  shortDescription: "A live fit of primate action potentials on public patch-clamp data",
  categories: ["Interactive demos", "Neuroscience", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const visionMeta: ArticleMeta = {
  slug: projectSlug("Computer Vision"),
  title: "Computer Vision",
  shortDescription: "Classical computer-vision coursework running live in the browser",
  categories: ["Interactive demos", "Computer vision", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const arxivMeta: ArticleMeta = {
  slug: projectSlug("arXiv Semantic Graph"),
  title: "arXiv Semantic Graph",
  shortDescription: "A semantic graph of arXiv abstracts with a live similarity threshold",
  categories: ["Interactive demos", "Information retrieval", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const crossteachMeta: ArticleMeta = {
  slug: projectSlug("Cross-Teaching Segmentation"),
  title: "Cross-Teaching Segmentation",
  shortDescription: "A U-Net and a Vision Transformer swapping pseudo-labels on unlabeled images",
  categories: ["Interactive demos", "Machine learning", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const p300Meta: ArticleMeta = {
  slug: projectSlug("P300 Speller"),
  title: "P300 Speller",
  shortDescription: "A brain-computer-interface speller driven by an evoked potential",
  categories: ["Interactive demos", "Neurotechnology", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const sqlMeta: ArticleMeta = {
  slug: projectSlug("SQL Playground"),
  title: "SQL Playground",
  shortDescription: "Five course databases running in the browser through SQLite in WebAssembly",
  categories: ["Interactive demos", "Databases", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const modelingMeta: ArticleMeta = {
  slug: projectSlug("Early 3D Modeling"),
  title: "Early 3D Modeling",
  shortDescription: "High-school Inventor CAD stories and VEXcode VR programs in a live 2D sim",
  categories: ["Interactive demos", "Computer-aided design", "2026 establishments"],
  lastEdited: "1 September 2026",
};

export const earlycodeMeta: ArticleMeta = {
  slug: projectSlug("Early Code"),
  title: "Early Code",
  shortDescription: "A timeline of first programs, from a C++ final to Aho-Corasick from scratch",
  categories: ["Interactive demos", "Programming education", "2026 establishments"],
  lastEdited: "1 September 2026",
};

/** Every registered article's metadata, in registry order. */
export const articleMetas: ArticleMeta[] = [
  davidsInternetMeta,
  linearMeta,
  notionMeta,
  youtubeMeta,
  superSmashMeta,
  fakePhoneMeta,
  betMeta,
  dollarPixelsMeta,
  flStudioMeta,
  verilogMeta,
  nocturnalMeta,
  signalsMeta,
  quantumMeta,
  hardhackMeta,
  esp32Meta,
  organoidsMeta,
  spikesMeta,
  visionMeta,
  arxivMeta,
  crossteachMeta,
  p300Meta,
  sqlMeta,
  modelingMeta,
  earlycodeMeta,
];
