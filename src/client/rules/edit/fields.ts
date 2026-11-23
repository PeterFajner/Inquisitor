// What each effect type's chip turns into when edited: its fields, each a
// control of some kind (dice, a stat list, a picker of entries by book
// name, a condition, nested effects…). A type with no spec here (a newer
// format) is edited as its JSON.
import {
  Ban, Brain, Calculator, Coins, CornerDownRight, Cpu, Dices, Equal, FileText, Hash, Infinity as InfinityIcon, KeyRound, Layers,
  ListChecks, MapPin, Minus, Package, Percent, Plus, RefreshCw, Repeat2, Shield, Split, Star, StickyNote, Swords, Tag, TriangleAlert, Users,
  X, Zap,
} from "lucide-preact";
import { ALIGNMENTS, AVAILABILITIES, DERIVED, LOCATIONS, POOLS, QUALITIES, STATS } from "../../../shared/rules/schema.ts";
import type { RefKind } from "../ctx.ts";
import { L } from "../labels.ts";
import type { IconType } from "../chips/ui.tsx";
import { KIND_ICON } from "../chips/kinds.ts";

export type FieldKind =
  | { k: "dice" }
  | { k: "int" }
  | { k: "num" }
  | { k: "text" }
  | { k: "long" }
  | { k: "enum"; of: readonly string[]; show?: Record<string, string>; icons?: Record<string, IconType> }
  | { k: "enums"; of: readonly string[]; show?: Record<string, string>; single?: boolean }
  | { k: "stats" }
  | { k: "ref"; ref: RefKind }
  | { k: "refs"; ref: RefKind }
  | { k: "bool" }
  | { k: "effects" }
  | { k: "from" }
  | { k: "cond" }
  | { k: "strings" }
  | { k: "record" }
  | { k: "json" }
  | { k: "pickN" }
  | { k: "chance" }
  | { k: "column" }
  | { k: "cap" }; // number or "average"

export type Field = { at: (string | number)[]; f: FieldKind; label: string; icon: IconType; req?: boolean };

const POOL_SHOW: Record<string, string> = { talent: "Talents", exotic: "Exotic Abilities", item: "Equipment", mutation: "Mutations", power: "Psychic Powers" };

const id: Field = { at: ["id"], f: { k: "text" }, label: L.id, icon: Hash };
const idReq: Field = { ...id, req: true };
const f = (at: string | (string | number)[], k: FieldKind, label: string, icon: IconType, req?: boolean): Field => ({
  at: Array.isArray(at) ? at : [at],
  f: k,
  label,
  icon,
  req,
});

const grant = (kind: "talent" | "exotic" | "mutation" | "power"): Field[] => [
  f(kind, { k: "ref", ref: kind }, L.kinds[kind], KIND_ICON[kind], true),
  f("note", { k: "text" }, L.note, StickyNote),
  f("again", { k: "bool" }, L.add2, Repeat2),
];

export const EFFECT_FIELDS: Record<string, Field[]> = {
  stat: [
    f("stat", { k: "stats" }, L.stats, Hash, true),
    f("add", { k: "dice" }, L.add2, Plus),
    f("set", { k: "dice" }, L.set, Equal),
    f("multiply", { k: "num" }, L.multiply, X),
    f("max", { k: "cap" }, L.max, Minus),
    f("min", { k: "int" }, L.min, Plus),
    f("each", { k: "bool" }, L.each, RefreshCw),
    id,
  ],
  talent: grant("talent"),
  exotic: grant("exotic"),
  mutation: grant("mutation"),
  power: grant("power"),
  item: [
    f("item", { k: "ref", ref: "item" }, L.kinds.item, Package, true),
    f("qty", { k: "dice" }, L.qty, Hash),
    f("quality", { k: "enum", of: QUALITIES }, L.quality, Cpu),
    f("implanted", { k: "bool" }, L.implanted, Cpu),
    f("reloads", { k: "int" }, L.reloads, RefreshCw),
    f("alterations", { k: "refs", ref: "item" }, L.upgrade, Plus),
    f("note", { k: "text" }, L.note, StickyNote),
    f("again", { k: "bool" }, L.add2, Repeat2),
  ],
  pick: [
    idReq,
    f("pick", { k: "pickN" }, L.pick, ListChecks, true),
    f("from", { k: "from" }, L.pick, ListChecks),
    f("pool", { k: "enum", of: POOLS, show: POOL_SHOW }, L.pool, Layers),
    f("filter", { k: "json" }, L.filter, Tag),
    f("qty", { k: "dice" }, L.qty, Hash),
    f("random", { k: "dice" }, L.random, Dices),
    f("distinct", { k: "bool" }, L.each, RefreshCw),
    f("implanted", { k: "bool" }, L.implanted, Cpu),
    f("into", { k: "text" }, L.kinds.item, Package),
  ],
  optional: [idReq, f("optional", { k: "effects" }, L.optional, Plus)],
  chance: [
    idReq,
    f("chance", { k: "chance" }, L.chance, Percent, true),
    f("then", { k: "effects" }, L.chance, Percent),
    f("else", { k: "effects" }, L.otherwise, CornerDownRight),
  ],
  roll: [
    idReq,
    f("roll", { k: "ref", ref: "table" }, L.roll, Dices, true),
    f("times", { k: "dice" }, L.times, X),
    f("column", { k: "column" }, L.column, Hash),
    f("rerollDuplicates", { k: "bool" }, L.random, Repeat2),
    f("qty", { k: "dice" }, L.qty, Hash),
    f("rerollUnless", { k: "json" }, L.filter, Tag),
  ],
  when: [
    f("when", { k: "cond" }, L.if, Split, true),
    f("then", { k: "effects" }, L.if, Split),
    f("else", { k: "effects" }, L.otherwise, CornerDownRight),
  ],
  alignment: [idReq, f("alignment", { k: "enums", of: ALIGNMENTS }, L.alignment, Users, true)],
  gear: [
    idReq,
    f(["gear", "count"], { k: "dice" }, L.gear, Dices, true),
    f(["gear", "availability"], { k: "enums", of: AVAILABILITIES }, L.availability, Coins),
    f(["gear", "alien"], { k: "json" }, L.alien, Star),
    f(["gear", "downgrade"], { k: "json" }, L.downgrade, Minus),
    f(["gear", "exclude"], { k: "strings" }, L.except, Ban),
    f(["gear", "require"], { k: "json" }, L.require, ListChecks),
  ],
  powers: [
    idReq,
    f(["powers", "count"], { k: "dice" }, L.powers, Brain, true),
    f(["powers", "maxDifficulty"], { k: "int" }, L.maxDifficulty, Hash),
    f(["powers", "crossDisciplinePenalty"], { k: "int" }, L.crossDiscipline, Minus),
    f(["powers", "disciplines"], { k: "strings" }, L.group, Layers),
  ],
  prose: [
    f("prose", { k: "long" }, L.prose, FileText, true),
    f("kind", { k: "enum", of: ["gameplay", "gm", "unfit"], icons: { gameplay: FileText, gm: Users, unfit: TriangleAlert } }, L.prose, FileText, true),
    f("proposal", { k: "long" }, L.proposal, TriangleAlert),
  ],
  armour: [
    f(["armour", "av"], { k: "dice" }, L.armour, Shield),
    f(["armour", "add"], { k: "dice" }, L.add2, Plus),
    f(["armour", "as"], { k: "ref", ref: "item" }, L.armour, Package),
    f(["armour", "field"], { k: "dice" }, L.armour, Zap),
    f(["armour", "locations"], { k: "json" }, L.location, MapPin),
    f(["armour", "choose"], { k: "int" }, L.pick, ListChecks),
    id,
  ],
  restrict: [f("restrict", { k: "json" }, L.restrict, Ban, true)],
  exclusive: [f("exclusive", { k: "json" }, L.exclusive, Ban, true)],
  derived: [
    f("derived", { k: "enums", of: DERIVED }, L.derived, Calculator, true),
    f("add", { k: "dice" }, L.add2, Plus),
    f("set", { k: "json" }, L.set, Equal),
    f("counts", { k: "json" }, L.derived, Calculator),
    id,
  ],
  attribute: [
    f("attribute", { k: "text" }, L.attribute, Tag, true),
    f("set", { k: "dice" }, L.set, Equal),
    f("add", { k: "dice" }, L.add2, Plus),
    id,
  ],
  wielded: [f("wielded", { k: "effects" }, L.wielded, Swords)],
  remove: [
    f(["remove", "talent"], { k: "refs", ref: "talent" }, L.kinds.talent, KIND_ICON.talent),
    f(["remove", "exotic"], { k: "refs", ref: "exotic" }, L.kinds.exotic, KIND_ICON.exotic),
    f(["remove", "item"], { k: "refs", ref: "item" }, L.kinds.item, KIND_ICON.item),
    f(["remove", "mutation"], { k: "refs", ref: "mutation" }, L.kinds.mutation, KIND_ICON.mutation),
    f(["remove", "power"], { k: "refs", ref: "power" }, L.kinds.power, KIND_ICON.power),
  ],
  reloads: [f(["reloads", "add"], { k: "int" }, L.add2, Plus), f(["reloads", "multiply"], { k: "num" }, L.multiply, X)],
  trade: [
    idReq,
    f(["trade", "give"], { k: "json" }, L.give, Minus, true),
    f(["trade", "get"], { k: "effects" }, L.get, Plus),
    f(["trade", "times"], { k: "json" }, L.times, X),
  ],
  upgrade: [idReq, f("upgrade", { k: "int" }, L.upgrade, Plus, true)],
  bionics: [
    idReq,
    f(["bionics", "count"], { k: "dice" }, L.bionics, Cpu, true),
    f(["bionics", "quality"], { k: "enum", of: QUALITIES }, L.quality, Cpu),
    f(["bionics", "upgrade"], { k: "num" }, L.upgrade, Percent),
    f(["bionics", "table"], { k: "ref", ref: "table" }, L.roll, Dices),
  ],
  weapon: [
    f(["weapon", "name"], { k: "text" }, L.name, Swords),
    f(["weapon", "profile"], { k: "record" }, L.weapon, Swords, true),
    f(["weapon", "qty"], { k: "int" }, L.qty, Hash),
  ],
  access: [
    f(["access", "pool"], { k: "enum", of: POOLS, show: POOL_SHOW }, L.pool, Layers, true),
    f(["access", "group"], { k: "strings" }, L.group, KeyRound, true),
  ],
  psyker: [],
  companion: [
    f(["companion", "archetype"], { k: "ref", ref: "archetype" }, L.companion, Users, true),
    f(["companion", "subtype"], { k: "text" }, L.companion, Hash),
    f(["companion", "option"], { k: "text" }, L.companion, Hash),
  ],
  warband: [
    f(["warband", "max"], { k: "int" }, L.max, Hash, true),
    f(["warband", "archetype"], { k: "refs", ref: "archetype" }, L.warband, Users, true),
  ],
  location: [f("location", { k: "json" }, L.location, MapPin, true), id],
};

export const STAT_LIST = STATS;
export const LOCATION_LIST = LOCATIONS;
export { InfinityIcon };
