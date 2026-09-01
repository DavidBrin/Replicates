import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { davidsInternetMeta } from "@/content/articles/meta";
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
  WikiTable,
} from "@/components/wiki";

/** Section ids/headings this module renders, for the chrome agent's TOC. */
export const sections: Array<{ id: string; heading: string }> = [
  { id: "Background", heading: "Background" },
  { id: "Projects", heading: "Projects" },
  { id: "Methodology", heading: "Methodology" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const davidsInternet: ArticleModule = {
  meta: davidsInternetMeta,
  body: (
    <>
      <Hatnote>
        This article is about the portfolio index. For the search engine
        itself, see the live site at{" "}
        <ExternalLink href="https://david-internet.vercel.app">
          david-internet.vercel.app
        </ExternalLink>
        .
      </Hatnote>

      <Infobox
        title="David's Internet"
        rows={[
          { label: "Type", value: "Portfolio index" },
          { label: "No. of projects", value: String(projects.length) },
          { label: "Repository", value: <code>Replicates</code> },
          {
            label: "Website",
            value: (
              <ExternalLink href="https://david-internet.vercel.app">
                david-internet.vercel.app
              </ExternalLink>
            ),
          },
        ]}
      />

      <P>
        <B>David&apos;s Internet</B> is a search engine that runs over a
        portfolio of software replicas built by David — working
        rebuilds of established products such as Linear, Notion and YouTube,
        each developed inside its own self-contained folder of the{" "}
        <code>Replicates</code> repository. This encyclopedia is the
        project&apos;s channel guide: a Wikipedia-style reference in which
        every replica has its own article, cross-linked from this index.
      </P>

      <P>
        The search engine went live in September 2026 at{" "}
        <ExternalLink href="https://david-internet.vercel.app">
          david-internet.vercel.app
        </ExternalLink>
        ; the seven replicas listed below, and the encyclopedia describing
        them, make up the portfolio it indexes.
      </P>

      <Section heading="Background">
        <P>
          The <code>Replicates</code> repository frames its own purpose as
          &ldquo;exploring agentic software development through building
          established software products from scratch in just a few
          prompts.&rdquo;<Ref n={1} /> Each project folder is self-contained,
          carrying its own <code>README.md</code>, <code>SPEC.md</code>,{" "}
          <code>DECISIONS.md</code> and <code>research/</code> directory, and
          each is developed independently of its siblings. The search engine
          became the portfolio&apos;s first live deployment in September
          2026; none of the seven replicas is deployed yet, which is why
          their &ldquo;Website&rdquo; links in this encyclopedia render as
          stubs until a URL is filled in.
        </P>
      </Section>

      <Section heading="Projects">
        <P>
          Seven projects make up the portfolio at the time of writing, spanning
          an issue tracker, a workspace tool, a video platform, a fighting
          game, a personal-safety app, a prediction market and a pixel-grid
          homepage.
        </P>
        <WikiTable>
          <thead>
            <tr>
              <th>Project</th>
              <th>Replica of</th>
              <th>Description</th>
              <th>Tests</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.slug}>
                <td>
                  <WikiLink to={project.slug}>{project.name}</WikiLink>
                </td>
                <td>{project.replicaOf.name}</td>
                <td>{project.tagline}</td>
                <td>{project.testStats}</td>
              </tr>
            ))}
          </tbody>
        </WikiTable>
      </Section>

      <Section heading="Methodology">
        <P>
          Every project in the portfolio is built through the same broad
          pattern: a set of parallel &ldquo;research lanes&rdquo; gather
          facts about the real product before any code is written, followed
          by a sequence of &ldquo;build slices&rdquo; that implement it in
          stages. The lane and slice counts vary by project&apos;s scope —
          the YouTube replica used nine research lanes and twelve build
          slices, the Dollar Pixels replica used five of each, and Bet used a
          14-task plan with an implementer, an independent reviewer, and a
          fix loop per task instead of the lane/slice split.
        </P>
        <P>
          A second recurring pattern is independent review after
          implementation: several projects record multiple rounds of
          automated code review that surfaced concrete defects — the Linear
          replica&apos;s three review rounds found 18, 20 and 7 issues
          respectively, including a CSS <code>url()</code> injection
          vulnerability, and the YouTube replica&apos;s five review rounds
          found roughly 72 findings in total.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Linear_(replica)">Linear (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="YouTube_(replica)">YouTube (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Dollar_Pixels">Dollar Pixels</WikiLink>
          </li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1">
              &ldquo;Replicates.&rdquo; Root <code>README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Portfolio indexes", "Software replicas", "2026 establishments"]} />
    </>
  ),
};
