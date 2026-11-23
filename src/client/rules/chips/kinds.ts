// An icon per kind of entry (card headers, grant chips, pickers).
import { BookOpen, Brain, Dices, Dna, Package, ScrollText, Sparkles, Star, Users } from "lucide-preact";
import type { RefKind } from "../ctx.ts";
import { L } from "../labels.ts";
import type { IconType } from "./ui.tsx";

export const KIND_ICON: Record<RefKind, IconType> = {
  archetype: Users,
  talent: Star,
  exotic: Sparkles,
  item: Package,
  power: Brain,
  mutation: Dna,
  table: Dices,
  rule: ScrollText,
};
export const KIND_LABEL: Record<RefKind, string> = L.kinds;
export const BookIcon = BookOpen;
