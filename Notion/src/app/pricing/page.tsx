import type { Metadata } from "next";
import { brand } from "@/config/app.config";
import { Container, Marketing } from "@/components/marketing/Marketing";
import { Nav } from "@/components/marketing/Nav";
import { PricingCards } from "@/components/marketing/PricingCards";
import { CtaBand } from "@/components/marketing/CtaBand";
import { Footer } from "@/components/marketing/Footer";

export const metadata: Metadata = {
  title: `Pricing — ${brand.name}`,
  description: `Plans for individuals, teams and enterprises on ${brand.name}.`,
};

/** Plans page: same shell as the landing page, four cards, nothing else. */
export default function PricingPage() {
  return (
    <Marketing>
      <Nav />
      <main>
        <section className="pt-16 pb-12 text-center">
          <Container hero>
            <h1 className="mkt-h2 mkt-h2--display">
              Find the plan that fits.
            </h1>
            <p className="mkt-deck mx-auto mt-4 max-w-[46ch]">
              Start free, upgrade when your team does. Every plan includes
              unlimited pages, real-time collaboration and the mobile apps.
            </p>
          </Container>
        </section>

        <PricingCards />
        <CtaBand />
      </main>
      <Footer />
    </Marketing>
  );
}
