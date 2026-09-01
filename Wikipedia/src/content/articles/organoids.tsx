import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { organoidsMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Organoids_on_Psychedelics")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Spectral_parameterization", heading: "Spectral parameterization" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const organoids: ArticleModule = {
  meta: organoidsMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Organoids on Psychedelics"
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
          { label: "Hosted on", value: <code>David-Internet/demos/organoids</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Organoids on Psychedelics</B> is an interactive demonstration of
        cortical-organoid electrophysiology analysis conducted in the Voytek
        Lab at UC San Diego. It is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink> and
        presents the work in five chronological chapters.<Ref n={1} />
      </P>

      <P>
        The demo covers local field potential preprocessing, spectral fitting,
        dose and time comparisons, spike and network-event detection, and an
        analysis-library dependency map. Its interactive panels use labeled
        synthetic data, while accompanying figures are rendered analysis
        outputs.
      </P>

      <Section heading="Overview">
        <P>
          The first chapter follows a well&apos;s signal from Axion raw data
          through bandpass filtering, downsampling, and HDF5 export. Later
          chapters show 5-MeO-DMT on Plate D and psilocybin, LSD, psilocin,
          and vehicle conditions on Plate F. A 48-well raster displays bursts
          and network events, with controls for time, stimulation, and dose.
        </P>
      </Section>

      <Section heading="Spectral parameterization">
        <P>
          A selected well&apos;s power spectrum is decomposed with FOOOF or
          specparam into an aperiodic component and periodic peaks. FOOOF draws the aperiodic fit then the peaks.
          The panel can switch between fixed and knee models, while the dose
          view shows parameter heatmaps across days.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo reworks analysis from July 2024 to June 2025 into a
          browser presentation. It includes a fixture-tested TypeScript port of
          the FOOOF fitting algorithm and ports of the burst and network-event
          functions. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Anatomy_of_a_Spike">Anatomy of a Spike</WikiLink>
          </li>
          <li>
            <WikiLink to="Nocturnal_Neuro">Nocturnal Neuro</WikiLink>
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
              <code>content/organoids/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Neuroscience", "2026 establishments"]} />
    </>
  ),
};
