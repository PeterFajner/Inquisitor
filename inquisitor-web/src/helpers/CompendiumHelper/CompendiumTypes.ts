import { Archetype } from '../ArchetypeHelper/Archetype';

export interface Compendium {
    // compendium keys should always be lowercase, as there's some inconsistency in capitalization throughout the spreadsheet
    archetypes: { [key: string]: Archetype };
    talents: { [key: string]: Talent };
    boons: { [key: string]: Boon[] }; // key is subtype key
    exoticAbilities: { [key: string]: ExoticAbility };
    randomExoticAbilities: RandomExoticAbility[]; // ordered by lowroll
}

export const EmptyCompendium: Compendium = {
    archetypes: {},
    talents: {},
    boons: {},
    exoticAbilities: {},
    randomExoticAbilities: [],
};

export interface ExoticAbility {
    key: string; // lowercase
    name: string;
    description: string;
}

export interface RandomExoticAbility {
    lowRoll: number; // 1-100
    highRoll: number; // 1-100
    exoticAbility: ExoticAbility;
}

export interface Talent {
    key: string;
    name: string;
    description: string;
}

export interface Talent {}

export type Stat = 'BS' | 'I' | 'Ld' | 'Nv' | 'S' | 'Sg' | 'T' | 'WS' | 'Wp';

export type BoonType = 'Ability' | 'Boost' | 'Exotic' | 'Psychic' | 'Reroll';

export interface Boon {
    lowRoll: number; // 1-100
    highRoll: number; // 1-100
    type: BoonType;
}

export interface AbilityBoon extends Boon {
    type: 'Ability';
    ability: Talent;
}

export interface BoostBoon extends Boon {
    type: 'Boost';
    amount: number;
    stat: Stat;
}

export interface ExoticBoon extends Boon {
    type: 'Exotic';
}

export interface PsychicBoon extends Boon {
    type: 'Psychic';
}

export interface RerollBoon extends Boon {
    type: 'Reroll';
    subtypeKey: string;
}

export interface RolledExoticBoon extends ExoticBoon {
    exoticAbility: ExoticAbility;
}

export interface RolledPsychicBoon extends PsychicBoon {
    // todo
}

/**
 * A specific boon that has been granted to a character, rather than a possible boon that can be rolled
 */
export type DefiniteBoon =
    | AbilityBoon
    | BoostBoon
    | RolledExoticBoon
    | RolledPsychicBoon;

/**
 * Handle turning '55+2D10' into a structured format
 */
export class DieCode {
    base: number;
    numDice: number;
    dieSize: 3 | 6 | 10 | 100;

    constructor(dieCodeString: string) {
        // the regex first tries to match `1+2D3` or `1+D3` then `2D3` or `D3` then `1`
        const regex =
            /((?<base1>\d*)\+(?<numDice1>\d*)?D(?<dieSize1>\d*))|((?<numDice2>\d*)?D(?<dieSize2>\d*))|((?<base3>\d*))/;
        const match = dieCodeString.match(regex);
        const { base1, numDice1, dieSize1, numDice2, dieSize2, base3 } =
            match?.groups || {};
        if (base1 && dieSize1) {
            this.base = parseInt(base1);
            this.numDice = parseInt(numDice1) || 1;
            this.dieSize = parseInt(dieSize1) as 3 | 6 | 10 | 100;
        } else if (dieSize2) {
            this.base = 0;
            this.numDice = parseInt(numDice2) || 1;
            this.dieSize = parseInt(dieSize2) as 3 | 6 | 10 | 100;
        } else if (base3) {
            this.base = parseInt(base3);
            this.numDice = 0;
            this.dieSize = 3;
        } else {
            throw new TypeError(`Invalid die code string ${dieCodeString}`);
        }
        // sanity check
        const generatedFirstPart = this.base ? `${this.base}` : '';
        const generatedMiddle = this.base && this.numDice ? '+' : '';
        const generatedSecondPart = this.numDice
            ? `${this.numDice}D${this.dieSize}`
            : '';
        const generatedSecondPartOption2 =
            this.numDice === 1 ? `D${this.dieSize}` : null; // D10 instead of 1D10
        const generatedString =
            generatedFirstPart + generatedMiddle + generatedSecondPart;
        const generatedStringOption2 = generatedSecondPartOption2
            ? generatedFirstPart + generatedMiddle + generatedSecondPartOption2
            : null;
        if (
            dieCodeString !== generatedString &&
            dieCodeString !== generatedStringOption2
        ) {
            console.debug(`Ensure ${dieCodeString} === ${generatedString}`, {
                match,
            });
        }
    }

    roll(): number {
        let sum = this.base;
        for (let i = 0; i < this.numDice; i++) {
            const result = 1 + Math.floor(Math.random() * this.dieSize);
            console.debug(
                `Rolling ${this.base}+${this.numDice}D${this.dieSize} #${
                    i + 1
                }: ${result}`
            );
            sum += result;
        }
        return sum;
    }
}

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
