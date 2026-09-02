import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { betMeta } from "@/content/articles/meta";
import {
  B,
  Categories,
  ExternalLink,
  Hatnote,
  Infobox,
  P,
  Ref,
  References,
  Section,
  WikiLink,
} from "@/components/wiki";

const project = projects.find((p) => p.slug === "Bet_(app)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Pricing_engine", heading: "Pricing engine" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const bet: ArticleModule = {
  meta: betMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For a comparable public prediction
        market, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Bet (app)"
        rows={[
          { label: "Type", value: "Prediction market" },
          {
            label: "Replica of",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>../{project.folder}</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Bet</B> is a play-money prediction-market application, developed
        in the <code>bet</code> folder of the <code>Replicates</code>{" "}
        repository, scoped to a friend group rather than the general public.
        Each market carries an embedded group chat, alongside a public,
        read-only Explore surface styled after a{" "}
        <ExternalLink href={project.replicaOf.url}>Polymarket</ExternalLink>
        /Kalshi hybrid.
      </P>

      <P>
        Unauthorized reads of a market return a 404 status rather than a 403,
        because a 403 response would confirm the market&apos;s existence.
      </P>

      <Section heading="Overview">
        <P>
          The store is in-memory and resets on a cold start. The application
          has no password authentication.
        </P>
      </Section>

      <Section heading="Pricing engine">
        <P>
          Markets are priced with Robin Hanson&apos;s logarithmic market
          scoring rule (LMSR),<Ref n={1} /> expressed as{" "}
          <code>C(q) = b·ln Σ exp(qᵢ/b)</code>, rather than an order book.
          The project describes the rationale as: &ldquo;a CLOB with six
          friends is an empty book.&rdquo; Three pricing engines use a
          single shared interface: LMSR, fixed odds, and parimutuel.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica carries {project.testStats}, guarded in part by
          property-based tests written with fast-check that check pricing
          invariants; one round-trip property was strengthened after a bug
          was found in which <code>Math.abs</code> had been masking a
          sign-flip. It was built from {project.builtWith.toLowerCase()}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Fake_Phone">Fake Phone</WikiLink>
          </li>
          <li>
            <WikiLink to="Dollar_Pixels">Dollar Pixels</WikiLink>
          </li>
          <li>
            <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>
          </li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">
              Hanson, R. &ldquo;Logarithmic Market Scoring Rules for
              Modular Combinatorial Information Aggregation.&rdquo;{" "}
              <i>Journal of Prediction Markets</i>, 2007.
            </span>,
            <span key="2">
              <code>bet/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Prediction markets"]} />
    </>
  ),
};
