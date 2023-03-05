export const STAT_NAMES = {
    BS: 'Ballistics Skill',
    I: '???',
    Ld: 'Leadership',
    Nv: 'Nerve',
    S: 'Speed',
    Sg: 'Sagacity',
    T: '???',
    WS: 'Weapons Skill',
    Wp: 'Willpower',
};

export interface Subtype {
    name: string;
    stats: {
        BS: DieCode,
        I: DieCode,
        Ld: DieCode,
        Nv: DieCode,
        S: DieCode,
        Sg: DieCode,
        T: DieCode,
        WS: DieCode,
        Wp: DieCode,
    };
}

export interface Role {
    name: string;
}

export interface Archetype {
    name: string;
    roles: {[key: string]: Role};
    subtypes: {[key: string]: Subtype};
}

export interface ArchetypeCompendium {
    archetypes: {[key: string]: Archetype}
}

export const EmptyCompendium = {
    archetypes: {}
}

/**
 * Handle turning '55+2D10' into a structured format
 */
export class DieCode {
    base: number;
    numDice: number;
    dieSize: 6 | 10;

    constructor(dieCodeString: string) {
        // the regex first tries to match `1+2D3` then `2D3` then `1`
        const regex =
            /((?<base1>\d*)\+(?<numDice1>\d*)D(?<dieSize1>\d*))|((?<numDice2>\d*)D(?<dieSize2>\d*))|((?<base3>\d*))/;
        const match = dieCodeString.match(regex);
        const { base1, numDice1, dieSize1, numDice2, dieSize2, base3 } =
            match?.groups || {};
        if (base1 && numDice1 && dieSize1) {
            this.base = parseInt(base1);
            this.numDice = parseInt(numDice1);
            this.dieSize = parseInt(dieSize1) as 6 | 10;
        } else if (numDice2 && dieSize2) {
            this.base = 0;
            this.numDice = parseInt(numDice2);
            this.dieSize = parseInt(dieSize2) as 6 | 10;
        } else if (base3) {
            this.base = parseInt(base3);
            this.numDice = 0;
            this.dieSize = 6;
        } else {
            throw new TypeError(`Invalid die code string ${dieCodeString}`);
        }
    }
}
