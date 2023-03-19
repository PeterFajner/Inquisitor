import { Archetype, Role, Subtype } from "helpers/ArchetypeHelper/Archetype";
import { Talent } from "helpers/CompendiumHelper/CompendiumTypes";

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

export interface Character {
    id: string;
    name: string;
    archetype: Archetype;
    role: Role;
    subtype: Subtype;
    stats: Stats;
    baseTalents: Set<Talent>;
    chosenTalents: Set<Talent>;
}
