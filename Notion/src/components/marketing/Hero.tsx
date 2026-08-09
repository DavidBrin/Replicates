import { Container } from "./Marketing";
import { AppMockup } from "./AppMockup";
import { CtaPair } from "./CtaPair";
import { HeroPill } from "./HeroPill";
import { StickerRail } from "./StickerRail";
import { DoodleFace } from "./icons";
import { HERO } from "./copy";

/** Ring + fill pairs for the avatar pile, drawn from the marketing palette. */
const AVATARS = [
  { ring: "#097FE8", fill: "#E6F3FE" },
  { ring: "#DFDCD9", fill: "#F9F9F8" },
  { ring: "#62AEF0", fill: "#F2F9FF" },
  { ring: "#A39E98", fill: "#F6F5F4" },
  { ring: "#005BAB", fill: "#E6F3FE" },
  { ring: "#93CDFE", fill: "#F2F9FF" },
  { ring: "#31302E", fill: "#F9F9F8" },
];

/**
 * The hero.
 *
 * A server component — only the two genuinely interactive pieces (the morphing
 * word pill and the scroll-parallax sticker rail) ship JavaScript.
 */
export function Hero() {
  return (
    <section className="mkt-hero">
      {/* Decorative rail lives behind the content and never intercepts input */}
      <StickerRail />

      <Container hero className="relative z-[2]">
        {/* -- overlapping avatar pile ------------------------------------ */}
        <div className="mkt-avatars">
          {AVATARS.map((avatar, i) => (
            <span
              key={i}
              className="grid size-14 shrink-0 place-items-center rounded-full"
              style={{
                background: avatar.fill,
                boxShadow: `0 0 0 3px ${avatar.ring}, 0 0 0 5px #fff`,
                zIndex: i,
              }}
              aria-hidden="true"
            >
              <DoodleFace variant={i} size={44} />
            </span>
          ))}
        </div>

        <h1 className="mkt-h1">
          {HERO.headlinePrefix} <HeroPill /> {HERO.headlineSuffix}
        </h1>

        <p className="mkt-deck mx-auto mt-6 max-w-[640px]">{HERO.deck}</p>

        <CtaPair className="mt-8" />
      </Container>

      {/* -- product surface ------------------------------------------------
          No browser chrome: the real site shows the app itself, framed only by
          a hairline and dissolved into the page by the gradient below. */}
      <Container className="relative z-[2] mt-12 md:mt-16">
        <div className="mkt-heroshot">
          <AppMockup />
          <div className="mkt-heroshot__fade" aria-hidden="true" />
        </div>
      </Container>
    </section>
  );
}
