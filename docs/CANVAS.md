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
| `cards: CanvasCard[]` | `{id, x, y, w, h?, label?}`: world position of the top-left corner, width (the card is laid out at that CSS width), an estimated height until it's measured, an accessible name (also on its placeholder). Order = Tab order. |
| `renderCard(card, {selected})` | The card's content: ordinary Preact children (HTML, so text is selectable and accessible). **Keep it stable** (`useCallback`): a card re-renders only when its card object, position, selection or `renderCard` changes. Give a card a new object when its content changes. |
| `wires?: CanvasWire[]` | `{from, to, fromSide?, toSide?, class?, style?}`: a curve between two cards (by id), drawn under the cards. Sides default to the facing ones (`left`/`right`/`top`/`bottom`). Default stroke `--wire`; style per wire with `class` or `style` (e.g. `{stroke: "var(--accent)", strokeDasharray: "4 4"}`). Wires whose box is off screen aren't drawn. |
| `regions?: CanvasRegion[]` | `{id, title, icon?, x, y, w, h, class?}`: a titled area under the cards. The title is drawn above the region's top-left corner, over the cards, and grows as you zoom out so it stays readable (up to a twelfth of the region's width): leave `regionGap` room for it. A region with an `icon` gets a tab in the tab bar (top left) that flies to it; the tab of the region under the viewport's centre has `aria-current="true"`. |
| `selected?`, `onSelect?(id \| null)` | Controlled selection. A click/tap on a card selects it (not when the click ended a text selection); a click/tap on the background or Escape selects nothing; Enter/Space on a focused card selects it. Selected cards get `data-selected` and `aria-current`. |
| `onMove?(id, {x, y})` | Makes cards draggable; called on drop with the new world position (snapped). The card follows the pointer meanwhile; it goes back unless the caller updates its `x`/`y`. |
| `snap?: number` | Grid step for dragged cards. |
| `measure?: boolean` | Measure every card once, hidden, 40 per frame after fonts load (needed for masonry by measured height). Mounted cards are always measured (ResizeObserver). |
| `onMeasure?(sizes)` | All measured sizes so far (`Map<id, {w, h}>`), at most once a frame. |
| `initialView?: View \| "fit"` | Default `"fit"`: fits all cards and regions, and keeps fitting while sizes arrive until the first pan/zoom. |
| `onViewChange?(view)` | The view, 200 ms after it stops changing (e.g. to keep it in the URL). |
| `minZoom?`, `maxZoom?` | Default 0.02 and 2.5. |
| `placeholderBelow?` | Default 0.32: below this zoom cards are empty boxes (no content mounted). |
| `overscan?` | Default 700: screen pixels around the viewport whose cards stay mounted (doubled for placeholders). |
| `minimap?` | Show the minimap at first (it has a toggle). |
| `controls?` | Default true: the zoom in / zoom out / fit / minimap buttons (bottom right). |
| `labels?` | `{zoomIn, zoomOut, fit, minimap, canvas?}`: the controls' `aria-label`s and tooltips. The defaults are English placeholders that need the owner's approval (AGENTS.md); pass approved words. |
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
wires and cards, then region titles) without re-rendering. Preact re-renders only
when the viewport leaves the mounted window (viewport + overscan), the zoom
crosses `placeholderBelow`, or zooming in more than doubles. Each card is a
memoised slot, so a re-render mounts and unmounts only the cards entering
and leaving. `will-change: transform` is set only while moving, so text is
re-rastered crisp when the view settles.

Measured in headless Chrome with the 867 cards of `data/rules`, at
1280×800 and 390×844: panning with all 867 placeholders on screen and at
zoom 1 (~30 cards mounted), and flinging 12,000 px across ~210 cards, run at
a 16.7 ms median frame (p95 ≈ 18.5 ms).

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
in state, and recompute the layout from them; saved positions (moved
cards) override the layout's.

## Styling

`canvas.css` uses only base.css tokens: `--bg` behind, `--surface-2`
regions, `--line` placeholders and region borders, `--wire` wires,
`--accent` selection, `--focus` keyboard focus and the minimap's viewport.
Cards are styled by the caller's content; the slot (`.cv-card`) only
positions it. Classes: `.cv` (root; `.is-moving` while the view moves,
`.is-panning`, `.is-dragging`), `.cv-region`, `.cv-region-title`,
`.cv-wire`, `.cv-card` (`.is-ph` placeholder, `.is-drag`), `.cv-tabs`,
`.cv-controls`, `.cv-minimap`.
