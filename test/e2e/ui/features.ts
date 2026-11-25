// The feature-area shards (feature:<name>), one browser session each.
import type { Report } from "../lib/report.ts";
import type { RunOptions } from "../shards.ts";
import { balanceFeature, desktopDark, desktopLight, errorPagesFeature, phoneDark, phoneLight } from "./f-views.ts";
import { passkeyFeature, ruleEditFeature, rulesUpdateFeature } from "./f-account.ts";
import { navigationFeature, rulesFeature } from "./f-rules.ts";
import { historyFeature, shareFeature, warbandFeature } from "./f-share.ts";
import { legacyImportFeature, rulesEditorFeature } from "./f-editor.ts";
import { duplicateDeleteFeature, editsFeature, exportFeature, newCharacterFeature, rollsFeature, undoFeature } from "./f-builder.ts";

export const FEATURES: Record<string, (r: Report, o: RunOptions) => Promise<void>> = {
  "new-character": newCharacterFeature,
  edits: editsFeature,
  rolls: rollsFeature,
  "undo-redo": undoFeature,
  "duplicate-delete": duplicateDeleteFeature,
  export: exportFeature,
  history: historyFeature,
  share: shareFeature,
  warbands: warbandFeature,
  "rules-page": rulesFeature,
  navigation: navigationFeature,
  passkey: passkeyFeature,
  "rule-edit-live": ruleEditFeature,
  "rules-update": rulesUpdateFeature,
  "phone-light": phoneLight,
  "phone-dark": phoneDark,
  "desktop-light": desktopLight,
  "desktop-dark": desktopDark,
  "error-pages": errorPagesFeature,
  balance: balanceFeature,
  "rules-editor": rulesEditorFeature,
  "legacy-import": legacyImportFeature,
};
