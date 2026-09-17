# Lane 1 — Visual & interaction design

Target: **FL Studio 21 / 2024-era**, default theme, Windows build (the manual's own
screenshots are Windows FL Studio 21). Scope: app chrome + Channel Rack, Piano Roll,
Playlist, Mixer.

Every claim is marked **HIGH** (quoted from Image-Line's own manual or measured
pixel-by-pixel from an official Image-Line screenshot), **MED** (consistent across
secondary sources), or **LOW** (inference — flagged).

Primary sources used throughout:

- Channel Rack — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/channelrack.htm>
- Piano roll — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll.htm>
- Playlist — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm>
- Mixer — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer.htm>
- Toolbar / panels — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/toolbar_panels.htm>
- User interface (GUI) conventions — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/basics_interface.htm>
- Keyboard & mouse shortcuts — <https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/basics_shortcuts.htm>
- Theme settings — <https://www.image-line.com/fl-studio-learning/fl-studio-beta-online-manual/html/envsettings_themes.htm>

---

## 0. Reference captures

All in `research/screenshots/`, downloaded from Image-Line's own manual image
directory (`.../fl-studio-online-manual/html/img_shot/`) and from the FL Studio
product page. These are the comparison targets.

| File | Source URL | What it shows |
|---|---|---|
| `channelrack_main.png` (1310×503) | `img_shot/channelrack_main.png` | **Channel Rack**, annotated, 5 channels + step grid |
| `channelrack_swing.png` | `img_shot/channelrack_swing.png` | Per-channel Swing knob in Channel Settings |
| `channelrack_grapheditor.png` | `img_shot/channelrack_grapheditor.png` | Graph Editor (per-step velocity etc.) |
| `channelrack_pianomode.png` | `img_shot/channelrack_pianomode.png` | Channel Rack piano-roll preview strip |
| `pianoroll_general.png` (1561×722) | `img_shot/pianoroll_general.png` | **Piano Roll**, annotated, full anatomy |
| `pianoroll_eventeditor.png` | `img_shot/pianoroll_eventeditor.png` | Velocity/control lane + target-control menu |
| `pianoroll_ghostnotes.png` | `img_shot/pianoroll_ghostnotes.png` | Ghost notes |
| `pianoroll_midicolors.png`, `pianoroll_notelabels.png` | `img_shot/…` | Per-MIDI-channel note colours; note name labels |
| `playlist_main.png` (1842×729) | `img_shot/playlist_main.png` | **Playlist**, annotated, all clip types |
| `playlist_trackheaders.png` | `img_shot/playlist_trackheaders.png` | Track headers + right-click menu |
| `mixer_main.png` (1957×961) | `img_shot/mixer_main.png` | **Mixer**, annotated, full strip anatomy |
| `mixer_routing.png` | `img_shot/mixer_routing.png` | Routing view |
| `basics_interface.png` (1670×995) | `img_shot/basics_interface.png` | Whole app: toolbar + Browser + all four windows at once |
| `basics_interface_lcd.png` | `img_shot/basics_interface_lcd.png` | Transport buttons + tempo LCD close-up |
| `panel_main_menubar.png` | `img_shot/panel_main_menubar.png` | Title bar / menu bar / hint panel stack |
| `settings_themes.png` | `img_shot/settings_themes.png` | Theme settings dialog |
| `official_product_theme_default.png` | `image-line.com/static/assets/asset-theme-3.…png` | Very high-zoom Channel Rack row anatomy (custom gold theme) |

`official_product_theme_default.png` is a **non-default (gold) theme** but is the
highest-resolution official view of a Channel Rack row's individual widgets — use it
for *shape*, not colour.

---

## 1. Overall app chrome

### 1.1 Window model — HIGH

> "FL Studio features floating windows within a unified workspace. Windows
> automatically snap together when dragged nearby; holding Alt while dragging
> overrides this behavior. Users can configure windows as either docked within the
> main interface or detached for multi-monitor setups."
> — `basics_interface.htm`

Concretely, visible in `basics_interface.png`:

- One dark **workspace** fills the app below the toolbar. Each of Channel Rack,
  Piano Roll, Playlist, Mixer, Browser is a **free-floating panel** inside it with its
  own title bar, z-order, and minimise/maximise/close buttons at the right of that
  title bar. They overlap (the Piano Roll in the reference shot sits on top of both
  Playlist and Mixer). **HIGH**
- Title bar reads `▷ <icon> Window name - <context>` — e.g. `Piano roll - FLEX`,
  `Playlist - Arrangement › Vocals: The Girl - Spectral view`,
  `Mixer - return to new`, `Channel rack`. The leading `▷` is the window's own
  hamburger/main menu; the trailing `›` segments are clickable breadcrumb-style
  selectors. **HIGH** (read directly off the captures)
- Each window has its own **tool bar row** immediately under (or merged into) the
  title bar, holding that window's tool icons. **HIGH**
- Toggles: `F5` Playlist, `F6` Channel Rack/Step Sequencer, `F7` Piano Roll,
  `F9` Mixer, `F12` close all windows, `Esc` close focused window, `Tab` cycle
  nested windows, `Enter` toggle max/min Playlist. **HIGH** (`basics_shortcuts.htm`)

For a browser replica this means: absolutely-positioned draggable/resizable panels
over a fixed workspace div, not a CSS grid of fixed regions. **LOW** (implementation
inference, but forced by the above).

### 1.2 Toolbar / transport bar layout — HIGH

Left→right along the top strip (`toolbar_panels.htm`, confirmed against
`basics_interface.png` and `panel_main_menubar.png`):

1. **Window buttons + Title bar** — `_ ▫ ✕` at far left, then the project title bar.
   (Note: FL puts its own window controls on the *left*.) **HIGH**
2. **Menu bar** — `FILE EDIT ADD PATTERNS VIEW OPTIONS TOOLS HELP`, all-caps,
   letter-spaced, no drop shadows. **HIGH** (quoted list from `toolbar_panels.htm`)
3. **Hint panel** — a wide read-only strip below the menu bar showing the hovered
   control's description and, while dragging, its live value. There is also an
   optional larger floating hint in the lower-left "remaining transparent to mouse
   clicks". **HIGH**
4. **Main volume** and **Main pitch** — two small vertical sliders at the far right
   of the title/menu/hint stack. **HIGH** (`panel_main_menubar.png`)
5. **Transport & recording panel**: `PAT/SONG` switch, Play/Pause, Stop, Record.
   - "Pat/Song mode switch — toggles between pattern-only and full playlist playback"
   - "Play/Pause button — begins playback or pauses; pressing again stops and rewinds"
   - "Stop button — halts playback; double-clicking triggers 'panic mode'"
   - "Record button (R) — switches between recording and playback modes"; right-click
     it for record-filter options. **HIGH**
   - Visual (measured from `basics_interface_lcd.png`): the PAT/SONG button is a
     rounded square that **glows orange** when lit; Play (▶) and Stop (■) are a
     joined pill of two dark buttons with pale glyphs; Record is a separate circular
     button. **HIGH**
6. **Time panel (LCD)** — two display modes, "Bar : Beat/Step : Tick" or
   "Minute : Second : Centisecond", with an S/B switch choosing what the centre
   digits show. **HIGH**
7. **Tempo panel** — "Shows/sets song tempo (10 - 522 BPM)" in larger digits, plus
   smaller fractional digits at 1/1000 BPM. Right-click → tap tempo / nudge /
   presets. **HIGH**
8. **Pattern selector** — current pattern name with `▸` and `+` buttons either side;
   menu has "Find first empty (Shift+F4)", "Find next empty (F4)", "Find next empty
   (no naming) (Ctrl+F4)", "Rename / color… (F2)". **HIGH** (menu text read off
   `channelrack_main.png`, matches `toolbar_panels.htm`)
9. **Shortcut icons** — customisable row: Add menu, cut/paste, undo, plugin picker,
   record controls, render, and view toggles for Playlist / Channel Rack / Piano roll
   / Mixer. **HIGH**
10. **Online/Communications + CPU & memory panels** — CPU %, voice count, memory,
    with small bar graphs. **HIGH**
11. **Recording panel** — record filters "Automation, Notes, Audio, Clips", count-in
    metronome, loop record, blend. **HIGH**
12. **Global Snap panel** — see §3.4. **HIGH**

### 1.3 LCD-display idiom — HIGH

> "Numeric displays respond to left-mouse dragging vertically. The pointer changes
> appearance at the top (increment) or bottom (decrement) edges for step-wise
> adjustment. Users can also left-click and hold while typing numerical values
> directly." — `basics_interface.htm`

Measured from `basics_interface_lcd.png`: the tempo LCD is a **pale, near-white
cyan-tinted plate** (`#E6F7FF`, gradient toward `#E1F1F9` at the edges) with **dark
navy digits** and a small `▲/▼` spinner at its right edge — i.e. FL's LCDs read as
*light-on-dark-chrome*, inverted from everything else in the UI. **HIGH**

### 1.4 Knob / slider interaction vocabulary — HIGH

From `basics_interface.htm`, verbatim:

- "Left-click the image and drag up/down (left/right for horizontal sliders)"
- Right-click → menu with "'Type in value'" / "'Set'"
- Fine-tune: hold **Ctrl** while dragging, or hold **both mouse buttons**
- Hold **Shift** to avoid pausing at default values
- **Alt+Left-click or middle-click resets to default**
- Right-click → link to internal/external controllers (automation)

---

## 2. Channel Rack

Reference: `channelrack_main.png`, `official_product_theme_default.png`.

### 2.1 Row layout, left → right — HIGH

Quoted order from `channelrack.htm`:

1. **Mute LED** — "Turning this LED off will mute the Channel". Small circular LED,
   lit **green** when unmuted. Shown as a padlock glyph on rows where the channel is
   locked to its mixer track.
2. **Pan knob** — pre-mixer pan.
3. **Volume knob** — pre-mixer level.
4. **Mixer Track routing box** — a rounded rect showing the mixer track number
   (`---` when unassigned). "Click and drag vertically to change the Mixer Track."
5. **Channel Button** — the wide name button; shows instrument name + a small
   instrument glyph on the right. Click opens the plugin.
6. **Channel selector / activity indicator** — a thin vertical bar to the right of
   the name button: "Outer border selects channel; inner shows activity".
   Lit bright green when selected.
7. **Step sequencer grid** *or* **piano-roll preview strip** — which one depends on
   whether the channel holds a score (`channelrack_pianomode.png` shows the piano
   preview: horizontal green note bars on a dark strip).

Below the last row: a `+` button ("Add plugin Channels"), and a horizontal scrollbar
whose right end can be **dragged right to lengthen the pattern**. **HIGH**

Rack title bar: `▷ ⟳ [All ▸] ⋮ ◁ Channel rack ◯ [16] ↺ 📊 ▤ ✕` — hamburger, loop/rec
icon, channel **filter group** dropdown ("All"), resize handles, swing knob, a
**pattern-length numeric box (`16`)**, undo, graph editor, keyboard-view toggle,
close. **HIGH** (read off `channelrack_main.png`; the `16` box is the "Drag right to
change pattern length" control the annotation points at).

### 2.2 Step grid semantics — HIGH

- "Each button (step) in the grid represents a 16th note."
- Default view: "4 beats x 4 bars = 16 steps."
- "There are a maximum of 512 steps in the Step Sequencer."
- Pattern length range "1 to 512 steps (1/16th note to 64 bars in 4/4 time)";
  "When set to Auto the length of the pattern will be set by the end of the last bar
  with data."
- **Left-click activates a step; right-click deactivates.** "Visual grouping by bars
  shown through lighter/darker block patterns."
- Steps hold more than on/off: the **Graph Editor (Ctrl+K)** edits per-step Note,
  Velocity, Release, Fine Pitch, Mod X, Mod Y, Shift and Rep. "Left-click a column
  and drag up/down"; "Hold Ctrl and adjust one column, the others will follow";
  right-click-drag interpolates between steps.

### 2.3 Measured step-cell geometry — HIGH (measured), scale caveat LOW

Horizontal run-length scan across the "Kick" row of `channelrack_main.png` at y=212:

- **Step pitch = 24 px**; **cell width = 20 px**; **4 px gutter** of rack background
  between cells.
- Vertical scan at x=335: **cell height ≈ 32 px**, **channel row pitch = 45 px**
  (Kick cell top y=199, Clap cell top y=244).
- So a step button is a **portrait rounded rect, roughly 20×32 (≈1 : 1.6)**, not a
  square — this is the single most-missed detail when people redraw FL's rack.
- The cell is drawn as a soft 3-D switch: a bright 1–2 px cap at the very top
  (`#F9FFFF`→`#FFFFFF` on a lit cell), then a vertical gradient darkening downward
  (`#D3E5F0` → `#ACBEC9` over ~25 px), then a dark bottom lip.

**Caveat (LOW):** the manual capture may be at a non-100 % Windows DPI scale. Treat
the *ratios* (pitch:width:gutter = 24:20:4; row:cell height = 45:32) as HIGH and the
absolute px as indicative.

### 2.4 Measured step colours — HIGH

The 4-step beat grouping is done by **alternating the hue of the whole group**, not
by a background band behind them:

| Beat group | Step OFF | Step ON |
|---|---|---|
| Groups 1, 3 (steps 1–4, 9–12) — "cool" | `#6E7579` body, `#7D8388` top cap, `#454C50` bottom lip | `#D2E4EF` body, `#EFFFFF` cap, `#ACBEC9` foot |
| Groups 2, 4 (steps 5–8, 13–16) — "warm" | `#806D6E` body, `#8D7B7C` cap, `#4C494C` bottom lip | `#FFCED0` body, `#FFE9EC` cap |

Gutter / rack body between cells: `#727C81`. Cell outline: `#5E676C`.

So: **odd beats render neutral slate, even beats render a warm/rose slate, and the
"on" state is a high-value tint of the same hue.** **HIGH** (measured)

### 2.5 Swing — HIGH

Two different swings exist and the replica must not conflate them:

- **Global/rack Swing slider** on the Channel Rack: "Turn right to add a 'swing'
  rhythm to Steps." It delays "odd 16th notes (1,3,5,7,9,11,13,15)" relative to the
  even-numbered steps. (`channelrack.htm`)
- **Per-channel Swing knob** in Channel Settings → *Time* group, labelled
  "Swing mix (0 to 100%)", sitting beside GATE and SHIFT
  (`channelrack_swing.png`). **HIGH**

### 2.6 Channel button colouring — HIGH

- Channels support "Solid color assignment", "Gradient coloring across multiple
  selected channels", "Random coloring", and "Grouping by color".
- Right-click channel button → Channel Operations menu: Piano roll, Graph editor,
  **Rename/recolor**, Clone, Delete.
- **A red channel button is an error state**: "samples or instruments nominated for
  those Channels can't be found" (the `Snare` row in the reference capture).
- Default un-coloured channel buttons render as a dark slate plate (`#4A545A`-family)
  with pale text; a coloured channel tints the whole button (the `Harmor` row in the
  capture is a dark maroon).

### 2.7 Channel selection & rack shortcuts — HIGH

"When lit, the Channel is selected." Left-click focuses one channel; right-click
toggles independently; right-click-drag multi-selects; double-click selects all.

`Alt+C` clone, `Alt+Del` delete, `Alt+↑/↓` move, `Alt+G` group, `Alt+U` ungroup/unzip,
`Alt+Z` zip, `Alt+M` toggle mixer-track selectors, `Ctrl+L` route to free mixer
tracks, `Shift+Q` quantize, `Shift+Ctrl+←/→` rotate/shift step data,
`Ctrl+C/V/X` copy/paste/cut steps or score,
`1…9,0` mute channel 1–10, `Ctrl+1…9,0` solo, `↑/↓` select channel above/below.
Mouse: `Shift+Mouse-wheel` on an empty part of the rack title bar scrolls patterns;
`Shift+Mouse-wheel` on a channel moves it up/down.

---

## 3. Piano Roll

Reference: `pianoroll_general.png`, `pianoroll_eventeditor.png`,
`pianoroll_ghostnotes.png`.

### 3.1 Anatomy, top → bottom / left → right — HIGH

- **Title bar**: `▷ 🔧 🎧 ♪ ≡ ↺ | [tools…] | ◁ Piano roll - <channel name> ›` then
  window controls. The `- FLEX` suffix names the **target channel**; the trailing `›`
  opens a channel picker.
- **Tool bar** (icons, left→right in the capture): Draw, Paint, Paint-drum, Delete,
  Mute, Slice, Slip/select-ish, Select, Zoom, Playback — plus a "Ghost note menu"
  icon at the far right of the bar.
- **Note-colour swatch + Slide/Portamento pad** — a large angled green swatch at the
  top-left corner above the keyboard; picks the current note colour (= MIDI channel)
  and the slide/porta stamp.
- **Horizontal zoom/scroll bar** across the top, with `‹` and `›` end caps; its ends
  are drag handles for zoom.
- **Time ruler** below it, numbered in bars; **time markers** are tabs hanging from
  the ruler.
- **Preview keyboard column** down the left edge, with octave labels (`C5`, `C6`).
- **Grid** — the note lanes.
- **Splitter handle** (a small `····` grip) between grid and event editor.
- **Event editor / control lane** at the bottom, with an **"Editor target"** selector
  reading `Control ▸` at its left and an editor-zoom control at its right.
- **Vertical zoom** control at top right; **vertical scrollbar** with `⌃`/`⌄` caps.

### 3.2 Measured grid geometry & colours — HIGH

Run-length scans of `pianoroll_general.png`:

| Element | Value |
|---|---|
| Keyboard column width | **≈104 px** (x=232→335); grid starts x=340 |
| White key fill | horizontal gradient `#D9DDE5` (left) → `#FFFFFF` (right), i.e. keys are shaded as 3-D keys, not flat |
| Black key fill | `#494A4C`, drawn as a shorter bar inset from the left |
| Row (semitone) height | **≈21–22 px** at this zoom |
| Step column width | **≈21 px** at this zoom (so cells are ~square here) |
| White-key note lane | `#42545F` |
| Black-key note lane (and 1 px step gridline) | `#394B56` |
| Darker beat band (in the shaded regions) | `#32444F` |
| Beat gridline | `#2E404B`, flanked by `#3E4F5A` |
| Bar gridline | `#1A2C37` (darkest) |
| Ruler background | `#2A363F` |
| Window/tool-bar chrome | `#4E585E` |

So the **row shading alternates by black/white key**, and the **column shading
alternates per beat**, and the two are layered — a note lane is
`black-key ? #394B56 : #42545F`, then beat-shaded columns darken it another step,
then 1 px step / beat / bar rules are drawn on top with three increasing weights.
**HIGH** (measured)

### 3.3 Note blocks — HIGH

- **Shape: rectangular, square corners**, with a 1 px darker outline and a
  bright 1 px top edge — *not* rounded. Measured on `pianoroll_general.png`:
  top edge `#C6FBD0`, body `#BCF1C6`/`#BEF3C9`, bottom shadow `#83AB89`,
  right-end cap `#4E8756` (a darker green resize-grip block at the right edge,
  ~9 px wide). **HIGH**
- **Note name label** is drawn *inside* the note at its left end in small dark type
  (`B5`, `A5`, `G5`…) and truncates to `G.`/`..` as the note narrows
  (`pianoroll_eventeditor.png`). **HIGH**
- **A slide note** gets a small diagonal wedge glyph at its right end; portamento
  notes get an arrow-ish glyph. **HIGH**
- **Note colour = MIDI channel:** "Each color is locked to a particular MIDI channel."
  Up to 16 colours; overlapping notes of different colours can be edited
  independently ("Up to 16 notes sliding simultaneously in different directions").
  Measured second colour in the capture: a lavender-blue `#B9CEF2`. `Alt+C` changes
  note colour. **HIGH**
- **Ghost notes**: flat grey blocks with no label, drawn behind live notes.
  Measured `#637580`. Two kinds — "Solid blocks" (other channels within the same
  Pattern) and "Open Blocks" (from overlapping Patterns).
  "Double-Right-Click to switch to the Channel to edit these Notes."
  `Alt+V` toggles ghost channels. **HIGH**

### 3.4 Snap — HIGH

Local Snap selector per window; when set to `Main` it follows the **Global Snap**
panel on the main toolbar. Verbatim option list (`toolbar_panels.htm`):

> "Line - Events snap to the nearest grid-line… Cell - … the grid-cell they fall in.
> (none) - No snapping. Movement is limited only by the Project Timebase (PPQ)
> setting (F11). … Steps 1/6 to 1 (step) … Beats 1/6 to 1 (beat) … Bar - 1 bar."

And the conversion table, verbatim:

| Snap setting | Notation |
|---|---|
| 1/4 Step | 64th notes |
| 1/2 Step | 32nd notes |
| 1/4 Beat | 16th notes |
| 1/3 Beat | Triplets |
| 1/2 Beat | 8th notes |
| 1 Beat | Quarter notes |
| Bar | Whole note |

> "Snapping can be temporarily disabled by holding the Alt key when dragging events."

`Backspace` toggles global snap on/off. **HIGH**

### 3.5 Tools & mouse bindings — HIGH

Verbatim tool behaviours from `pianoroll.htm`:

| Tool | Key | Behaviour |
|---|---|---|
| Draw (pencil) | `P` | Left-click adds a note; left-click-drag repositions before release; **right-click deletes**; right-click-drag deletes multiple |
| Paint | `B` | Left-click adds one; click-drag paints "multiple notes at once while dragging horizontally"; right-click deletes |
| Paint drum sequencer | `N` | Left-click adds; left-click on a note mutes/unmutes; right-click deletes |
| Delete | `D` | Click or drag to remove |
| Mute | `T` | Left-click mutes; drag mutes multiple |
| Slice | `C` | Left-click-drag vertically splits notes |
| Select | `E` | Click or drag to select |
| Zoom | `Z` | Left-click-drag zooms to selection; right-click toggles zoom |
| Play/audition | `Y` | Click plays notes; drag scrubs |

Note editing, verbatim:

- Draw a note of a chosen length: "hold the (Left-Shift) Left-click and drag to the
  desired length".
- **Resize**: hover the note edge until a "double-headed arrow" appears, then drag.
  Resizing from the *left* edge requires enabling "Allow resizing from left"
  (`Ctrl+Alt+Home`). **Right-edge resize is the default.**
- **Delete**: "Right-Click a note to erase it".
- **Move**: "Left-click on the note and drag vertically or horizontally."
- **Velocity**: "Hold (Alt/Opt) and use Mouse-wheel while hovering notes to change
  velocity."

Modifiers, verbatim:

- **Shift** — vertical lock (preserve pitch); stretch mode when adding notes
- **Ctrl** — horizontal lock (preserve timing); makes selections
- **Alt** — bypasses snap; free movement; `Ctrl+Alt` for fine
- **Shift+Alt** — nudge notes with mouse-wheel

Additional from `basics_shortcuts.htm`: `Shift+Left-click` clones the selection;
`Ctrl+Left-click` selects; `Ctrl+Shift+Left-click` adds to selection;
double-left-click a note opens Note Properties; `Ctrl+Right-click` zoom-on-selection.

### 3.6 Zoom / pan — HIGH

- **Pan (both axes at once):** "Click the (Middle-Mouse-Button) and drag in the Piano
  roll to scroll vertically and horizontally at the same time." Alternative:
  `Left-Shift + Right-click` drag.
- **Horizontal zoom:** grab the *edge* of the horizontal position slider and drag.
  The Playlist page additionally documents the shortcut that also works here:
  "place the Mouse cursor over the location to zoom and (Ctrl+Mouse-wheel)."
- **Vertical zoom:** middle-mouse-button drag, or middle-click-drag on the preview
  keyboard.
- **Quick zoom:** `Page Up`/`Page Down` zoom in/out centred on the cursor;
  `Shift+1/2/3` zoom presets; `Shift+4` minimum zoom; `Shift+5` zoom to selection.

### 3.7 Velocity / control lane — HIGH

- The lane is the **Event Editor** beneath the grid, resized with the splitter grip.
- Target chosen from the **"Editor target"** selector (`Control ▸`) at its left, or
  by right-clicking the lane. The menu (read off `pianoroll_eventeditor.png`) is two
  columns: **Note properties** — Note pan, Note velocity, Note release, Note filter
  cutoff frequency, Note filter resonance (Q), Note fine pitch, Note repeat — and
  **Channel controls** — Channel panning, Channel volume, Channel pitch.
- Rendering: **one stem per note**, drawn as a vertical line from the lane baseline up
  to a small round handle, coloured to match the note (green `#C7FFCF` stems for green
  notes, red stems for the red note in the capture). Selected/unselected notes' stems
  are distinguished by brightness. **HIGH** (measured + capture)
- Adjust with "mouse-wheel (Alt/Opt+mouse-wheel)" or by dragging the handle.
- `F` cycles to the next note property shown in the lane; `Shift+F` cycles note
  properties.
- **Default velocity is 100 (of 127)** — **MED**, from Image-Line forum consensus
  (<https://forum.image-line.com/viewtopic.php?t=66390>), not stated in the manual page.

---

## 4. Playlist

Reference: `playlist_main.png`, `playlist_trackheaders.png`.

### 4.1 Anatomy — HIGH

Left→right, top→bottom from the annotated capture:

- **Title bar**: `▷ [tools…] ◁ Playlist - Arrangement › <clip source> ›` + window
  controls. The **Arrangements** breadcrumb and the **Clip source** breadcrumb are
  separate clickable segments.
- **Tool bar** row with the same tool icon set as the Piano Roll (plus Slip Edit).
- **Clip-focus buttons** and **`+ Add track`** button below the tool bar.
- **Picker Panel** — a dockable left panel listing the project's Patterns (each row a
  coloured mini-preview strip with the pattern name, e.g. `Panning`, `Melody`,
  `Bass`, `Main automation`). This is where you pick the clip you're about to paint.
  Toggle `Alt+P`. **HIGH**
- **Track headers** column: track name, a mute/solo LED (green dot, bottom-right of
  the header), a `···` grip, and per-mode icons. Right-click menu (verbatim from
  `playlist_trackheaders.png`): *Rename, color and icon… / Change color… / Change
  icon… / Auto name / Auto name clips / Track mode ▸ / Performance settings ▸ /
  Size ▸ / Lock to this size*.
- **Zoom & scroll bar** above the timeline (a miniature of the whole arrangement,
  with the ends as zoom drag handles).
- **Timeline / ruler** numbered "in bars displayed along the top of the window", with
  **Time markers** as tabs (`Start`, `↻Repeat`, `↓Chorus` in the capture).
- **Track lanes** with clips.
- **Track-height control** at the top-right of the lane area (drag vertically to
  change *all* track heights); vertical scrollbar below it.
- **Play position** marker: a small green/yellow triangle in the ruler with a
  vertical playhead line down the lanes. **HIGH**
- **Selection**: a translucent **red/pink rectangle** overlaying the selected time
  range and tracks. **HIGH** (visible in `playlist_main.png`; measured overlay tint
  ≈ +40 % red over the underlying pixels — treat exact alpha as **LOW**)

### 4.2 Clip appearance — HIGH

Every clip is a **flat rectangle with a 1-line header strip at its top** carrying a
small type-icon and the clip name (e.g. `▤ Melody`, `⌁ Panning`,
`↦ Vocals: The Girl - Stereo view`), and a **body that is a live mini-preview of the
clip's contents**:

- **Pattern clip (notes)** — body shows the pattern's notes as small pale horizontal
  bars laid out at their real pitch/time positions, i.e. a miniature piano roll.
- **Pattern clip (events/automation)** — body shows the event curve.
- **Audio clip** — body shows the waveform (or spectrogram in spectral view).
- **Automation clip** — body shows the automation envelope with its control points.

Clip **colour source is selectable** — verbatim from `playlist.htm`, three modes
exposed as `NOTE / CHAN / PAT` buttons above the track headers:

- "Note mode: Uses the parent pattern's (notes & event) colors"
- "Chan mode: Uses the parent channel's color settings"
- "Pat mode: Uses the parent pattern's color settings"

Colouring: click "the color square" in the rename dialog, or "Right-Click to randomly
assign a color from a palette". **HIGH**

Measured clip colours from `basics_interface.png` (a real project, so these are
*user* colours, illustrative of the palette's character rather than defaults):
bass clip header `#B99664` / body `#5D5645`; drum clip body notes drawn in near-white
on a desaturated green; vocal audio clips pink-lavender. Track headers pick up a
desaturated version of the clip colour. **HIGH** (measured) / **LOW** (as "defaults")

### 4.3 Drawing / erasing clips — HIGH

Verbatim:

- **Draw (P)**: "Left-click to add the currently selected Clip. Left-click-and-drag
  to reposition the clip before releasing it. Right-Click to delete Clips."
- **Paint (B)**: "Left-click to adds the currently selected Clip. Click-and-drag to
  paint multiple clips. Right-Click to delete Clips."
- **Delete (D)**: "Click or Click-and-drag to delete Clips."
- **Mute (T)**: "Left-click on clips to mute them. Left-click and drag to mute
  multiple clips."
- **Slip Edit (S)**: "Left-click on the content of Clips to slide them left or right
  relative to the time-line while retaining the start/end points."
- **Slice (C)**: "Click and drag to make vertical slices through Clip OR use
  (Left-Shift) to Slice diagonally."
- **Select (E)**: "Either Left-click on Clips or Left-click and drag to make group
  selections."
- **Play Selected (Y)**: "Click the clips you want to play. Click position will set
  the start location."

Mouse shortcuts (`basics_shortcuts.htm`): double-left-click a clip opens properties;
**right-click = delete tool**; double-right-click = mute tool;
`Shift+Left-click` clones the clip; `Ctrl+Left-click` selects;
`Ctrl+Shift+Left-click` adds to selection; middle-mouse-drag (or
`Left-Shift+Right-click`) pans; `Ctrl+Right-click` zoom-to-selection;
`Shift+Mouse-wheel` over the track area re-orders tracks;
`Shift+Alt+Mouse-wheel` over a clip nudges its position.

### 4.4 Snap — HIGH

Playlist local snap adds **Cell** (grid-cell start) to the shared list; "Holding the
Alt key temporarily sets snap to 'none.'" `Backspace` toggles global snap.

### 4.5 Loop / time markers — HIGH

- Add a marker: `Alt+T` or `Ctrl+T`. `Alt+/` and `Alt+*` jump previous/next marker.
- Marker types, verbatim list: "None, Start, Loop, Marker loop, Marker skip, Marker
  pause, Time signature, and Start/Stop recording".
- **Song loop**: "Right-Click a Time Marker and select the option 'Song loop'" — a
  "down facing arrow" indicates the repeat point. "The Repeat Marker is ignored
  during rendering except for the special case where the marker is set beyond the
  end."

### 4.6 Zoom / scroll — HIGH

- **Horizontal zoom:** "Left-click and drag on the left or right edge of the
  horizontal scroll handle. Alternatively place the Mouse cursor over the location to
  zoom and (Ctrl+Mouse-wheel)."
- **Vertical zoom:** "Left-click and drag the track height control up/down to change
  the vertical zoom of all Playlist tracks."
- **Pan:** "Click the (Middle-Mouse-Button) and drag in the Playlist to scroll
  vertically and horizontally at the same time."
- `PgUp/PgDn` zoom in/out; `Shift+1/2/3` presets; `Shift+4` show all;
  `Shift+5` zoom on selection; `Shift+0` centre on playhead.

### 4.7 Track ↔ Channel ↔ Mixer linkage — HIGH

"Drop instruments on Playlist Track headers to create a link between the three
windows" (Channel Rack, Playlist, Mixer) — FL's *Track mode*, a 1:1 instrument-per-
track binding. Worth noting for Lane 6's scope call: the classic FL workflow
(patterns painted onto generic tracks) and this newer 1:1 mode coexist.

---

## 5. Mixer

Reference: `mixer_main.png`, `mixer_routing.png`.

### 5.1 Composition — HIGH

Verbatim: "500 x Insert Tracks for receiving input from plugins and external audio
Inputs, 1 x Current track for hosting tools like Edison and Wave Candy and a Master
track". "Each Track has 10 effects slots."

### 5.2 Strip layout, top → bottom — HIGH

Read off `mixer_main.png` (a **vertical** strip; strips sit side-by-side and scroll
horizontally):

1. **Track number tab** at the very top (`1 2 3 … 26`, `20 99 100…`), highlighted in
   blue/teal when selected or docked; small icons under the number row indicate
   routing/instrument links.
2. **Track name label**, rendered **rotated 90° (bottom-to-top)** down the upper part
   of the strip — `Master`, `Send FROM`, `Synths`, `Bass`, `Insert 7`… This vertical
   label is one of the Mixer's most recognisable visual traits. "Track labels - Can
   be Middle-clicked, or Right-Click and select from the 'context menu > Rename /
   color'".
3. **Peak meter** — a tall narrow vertical bar beside the fader. Green over most of
   its range, yellow toward the top. The **selected track's meter is drawn much
   wider/brighter** at the far left of the mixer. Measured yellow `#FEFE3F`,
   green tip `#AAFD43`, meter trough `#3B4D5F`. **HIGH**
4. **Mute LED** — small green ring, one per strip, in a horizontal row across all
   strips.
5. **Panning knob** — small dark knob, again in a row across all strips.
6. **Level fader** — a wide, short, pale **horizontal-cap slider handle** running in
   a vertical track. The default/unity position sits high in the track. Handles turn
   **orange** when the track is not at default / is armed-highlighted in the capture
   (`#F0A020`-family). "Level Faders - 'Volume control' for the track", post-effect.
   The **fader/meter relative height is itself draggable vertically**.
7. **Invert phase**, **Swap stereo**, **Stereo separation** knob — three more
   cross-strip rows of tiny controls.
8. **Disable all FX**, **Latency compensation**, **Record arm** — three more rows.
9. **Send switch** — a small triangle at the bottom of each strip; clicking it on
   another strip makes that strip receive a send from the selected track, drawn as a
   **curved green "send link" line** across the bottom of the mixer.

### 5.3 Track Inspector / FX panel — HIGH

A dock (left or right, `Ctrl+Enter` toggles) showing, top→bottom: **Audio Input**
selector, **Slot 1…Slot 10** (each row = effect name or italic `Slot n` placeholder,
a **wet-mix knob** on the right, and a small green **enable LED**), then a **Track
Properties** area (parametric EQ curve + 3 EQ bands with faders/knobs), then **PDC**
and **Audio Output** selector. Empty slots render their label in *italic grey*;
loaded effects render in solid white. **HIGH**

For a minimal replica: draw 10 slot rows with the wet knob + LED and don't implement
FX — the visual idea is the ladder of ten named rows. (Brief says visual idea only.)

### 5.4 Routing & meters — HIGH

- Channels route via the "Channel Rack Routing selector or the Channel settings
  Routing selector".
- "The master track receives all audio unless channels route elsewhere."
- Useful truth for a replica's metering: "it is practically IMPOSSIBLE to clip insert
  Mixer Tracks. You can safely ignore peaks over 0 dB." Only Master and
  ASIO-routed tracks can clip. So only Master needs a red clip indicator.
- `Ctrl+L` links selected channels to a mixer track; `Ctrl+Shift+L` links from the
  selected mixer track; `S` solos; `Alt+S` alt-solo; `Alt+←/→` moves a track;
  `Alt+W` toggles peak-meter wave view; `F2` renames; `Ctrl+A` selects all tracks;
  `Ctrl+Shift+Left-click` multi-selects; `Shift+Mouse-wheel` moves tracks.

---

## 6. Colour palette (default theme)

FL Studio 21 is **themeable** — "To open the Theme settings choose 'Options > Theme
settings' from the main menu or press the F10 function key" — so "the FL palette" is
the *default* theme, and any replica should implement colours as tokens rather than
hard-coded values. Theme settings expose HSL/RGB, "HTML color (#)" entry, a "Lock to
safe colors" toggle that "reduces the saturation and luminance range to fall within
the color range chosen by the FL Studio 'aesthetics committee'", and a dice for random
safe colours. **HIGH** (`envsettings_themes.htm`)

### 6.1 Measured tokens

Every value below was sampled pixel-exactly from an official Image-Line screenshot
(file named in the last column). Confidence **HIGH** for "this is the colour in that
capture"; **MED** for "this is the shipped default", since the manual's captures are
of real projects and PNG palette quantisation (`8-bit colormap` on several files) can
shift a value by ±1.

| Role | Hex | Source file |
|---|---|---|
| Workspace / desktop behind windows | `#475056` | `basics_interface.png` |
| Window title bar & tool bars | `#4E585E` | all four captures |
| Window title bar (alt / inactive) | `#535D62` | `basics_interface.png` |
| Panel body — Channel Rack rack area | `#727C81` | `channelrack_main.png` |
| Panel body — plugin/Channel Settings window | `#444B4F` | `channelrack_swing.png` |
| Deep recess / inset well | `#2D3438`, `#293238` | `channelrack_swing.png`, `pianoroll_general.png` |
| Browser / dark list background | `#1F2A30` | `basics_interface.png` |
| Piano-roll lane, white key | `#42545F` | `pianoroll_general.png` |
| Piano-roll lane, black key + step gridline | `#394B56` | `pianoroll_general.png` |
| Piano-roll beat-shaded band | `#32444F` | `pianoroll_general.png` |
| Beat gridline / flank | `#2E404B` / `#3E4F5A` | `pianoroll_general.png` |
| Bar gridline (heaviest) | `#1A2C37` | `pianoroll_general.png` |
| Ruler / timeline background | `#2A363F` (PR), `#2B3840` (PL) | `pianoroll_general.png`, `playlist_main.png` |
| Playlist lane background | `#3A4C57` / `#3F4B55` | `playlist_main.png`, `playlist_trackheaders.png` |
| Piano keyboard, white key | `#D9DDE5` → `#FFFFFF` L-to-R gradient | `pianoroll_general.png` |
| Piano keyboard, black key | `#494A4C` | `pianoroll_general.png` |
| Note block, default green | body `#BCF1C6`, top `#C6FBD0`, shadow `#83AB89`, right grip `#4E8756` | `pianoroll_general.png` |
| Note block, 2nd MIDI colour (lavender) | `#B9CEF2` | `pianoroll_general.png` |
| Note block, red MIDI colour | `#F08080`-family | `pianoroll_eventeditor.png` |
| Ghost note | `#637580` | `pianoroll_general.png` |
| Step OFF, odd beat group | `#6E7579` (cap `#7D8388`, lip `#454C50`) | `channelrack_main.png` |
| Step ON, odd beat group | `#D2E4EF` (cap `#EFFFFF`) | `channelrack_main.png` |
| Step OFF, even beat group | `#806D6E` (cap `#8D7B7C`, lip `#4C494C`) | `channelrack_main.png` |
| Step ON, even beat group | `#FFCED0` (cap `#FFE9EC`) | `channelrack_main.png` |
| Step cell outline / gutter | `#5E676C` / `#727C81` | `channelrack_main.png` |
| LED green, lit | `#A8E1B0` core, `#B8F0BF` highlight | `channelrack_main.png` |
| Channel-selected indicator green | `#B8F0BF` on `#82A58F` | `channelrack_main.png` |
| Accent orange (PAT/SONG lit, knob rings, sync) | `#FFD27C` highlight over an `#FF8A00`-family glow | `basics_interface_lcd.png`, `channelrack_swing.png` |
| LCD plate | `#E6F7FF` → `#E1F1F9`, dark navy digits | `basics_interface_lcd.png` |
| Mixer meter, green | `#AAFD43` | `mixer_main.png` |
| Mixer meter, yellow (upper) | `#FEFE3F` | `mixer_main.png` |
| Mixer meter trough | `#3B4D5F` | `mixer_main.png` |
| Mixer fader handle, default | pale `#C6CDD1`-family | `mixer_main.png` |
| Mixer fader handle, non-default/armed | orange `#F0A020`-family | `mixer_main.png` |
| Playlist selection overlay | translucent red/pink over content | `playlist_main.png` |
| Error state (missing plugin/sample channel button) | red `#C0392B`-family | `channelrack_main.png` |
| Body text (light on dark) | `#D8E1E6` / `#BDC2C6` | `pianoroll_ghostnotes.png`, `playlist_trackheaders.png` |

**On the brief's guess of `#374146`:** that exact value *is* present in FL's default
theme (0.33 % of `channelrack_main.png`, 0.67 % of `channelrack_swing.png`) but it is a
minor recess tone, not the primary surface. The two workhorse surfaces are
**`#4E585E`** (chrome/title bars) and **`#42545F`/`#3A4C57`** (grid canvases), with
**`#727C81`** for the Channel Rack's raised rack body. **HIGH**

The whole palette is a **desaturated blue-slate ramp**, hue ≈ 200–205°, saturation
8–15 %, lightness stepping roughly 10 → 20 → 27 → 33 → 45 %, with exactly three
saturated accents: **green** (LEDs, notes, sends, meters), **orange** (transport
mode, knob rings, non-default values), and **red** (errors, selection, record). **MED**
(derived from the measurements above.)

### 6.2 Per-channel / per-clip user colours

FL does **not** ship a fixed per-channel default palette that a replica must match.
New channels default to the neutral chrome colour; the user assigns colour by
right-click → "Rename / color…", by "Gradient coloring across multiple selected
channels", or by "Right-Click to randomly assign a color from a palette" — the
palette being the theme's "safe colors" range (reduced saturation and luminance).
**HIGH** on the mechanism; the specific hex list of that random palette is **not
documented** — see Gaps.

---

## 7. Typography & iconography

- **Type**: a single condensed humanist sans across the whole UI, at essentially one
  or two sizes. Menu bar is **ALL CAPS with wide letter-spacing**; window titles,
  channel names, mixer labels and note labels are **sentence case**. No bold/italic
  contrast except **italic = disabled/placeholder** (empty mixer FX slots read
  *Slot 4* in italic grey). Text is light-on-dark everywhere except LCDs. Numbers in
  LCDs use a slightly wider tabular face. **HIGH** (observed consistently across all
  captures); the exact typeface is **not published** — a condensed grotesque
  (Oswald / Barlow Semi Condensed / Roboto Condensed) is the closest free stand-in.
  **LOW**
- **Icons**: flat, monochrome, ~16 px, single-weight line glyphs in the same pale
  grey as text; they light up (green/orange) rather than changing shape when active.
  Instrument channels carry a small pictographic glyph on the right of the name
  button (kick drum, hand clap, hi-hat stand, piano keys). Windows are identified by
  a glyph in their title bar. The manual publishes these as individual PNGs under
  `html/img_glob/flicon_*.png` (e.g. `flicon_pencilup.png`, `flicon_paint.png`,
  `flicon_slice.png`, `flicon_snap.png`, `flicon_playlist.png`, `flicon_rack.png`,
  `flicon_pianoroll.png`, `flicon_mixer.png`) — **do not ship these files**, but they
  are a precise shape reference. **HIGH**
- **Controls**: knobs are dark circles with a single light pointer line and (when
  non-default) an orange arc around the rim; sliders are pale rounded caps in dark
  tracks; LEDs are small rings that fill with colour; everything sits on subtle 1 px
  bevels rather than borders. **HIGH**

---

## 8. Interaction vocabulary — the FL idioms that matter

Consolidated, all **HIGH** from `basics_shortcuts.htm` / the per-window pages:

| Gesture | Meaning |
|---|---|
| **Left-click** | draw / add / activate (step, note, clip) |
| **Right-click** | **delete** (step, note, clip) — FL's signature binding; also opens context menus on non-content areas |
| **Right-click-drag** | delete multiple |
| **Left-click-drag on a fresh click** | reposition the just-drawn item before release |
| **Shift+Left-click-drag** (Piano Roll) | draw a note *and* set its length in one gesture |
| **Shift+Left-click** on an existing item | **clone** the selection |
| **Ctrl+Left-click** | select; **Ctrl+Shift+Left-click** adds to selection |
| **Drag right edge** (note/clip) | resize; left-edge resize is off by default (`Ctrl+Alt+Home`) |
| **Middle-mouse-drag** | **pan both axes** in Playlist and Piano Roll (also `Left-Shift+Right-click`) |
| **Ctrl+Mouse-wheel** | zoom horizontally at the cursor |
| **Middle-mouse-drag** (Piano Roll vertical / preview keyboard) | vertical zoom |
| **Alt (held)** | **bypass snap** while dragging |
| **Alt+Mouse-wheel** over a note | change the current note property (velocity by default) |
| **Shift+Alt+Mouse-wheel** | nudge position |
| **Shift (held)** while dragging a note | lock pitch (vertical lock) |
| **Ctrl (held)** while dragging a note | lock timing (horizontal lock) |
| **Alt+Left-click / middle-click** on a knob | reset to default |
| **Ctrl-drag** on a knob | fine adjustment |
| **Shift+Mouse-wheel** over track/channel area | reorder tracks/channels |
| **Double-left-click** a note/clip | open its properties dialog |
| **Double-right-click** a ghost note | switch the Piano Roll to that ghost's channel |
| **Ctrl+Right-click-drag** | zoom to selection |
| **Middle-click + Right-click** | open the context menu (in PR/PL) |

Tool letters are **shared across Piano Roll and Playlist**: `E` select, `P` draw
(pencil), `B` paint (brush), `C` slice, `D` delete, `T` mute, `Y` playback,
`Z` zoom, plus `S` slip-edit (Playlist only) and `N` paint-drum (Piano Roll only).

---

## 9. Keyboard shortcuts for the beat-making loop

The minimum set a replica must honour (all **HIGH**, `basics_shortcuts.htm`):

**Transport**
- `Space` — start/stop playback
- `Ctrl+Space` — start/pause
- `L` — **toggle Pattern / Song mode** (the single most important FL binding after Space)
- `R` — toggle recording
- `Ctrl+M` — metronome; `Ctrl+P` — metronome precount
- `Ctrl+H` — panic / stop all sound
- `Home` — playback marker to start
- `Ctrl+E` — step-edit mode; `Ctrl+I` — wait for input; `Ctrl+B` — blend notes;
  `Ctrl+T` — typing keyboard → piano

**Windows**
- `F5` Playlist · `F6` Channel Rack · `F7` Piano Roll · `F8` Plugin Picker ·
  `F9` Mixer · `F11` Song info · `F12` close all · `Esc` close · `Enter` max/min
  Playlist · `Tab` cycle nested windows · `F1` help · `Alt+F8` Browser

**Patterns**
- Numpad `1..9` select pattern; numpad `+`/`-` next/previous pattern
- `F4` next empty pattern; `Shift+F4` first empty; `Ctrl+F4` next empty (no naming)
- `F2` rename/recolor the current pattern

**Editing (both grids)**
- `Ctrl+A` select all · `Ctrl+D` deselect · `Ctrl+C/V/X` copy/paste/cut ·
  `Ctrl+B` duplicate to the right · `Del` delete selected
- `Ctrl+Z` undo last edit · `Ctrl+Alt+Z` undo step-by-step
- `Backspace` toggle global snap · `Alt` bypass snap
- `Ctrl+Q` / `Shift+Q` quantize · `Ctrl+L` quick legato (PR)
- `Ctrl+↑/↓` transpose one octave (PR)
- `PgUp/PgDn` zoom · `Shift+1..4` zoom presets · `Shift+5` zoom to selection

**Channel Rack**
- `1..9,0` mute channels 1–10 · `Ctrl+1..9,0` solo · `↑/↓` select channel
- `Alt+C` clone · `Alt+Del` delete · `Alt+↑/↓` reorder · `Ctrl+K` graph editor

**Mixer**
- `S` solo · `Alt+S` alt-solo · `Ctrl+L` link channel(s) to track · `F2` rename

**File**
- `Ctrl+S` save · `Ctrl+Shift+S` save as · `Ctrl+N` save new version · `Ctrl+O` open ·
  `Ctrl+R` export wave

---

## 10. Implementation notes for the spec writer

1. **The three FL primitives to get right, in priority order:** (a) right-click =
   delete, everywhere; (b) middle-drag = 2-axis pan and `Ctrl+wheel` = zoom-at-cursor,
   everywhere; (c) `L` toggles Pattern vs Song mode and the whole app's meaning
   changes with it.
2. **The step grid's 4-step group shading is a *hue* alternation on the buttons
   themselves**, and the buttons are portrait rounded rects at ≈20×32 with a 4 px
   gutter — not a flat square checkerboard. This one detail is what makes a mock
   "look like FL" vs "look like a generic step sequencer".
3. **The Piano Roll's shading is two-dimensional** — black/white key row tint ×
   per-beat column tint × three weights of gridline. Notes are square-cornered with a
   distinct darker right-edge grip.
4. **The Playlist clip is a header strip + a live miniature of its contents.** A
   pattern clip that renders as a flat coloured rectangle with a label is the most
   common way a replica reads wrong.
5. **Theme everything as tokens.** FL 21 ships a theme editor (`F10`), so hard-coding
   `#4E585E` throughout would be un-FL-like on top of being bad practice.
6. **Mixer**: the vertical rotated track label, the wide selected-track meter, and the
   ladder of ten slot rows carry the whole visual idea; faders and meters are
   secondary.

---

## 11. Gaps / open items

- **No published hex list** for the theme's "safe colors" random palette used for
  channel/pattern/track colouring. A replica must invent an equivalent (HSL-clamped:
  S ≈ 35–60 %, L ≈ 45–65 % matches what's observable in the captures). **LOW**
- **No published typeface name.** Identified only by eye as a condensed grotesque.
- **Absolute pixel metrics are scale-uncertain.** The manual's captures give exact
  *ratios* but may be at 125 %/150 % Windows DPI; note height / step width "at 100 %
  zoom" is not documented anywhere by Image-Line. Ratios are safe; absolutes are not.
- **Selection-overlay alpha** in the Playlist and the exact selected-note rendering in
  the Piano Roll were not isolated cleanly — the annotated captures overlay text on
  the relevant regions.
- **Default note velocity (100/127)** rests on forum consensus, not the manual.
- Verifying the above properly needs a capture from the **free FL Studio trial**
  (fully functional, save disabled) at a known 100 % DPI — that is the one legitimate
  way to close the metric gaps, and it was out of reach in this lane (no desktop
  runtime available).
