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
  { id: "Method", heading: "Method" },
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
        semi-supervised segmentation in which a U-Net and a Vision Transformer
        grade each other&apos;s predictions on unlabeled images.<Ref n={1} /> It
        presents the DTU 02456 Group 9 project from fall 2025 and a later
        Oxford-IIIT Pet redesign, using four shipped checkpoints rather than
        toy substitutes.
      </P>

      <P>
        Visitors can pick a pet, compare supervised and cross-taught masks,
        dim low-confidence pixels, and press teach so that{" "}
        <B>pseudo-labels cross the resolution gap</B> between a 512-pixel U-Net
        and a 224-pixel ViT.
      </P>

      <Section heading="Overview">
        <P>
          The page includes training curves from committed per-epoch metrics,
          a results table for Oxford Pet, and the original micro-CT story
          (Dice 0.49 to 0.97 with 22 labeled slices). Encoder activations,
          attention rollout, and a learning ladder through the course notebooks
          sit beside the live exchange.
        </P>
      </Section>

      <Section heading="Method">
        <P>
          Cross-teaching gates the exchange on confidence: after a two-epoch
          warmup the confident-image ratio rises and each model trains on the
          other&apos;s pseudo-labels. The demo also documents CrossDetection.py,
          a detector pair that was written and never run.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          Predictions, confidence maps, and attention rollouts were generated
          by running the public checkpoints over held-out images. {project.testStats}.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li><WikiLink to="Computer_Vision">Computer Vision</WikiLink></li>
          <li><WikiLink to="ArXiv_Semantic_Graph">arXiv Semantic Graph</WikiLink></li>
          <li><WikiLink to="Davids_Internet">David&apos;s Internet</WikiLink></li>
        </ul>
      </Section>

      <Section heading="References">
        <References
          refs={[
            <span key="1"><code>content/crossteach/README.md</code>, David&apos;s Internet.</span>,
          ]}
        />
      </Section>

      <Categories categories={["Interactive demos", "Machine learning", "2026 establishments"]} />
    </>
  ),
};
