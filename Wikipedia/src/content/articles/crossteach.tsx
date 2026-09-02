import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { crossteachMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Cross-Teaching_Segmentation")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Results", heading: "Results" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const crossteach: ArticleModule = {
  meta: crossteachMeta,
  body: (
    <>
      <Hatnote>
        This article is about the interactive demo. For the search engine that
        hosts it, see <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.
      </Hatnote>

      <Infobox
        title="Cross-Teaching Segmentation"
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
          { label: "Hosted on", value: <code>David-Internet/demos/crossteach</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Cross-Teaching Segmentation</B> is an interactive demonstration of
        a semi-supervised segmentation project from DTU course 02456, Deep
        Learning, in fall 2025, and of a 2026 follow-up on the Oxford-IIIT
        Pet dataset. It is hosted on{" "}
        <WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink>.<Ref n={1} />
      </P>

      <P>
        In cross-teaching, two models of different architecture, a U-Net over
        512-pixel images and a Vision Transformer over 224-pixel images,
        train on a small labeled set and pass confident predictions on
        unlabeled images to each other as pseudo-labels. Every prediction,
        confidence map, encoder activation and attention rollout on the page
        was produced by running the four trained checkpoints published in the
        project&apos;s repository.
      </P>

      <Section heading="Overview">
        <P>
          The exchange panel holds twelve held-out test images with
          predictions from all four checkpoints. A slider dims pixels below a
          confidence threshold on the real softmax maps, and a replay
          animation shows confident predictions crossing the resolution gap
          as pseudo-labels. A training panel replays the committed per-epoch
          metrics, in which a two-epoch warmup holds the exchange off before
          the confident-image ratio rises. An architecture panel shows
          activations for each ResNet-34 encoder stage, attention rollout
          from the transformer checkpoint, and the source of a detection
          variant that was written but never run. A final panel walks the
          course&apos;s notebook sequence, with a small autodiff engine and a
          half-moon classifier training live in TypeScript.
        </P>
      </Section>

      <Section heading="Results">
        <P>
          The original project segmented pores in micro-CT scans, where
          cross-teaching raised the supervised U-Net&apos;s Dice score from
          0.49 to 0.97 with 22 labeled slices. The 2026 Oxford-IIIT Pet
          redesign, with 590 labeled images, ended level with its supervised
          baselines (U-Net 0.852, ViT 0.762), and the page reports both
          outcomes side by side rather than only the favorable one.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The 02456 project was Group 9: Olfert Jan Mebius, David Brin, Joey
          Bink and Thorsteinn Mar Hoskuldsson. The method follows Luo et
          al.<Ref n={2} /> The checkpoints, per-epoch metrics and micro-CT
          slices come from the group&apos;s public repositories, and the
          page&apos;s TypeScript metrics port is fixture-tested against the
          repository&apos;s own Python evaluation path. Nothing is retrained
          for the demo.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Computer_Vision">Computer Vision</WikiLink>
          </li>
          <li>
            <WikiLink to="Quantum_Playground">Quantum Playground</WikiLink>
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
              <code>content/crossteach/README.md</code>, David&apos;s Internet.
            </span>,
            <span key="2">
              Luo et al., &ldquo;Semi-Supervised Medical Image Segmentation via
              Cross Teaching between CNN and Transformer&rdquo; (arXiv:2112.04894);
              applied here after arXiv:2207.14191.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Machine learning", "2026 establishments"]} />
    </>
  ),
};
