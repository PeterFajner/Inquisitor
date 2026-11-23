// The history's aria-labels (also their tooltips), in one place for the
// owner to review (AGENTS.md: controls are icons; these words are never
// printed). Placeholders until approved.
import type { EditKind } from "../../shared/api.ts";

export const H = {
  history: "History",
  builder: "Open in the builder",
  head: "Current version",
  makeHead: "Make this the current version",
  compare: "Compare with the current version",
  duplicate: "Duplicate from this version",
  source: "Duplicated from",
  author: "By",
  when: "When",
  gained: "Gained",
  lost: "Lost",
  close: "Close",
  same: "No difference",
  balance: "Balance",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Zoom to fit",
  minimap: "Minimap",
} as const;

/** What made a version (Version.kind). */
export const KIND: Record<EditKind, string> = {
  roll: "Rolled",
  choice: "Chosen",
  override: "Overridden",
  reroll: "Re-rolled",
  luna: "Luna",
  manual: "Edited",
  import: "Imported",
  duplicate: "Duplicated",
};
