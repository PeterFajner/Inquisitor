import { DieCode, Talent } from "helpers/CompendiumHelper/CompendiumTypes";

export interface Subtype {
    key: string; // lowercase name
    name: string;
    stats: {
        BS: DieCode;
        I: DieCode;
        Ld: DieCode;
        Nv: DieCode;
        S: DieCode;
        Sg: DieCode;
        T: DieCode;
        WS: DieCode;
        Wp: DieCode;
    };
}

export interface Role {
    key: string; // lowercase name
    name: string;
}

export interface Archetype {
    key: string; // lowercase name
    name: string;
    roles: { [key: string]: Role };
    subtypes: { [key: string]: Subtype };
    // null subtype/role = all subtypes/roles have this talent
    // a talent available to multiple subtypes/roles appears multiple times
    talents: { talent: Talent; subtype: Subtype | null; role: Role | null }[];
    talentChoices: {
        numTalents: number;
        subtype: Subtype | null;
        role: Role | null;
    }[]; // free talents the player can select
}
