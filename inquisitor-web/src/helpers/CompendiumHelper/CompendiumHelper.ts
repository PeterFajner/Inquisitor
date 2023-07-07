import config from 'config';
import { sheetUrlToCsv } from 'helpers/SheetsHelper/SheetsHelper';
import {
    AbilityBoon,
    Archetype,
    Boon,
    BoostBoon,
    Compendium,
    DieCode,
    ExoticBoon,
    PsychicBoon,
    RerollBoon,
    Subtype,
} from 'types/Compendium';

const assertDefined = (
    property: any,
    propertyName: string,
    stage: string,
    data: object
) => {
    if (property === undefined) {
        console.error(
            `${propertyName} undefined in compendium building stage ${stage}`,
            { data }
        );
    }
};

export const buildCompendium = async (
    setMaxProgress: (max: number) => void,
    setStatus: (progress: number, status: string) => void
): Promise<Compendium> => {
    const { sheets } = config;
    const compendium: Compendium = {
        archetypes: {},
        talents: {},
        boons: {},
        exoticAbilities: {},
        randomExoticAbilities: [],
    };
    setMaxProgress(8);
    // add archetypes and subtypes and their stats to compendium
    setStatus(1, 'Loading archetypes, subtypes, and stat ranges...');
    const rawStats = await sheetUrlToCsv(sheets.stats);
    rawStats.forEach((item) => {
        const archetype = item.Archetype;
        const archetypeKey = item.Archetype.toLowerCase();
        const subtype = item.Subtype;
        const subtypeKey = item.Subtype.toLowerCase();
        compendium.archetypes[archetypeKey] =
            compendium.archetypes[archetypeKey] ??
            ({
                key: archetypeKey,
                name: archetype,
                roles: {},
                subtypes: {},
                talents: [],
                talentChoices: [],
            } as Archetype);
        try {
            compendium.archetypes[archetypeKey].subtypes[subtypeKey] = {
                key: subtypeKey,
                name: subtype,
                stats: {
                    BS: new DieCode(item.BS),
                    I: new DieCode(item.I),
                    Ld: new DieCode(item.Ld),
                    Nv: new DieCode(item.Nv),
                    S: new DieCode(item.S),
                    Sg: new DieCode(item.Sg),
                    T: new DieCode(item.T),
                    WS: new DieCode(item.WS),
                    Wp: new DieCode(item.Wp),
                },
            } as Subtype;
        } catch (error) {
            console.error(error);
        }
    });
    // add roles to compendium
    setStatus(2, 'Loading roles...');
    const roles = await sheetUrlToCsv(sheets.roles);
    roles.forEach((item) => {
        const name = item.Role;
        const key = name.toLowerCase();
        const archetypeKey = item.Archetype.toLowerCase();
        const archetype = compendium.archetypes[archetypeKey];
        assertDefined(archetype, 'archetype', 'roles', { item, compendium });
        archetype.roles[key] = { key, name };
    });
    // add talents to compendium
    setStatus(3, 'Loading talent list...');
    const rawTalentsList = await sheetUrlToCsv(sheets.talentsList);
    rawTalentsList.forEach((talent) => {
        const name = talent.Talent;
        const key = name.toLowerCase();
        const description = talent.Description;
        compendium.talents[key] = { name, description, key };
    });
    // add talents to archetypes, subtypes, and roles
    setStatus(4, 'Loading talent assignments...');
    const archetypeTalents = await sheetUrlToCsv(sheets.talents);
    archetypeTalents.forEach((item) => {
        const archetype = compendium.archetypes[item.Archetype.toLowerCase()];
        assertDefined(archetype, 'archetype', 'archetype talents', {
            item,
            compendium,
        });
        const role =
            item.Role === '*' ? null : archetype.roles[item.Role.toLowerCase()];
        assertDefined(role, 'role', 'archetype talents', {
            item,
            compendium,
            archetype,
        });
        const subtype =
            item.Subtype === '*'
                ? null
                : archetype.subtypes[item.Subtype.toLowerCase()];
        assertDefined(subtype, 'subtype', 'archetype talents', {
            item,
            compendium,
            archetype,
        });
        // check to see if this is a talent choice (ex: "Any 3")
        const anyMatch = item.Talent.toLowerCase().match(
            /any (?<numFreeTalents>\d+)/
        );
        // check to see if this is a talent choice from a list (ex: "Pick 3")
        const pickMatch = item.Condition.toLowerCase().match(
            /pick (?<numPickTalents>\d+)/
        );
        const { numFreeTalents } = anyMatch?.groups || {};
        const { numPickTalents } = pickMatch?.groups || {};
        //console.debug({ item, numFreeTalents, anyMatch, anyMatchGroups: anyMatch?.groups });
        if (numFreeTalents) {
            archetype.talentChoices.push({
                numTalents: parseInt(numFreeTalents),
                role,
                subtype,
                talentList: null, // means choose from all talents
            });
        } else if (numPickTalents) {
            const numTalents = parseInt(numPickTalents);
            const talent = compendium.talents[item.Talent.toLowerCase()];
            // see if the talent choice list has alrady been registered
            const talentChoiceEntry = archetype.talentChoices.find(
                (choice) =>
                    choice.numTalents === numTalents &&
                    choice.role === role &&
                    choice.subtype === subtype &&
                    choice.talentList instanceof Array
            );
            if (talentChoiceEntry) {
                talentChoiceEntry.talentList?.push(talent);
            } else {
                archetype.talentChoices.push({
                    numTalents,
                    subtype,
                    role,
                    talentList: [talent],
                });
            }
        } else {
            const talent = compendium.talents[item.Talent.toLowerCase()];
            assertDefined(talent, 'talent', 'archetype talents', {
                item,
                compendium,
                talent,
            });
            archetype?.talents.push({ talent, role, subtype });
        }
    });
    // load boons
    setStatus(5, 'Loading boons...');
    const rawBoons = await sheetUrlToCsv(sheets.boons);
    rawBoons.forEach((rawBoon) => {
        const subtypeKey = rawBoon.Subtype.toLowerCase();
        const lowRoll = parseInt(rawBoon.Low);
        const highRoll = parseInt(rawBoon.High);
        const type = rawBoon.Type;
        let boon: Boon;
        switch (type) {
            // 'Ability' boons actually confer talents rather than Exotic Abilities
            case 'Ability':
                const ability = compendium.talents[rawBoon.Name.toLowerCase()];
                assertDefined(ability, 'ability', 'boons', {
                    rawBoon,
                    compendium,
                });
                boon = {
                    lowRoll,
                    highRoll,
                    type,
                    ability,
                } as AbilityBoon;
                break;
            case 'Boost':
                boon = {
                    lowRoll,
                    highRoll,
                    type,
                    amount: parseInt(rawBoon.Amount),
                    stat: rawBoon.Name,
                } as BoostBoon;
                break;
            case 'Exotic':
                boon = {
                    lowRoll,
                    highRoll,
                    type,
                } as ExoticBoon;
                break;
            case 'Psychic':
                boon = {
                    lowRoll,
                    highRoll,
                    type,
                } as PsychicBoon;
                break;
            case 'Reroll':
                boon = {
                    lowRoll,
                    highRoll,
                    type,
                    subtypeKey: rawBoon.Name.toLowerCase(),
                } as RerollBoon;
                break;
            default:
                console.error('Invalid Boon type', { rawBoon });
                throw new Error(`Invalid Boon type ${rawBoon.Type}`);
        }
        // add to compendium, by subtype
        const boonList = compendium.boons[subtypeKey] ?? [];
        boonList.push(boon);
        compendium.boons[subtypeKey] = boonList;
    });
    // load exotic abilities
    setStatus(6, 'Loading exotic abilities...');
    const rawExoticAbilities = await sheetUrlToCsv(
        sheets.exoticAbilitiesDescriptions
    );
    rawExoticAbilities.forEach((rawAbility) => {
        const abilityKey = rawAbility.Ability.toLowerCase();
        compendium.exoticAbilities[abilityKey] = {
            key: abilityKey,
            name: rawAbility.Ability,
            description: rawAbility.Description,
        };
    });
    // load random exotic abilities
    setStatus(7, 'Loading random exotic abilities table...');
    const rawRandomExoticAbilities = await sheetUrlToCsv(
        sheets.randomExoticAbilities
    );
    rawRandomExoticAbilities.forEach((rawAbility) => {
        const exoticAbility =
            compendium.exoticAbilities[rawAbility.Ability.toLowerCase()];
        assertDefined(
            exoticAbility,
            'exotic ability',
            'random exotic abilities',
            {
                rawAbility,
                compendium,
            }
        );
        compendium.randomExoticAbilities.push({
            lowRoll: parseInt(rawAbility.Low),
            highRoll: parseInt(rawAbility.High),
            exoticAbility,
        });
    });
    console.debug({ compendium });
    return compendium;
};
