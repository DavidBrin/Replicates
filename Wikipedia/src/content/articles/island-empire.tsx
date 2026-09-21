import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { islandEmpireMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Island_Empire_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Rules", heading: "Rules" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const islandEmpire: ArticleModule = {
  meta: islandEmpireMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the mobile game it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
      </Hatnote>

      <Infobox
        title="Island Empire (replica)"
        image={
          <Image
            src="/images/Island_Empire_(replica).png"
            alt="Screenshot of the Island Empire replica: a campaign level with a selected knight and the blue HUD bar"
            width={300}
            height={169}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Turn-based strategy game" },
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
        <B>Island Empire (replica)</B> is a browser rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>Island Empire</ExternalLink>, a
        mobile territory-conquest game by HBRZ-Developer (2020) descended from Sean
        O&apos;Connor&apos;s <i>Slay</i> and the Android game <i>Antiyoy</i>. It was
        developed in the <code>island-empire</code> folder of the{" "}
        <code>Replicates</code> repository and ships a twelve-level campaign,
        random maps against a computer opponent, hot-seat play for up to eight
        players, weekly challenges and a map editor whose maps are shared by link.
      </P>

      <Section heading="Overview">
        <P>
          The original publishes no rulebook, so the replica&apos;s rules were read
          off the game&apos;s store screenshots and three walkthrough videos. The
          most consequential finding contradicted every written source: reviews and
          the game&apos;s genealogy describe a hexagonal grid, but the frames show a
          square grid with four-neighbour adjacency, shield badges that never appear
          on a diagonal, and walls that protect only their own tile while a city
          protects the four around it.<Ref n={1} />
        </P>
      </Section>

      <Section heading="Rules">
        <P>
          Land is divided into provinces of at least two connected tiles, each with
          a city that banks the province&apos;s gold. Every owned tile pays one gold a
          day, a farm pays five, a mine eight and a chest ten once. Knights of level
          one to four cost 10, 20, 30 and 40 gold and cost 2, 5, 12 and 30 a day in
          upkeep; a province that cannot pay loses every knight to a grave. A knight
          captures a tile only when its level strictly exceeds the tile&apos;s
          defence, and two knights merge into one of the summed level. The first two
          knight levels, the woodwall and the farm were read from unit cards; the
          level-three and level-four upkeep and the stone tower are extrapolations
          the decision log labels as such.<Ref n={2} />
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          The game engine is a pure TypeScript module: <code>apply(state, action)</code>{" "}
          returns a new state and a list of events, and a layering test scans the
          source to reject any import of React or the DOM and any call to{" "}
          <code>Math.random</code> or the clock. The computer opponent, the random-map
          generator and undo (a replay of the turn&apos;s history from a snapshot)
          all live inside that boundary, so a whole computer turn is computed
          synchronously and the session runner only animates it. Every sprite is
          drawn from code onto a 32-pixel canvas and blitted without smoothing;
          the repository contains no image assets.
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica was built from {project.builtWith.toLowerCase()}: research
          lanes covered repository conventions, rules, modes, interaction, the
          Slay/Antiyoy genealogy and visual design, and five developers built the
          engine, renderer, content, persistence and setup screens in parallel
          against two contracts published before any rule was implemented. It
          carries {project.testStats}.<Ref n={3} />
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Super_Smash_(replica)">Super Smash (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Linear_(replica)">Linear (replica)</WikiLink>
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
              <code>island-empire/research/06-research-brief.md</code>.
            </span>,
            <span key="2">
              <code>island-empire/DECISIONS.md</code>.
            </span>,
            <span key="3">
              <code>island-empire/README.md</code>.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Turn-based strategy video games"]} />
    </>
  ),
};
