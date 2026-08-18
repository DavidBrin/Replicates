import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
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

const project = projects.find((p) => p.slug === "Linear_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "Reception", heading: "Reception" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const linear: ArticleModule = {
  meta: {
    slug: project.slug,
    title: "Linear (replica)",
    shortDescription: "A rebuild of the Linear issue tracker",
    categories: ["Software replicas", "Issue tracking systems"],
    lastEdited: "18 August 2026",
  },
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the product it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Linear (replica)"
        image={
          <Image
            src="/images/Linear_(replica).png"
            alt="Screenshot of the Linear replica's issue list view"
            width={300}
            height={188}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Issue tracking software" },
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
        <B>Linear (replica)</B> is a rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>Linear</ExternalLink>, the
        issue-tracking software, developed in the <code>Linear</code> folder
        of the <code>Replicates</code> repository. It reproduces Linear&apos;s
        issues, projects and teams, with membership enforced across four
        permission roles.
      </P>

      <P>
        The replica adds a per-team DAG (directed acyclic graph) tab, a view
        the real product does not offer.
      </P>

      <Section heading="Overview">
        <P>
          The replica covers issue tracking, project management and team
          membership across four permission levels. Its visual details were
          measured from the running Linear product rather than its marketing
          site: the interface chrome uses a background of <code>#09090a</code>{" "}
          around a <code>#121213</code> pane, colors read directly off the
          live application.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          The status-glyph progress wedge is drawn at radius 1.94 rather than
          2 — a deliberate 3% shortfall reproduced from the measured product.
          Issue ordering uses fractional-index string comparison instead of
          Linear&apos;s own floating-point <code>sortOrder</code> field, since
          floats run out of double-precision headroom after roughly 50 inserts
          into a single gap; the database declares <code>collate &quot;C&quot;</code>{" "}
          explicitly to keep that string ordering deterministic. Authorization
          is implemented as a single table checked exhaustively by the
          TypeScript compiler via <code>satisfies</code>, backed by a
          hand-transcribed 416-case test matrix.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica is built on Next.js 16 with PGlite for local
          development and Neon in production. It carries {project.testStats}{" "}
          according to the project&apos;s own <code>README.md</code>,
          though the root repository&apos;s README states a stale figure of
          1,314 unit tests and 9 e2e tests.<Ref n={1} /> It was built across{" "}
          {project.builtWith.toLowerCase()}.
        </P>
      </Section>

      <Section heading="Reception">
        <P>
          According to the project&apos;s decision log, three rounds of
          automated code review found 18, 20 and 7 issues respectively,
          including a CSS <code>url()</code> injection vulnerability reachable
          through label names, an invite endpoint that leaked a user&apos;s
          email address, and unthrottled scrypt-hashing endpoints.<Ref n={2} />
        </P>
      </Section>

      <Section heading="See also" editable={false}>
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Notion_(replica)">Notion (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="YouTube_(replica)">YouTube (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>
          </li>
        </ul>
      </Section>

      <Section heading="References" editable={false}>
        <References
          refs={[
            <span key="1">
              <code>Linear/README.md</code>.
            </span>,
            <span key="2">
              <code>Linear/DECISIONS.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Issue tracking systems"]} />
    </>
  ),
};
