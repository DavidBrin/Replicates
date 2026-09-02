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
  { id: "Speller_paradigm", heading: "Speller paradigm" },
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
        brain-computer-interface speller that David studied on Triton
        Neurotech&apos;s machine-learning team at UC San Diego. The codebase
        and all quoted results are the open-source p300-speller project by
        Manuel Carzaniga and Lorenzo Gualniera, which trains convolutional
        networks on BCI Competition III dataset II.<Ref n={1} />
      </P>

      <P>
        The page runs a live simulation of the speller on labeled synthetic
        EEG. A six-by-six character matrix flashes rows and columns at the
        study&apos;s cadence of 100 ms on and 75 ms off, a P300 wave rises
        out of the averaged target-flash epochs, and the project&apos;s
        letter-decoding logic, ported to TypeScript, accumulates row and
        column scores until a letter locks in.
      </P>

      <Section heading="Overview">
        <P>
          The speller panel includes a signal-strength slider, a
          photosensitivity warning that gates the flashing, and a
          reduced-motion mode. A classifier panel presents the 650 ms
          window as the network&apos;s input image, the five-layer 1D CNN,
          and a 64-electrode head map with every electrode subset the model
          family used: all 64 channels, a hand-picked set of eight classic
          P300 sites, a learned set of eight, and six single lobes. A results
          panel shows the committed notebook outputs for subject B: window
          accuracy between roughly 73 and 80 percent across CNN1 through CNN3
          and the MCNN ensembles, character accuracy climbing from 37 percent
          at one repetition to 94 percent at fifteen, and the 100-letter test
          sentence the pipeline spelled, mistakes highlighted.
        </P>
      </Section>

      <Section heading="Speller paradigm">
        <P>
          The speller is an oddball paradigm. Only two of twelve flashes in a
          repetition contain the target character, and those target flashes
          evoke a P300, a positive deflection near 300 ms after the stimulus.
          The response is too small to see in a single epoch, so the decoder
          averages classifier scores across repetitions before choosing the
          strongest row and column, whose intersection is the letter.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          None of the quoted training runs are David&apos;s, and the page
          says so; the material is archived as study code from the team. No
          competition data ships with the demo: the live signal is seeded
          synthetic EEG, and the per-flash scorer in the simulation is
          template matching rather than the CNN, both stated on the page. The
          decoding functions downstream of the scores are the notebook&apos;s
          own, fixture-tested against the Python originals.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Nocturnal_Neuro">Nocturnal Neuro</WikiLink>
          </li>
          <li>
            <WikiLink to="Anatomy_of_a_Spike">Anatomy of a Spike</WikiLink>
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
              Carzaniga, M. and Gualniera, L.,{" "}
              <ExternalLink href="https://github.com/Manucar/p300-speller">
                p300-speller
              </ExternalLink>
              ; <code>content/p300/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Neurotechnology", "2026 establishments"]} />
    </>
  ),
};
