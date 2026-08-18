import type { ArticleRegistry } from "@/lib/registry";
import { davidsInternet } from "./davids-internet";
import { linear } from "./linear";
import { notion } from "./notion";
import { youtube } from "./youtube";
import { superSmash } from "./super-smash";
import { fakePhone } from "./fake-phone";
import { bet } from "./bet";
import { dollarPixels } from "./dollar-pixels";

// `Sandbox` (./sandbox.tsx) proved the registry -> primitives pipeline and
// stays on disk, unregistered, as a reference for future article authoring —
// see SPEC.md and the eight modules below for the real encyclopedia content.
export const articles: ArticleRegistry = {
  [davidsInternet.meta.slug]: davidsInternet,
  [linear.meta.slug]: linear,
  [notion.meta.slug]: notion,
  [youtube.meta.slug]: youtube,
  [superSmash.meta.slug]: superSmash,
  [fakePhone.meta.slug]: fakePhone,
  [bet.meta.slug]: bet,
  [dollarPixels.meta.slug]: dollarPixels,
};
