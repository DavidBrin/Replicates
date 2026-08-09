import { Container } from "./Marketing";
import { CtaPair } from "./CtaPair";
import { CTA_BAND } from "./copy";

/**
 * The closing call to action.
 *
 * Full-bleed warm gray — #F6F5F4, not a neutral #F5F5F5; the warmth is what
 * makes the band read as Notion rather than as a default section tint. Also
 * the anchor target for every "Request a demo" link on the page.
 */
export function CtaBand() {
  return (
    <section
      id="request-demo"
      className="scroll-mt-16"
      style={{ background: "var(--mkt-gray-200)", padding: "64px 0" }}
    >
      <Container className="text-center">
        <h2 className="mkt-h2 mkt-h2--display">{CTA_BAND.heading}</h2>
        <p className="mkt-deck mx-auto mt-4 max-w-[46ch]">{CTA_BAND.deck}</p>
        <CtaPair className="mt-8" />
      </Container>
    </section>
  );
}
