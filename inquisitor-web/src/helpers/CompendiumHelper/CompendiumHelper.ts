import config from 'config';
import { sheetUrlToCsv } from 'helpers/SheetsHelper/SheetsHelper';
import {
    AbilityBoon,
    Archetype,
    ArchetypeKey,
    Boon,
    BoonType,
    BoostBoon,
    Compendium,
    DieCode,
    ExoticAbility,
    ExoticAbilityKey,
    ExoticBoon,
    PsychicBoon,
    RerollBoon,
    Role,
    RoleKey,
    Subtype,
    SubtypeKey,
    Talent,
    TalentKey,
} from 'types/Compendium';
import {
    RawDataRows,
    SerializableAbilityBoon,
    SerializableArchetype,
    SerializableArchetypeTalent,
    SerializableBoon,
    SerializableBoostBoon,
    SerializableCompendium,
    SerializableRandomExoticAbility,
    SerializableRerollBoon,
    SerializableRole,
    SerializableTalentChoiceList,
} from 'types/SerializableCompendium';

const assertDefined = (property: any, propertyName: string, stage: string, data: object) => {
    if (property === undefined) {
        console.error(`${propertyName} undefined in compendium building stage ${stage}`, { data });
    }
};

export const linkCompendium = (unlinkedCompendium: SerializableCompendium): Compendium => {
    const compendium: Compendium = {
        archetypes: new Map(),
        talents: new Map(unlinkedCompendium.talents.map((talent) => [talent.key, talent])),
        boons: new Map(),
        exoticAbilities: new Map(
            unlinkedCompendium.exoticAbilities.map((exoticAbility) => [exoticAbility.key, exoticAbility])
        ),
        randomExoticAbilities: [],
    };
    // link random exotic abilities
    compendium.randomExoticAbilities = unlinkedCompendium.randomExoticAbilities.flatMap(
        ({ lowRoll, highRoll, exoticAbilityKey }) => {
            const exoticAbility = compendium.exoticAbilities.get(exoticAbilityKey);
            if (!exoticAbility) {
                console.warn(`exotic ability ${exoticAbilityKey} not found when linking random exotic abilities`, {
                    unlinkedCompendium,
                });
                return [];
            }
            return [
                {
                    lowRoll,
                    highRoll,
                    exoticAbility,
                },
            ];
        }
    );
    // link boons
    unlinkedCompendium.boons.forEach((uBoon) => {
        const { lowRoll, highRoll, type, subtypeKey } = uBoon;
        const subtypeBoons = compendium.boons.get(subtypeKey) ?? [];
        compendium.boons.set(subtypeKey, subtypeBoons);
        switch (type) {
            case 'Ability':
                const abilityKey = (uBoon as SerializableAbilityBoon).abilityKey;
                const ability = compendium.talents.get(abilityKey);
                if (!ability) {
                    console.warn(`Ability ${abilityKey} not found when loading boon`, {
                        compendium,
                        unlinkedCompendium,
                    });
                    return;
                }
                subtypeBoons.push({
                    lowRoll,
                    highRoll,
                    type,
                    ability,
                } as AbilityBoon);
                break;
            default:
                subtypeBoons.push(uBoon);
        }
    });
    // link archetypes
    compendium.archetypes = new Map(
        unlinkedCompendium.archetypes.map((uArchetype) => {
            const roles = new Map(
                unlinkedCompendium.roles
                    .filter((role) => role.archetypeKey === uArchetype.key)
                    .map((role) => [role.key, role])
            );
            const subtypes = new Map(uArchetype.subtypes.map((subtype) => [subtype.key, subtype]));
            const archetype: Archetype = {
                ...uArchetype,
                roles,
                subtypes,
                talents: unlinkedCompendium.archetypeTalents
                    .filter(({ archetypeKey }) => archetypeKey === uArchetype.key)
                    .flatMap(({ talentKey, subtypeKey, roleKey }) => {
                        const talent = compendium.talents.get(talentKey);
                        if (!talent) {
                            console.warn(
                                `Talent ${talentKey} not found when adding talents for archetype ${uArchetype.key}`
                            );
                            return [];
                        }
                        const subtype = subtypes.get(subtypeKey as SubtypeKey) ?? null;
                        if (subtypeKey && !subtype) {
                            console.warn(
                                `Subtype ${subtypeKey} not found when adding talents for archetype ${uArchetype.key}`
                            );
                            return [];
                        }
                        const role = roles.get(roleKey as RoleKey) ?? null;
                        if (roleKey && !role) {
                            console.warn(
                                `Role ${roleKey} not found when adding talents for archetype ${uArchetype.key}`
                            );
                            return [];
                        }
                        return [
                            {
                                talent,
                                subtype,
                                role,
                            },
                        ];
                    }),
                talentChoices: unlinkedCompendium.archetypeTalentChoices
                    .filter(({ archetypeKey }) => archetypeKey === uArchetype.key)
                    .flatMap(({ numTalents, subtypeKey, roleKey, talentKeyList }) => {
                        const subtype = subtypes.get(subtypeKey as SubtypeKey) ?? null;
                        if (subtypeKey && !subtype) {
                            console.warn(
                                `Subtype ${subtypeKey} not found when adding talent choices for archetype ${uArchetype.key}`
                            );
                            return [];
                        }
                        const role = roles.get(roleKey as RoleKey) ?? null;
                        if (roleKey && !role) {
                            console.warn(
                                `Role ${roleKey} not found when adding talent choices for archetype ${uArchetype.key}`
                            );
                            return [];
                        }
                        const talentList = [];
                        for (const talentKey of talentKeyList ?? []) {
                            const talent = compendium.talents.get(talentKey as TalentKey);
                            if (!talent) {
                                console.warn(
                                    `Talent ${talentKey} not found when adding talents for archetype ${uArchetype.key}`
                                );
                                return [];
                            }
                            talentList.push(talent);
                        }
                        return [
                            {
                                numTalents,
                                subtype,
                                role,
                                talentList,
                            },
                        ];
                    }),
            };
            return [archetype.key, archetype];
        })
    );

    return compendium;
};

const loadArchetypesSubtypesStats = (rawStats: RawDataRows): SerializableArchetype[] => {
    const archetypes: Map<ArchetypeKey, SerializableArchetype> = new Map();
    rawStats.forEach((item) => {
        const archetype = item.Archetype;
        const archetypeKey = item.Archetype.toLowerCase() as ArchetypeKey;
        const subtype = item.Subtype;
        const subtypeKey = item.Subtype.toLowerCase() as SubtypeKey;
        if (!archetypes.has(archetypeKey)) {
            archetypes.set(archetypeKey, {
                key: archetypeKey,
                name: archetype,
                subtypes: [],
            });
        }
        archetypes.get(archetypeKey)!.subtypes.push({
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
        });
    });
    return Array.from(archetypes.values());
};

const loadRoles = (rawRoles: RawDataRows): SerializableRole[] => {
    const roles: SerializableRole[] = [];
    rawRoles.forEach((item) => {
        const name = item.Role;
        const key = name.toLowerCase() as RoleKey;
        const archetypeKey = item.Archetype.toLowerCase() as ArchetypeKey;
        roles.push({ key, name, archetypeKey });
    });
    return roles;
};

const loadTalents = (rawTalents: RawDataRows): Talent[] => {
    const talents: Talent[] = [];
    rawTalents.forEach((talent) => {
        const name = talent.Talent;
        const key = name.toLowerCase() as TalentKey;
        const description = talent.Description;
        talents.push({ name, description, key });
    });
    return talents;
};

const loadArchetypeTalentsAndChoices = (
    rawArchetypeTalents: RawDataRows
): { archetypeTalents: SerializableArchetypeTalent[]; archetypeTalentChoices: SerializableTalentChoiceList[] } => {
    const archetypeTalents: SerializableArchetypeTalent[] = [];
    const archetypeTalentChoices: SerializableTalentChoiceList[] = [];
    rawArchetypeTalents.forEach((item) => {
        const archetypeKey: ArchetypeKey = item.Archetype.toLowerCase() as ArchetypeKey;
        const roleKey = item.Role === '*' ? null : (item.Role.toLowerCase() as RoleKey);
        const subtypeKey = item.Subtype === '*' ? null : (item.Subtype.toLowerCase() as SubtypeKey);
        // check to see if this is a talent choice (ex: "Any 3")
        const anyMatch = item.Talent.toLowerCase().match(/any (?<numFreeTalents>\d+)/);
        // check to see if this is a talent choice from a list (ex: "Pick 3")
        const pickMatch = item.Condition.toLowerCase().match(/pick (?<numPickTalents>\d+)/);
        const { numFreeTalents } = anyMatch?.groups || {};
        const { numPickTalents } = pickMatch?.groups || {};
        //console.debug({ item, numFreeTalents, anyMatch, anyMatchGroups: anyMatch?.groups });
        if (numFreeTalents) {
            archetypeTalentChoices.push({
                numTalents: parseInt(numFreeTalents),
                roleKey,
                subtypeKey,
                talentKeyList: null, // means choose from all talents
                archetypeKey,
            });
        } else if (numPickTalents) {
            const numTalents = parseInt(numPickTalents);
            const talentKey = item.Talent.toLowerCase() as TalentKey;
            // see if the talent choice list has alrady been registered
            const talentChoiceEntry = archetypeTalentChoices.find(
                (choice) =>
                    choice.numTalents === numTalents &&
                    choice.roleKey === roleKey &&
                    choice.subtypeKey === subtypeKey &&
                    choice.talentKeyList instanceof Array &&
                    choice.archetypeKey === archetypeKey
            );
            if (talentChoiceEntry) {
                talentChoiceEntry.talentKeyList?.push(talentKey);
            } else {
                archetypeTalentChoices.push({
                    numTalents,
                    subtypeKey,
                    roleKey,
                    talentKeyList: [talentKey],
                    archetypeKey,
                });
            }
        } else {
            const talentKey = item.Talent.toLowerCase() as TalentKey;
            archetypeTalents.push({ talentKey, roleKey, subtypeKey, archetypeKey });
        }
    });
    return { archetypeTalents, archetypeTalentChoices };
};

const loadBoons = (rawBoons: RawDataRows): SerializableBoon[] =>
    rawBoons.flatMap((rawBoon) => {
        const subtypeKey = rawBoon.Subtype.toLowerCase() as SubtypeKey;
        const lowRoll = parseInt(rawBoon.Low);
        const highRoll = parseInt(rawBoon.High);
        const type = rawBoon.Type as BoonType;
        const boon: SerializableBoon = {
            lowRoll,
            highRoll,
            type,
            subtypeKey,
        };
        switch (type) {
            // 'Ability' boons actually confer talents rather than Exotic Abilities
            case 'Ability':
                return [{
                    ...boon,
                    abilityKey: rawBoon.Name.toLowerCase(),
                }];
            case 'Boost':
                return [{
                    ...boon,
                    amount: parseInt(rawBoon.Amount),
                    stat: rawBoon.Name,
                }];
            case 'Reroll':
                return [{
                    ...boon,
                    targetSubtypeKey: rawBoon.Name.toLowerCase(),
                }];
            case 'Exotic':
            case 'Psychic':
                return [boon];
            default:
                console.warn('Invalid Boon type', { rawBoon });
                return [];
        }
    });

const loadExoticAbilities = (rawExoticAbilities: RawDataRows): ExoticAbility[] => {
    const exoticAbilities: Map<Lowercase<string>, ExoticAbility> = new Map();
    rawExoticAbilities.forEach((rawAbility) => {
        const abilityKey = rawAbility.Ability.toLowerCase() as TalentKey;
        exoticAbilities.set(abilityKey, {
            key: abilityKey,
            name: rawAbility.Ability,
            description: rawAbility.Description,
        });
    });
    return exoticAbilities;
};

const loadRandomExoticAbilities = (rawRandomExoticAbilities: RawDataRows): SerializableRandomExoticAbility[] =>
    rawRandomExoticAbilities.map((rawAbility) => ({
        lowRoll: parseInt(rawAbility.Low),
        highRoll: parseInt(rawAbility.High),
        exoticAbilityKey: rawAbility.Ability.toLowerCase() as ExoticAbilityKey,
    }));

export const buildCompendium = async (
    setMaxProgress: (max: number) => void,
    setStatus: (progress: number, status: string) => void
): Promise<Compendium> => {
    const { sheets } = config;
    const unlinkedCompendium: Partial<SerializableCompendium> = {};
    setMaxProgress(8);

    setStatus(1, 'Loading archetypes, subtypes, and stat ranges...');
    const rawStats = await sheetUrlToCsv(sheets.stats);
    unlinkedCompendium.archetypes = loadArchetypesSubtypesStats(rawStats);

    setStatus(2, 'Loading roles...');
    const rawRoles = await sheetUrlToCsv(sheets.roles);
    unlinkedCompendium.roles = loadRoles(rawRoles);

    setStatus(3, 'Loading talent list...');
    const rawTalents = await sheetUrlToCsv(sheets.talentsList);
    unlinkedCompendium.talents = loadTalents(rawTalents);

    setStatus(4, 'Loading talent assignments...');
    const archetypeTalents = await sheetUrlToCsv(sheets.talents);
    Object.assign(unlinkedCompendium, loadArchetypeTalentsAndChoices(archetypeTalents));

    setStatus(5, 'Loading boons...');
    const rawBoons = await sheetUrlToCsv(sheets.boons);
    unlinkedCompendium.boons = loadBoons(rawBoons);

    setStatus(6, 'Loading exotic abilities...');
    const rawExoticAbilities = await sheetUrlToCsv(sheets.exoticAbilitiesDescriptions);
    unlinkedCompendium.exoticAbilities = loadExoticAbilities(rawExoticAbilities);

    setStatus(7, 'Loading random exotic abilities table...');
    const rawRandomExoticAbilities = await sheetUrlToCsv(sheets.randomExoticAbilities);
    unlinkedCompendium.randomExoticAbilities = loadRandomExoticAbilities(rawRandomExoticAbilities);

    return linkCompendium(unlinkedCompendium as SerializableCompendium);
};
