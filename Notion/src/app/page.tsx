import type { Metadata } from "next";
import { brand } from "@/config/app.config";
import { Marketing } from "@/components/marketing/Marketing";
import { Nav } from "@/components/marketing/Nav";
import { Hero } from "@/components/marketing/Hero";
import { LogoWall } from "@/components/marketing/LogoWall";
import { FeatureSection } from "@/components/marketing/FeatureSection";
import {
  FEATURE_AGENTS,
  FEATURE_ASSISTANTS,
  FEATURE_WORKSPACE,
} from "@/components/marketing/features";
import { Stats } from "@/components/marketing/Stats";
import { Testimonials } from "@/components/marketing/Testimonials";
import { CtaBand } from "@/components/marketing/CtaBand";
import { Footer } from "@/components/marketing/Footer";

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: brand.description,
};

/**
 * The marketing landing page.
 *
 * Intentionally a *server* component: the only JavaScript that reaches the
 * browser is the handful of genuinely interactive leaves (nav, hero pill +
 * sticker parallax, feature tabs, testimonial rotation, the footer's language
 * menu). Everything else — the mockups, the marquees — renders to static
 * HTML.
 */
export default function HomePage() {
  return (
    <Marketing>
      <Nav />
      <main>
        <Hero />
        <LogoWall />
        <FeatureSection {...FEATURE_AGENTS} />
        <FeatureSection {...FEATURE_ASSISTANTS} />
        <Stats />
        <FeatureSection {...FEATURE_WORKSPACE} />
        <Testimonials />
        <CtaBand />
      </main>
      <Footer />
    </Marketing>
  );
}
