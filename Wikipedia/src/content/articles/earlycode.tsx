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
        <B>Early Code</B> is an interactive demonstration of David&apos;s
        earliest programs, written between 2021 and 2024, arranged as a
        timeline with one live widget per era. Every widget is a disclosed
        TypeScript port of the original code, fixture-tested at build against
        pure-Python references.<Ref n={1} />
      </P>

      <P>
        The timeline opens with a 2021 C++ final that re-runs over its actual
        input files in a fake terminal, quirks preserved: the original
        swallows the header line, reads out-of-range numbers without
        tallying them, and reports a most frequent value of zero when nothing
        tallies. It closes at a PyTorch tutorial notebook that is referenced
        but not re-run, because its dataset was never archived.
      </P>

      <Section heading="Overview">
        <P>
          Between those endpoints sit the UCSD years. A CSE 12 panel animates
          the appends, shifts and capacity doubling of David&apos;s
          ArrayList, and plays rock-paper-scissors against the original
          winner logic. A CSE 15L panel replays the chat and doc-search URL
          handlers request by request on a mini browser, with the handler
          branch highlighting as each request arrives, and reproduces the
          JUnit lab&apos;s planted merge bug: one test passes, one times out
          at 500 ms, and a one-line fix turns it green.
        </P>
      </Section>

      <Section heading="Aho-Corasick">
        <P>
          The final panel is an Aho-Corasick automaton implemented from
          scratch for the page. The trie grows node by node, failure links
          attach in breadth-first order, and a cursor walks the visitor&apos;s
          text emitting match tuples. Over the film-title patterns from
          David&apos;s CSE 100 notebook the automaton has 106 nodes, the same
          count the notebook obtained from the pyahocorasick library; the
          notebook itself only counted nodes, so the build, matching and
          animation are new work, and the page says so.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The course-provided server scaffold is credited to the CSE 15L
          staff; David wrote the handlers. The doc-search corpus is a
          synthetic 30-document stand-in for a corpus that is not shipped,
          and the archived Java is gathered at build with the student ID and
          email scrubbed. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Early_3D_Modeling">Early 3D Modeling</WikiLink>
          </li>
          <li>
            <WikiLink to="Computer_Vision">Computer Vision</WikiLink>
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
              <code>content/earlycode/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Programming education", "2026 establishments"]} />
    </>
  ),
};
