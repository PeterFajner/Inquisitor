// The chips: importing this registers every renderer (basic.tsx, flow.tsx).
import "./basic.tsx";
import "./flow.tsx";
export { EFFECT_TYPES, EffectChip, Effects, effectType, pickCount, register, rendererOf, type ChipRenderer, type EffectType } from "./registry.tsx";
export { condText } from "./condition.tsx";
export { KIND_ICON, KIND_LABEL } from "./kinds.ts";
export { Chip, Ic, type IconType } from "./ui.tsx";
