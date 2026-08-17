/**
 * Playlists — the panel, the list, the index card, and save-to-playlist.
 *
 * Measured against `research/09-youtube-signedin-surfaces.md` §8.1 (the index),
 * §8.2 (the detail page and its sticky panel) and §9.3 (the save sheet), with
 * §2.4's collection stack behind the two artwork treatments.
 *
 * Both files are client components. The panel holds a rename form and a menu,
 * the sheet holds membership state that writes on toggle, and `Menu`/`Sheet`
 * take render-prop triggers that cannot cross the RSC boundary. Everything they
 * accept is serialisable, so a server page can render them directly.
 *
 * ## The one rule to carry away
 *
 * `watch_later` and `liked` are fixed, and `liked` is *derived* — a video is in
 * it because it was liked, and `playlists.addVideo`/`removeVideo` throw
 * `LikedPlaylistIsDerivedError` rather than writing a second, disagreeing copy
 * of that fact. Every affordance those rules forbid is rendered **disabled with
 * the reason** rather than left to fail. {@link SYSTEM_PLAYLIST_REASON} is the
 * one place those sentences are written.
 */

export {
  NewPlaylistButton,
  PlaylistCard,
  PlaylistItemList,
  PlaylistPanel,
  SYSTEM_PLAYLIST_REASON,
  systemKind,
  type NewPlaylistButtonProps,
  type PlaylistCardProps,
  type PlaylistItemListProps,
  type PlaylistPanelProps,
} from "./playlist-panel";

export {
  SaveToPlaylist,
  type SaveTarget,
  type SaveToPlaylistProps,
} from "./save-to-playlist";
