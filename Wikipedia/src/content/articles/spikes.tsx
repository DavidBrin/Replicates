import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { spikesMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Anatomy_of_a_Spike")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Spike_parameterization", heading: "Spike parameterization" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const spikes: ArticleModule = {
  meta: spikesMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Anatomy of a Spike"
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
          { label: "Hosted on", value: <code>David-Internet/demos/spikes</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Anatomy of a Spike</B> is an interactive demonstration of
        spike-parameterization analysis using public marmoset patch-clamp
        recordings from DANDI:001776. It is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink> and
        runs fitted waveforms in the browser.<Ref n={1} />
      </P>

      <P>
        The page lets visitors inspect a recorded sweep, fit individual action
        potentials, alter a generative waveform, and brush a population scatter
        of fitted spikes. The analysis uses the Voytek Lab&apos;s spikeparam
        model, for which David is a user rather than an author.
      </P>

      <Section heading="Overview">
        <P>
          A cursor moves through a 50 kHz patch-clamp sweep as detected spikes
          are centered and windowed. The population view contains more than
          2,600 fitted spikes from ten marmosets. Selecting points overlays
          their recorded waveforms with a mean and standard deviation display,
          alongside feature comparisons and group boxplots.
        </P>
      </Section>

      <Section heading="Spike parameterization">
        <P>
          The main fit proceeds through a LOWESS-smoothed derivative, an
          inflection point, peak calipers, and a bounded exponential decay.
          For the alternate model, two skewed Gaussians reach r-squared of 0.999.
          Sliders for the fitted parameters regenerate a waveform over the recorded spike.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The demo reworks a 2024 spike-parameterization project with public
          NWB data. Its TypeScript ports of the spikeparam patch and
          skewed-Gaussian fits are checked against the Python pipeline.
          {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Organoids_on_Psychedelics">Organoids on Psychedelics</WikiLink>
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
              <code>content/spikes/README.md</code>, David&apos;s Internet.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Neuroscience", "2026 establishments"]} />
    </>
  ),
};
