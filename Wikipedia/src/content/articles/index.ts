import type { ArticleRegistry } from "@/lib/registry";
import { davidsInternet } from "./davids-internet";
import { linear } from "./linear";
import { notion } from "./notion";
import { youtube } from "./youtube";
import { superSmash } from "./super-smash";
import { fakePhone } from "./fake-phone";
import { bet } from "./bet";
import { dollarPixels } from "./dollar-pixels";
import { flStudio } from "./fl-studio";
import { artWall } from "./art-wall";
import { verilog } from "./verilog";
import { nocturnal } from "./nocturnal";
import { signals } from "./signals";
import { quantum } from "./quantum";
import { hardhack } from "./hardhack";
import { esp32 } from "./esp32";
import { organoids } from "./organoids";
import { spikes } from "./spikes";
import { vision } from "./vision";
import { arxiv } from "./arxiv";
import { crossteach } from "./crossteach";
import { p300 } from "./p300";
import { sql } from "./sql";
import { modeling } from "./modeling";
import { earlycode } from "./earlycode";

// `Sandbox` (./sandbox.tsx) proved the registry -> primitives pipeline and
// stays on disk, unregistered, as a reference for future article authoring.
export const articles: ArticleRegistry = {
  [davidsInternet.meta.slug]: davidsInternet,
  [linear.meta.slug]: linear,
  [notion.meta.slug]: notion,
  [youtube.meta.slug]: youtube,
  [superSmash.meta.slug]: superSmash,
  [fakePhone.meta.slug]: fakePhone,
  [bet.meta.slug]: bet,
  [dollarPixels.meta.slug]: dollarPixels,
  [flStudio.meta.slug]: flStudio,
  [artWall.meta.slug]: artWall,
  [verilog.meta.slug]: verilog,
  [nocturnal.meta.slug]: nocturnal,
  [signals.meta.slug]: signals,
  [quantum.meta.slug]: quantum,
  [hardhack.meta.slug]: hardhack,
  [esp32.meta.slug]: esp32,
  [organoids.meta.slug]: organoids,
  [spikes.meta.slug]: spikes,
  [vision.meta.slug]: vision,
  [arxiv.meta.slug]: arxiv,
  [crossteach.meta.slug]: crossteach,
  [p300.meta.slug]: p300,
  [sql.meta.slug]: sql,
  [modeling.meta.slug]: modeling,
  [earlycode.meta.slug]: earlycode,
};
