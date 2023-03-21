import { Archetype } from "../ArchetypeHelper/Archetype";

export interface Compendium {
    // compendium keys should always be lowercase, as there's some inconsistency in capitalization throughout the spreadsheet
    archetypes: { [key: string]: Archetype };
    talents: { [key: string]: Talent };
}

export const EmptyCompendium: Compendium = {
    archetypes: {},
    talents: {},
};

export interface Talent {
    key: string;
    name: string;
    description: string;
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

    roll(): number {
        let sum = this.base;
        for (let i = 0; i < this.numDice; i++) {
            const result = 1 + Math.floor(Math.random() * this.dieSize);
            console.debug(`Rolling ${this.base}+${this.numDice}D${this.dieSize} #${i+1}: ${result}`);
            sum += result;
        }
        return sum;
    }
}

export const STAT_NAMES = {
    BS: "Ballistics Skill",
    I: "???",
    Ld: "Leadership",
    Nv: "Nerve",
    S: "Speed",
    Sg: "Sagacity",
    T: "???",
    WS: "Weapons Skill",
    Wp: "Willpower",
};
