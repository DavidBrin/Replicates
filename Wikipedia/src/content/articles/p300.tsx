import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { p300Meta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "P300_Speller")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Speller", heading: "Speller" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const p300: ArticleModule = {
  meta: p300Meta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="P300 Speller"
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
          { label: "Hosted on", value: <code>David-Internet/demos/p300</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>P300 Speller</B> is an interactive demonstration of a
        brain-computer-interface speller that classifies an evoked potential
        over a flashing character matrix.<Ref n={1} /> It is based on work
        studied on Triton Neurotech&apos;s ML team, using the open-source
        p300-speller project by Carzaniga and Gualniera on BCI Competition III
        dataset II.
      </P>

      <P>
        A 6 by 6 matrix flashes rows and columns at{" "}
        <B>100 milliseconds on and 75 milliseconds off</B>, for 15 repetitions,
        over scrolling synthetic eight-channel EEG. Target flashes carry a
        P300 that only becomes visible as epochs average.
      </P>

      <Section heading="Overview">
        <P>
          The page maps a 1D-CNN family (CNN1 through CNN3 and MCNN1 through
          MCNN3) onto a 64-electrode head map and quotes committed notebook
          outputs: roughly 73 to 80 percent window accuracy, with character
          accuracy climbing from 37 percent to 94 percent as repetitions
          accumulate.
        </P>
      </Section>

      <Section heading="Speller">
        <P>
          Visitors pick a target letter and watch row and column scores
          accumulate until the letter locks in. An SNR slider shows why more
          repetitions help. The decoding logic is a TypeScript port of the
          original letter-scoring path, not a cartoon substitute.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          {project.testStats}. Results panels quote the notebooks rather than
          re-training the CNNs in the browser.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Anatomy_of_a_Spike">Anatomy of a Spike</WikiLink></li>
          <li><WikiLink to="Nocturnal_Neuro">Nocturnal Neuro</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/p300/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Neurotechnology", "2026 establishments"]} />
    </>
  ),
};
