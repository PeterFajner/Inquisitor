import { Archetype, Role, Subtype } from 'helpers/ArchetypeHelper/Archetype';
import {
    DefiniteBoon,
    Stat,
    Talent,
} from 'helpers/CompendiumHelper/CompendiumTypes';

export interface Stats {
    BS: number;
    I: number;
    Ld: number;
    Nv: number;
    S: number;
    Sg: number;
    T: number;
    WS: number;
    Wp: number;
}

export const STATS_ORDER: Stat[] = [
    'WS',
    'BS',
    'S',
    'T',
    'I',
    'Wp',
    'Sg',
    'Nv',
    'Ld',
];

export interface Character {
    id: string;
    name: string;
    archetype: Archetype;
    role: Role | null;
    subtype: Subtype;
    stats: Stats;
    baseTalents: Set<Talent>;
    chosenTalents: (Talent | undefined)[];
    boons: DefiniteBoon[];
}
