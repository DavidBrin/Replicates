import { Container } from "./Marketing";
import { Marquee } from "./Marquee";
import { LOGO_WALL } from "./copy";

/**
 * The customer wordmark wall.
 *
 * Rendered as flat monochrome type rather than logo files — it keeps the page
 * image-free and self-contained, and reads the same way the real wall does
 * once every logo is knocked back to a single gray.
 */
export function LogoWall() {
  return (
    <section className="pt-4 pb-12 md:pb-16">
      <Container>
        <p className="mkt-eyebrow text-center">{LOGO_WALL.eyebrow}</p>
      </Container>
      <div className="mt-6">
        <Marquee durationSeconds={52}>
          {LOGO_WALL.logos.map((logo) => (
            <span key={logo} className="mkt-wordmark">
              {logo}
            </span>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
