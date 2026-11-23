# The canvas engine

`src/client/canvas/` is an infinite, pannable and zoomable canvas for
Preact. The rules canvas (~900 cards in the book's regions) and the
character history tree are built on it. It has no text of its own: region
titles come from the caller (the book's section names), and every control
is an icon with an `aria-label` and the same text as its `title`.

```
src/client/canvas/
  index.ts       exports everything below
  Canvas.tsx     the component
  Minimap.tsx    the minimap (internal)
  tiles.ts       cards drawn ahead into tiles (drawCard; internal)
  geometry.ts    pure maths: transforms, zoom, fit, culling, fly path, wires
  layout.ts      layoutRegions: masonry placement into regions
  canvas.css     styles (base.css tokens only)
test/canvas.test.ts  tests of geometry.ts and layout.ts
```

## Coordinates

Cards, wires and regions live in **world** coordinates (CSS pixels at zoom
1). A `View` `{x, y, k}` maps them to the screen:
`screen = world * k + (x, y)`, screen being CSS pixels from the canvas
element's top-left. `toScreen`, `toWorld`, `visibleRect`, `zoomAt`,
`fitView` and `flyPath` in geometry.ts do the conversions.

## Example

```tsx
import { useCallback, useMemo, useRef, useState } from "preact/hooks";
import { BookOpen, Users } from "lucide-preact";
import { Canvas, layoutRegions, type CanvasApi, type CanvasCard, type Size } from "../canvas/index.ts";

const REGIONS = [
  { id: "archetypes", title: "Character Archetypes", icon: Users },
  { id: "talents", title: "Talents & Exotic Abilities", icon: BookOpen },
];

function RulesCanvas({ entries }: { entries: { id: string; region: string; name: string; pos?: { x: number; y: number } }[] }) {
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const api = useRef<CanvasApi>(null);

  // Entries without a saved position are placed by the layout helper, by measured height.
  const layout = useMemo(
    () => layoutRegions(REGIONS, entries.map((e) => ({ id: e.id, region: e.region, h: sizes.get(e.id)?.h ?? 160 })), { columnWidth: 300 }),
    [entries, sizes],
  );
  const cards: CanvasCard[] = useMemo(
    () => entries.map((e) => ({ id: e.id, w: 300, h: 160, label: e.name, ...(e.pos ?? layout.positions.get(e.id)!) })),
    [entries, layout],
  );
  const regions = REGIONS.map((r) => ({ ...r, ...layout.regions.get(r.id)! }));
  const render = useCallback((c: CanvasCard, { selected }: { selected: boolean }) => (
    <article class="rule-card">
      <h3><span data-canvas-handle />{c.label}</h3>
      …
    </article>
  ), []);

  return (
    <Canvas
      cards={cards}
      regions={regions}
      wires={[{ from: "archetype/adepta-sororitas", to: "table/boons" }]}
      renderCard={render}
      selected={selected}
      onSelect={setSelected}
      onMove={(id, pos) => saveMove(id, pos)}
      snap={8}
      measure
      onMeasure={(s) => setSizes(new Map(s))}
      apiRef={api}
      labels={{ zoomIn: "…", zoomOut: "…", fit: "…", minimap: "…" }}
    />
  );
}
// Elsewhere: api.current?.flyTo("talent/acrobatic"), api.current?.fit().
```

The canvas fills its container (`height: 100%`): give the parent a height.

## `<Canvas>` props

| prop | |
|---|---|
| `cards: CanvasCard[]` | `{id, x, y, w, h?, label?}`: world position of the top-left corner, width (the card is laid out at that CSS width), an estimated height until it's measured, an accessible name (also drawn on its placeholder, and the name of its keyboard stand-in). Order = Tab order. |
| `renderCheap?(card, size)`, `cheapBelow?` | A cheaper rendering, fixed to the card's measured size, used for measured, unselected cards while the settled zoom is below `cheapBelow` (default 0.5). |
| `renderCard(card, {selected})` | The card's content: ordinary Preact children (HTML, so text is selectable and accessible). **Keep it stable** (`useCallback`): a card re-renders only when its card object, position, selection or `renderCard` changes. Give a card a new object when its content changes. |
| `wires?: CanvasWire[]` | `{from, to, fromSide?, toSide?, class?, style?}`: a curve between two cards (by id), drawn under the cards. Sides default to the facing ones (`left`/`right`/`top`/`bottom`). Default stroke `--wire`; style per wire with `class` or `style` (e.g. `{stroke: "var(--accent)", strokeDasharray: "4 4"}`): wires are drawn on the placeholder canvas, each with the stroke, width, dashes and opacity a hidden `<path class="cv-wire …">` computes to (read once per class/style). Wires whose box is off screen aren't drawn. |
| `regions?: CanvasRegion[]` | `{id, title, icon?, x, y, w, h, class?}`: a titled area under the cards. The title is drawn above the region's top-left corner, over the cards, and grows as you zoom out so it stays readable (up to a twelfth of the region's width): leave `regionGap` room for it. A region with an `icon` gets a tab in the tab bar (top left, or in the bar between `barStart` and `barEnd`) that flies to it; the tab of the region under the viewport's centre has `aria-current="true"`. |
| `selected?`, `onSelect?(id \| null)` | Controlled selection. A click/tap on a card selects it (not when the click ended a text selection); a click/tap on the background or Escape selects nothing; Enter/Space on a focused card selects it. Selected cards get `data-selected` and `aria-current`. |
| `onMove?(id, {x, y})` | Makes cards draggable; called on drop with the new world position (snapped). The card follows the pointer meanwhile; it goes back unless the caller updates its `x`/`y`. |
| `snap?: number` | Grid step for dragged cards. |
| `measure?: boolean` | Measure every card without a known size once, hidden, after fonts load: rendered straight into a hidden box (no canvas re-render) in ~8 ms slices that yield in between, the batch size adapting to how long the last took (needed for masonry by measured height). Mounted cards are always measured (ResizeObserver). |
| `initialSizes?` | Sizes known from before (e.g. a cache): used as if measured, and not measured hidden; a mounted card's own measurement replaces them. |
| `onMeasure?(sizes)` | All sizes measured so far (`Map<id, {w, h}>`, not `initialSizes`): once a frame for mounted cards, about once a second while measuring hidden. |
| `initialView?: View \| "fit"` | Default `"fit"`: fits all cards and regions, and keeps fitting while sizes arrive until the first pan/zoom. |
| `onViewChange?(view)` | The view, 200 ms after it stops changing (e.g. to keep it in the URL). |
| `minZoom?`, `maxZoom?` | Default 0.02 and 2.5. |
| `placeholderBelow?` | Default 0.32: below this zoom cards are placeholders (no content mounted). Mounted cards stay until the zoom is 10% below it (no flapping around it). |
| `drawCard?(g, card, scale)` | Draws a card that isn't mounted, on the placeholder canvas, instead of a plain box: in world units from the card's top-left, `scale` device pixels a world unit (draw less when small). Cards are drawn ahead into tiles (below); keep it stable: a new function redraws every card, and a card is redrawn when its object, position or size changes. A card mounted over its drawing fades in (0.18 s, none with reduced motion). Where no tile is drawn yet, cards are boxes of `--cv-ph` (default `--line`). |
| `overscan?` | Default 700: screen pixels around the viewport whose cards stay mounted (doubled for placeholders). |
| `minimap?` | Show the minimap at first (it has a toggle). |
| `controls?` | Default true: the zoom in / zoom out / fit / minimap buttons (bottom right). |
| `labels?` | `{zoomIn, zoomOut, fit, minimap, canvas?}`: the controls' `aria-label`s and tooltips. The defaults are English placeholders that need the owner's approval (AGENTS.md); pass approved words. |
| `barStart?`, `barEnd?` | With either, the region tabs sit in a full-width bar along the top (`.cv-bar`), between these (the rules page puts the builder's home, + and rules controls first, so they stay in the same place on both pages). |
| `apiRef?` | Receives a `CanvasApi`. |
| `class?` | Extra class on the root. |

### `CanvasApi`

- `flyTo(target, opts?)`: target is a card id, a region id, a world `Rect`
  or a `View`. Smooth zoom-and-pan (van Wijk & Nuij: it pulls back on long
  flights), instant with `prefers-reduced-motion`. Options: `maxZoom`
  (default 1 for a card), `keepZoom` (only pan, centring the target),
  `pad` (screen pixels around it), `instant`.
- `fit(opts?)`: everything in view.
- `zoomBy(factor, at?)`: animated; about a screen point (default: centre).
- `panBy(dx, dy)` (screen pixels), `getView()`, `setView(view)`.
- `rectOf(id)`: a card's world rect, measured height when known.
- `size()`: the canvas's screen size.

## Input

| | mouse / trackpad | touch | keyboard |
|---|---|---|---|
| pan | drag the background; middle-button drag anywhere; scroll (shift+wheel: sideways) | one finger anywhere (background or card); two fingers | arrows (shift: ×4), when focus isn't in a text field |
| zoom | ctrl/⌘ + wheel or trackpad pinch (Safari's gesture events too), double-click the background, buttons | pinch | `+` / `-`, `0` fits |
| select | click a card | tap a card | Tab to a card, Enter |
| drag a card | press on its handle and drag | press on its handle and drag | — |

- **Handles**: an element with `data-canvas-handle` inside a card is its
  drag handle. A card without one is dragged from anywhere except
  interactive elements (`button`, `a`, inputs, `[data-canvas-nodrag]`) with
  the mouse, and not by touch (one finger pans, so a phone can always
  move around). With handles, mouse drags elsewhere on the card select
  text.
- **Tab** walks the mounted cards in `cards` order; a card focused off
  screen is flown into view (zoomed to readable if the canvas is showing
  placeholders).
- A pan or drag never ends in a click on what's under it.

## Performance

Panning and zooming set a CSS transform on three layers (regions, then
cards, then region titles) and redraw one 2D canvas, without re-rendering.
Preact re-renders only when the viewport leaves the mounted window
(viewport + overscan), the zoom crosses `placeholderBelow`, or zooming in
more than doubles.

- **Drawn cards come from tiles.** With `drawCard`, the world is cut into
  512-device-pixel squares at levels of 2^L device pixels a world unit, each
  drawn once into its own canvas (a few cards at a time, in idle callbacks,
  nearest the centre first) and blitted with the view: a frame shows the
  level at or above the view's scale (at most one above the mount
  threshold's), stands in a coarser or finer tile until its own is drawn,
  else plain boxes. A changed card marks the tiles it was and is on stale;
  they keep showing until redrawn. At most 96 tiles are kept (LRU). While a
  zoom gesture is below 0.9 × `placeholderBelow`, the mounted cards' layer
  is `content-visibility: hidden` (`.cv-world.is-far`) over their drawings:
  scaled far down, the browser repaints them at every step.
- **Placeholders and wires are drawn, not elements.** Every frame of a pan
  the browser re-sorts the page's painted pieces ("Layerize"), and that
  cost grows with each positioned or transformed box, each inline `<svg>`
  and anything as large as a wires SVG: 900 placeholder boxes cost 50 ms a
  frame on a 6× slowed CPU. So cards that aren't mounted are boxes (with
  their names once legible) on one canvas under the cards, redrawn with the
  view, and so are the wires; clicks and taps on them are hit-tested in
  world coordinates. Keyboard users get transparent focusable stand-ins
  (`.cv-ph`) over the placeholders once they Tab into the canvas.
- **Cards are placed with left/top**, not a transform per card.
- **Mounting is spread over frames.** Cards entering the window start as
  placeholders and are mounted (or switched between cheap and full) a
  budget's worth per frame (~8 ms, adapted per level from how long the
  last frame's took), those on screen first, then nearest the centre
  (`nextToMount`). Selected and dragged cards mount at once.
- **Zooming leaves the cards alone.** While the zoom changes (a pinch,
  ctrl/⌘+wheel, the buttons, a flight) nothing is mounted or unmounted and
  the region borders and titles keep their size (`--cv-inv` is set once the
  zoom rests, 150 ms after the last step): the mounted cards scale with
  their layer, every other card is drawn on the placeholder canvas (all of
  them, not only the mounted window's), and the window, the level of detail
  and `--cv-inv` catch up when the zoom rests. Changing `--cv-inv` at every
  step restyled and re-rastered the big region layers and was most of what
  made zooming slow. The layers keep `will-change: transform` for good
  (toggling it per gesture repainted every mounted card); Chrome re-rasters
  them sharp once a zoom rests.
- Callers should keep card content cheap to composite: the rules cards
  draw their icons as `<img>`s (src/client/rules/icon.tsx), not inline SVG.

Measured in headless Chrome with the 964 cards of `data/rules`
(`scratchpad` scripts, rAF frame times while wheel-panning/zooming each
frame): at 1280×800 and 390×844, with the CPU slowed 6×, panning at fit,
0.35, 0.6 and 1 runs at a 16.7 ms median frame. A 2 s trackpad-like pinch
(ctrl+wheel every 8 ms, 1440×900 at 2×) from the whole board to readable,
back and forth across the mount threshold, and around 1, runs at a 16.7 ms
median at 1× (no frame over 33.4 ms); at 6× the pinch across the threshold
has a 33 ms p95 and a long task or two of ~130 ms (painting the full cards
mounted from 0.33 at 2×). The rules canvas measures
nothing: every card's size is worked out from its content (below), so a
first visit is laid out at once (ready in ~0.55 s at 6×, no background work
after).

## Card sizes without measuring (src/shared/layout)

The rules cards' heights are worked out, not measured: the card is rendered
(Preact) into a tiny DOM of its own (`dom.ts`) and laid out by a small
layout engine (`box.ts`) that reads the app's own stylesheets (`css.ts`:
base.css, canvas.css, rules.css, matched and cascaded) and the self-hosted
Ubuntu faces' advance widths (`fonts.ts`, generated by
`npm run fonts:metrics` from src/static/fonts). It knows the CSS the cards
use: block flow, inline text with Chrome's line breaking (`text.ts`),
flexbox, grid, auto tables, images; line heights floored to 1/64 px as
Chrome does. Cards turn kerning and ligatures off so a run is as wide as
its advances. A card whose table wouldn't fit its width (it would scroll)
is made wider.

- The server works out every card (`src/lib/rules-heights.ts`, in a child
  process with a 40 MB heap, ~1 s for 964 cards; an edit reworks only the
  cards it changes) from `dist/layout/bake.js`, the same card code bundled
  for Node by scripts/client.ts, and serves them at
  `GET /api/v1/rules/heights`.
- The browser (`src/client/rules/sizes.ts`, `card-height.tsx`) uses a
  server height while it holds: same entry, and every name the card looked
  up resolves the same (a hidden pack can rename things); else it works the
  card out itself (~0.6 ms a card, ~3 ms at 6×).
- Each card gets its worked-out height as `min-height`.
- `npm run heights:check` renders every card in headless Chrome at a desktop
  and a phone viewport and compares, heights and where every word went
  (below): run it after changing the cards' markup or CSS. A CSS feature
  the engine doesn't know (or a new font) needs the engine taught first.

## Cards too small to read (geometry, src/client/rules/greek.ts)

Below the zoom at which its text would be readable, a rules card isn't
mounted but drawn (the canvas's `drawCard`) from its geometry: the engine,
asked to (`measure(el, w, true)`), also says where it put every box with a
background, border or shadow, every word (left edge, width, baseline) and
every icon, with their colours as the app's tokens (`var(--ink-2)`, drawn
in the page's theme). `paint.ts` encodes a card's pieces compactly (a
shared table of looks; rectangles in half pixels, each from the end of the
one before; numbers as URL-safe characters, 5 bits each), served for every
card at `GET /api/v1/rules/geometry` (same bake as the heights, fetched
after them; ~720 KB, ~180 KB gzipped for the 964 cards), and worked out in
the browser for a card worked out there. Words are bars over the band their
letters fill (from 0.6 em above the baseline, 0.6 em tall) at 42% alpha
(55% bold), which holds about the same ink as the text; chips, cells,
rules and the card are drawn as they are; under ~2 device pixels a line,
a line's words are one bar.

- **The threshold**: a card is mounted once its body text's x-height
  (13px Ubuntu: 6.8 CSS px) is 4.5 device pixels, the size under which
  lowercase letters can't be told apart (9px text on a 1× screen, the
  smallest UI text there is): zoom 0.67 at 1×, 0.33 at 2×, 0.22 at 3×
  (`readableAt` in RulesCanvas.tsx; it follows `devicePixelRatio`). It
  fades in over its drawing, the words seeming to sharpen in place.
- **WebKit** (Safari, every iOS browser) floors line heights to whole
  pixels: its cards are a little shorter than Chrome's (the server's
  heights still hold as their slots), so there the geometry is worked out
  in the browser with the engine in WebKit's lines (`wholeLines`, as each
  card is first drawn; ~0.7 ms a card). Checked against headless WebKit:
  964/964 heights within 0.5 px, every baseline exact.
- heights:check compares each text node's words in Chrome with the
  geometry's (left and right edges, baseline): within 1 px for every card
  but one whose text has a character the fonts lack (drawn by a system
  font, its width only guessed).

## Layout helper

`layoutRegions(regions, entries, options)` places entries that have no
position yet: each region gets its entries in the given order in columns,
each entry going into the currently shortest column (masonry; ties go
left), entries wider than a column spanning as many as they need. Regions
run left to right, wrapping to a new row past `rowWidth`. Deterministic.

- `regions: {id, columns?}[]`: in order. Without `columns`, the count
  that brings the region's shape closest to `aspect` is used.
- `entries: {id, region, h, w?}[]`: `h` measured (or estimated).
- `options`: `columnWidth` (required), `gap` 16, `padding` 32, `header` 0
  (space reserved at a region's top; titles are drawn above regions),
  `regionGap` 120, `aspect` 1.6, `rowWidth` ∞, `origin` {0, 0}.
- Returns `{positions: Map<id, {x, y}>, regions: Map<id, Rect>, bounds}`.

Typical use: pass `measure` and `onMeasure` to the canvas, keep the sizes
in state, and recompute the layout from them.

## Styling

`canvas.css` uses only base.css tokens: `--bg` behind, `--surface-2`
regions, `--line` placeholders and region borders, `--wire` wires,
`--accent` selection, `--focus` keyboard focus and the minimap's viewport.
Cards are styled by the caller's content; the slot (`.cv-card`) only
positions it. Classes: `.cv` (root; `.is-moving` while the view moves,
`.is-panning`, `.is-dragging`), `.cv-region`, `.cv-region-title`,
`.cv-wire` (on the hidden probe path only), `.cv-phs` (the placeholder canvas), `.cv-ph` (keyboard stand-ins), `.cv-card` (`.is-drag`; `data-level` 1 cheap, 2 full), `.cv-tabs`, `.cv-bar`,
`.cv-controls`, `.cv-minimap`.
