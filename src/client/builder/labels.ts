// Every control's aria-label (shown as its tooltip too), in one place for
// the owner to review. Controls are icons: these words are never printed.
export const L = {
  characters: "Characters",
  newCharacter: "New character",
  archetype: "Archetype",
  subtype: "Subtype",
  random: "Random",
  undo: "Undo",
  redo: "Redo",
  duplicate: "Duplicate",
  history: "History",
  remove: "Delete",
  confirmRemove: "Delete for good",
  rename: "Rename",
  reroll: "Re-roll",
  change: "Change",
  randomFill: "Choose at random",
  add: "Add",
  take: "Remove",
  restore: "Restore the rules' value",
  save: "Save",
  cancel: "Cancel",
  close: "Close",
  search: "Search",
  update: "Update to the current rules",
  apply: "Apply",
  yes: "Yes",
  no: "No",
  source: "The book's text",
  overridden: "Overridden",
  gained: "Gained",
  lost: "Lost",
  balance: "Balance",
  mine: "Duplicate to my characters",
  alignment: "Alignment",
  gm: "GM",
  unfit: "Not built by the rules: by hand",
  rules: "Rules",
  rerolled: "Rolled again",
  rolls: "Rolls",
  balanceDetail: "Balance details",
} as const;

// Visible text the owner approved from the 2023 site (AGENTS.md), so the
// builder reads as the GM knows it. Everything else on screen is the book's.
export const T = {
  title: "Inquisitor Character Generator",
  characterName: "Character name",
  occupation: "Occupation",
  /** Under an asterisked archetype: the book's sentence (p. 3, "The ones with asterixis should have GM approval before use"). */
  gmApproval: "* Should have GM approval before use.",
  archetype: "Archetype",
  subtype: "Subtype",
  role: "Role",
  stats: "Stats",
  base: "Base",
  boon: "Boon",
  total: "Total",
  talents: "Talents",
  boons: "Boons",
  reroll: "Reroll",
  downloadDocx: "Download Docx",
} as const;

/**
 * Archetype sections whose pick the 2023 site called "Role" (T.role): the
 * book names the pick after the archetype itself (an Inquisitor's faction,
 * "decided by the Inquisitor's faction"). Every other Occupation pick is
 * labelled by its own section heading.
 */
export const ROLE_SECTIONS: Record<string, string> = { inquisitor: "Belief Faction" };
