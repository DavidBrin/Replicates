import type { ArticleModule } from "@/lib/registry";
import { DAVID_INTERNET_URL, projects } from "@/content/projects";
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

const replicas = projects.filter((p) => p.kind !== "demo");
const demos = projects.filter((p) => p.kind === "demo");

/** Section ids/headings this module renders, for the chrome agent's TOC. */
export const sections: Array<{ id: string; heading: string }> = [
  { id: "Background", heading: "Background" },
  { id: "Replicas", heading: "Replicas" },
  { id: "Interactive_demos", heading: "Interactive demos" },
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
        itself, see{" "}
        <ExternalLink href={DAVID_INTERNET_URL}>David&apos;s Internet</ExternalLink>.
      </Hatnote>

      <Infobox
        title="David's Internet"
        rows={[
          { label: "Type", value: "Portfolio search engine" },
          { label: "Replicas", value: String(replicas.length) },
          { label: "Interactive demos", value: String(demos.length) },
          { label: "Repository", value: <code>Replicates</code> },
          {
            label: "Website",
            value: (
              <ExternalLink href={DAVID_INTERNET_URL}>david-internet.vercel.app</ExternalLink>
            ),
          },
        ]}
      />

      <P>
        <B>David&apos;s Internet</B> is a search engine over software David
        built: working replicas of products such as Linear, Notion and YouTube,
        each in its own folder of the <code>Replicates</code> repository, and
        interactive demos of coursework and lab work hosted on the search
        site itself. This encyclopedia is the channel guide. Every replica
        and every shipped demo has an article, linked from the tables below.
      </P>

      <P>
        The search engine went live in September 2026 at{" "}
        <ExternalLink href={DAVID_INTERNET_URL}>david-internet.vercel.app</ExternalLink>
        . Results look like a Google SERP. A hit opens the live project when
        one exists, or this encyclopedia when it does not.
      </P>

      <Section heading="Background">
        <P>
          The <code>Replicates</code> repository holds from-scratch copies of
          established software products.<Ref n={1} /> Each replica folder
          carries its own{" "}
          <code>README.md</code>, <code>SPEC.md</code>, <code>DECISIONS.md</code>{" "}
          and <code>research/</code> directory. The search engine was the
          first live deployment, in September 2026. Seven replicas are live
          (Linear, Notion, Super Smash, Fake Phone, Bet, FL Studio, and Dollar
          Pixels). YouTube still needs object storage, so its Website link
          stays a red stub. The interactive demos already run on the search
          site, so their Website links are live.
        </P>
      </Section>

      <Section heading="Replicas">
        <P>
          Eight replicas make up that half of the portfolio: an issue tracker,
          a workspace tool, a video platform, a fighting game, a personal-safety
          app, a prediction market, a pixel-grid homepage, and a browser DAW.
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
            {replicas.map((project) => (
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

      <Section heading="Interactive demos">
        <P>
          Fifteen demos run inside David&apos;s Internet rather than on their own
          domains. They cover digital design, signals, TinyML, a hardware
          hackathon, EEG hardware, two Voytek Lab analyses, computer vision,
          a semantic graph of arXiv abstracts, cross-teaching segmentation,
          a P300 speller, SQL labs, early CAD, and first programs.
        </P>
        <WikiTable>
          <thead>
            <tr>
              <th>Demo</th>
              <th>Origin</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {demos.map((project) => (
              <tr key={project.slug}>
                <td>
                  <WikiLink to={project.slug}>{project.name}</WikiLink>
                </td>
                <td>{project.replicaOf.name}</td>
                <td>{project.tagline}</td>
              </tr>
            ))}
          </tbody>
        </WikiTable>
      </Section>

      <Section heading="Methodology">
        <P>
          Each replica starts with parallel research lanes that gather facts
          about the real product, then a sequence of build slices that
          implement it. Lane and slice counts follow the project&apos;s scope.
          The YouTube replica used nine research lanes and twelve build
          slices, the Dollar Pixels replica used five of each, and Bet used a
          14-task plan with an implementer, an independent reviewer, and a
          fix loop per task instead of the lane/slice split.
        </P>
        <P>
          Independent review after implementation is the other recurring
          pattern. The Linear replica&apos;s three review rounds found 18, 20
          and 7 issues, including a CSS <code>url()</code> injection
          vulnerability. The YouTube replica&apos;s five review rounds found
          roughly 72 findings in total.
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
            <WikiLink to="ESP32_Thermal_TinyML">ESP32 Thermal TinyML</WikiLink>
          </li>
          <li>
            <WikiLink to="Anatomy_of_a_Spike">Anatomy of a Spike</WikiLink>
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
