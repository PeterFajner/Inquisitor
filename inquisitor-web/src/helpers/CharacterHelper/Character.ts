import { Archetype, Role, Subtype } from 'helpers/ArchetypeHelper/Archetype';
import { Talent } from 'helpers/CompendiumHelper/CompendiumTypes';

export interface Stats {
    BS: number,
    I: number,
    Ld: number,
    Nv: number,
    S: number,
    Sg: number,
    T: number,
    WS: number,
    Wp: number,
}

export interface Character {
    id: string;
    name: string;
    archetype: Archetype;
    role: Role;
    subtype: Subtype;
    stats: Stats;
    // chosen = whether the talent was chosen by the player (as opposed to automatic)
    talents: Set<{talent: Talent, chosen: boolean}>;
}