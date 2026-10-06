/**
 * The nine Tier 3 board specifications (D37).
 *
 * Territory and continent counts are tuned to the real catalogue's own numbers
 * (`research/map-data/smg-catalogue/all-maps.json`) so the boards feel like the
 * originals without copying one — facts are free, artwork is not (D1, D38):
 *
 * | board | here | catalogue entry |
 * |---|---|---|
 * | `europe` | 44 / 7 | Europe 44 / 7, blizzards 3, portals 5 |
 * | `usa-states` | 42 / 9 | United States 42 / 9, blizzards 3, portals 5 |
 * | `asia` | 48 / 9 | Asia 1800s 48 / 9, blizzards 4, portals 6 |
 * | `africa` | 37 / 7 | Africa 37 / 7, blizzards 2, portals 4 |
 * | `australia-new-zealand` | 38 / 8 | New Zealand and Australia 38 / 8, blizzards 2, portals 4 |
 * | `world-simple` | 24 / 6 | — (the small-board bucket is 19–35) |
 * | `south-america` | 20 / 5 | — |
 * | `north-america` | 38 / 7 | — |
 * | `middle-east` | 30 / 6 | — |
 *
 * The blizzard/portal counts are the catalogue's where the catalogue has an
 * entry, and the `round(T/15)` / `round(T/9)` heuristic where it does not.
 *
 * **The sea-link lists are hand-authored.** Each was produced by building the
 * board with an empty list and reading `pnpm run build:maps --suggest`, which
 * reports every territory the board leaves unreachable and the nearest coast to
 * it; the crossing a player would expect was then chosen from that shortlist.
 * Re-run with `--suggest` after changing any target count.
 */

import type { RegionSpec } from "./regions";

/* ------------------------------------------------------------------ Europe -- */

/**
 * Europe, 44 / 7. Natural Earth's 39 European countries plus the five
 * Caucasus/Anatolian neighbours a Europe board needs, with everything clipped to
 * 25°W–45°E — which is also what turns Russia into European Russia rather than a
 * board that reaches Kamchatka. European Russia is then cut into three.
 */
export const EUROPE: RegionSpec = {
  slug: "europe",
  name: "Europe",
  tagline: "44 territories from the Atlantic to the Urals",
  source: "world",
  continentsOf: ["Europe"],
  alsoWorld: ["Turkey", "Cyprus", "Georgia", "Armenia", "Azerbaijan"],
  drop: ["N. Cyprus"],
  window: { lon: [-25, 45], lat: [34, 72] },
  // What survives the 45°E cut is western Russia, so that is what it is called:
  // "Russia" would be a lie about a territory that stops at the Volga, and
  // splitting that remnant into three produced three bands rather than three
  // territories.
  rename: { Russia: "Western Russia" },
  split: { France: 2, Spain: 2, Ukraine: 2 },
  splitBase: { France: "France", Spain: "Spain", Ukraine: "Ukraine" },
  territories: 44,
  continents: 7,
  continentWord: "Europe",
  // Lambert conformal conic on 40°N/65°N, rotated onto a 15°E central meridian:
  // the standard choice for a European wall map, and the one that keeps Italy a
  // boot and Scandinavia a peninsula. Equal Earth is a whole-globe projection
  // and sheared the Baltic badly at this scale. The explicit rotation matters —
  // an unrotated conic sends the far hemisphere towards infinity and the fit
  // collapses, which `fitProjection` refuses outright.
  projection: "conicConformal",
  rotate: [-15, 0],
  parallels: [40, 65],
  width: 1600,
  height: 1000,
  slots: { blizzards: 3, portals: 5 },
  // The British Isles are one component already — Northern Ireland borders the
  // Republic by land — so the Channel and the North Sea are what connect them to
  // the continent; Iceland and Cyprus are the other two stranded pieces.
  seaLinks: [
    ["united_kingdom", "west_france"],
    ["united_kingdom", "netherlands"],
    ["iceland", "united_kingdom"],
    ["cyprus", "turkey"],
    ["denmark", "sweden"],
    ["italy", "greece"],
  ],
};

/* ------------------------------------------------------------------ United States -- */

/**
 * The United States, 42 / 9. The 50 states plus DC, merged down to 42 — so
 * New England and the Mid-Atlantic consolidate the way the real board does.
 * `geoAlbersUsa` insets Alaska and Hawaii, which is why both need a sea link.
 */
export const USA_STATES: RegionSpec = {
  slug: "usa-states",
  name: "United States",
  tagline: "42 territories across the fifty states",
  source: "usStates",
  territories: 42,
  continents: 9,
  continentWord: "States",
  projection: "albersUsa",
  width: 1600,
  height: 1000,
  slots: { blizzards: 3, portals: 5 },
  seaLinks: [
    ["alaska", "washington"],
    ["hawaii", "california"],
    ["alaska", "hawaii"],
  ],
};

/* ------------------------------------------------------------------ Asia -- */

/**
 * Asia, 48 / 9. Natural Earth's 47 Asian countries plus Siberia — which it files
 * under Europe, so Russia is pulled in explicitly, clipped east of 45°E and cut
 * into six. India, China and Kazakhstan are each too big to be one territory.
 */
export const ASIA: RegionSpec = {
  slug: "asia",
  name: "Asia",
  tagline: "48 territories from the Bosphorus to the Bering Strait",
  source: "world",
  continentsOf: ["Asia"],
  alsoWorld: ["Russia"],
  drop: ["N. Cyprus", "Palestine", "Cyprus"],
  window: { lon: [26, 180], lat: [-11, 78] },
  split: { Russia: 6, China: 5, India: 4, Kazakhstan: 2, Indonesia: 2, "Saudi Arabia": 2, Iran: 2 },
  territories: 48,
  continents: 9,
  continentWord: "Asia",
  projection: "equalEarth",
  width: 1600,
  height: 1000,
  slots: { blizzards: 4, portals: 6 },
  seaLinks: [
    ["philippines", "west_indonesia"],
    ["philippines", "taiwan"],
    ["taiwan", "south_mid_china"],
    ["japan", "north_korea_south_korea"],
    ["japan", "south_east_russia"],
    ["sri_lanka", "south_east_india"],
    ["oman_united_arab_emirates", "east_iran"],
  ],
};

/* ------------------------------------------------------------------ Africa -- */

/**
 * Africa, 37 / 7. All 51 Natural Earth African countries merged to 37, so the
 * small West African coastal states consolidate; Algeria, the DRC and Sudan are
 * each split because one territory the size of Algeria unbalances the board.
 */
export const AFRICA: RegionSpec = {
  slug: "africa",
  name: "Africa",
  tagline: "37 territories across the whole continent",
  source: "world",
  continentsOf: ["Africa"],
  // Lesotho is an enclave, and a feature's holes are dropped when it is read —
  // so South Africa's outer ring already covers that ground, and keeping Lesotho
  // would mean a territory with no land border at all.
  drop: ["Lesotho"],
  window: { lon: [-20, 56], lat: [-37, 38] },
  split: { Algeria: 2, "Dem. Rep. Congo": 2, Sudan: 2, Libya: 2 },
  territories: 37,
  continents: 7,
  continentWord: "Africa",
  projection: "equalEarth",
  width: 1300,
  height: 1400,
  slots: { blizzards: 2, portals: 4 },
  seaLinks: [
    ["madagascar", "mozambique_eswatini"],
    ["madagascar", "tanzania"],
  ],
};

/* ------------------------------------------------------------------ South America -- */

/**
 * South America, 20 / 5. Thirteen countries, with Brazil cut into six and
 * Argentina into three: a Brazil-sized single territory would be a third of the
 * board.
 */
export const SOUTH_AMERICA: RegionSpec = {
  slug: "south-america",
  name: "South America",
  tagline: "20 territories from the Caribbean coast to Tierra del Fuego",
  source: "world",
  continentsOf: ["South America"],
  window: { lon: [-82, -33], lat: [-56, 13] },
  split: { Brazil: 6, Argentina: 3 },
  territories: 20,
  continents: 5,
  continentWord: "South America",
  projection: "equalEarth",
  width: 1100,
  height: 1500,
  seaLinks: [
    ["falkland_is", "south_east_argentina"],
    ["falkland_is", "uruguay"],
  ],
};

/* ------------------------------------------------------------------ North America -- */

/**
 * North America, 38 / 7. The eighteen Natural Earth countries, with Canada cut
 * into ten, the United States into twelve, Greenland into two and Mexico into
 * three, then merged down to 38 so the Caribbean consolidates.
 */
export const NORTH_AMERICA: RegionSpec = {
  slug: "north-america",
  name: "North America",
  tagline: "38 territories from Panama to the high Arctic",
  source: "world",
  continentsOf: ["North America"],
  window: { lon: [-172, -12], lat: [5, 84] },
  split: {
    Canada: 10, "United States of America": 12, Greenland: 2, Mexico: 3,
  },
  splitBase: { "United States of America": "America", Canada: "Canada" },
  territories: 38,
  continents: 7,
  continentWord: "North America",
  projection: "equalEarth",
  width: 1600,
  height: 1100,
  seaLinks: [
    ["cuba", "south_far_east_america"],
    ["cuba", "bahamas"],
    ["cuba", "jamaica"],
    ["cuba", "dominican_rep_haiti"],
    ["puerto_rico", "dominican_rep_haiti"],
    ["trinidad_and_tobago", "puerto_rico"],
    ["west_greenland", "north_far_east_canada"],
  ],
};

/* ------------------------------------------------------------------ Australasia -- */

/**
 * Australia and New Zealand, 38 / 8. Natural Earth's admin-1 release covers
 * Australia's states, so the seven mainland states are real units cut into 32
 * territories; New Zealand and Papua New Guinea come from the world set. The
 * Australian Capital Territory and Jervis Bay Territory are dropped — both are
 * too small to see at board scale.
 */
export const AUSTRALIA_NZ: RegionSpec = {
  slug: "australia-new-zealand",
  name: "Australia & New Zealand",
  tagline: "38 territories across the Australian states, New Zealand and Papua",
  source: "australia",
  alsoWorld: ["New Zealand", "Papua New Guinea"],
  drop: ["Australian Capital Territory", "Jervis Bay Territory"],
  window: { lon: [110, 180], lat: [-48, 0] },
  split: {
    "Western Australia": 7, Queensland: 6, "Northern Territory": 5, "South Australia": 5,
    "New South Wales": 5, Victoria: 2, Tasmania: 2, "New Zealand": 4, "Papua New Guinea": 2,
  },
  territories: 38,
  continents: 8,
  continentWord: "Australasia",
  projection: "equalEarth",
  width: 1600,
  height: 1100,
  slots: { blizzards: 2, portals: 4 },
  seaLinks: [
    ["west_tasmania", "west_victoria"],
    ["south_west_new_zealand", "east_victoria"],
    ["north_east_new_zealand", "north_east_new_south_wales"],
    ["west_papua_new_guinea", "north_mid_queensland"],
  ],
};

/* ------------------------------------------------------------------ Middle East -- */

/**
 * The Middle East, 30 / 6. Twenty countries from the Aegean to the Gulf of
 * Oman, with Saudi Arabia, Iran, Turkey, Egypt and Iraq split, then merged down
 * to 30 so the Gulf emirates consolidate.
 */
export const MIDDLE_EAST: RegionSpec = {
  slug: "middle-east",
  name: "Middle East",
  tagline: "30 territories from the Aegean to the Gulf of Oman",
  source: "world",
  keep: ["Turkey", "Syria", "Lebanon", "Israel", "Jordan", "Iraq", "Iran", "Saudi Arabia",
    "Kuwait", "Qatar", "United Arab Emirates", "Oman", "Yemen", "Cyprus", "Egypt",
    "Armenia", "Azerbaijan", "Georgia", "Turkmenistan", "Afghanistan"],
  window: { lon: [25, 67], lat: [12, 44] },
  split: { "Saudi Arabia": 5, Iran: 5, Turkey: 4, Egypt: 3, Iraq: 2, Yemen: 2, Afghanistan: 2 },
  territories: 30,
  continents: 6,
  continentWord: "Middle East",
  projection: "equalEarth",
  width: 1600,
  height: 1100,
  seaLinks: [
    ["cyprus", "north_west_turkey"],
    ["cyprus", "syria"],
    ["oman_united_arab_emirates", "south_east_iran"],
  ],
};

/* ------------------------------------------------------------------ World Simple -- */

/**
 * World Simple, 24 / 6. Every country on earth merged down to twenty-four
 * territories across Natural Earth's own six continents — so the continents are
 * the real ones and each territory is named by its compass band inside one
 * ("North West Africa"), because a territory covering seven countries cannot
 * honestly be named after two of them.
 */
export const WORLD_SIMPLE: RegionSpec = {
  slug: "world-simple",
  name: "World Simple",
  tagline: "24 territories, six continents — the whole world, fast",
  source: "world",
  continentsOf: ["Africa", "Asia", "Europe", "North America", "South America", "Oceania"],
  window: { lon: [-180, 180], lat: [-58, 84] },
  // A simplified world board omits the small islands, the way the classic board
  // does. Each of these has no land border at all, so keeping one would spend a
  // territory slot and a sea link on something barely visible at board scale.
  drop: ["Taiwan", "Sri Lanka", "Cyprus", "N. Cyprus", "Palestine", "Trinidad and Tobago",
    "Puerto Rico", "Jamaica", "Bahamas", "New Caledonia", "Vanuatu", "Solomon Is.", "Fiji",
    "Falkland Is.", "Lesotho", "Ireland"],
  nameBy: "continentBand",
  continentMode: "source",
  territories: 24,
  // Tuned so the islands that do survive — Madagascar, Japan, the Philippines,
  // Britain, Iceland, Cuba, Greenland, Australia, New Zealand and Papua — do not
  // eat every slot: each continent keeps enough for its mainland as well.
  territoriesPerContinent: {
    Africa: 4, Asia: 6, Europe: 4, "North America": 4, "South America": 3, Oceania: 3,
  },
  continents: 6,
  continentWord: "World",
  projection: "equalEarth",
  width: 1600,
  height: 900,
  slots: { blizzards: 2, portals: 3 },
  // Ten crossings: Madagascar, the British Isles, Iceland, Cuba, Greenland,
  // Australia, New Zealand and Papua are each their own territory on this board
  // — as they are on the classic one — and none of them has a land border.
  // The last two are the classic board's own Bering and Gibraltar lanes, which
  // keep the continents from being three separate boards.
  seaLinks: [
    ["south_east_africa_ii", "south_east_africa"],
    ["north_west_europe", "south_west_europe"],
    ["north_east_europe", "north_west_europe"],
    ["north_east_north_america", "north_east_europe"],
    ["south_east_north_america", "north_west_south_america"],
    ["south_west_north_america", "north_west_north_america"],
    ["north_west_oceania", "north_west_oceania_ii"],
    ["south_east_oceania", "north_west_oceania_ii"],
    ["north_west_oceania_ii", "south_east_asia"],
    ["north_west_north_america", "north_east_asia"],
  ],
};

export const REGION_SPECS: readonly RegionSpec[] = [
  WORLD_SIMPLE, EUROPE, ASIA, AFRICA, NORTH_AMERICA, SOUTH_AMERICA,
  USA_STATES, AUSTRALIA_NZ, MIDDLE_EAST,
];
