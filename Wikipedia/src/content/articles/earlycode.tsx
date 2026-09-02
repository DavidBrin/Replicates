import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { earlycodeMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Early_Code")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Aho-Corasick", heading: "Aho-Corasick" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const earlycode: ArticleModule = {
  meta: earlycodeMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Early Code"
        rows={[
          { label: "Type", value: "Interactive demo" },
          {
            label: "Origin",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Hosted on", value: <code>David-Internet/demos/earlycode</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Early Code</B> is an interactive timeline of David&apos;s earliest
        programs from 2021 to 2024, each with a live widget.<Ref n={1} /> It
        covers a C++ final, CSE 12 data structures, CSE 15L URL handlers, a
        planted JUnit bug, and a from-scratch string matcher.
      </P>

      <P>
        The C++ final re-runs over its original numbers files in a fake
        terminal, quirks included. MyArrayList animates inserts, shifts, and
        capacity doubling. A mini browser replays chat and doc-search handlers
        request by request.
      </P>

      <Section heading="Overview">
        <P>
          Five live widgets are disclosed TypeScript ports. Course-provided
          server code is credited as such. The page ends at
          CardClassifier.ipynb, a PyTorch tutorial referenced but not re-run
          because its dataset is not archived.
        </P>
      </Section>

      <Section heading="Aho-Corasick">
        <P>
          The centerpiece is a from-scratch implementation: the{" "}
          <B>Aho-Corasick automaton grows its trie</B> and failure links live
          and matches Fast &amp; Furious titles from a CSE 100 notebook, with
          the same 106 nodes the pyahocorasick library reported.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          {project.testStats}. The JUnit lab&apos;s planted merge bug fails by
          timeout and then applies a one-line fix on the page.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Early_3D_Modeling">Early 3D Modeling</WikiLink></li>
          <li><WikiLink to="Verilog">Verilog</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/earlycode/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Programming education", "2026 establishments"]} />
    </>
  ),
};
