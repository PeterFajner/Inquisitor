export interface Compendium {
    // compendium keys should always be lowercase, as there's some inconsistency in capitalization throughout the spreadsheet
    archetypes: { [key: string]: Archetype };
    talents: { [key: string]: Talent };
    boons: { [key: string]: Boon[] }; // key is subtype key
    exoticAbilities: { [key: string]: ExoticAbility };
    randomExoticAbilities: RandomExoticAbility[]; // ordered by lowroll
}

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

export interface TalentChoiceList {
    numTalents: number;
    subtype: Subtype | null;
    role: Role | null;
    talentList: Talent[] | null; // list to choose the talents from, if null it's all talents
}

export interface Archetype {
    key: string; // lowercase name
    name: string;
    roles: { [key: string]: Role };
    subtypes: { [key: string]: Subtype };
    // null subtype/role = all subtypes/roles have this talent
    // a talent available to multiple subtypes/roles appears multiple times
    talents: { talent: Talent; subtype: Subtype | null; role: Role | null }[];
    // free talents the player can select
    talentChoices: TalentChoiceList[];
}

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
