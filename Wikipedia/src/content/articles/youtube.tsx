import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { youtubeMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "YouTube_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "Reception", heading: "Reception" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const youtube: ArticleModule = {
  meta: youtubeMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the product it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="YouTube (replica)"
        image={
          <Image
            src="/images/YouTube_(replica).png"
            alt="Screenshot of the YouTube replica's home page at 1920px"
            width={300}
            height={169}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Video hosting service" },
          {
            label: "Replica of",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>../{project.folder}</code> },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>YouTube (replica)</B> is a rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>YouTube</ExternalLink>&apos;s
        core functionality, developed in the <code>youtube</code> folder of
        the <code>Replicates</code> repository. It covers upload, an adaptive
        video player, channels, subscriptions, playlists, threaded comments,
        search, a recommender, watch history, a Shorts surface, and a
        Content&nbsp;ID matching system.
      </P>

      <P>
        Its central architectural bet is that the uploader&apos;s own browser
        encodes the entire rendition ladder using the <code>VideoEncoder</code>{" "}
        API before upload, so no transcode queue, worker pool or backlog
        exists on the server.
      </P>

      <Section heading="Overview">
        <P>
          The replica includes a hand-written MP4 demuxer, fragmented MP4
          muxer, HLS packager, and a Media Source Extensions player with its
          own adaptive bitrate logic — built without ffmpeg.wasm,
          mp4box.js or hls.js. Every seed video in the replica is synthetic,
          generated through the same real WebCodecs encoding path used for
          uploads. Its interface draws 37 icon glyphs from geometry rather
          than imported assets.
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          Content ID is implemented using Wang&apos;s landmark audio
          fingerprinting algorithm,<Ref n={1} /> with a matching threshold
          derived empirically from 3,086 leave-one-out fingerprint pairs,
          yielding an estimated false-positive rate of roughly 250 in
          2.5 × 10⁵ pairs. The recommender follows the approach described by
          Davidson et al.<Ref n={2} /> Visual details were measured from the
          real site: the brand red is <code>#f03</code>, the home grid
          renders at 3 × 533px at a 1920px viewport width, and the
          replica&apos;s design tokens use a live <code>--yt-sys-*</code>{" "}
          namespace rather than the dead <code>--yt-spec-*</code> one found in
          YouTube&apos;s own shipped CSS.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica is built on Next.js with PGlite for local development
          and Neon in production, backed by a 23-table schema. It carries{" "}
          {project.testStats}, and was built across {project.builtWith.toLowerCase()}.
        </P>
      </Section>

      <Section heading="Reception">
        <P>
          According to the project&apos;s own account, a recurring bug class —
          client-reference leakage across the React Server Components boundary
          — occurred five times during development and was invisible to the
          project&apos;s 2,227 unit tests; it was ultimately caught by a
          purpose-built, AST-based static check rather than by testing.
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Linear_(replica)">Linear (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Notion_(replica)">Notion (replica)</WikiLink>
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
              Wang, A. &ldquo;An Industrial-Strength Audio Search
              Algorithm.&rdquo; <i>Proceedings of the 4th International
              Conference on Music Information Retrieval (ISMIR)</i>, 2003.
            </span>,
            <span key="2">
              Davidson, J. et al. &ldquo;The YouTube Video Recommendation
              System.&rdquo; <i>Proceedings of the Fourth ACM Conference on
              Recommender Systems (RecSys)</i>, 2010.
            </span>,
            <span key="3">
              <code>youtube/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Video hosting services"]} />
    </>
  ),
};
