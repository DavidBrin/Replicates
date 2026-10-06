import Image from "next/image";
import type { ArticleModule } from "@/lib/registry";
import { projects } from "@/content/projects";
import { riskMeta } from "@/content/articles/meta";
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

const project = projects.find((p) => p.slug === "Risk_(replica)")!;

export const sections: Array<{ id: string; heading: string }> = [
  { id: "Overview", heading: "Overview" },
  { id: "Modes_and_modifiers", heading: "Modes and modifiers" },
  { id: "Dice", heading: "Dice" },
  { id: "Boards", heading: "Boards" },
  { id: "Architecture", heading: "Architecture" },
  { id: "Online_play", heading: "Online play" },
  { id: "Development", heading: "Development" },
  { id: "See_also", heading: "See also" },
  { id: "References", heading: "References" },
];

export const risk: ArticleModule = {
  meta: riskMeta,
  body: (
    <>
      <Hatnote>
        This article is about the replica. For the game it replicates, see{" "}
        <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>.
        For the Slay-like territory game in the same repository, see{" "}
        <WikiLink to="Island_Empire_(replica)">Island Empire (replica)</WikiLink>.
      </Hatnote>

      <Infobox
        title="Risk (replica)"
        image={
          <Image
            src="/images/Risk_(replica).png"
            alt="Screenshot of the Risk replica in the draft phase: a South America board with owner-coloured territories, numbered troop tokens, the roster capsules on the right edge, the Deploy Troops count dialog and the troops-to-deploy counter"
            width={300}
            height={169}
            className="h-auto w-full"
          />
        }
        rows={[
          { label: "Type", value: "Turn-based strategy board game, in the browser" },
          {
            label: "Replica of",
            value: <ExternalLink href={project.replicaOf.url}>{project.replicaOf.name}</ExternalLink>,
          },
          { label: "Developer", value: "David" },
          { label: "Written in", value: project.stack.join(", ") },
          { label: "Tests", value: project.testStats },
          { label: "Built with", value: project.builtWith },
          { label: "Repository", value: <code>../{project.folder}</code> },
          { label: "Platform", value: "Web browser (desktop and phone)" },
          { label: "Released", value: "October 2026" },
          {
            label: "Website",
            value: <ExternalLink href={project.liveUrl}>{project.liveUrl ?? "not deployed"}</ExternalLink>,
          },
        ]}
      />

      <P>
        <B>Risk (replica)</B> is a browser rebuild of{" "}
        <ExternalLink href={project.replicaOf.url}>RISK: Global Domination</ExternalLink>,
        SMG Studio&apos;s digital edition (2019) of the Hasbro board game. It was
        developed in the <code>Risk</code> folder of the <code>Replicates</code>{" "}
        repository and ships three ways to play — solo against five tiers of
        computer opponent, pass-and-play for up to six people on one device, and
        casual online games behind a four-letter lobby code — over sixteen boards
        and eleven rule modifiers. Its defining property is that the game engine
        contains no randomness at all: every die roll, card draw and opening deal
        is data inside the action that caused it.<Ref n={1} />
      </P>

      <Section heading="Overview">
        <P>
          The rules follow the digital edition rather than the printed one where
          the two differ. A turn is a draft, an attack phase and one fortify move;
          reinforcements are a third of the territories held (at least three) plus
          continent bonuses; cards are awarded for a capture and traded in sets
          under either the fixed scale (4, 6, 8, 10) or the progressive ladder;
          eliminating a player seizes their hand, and an inheritance that lifts the
          hand to five or more cards sends the player straight back to the draft to
          trade. The research phase confirmed each numbered rule against the
          published rulebook and the studio&apos;s own help pages, and recorded the
          handful of places the replica deliberately departs — most visibly that
          the two-player neutral army is an option the host switches on rather
          than the default.<Ref n={2} />
        </P>
        <P>
          Anyone who reaches the site is given a temporary, discoverable identity
          — a display name and a colour — with no account, password or e-mail.
          Chat is forty-two preset lines and eight emoji; there is no free text
          anywhere, which is also why the online lobby needs no moderation.
        </P>
      </Section>

      <Section heading="Modes and modifiers">
        <P>
          <i>Solo</i> plays against one to five bots drawn from five difficulty
          tiers — Beginner, Easy, Medium, Hard and Expert — each bot a persona
          folded with its tier once at match start. <i>Pass &amp; Play</i> seats
          two to six people on one device behind a full-screen hand-off that
          conceals the board between turns, so Fog of War works at a kitchen
          table. <i>Online</i> is a lobby browser showing who is present, a
          four-letter code to join, readiness, a turn timer that hands an absent
          seat to a bot, and a reclaim when the player returns.
        </P>
        <P>
          The modifiers are independent and combine freely: Fog of War, Capitals
          (an extra defence die, and optionally the win condition), Blizzards
          (frozen territories that still pay their continent), Portals (stable or
          relocating every three rounds), Percentage Domination from 50 to 90
          percent, Manual Placement, Max Rounds, Round Delay, Alliances, the
          choice of card scale, the choice of dice mode, and the two-player
          neutral army. Every game also carries a battle log that records who
          attacked whom, where, and what each side lost.
        </P>
      </Section>

      <Section heading="Dice">
        <P>
          The digital edition&apos;s <i>Balanced Blitz</i> is not a dice roll but
          a reshaping of the true battle distribution in four stages, and the
          studio publishes only a few worked examples of it. The replica
          reverse-engineered the reshape from those examples and reproduces them
          to fifteen decimal places: thirty attackers against a capital held by
          fifteen, losing exactly twelve, has probability{" "}
          <code>0.0100282888709122</code> under Balanced Blitz against{" "}
          <code>0.02221280017072782</code> under True Random, and forty-nine is the
          fewest attackers for an eighty-percent Blitz against fifty. The same
          cumulative-distribution walk serves both the battle resolver and the
          win-chance figure shown before a battle, and the bots score their attacks
          from the odds table of the dice mode actually in play.<Ref n={3} />
        </P>
      </Section>

      <Section heading="Boards">
        <P>
          No RISK board geometry is available under a licence that permits
          reuse, so every board is public domain or generated. Three — the classic
          forty-two-territory world, an extended world and Napoleonic Europe — come
          from a public-domain fan project&apos;s territory paths; nine regional
          boards (Europe, the United States, Asia, Africa, North and South America,
          Australia and New Zealand, the Middle East, and a simplified world) are
          dissolved out of Natural Earth data by a committed pipeline that derives
          adjacency from shared borders and budgets the vertices of every ring; and
          a seeded Voronoi generator makes a random board of any size. The classic
          graph was checked against nine independent sources, seven of which agree
          exactly.<Ref n={2} />
        </P>
      </Section>

      <Section heading="Architecture">
        <P>
          The engine is one pure function, <code>apply(state, map, action)</code>,
          and a build-failing layering test reads its source off disk to reject{" "}
          <code>Math.random</code>, the clock, and any import of React or the DOM.
          Randomness lives one layer out, in a resolver that takes an explicit
          seeded generator keyed on the sequence number of the action it is
          producing, and writes the outcome into the action. The action log is
          therefore the game: replaying it must reproduce the authority&apos;s state
          hash at every row, which is the first end-to-end test. A property test
          drives hundreds of games and asserts that the list of legal actions and
          the validator never disagree; it is what found the last two rule wedges.
        </P>
        <P>
          The board is an SVG of one path per territory, painted by attribute diff
          rather than re-rendered, with HTML troop tokens inside the same transform
          so that one camera projection serves hit-testing, labels and the
          continent badges alike.
        </P>
      </Section>

      <Section heading="Online play">
        <P>
          Online play is one Postgres table and a polling loop, sized to the free
          tiers it runs on. The server holds the same engine behind route handlers
          and appends to an append-only action log with contiguous sequence
          numbers; clients poll every two seconds on their turn and four seconds
          off it, slower when the tab is hidden, and receive a bodyless{" "}
          <code>204</code> when nothing changed. Bot turns, turn-timer takeovers and
          lobby expiry run lazily inside whichever poll arrives next, so nothing
          needs a scheduler. Fog games receive a masked snapshot and a redacted
          action list, and a client never rolls a die: an attack is submitted as an
          intent and resolved by the authority.<Ref n={1} />
        </P>
      </Section>

      <Section heading="Development">
        <P>
          The replica was built from {project.builtWith.toLowerCase()}: research
          lanes gathered 304 evidence images from store listings, the studio&apos;s
          training videos and map tiles, verified the rules and the classic graph,
          and reverse-engineered the dice; seven developers then built the engine,
          odds and bots, maps, screens, session and online layers in parallel
          against contracts published first. Four review rounds returned seventy
          findings, every one fixed, and two rounds of hands-on play returned
          fourteen more — among them the discovery that the continent ring, a filled
          path drawn above the territories, was silently swallowing every tap on a
          completed continent. It carries {project.testStats}.<Ref n={4} />
        </P>
      </Section>

      <Section heading="See also">
        <ul className="list-disc pl-6">
          <li>
            <WikiLink to="Island_Empire_(replica)">Island Empire (replica)</WikiLink>
          </li>
          <li>
            <WikiLink to="Leaders_(game)">Leaders (game)</WikiLink>
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
              <code>Risk/README.md</code>.
            </span>,
            <span key="2">
              <code>Risk/research/07-research-brief.md</code> and <code>Risk/DECISIONS.md</code>.
            </span>,
            <span key="3">
              <code>Risk/SPEC.md</code>, §4 (the odds contract) and the Balanced Blitz oracles.
            </span>,
            <span key="4">
              <code>Risk/DECISIONS.md</code>, D106–D114.
            </span>,
          ]}
        />
      </Section>

      <Categories categories={["Software replicas", "Turn-based strategy video games", "Board game adaptations"]} />
    </>
  ),
};
