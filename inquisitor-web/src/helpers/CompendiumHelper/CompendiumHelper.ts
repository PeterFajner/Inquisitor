import { Archetype, Subtype } from 'helpers/ArchetypeHelper/Archetype';
import config from 'config';
import { sheetUrlToCsv } from 'helpers/SheetsHelper/SheetsHelper';
import { Compendium, DieCode } from "helpers/CompendiumHelper/CompendiumTypes";
import { EmptyStats } from 'helpers/CharacterHelper/Placeholders';

const assertDefined = (property: any, propertyName: string, stage: string, data: object) => {
    if (property === undefined) {
        console.error(`${propertyName} undefined in compendium building stage ${stage}`, { data });
    }
}

export const buildCompendium = async (): Promise<Compendium> => {
    const { sheets } = config;
    const compendium: Compendium = { archetypes: {}, talents: {} };
    // add archetypes and subtypes and their stats to compendium
    const rawStats = await sheetUrlToCsv(sheets.stats);
    rawStats.forEach(item => {
        const archetype = item.Archetype;
        const archetypeKey = item.Archetype.toLowerCase();
        const subtype = item.Subtype;
        const subtypeKey = item.Subtype.toLowerCase();
        compendium.archetypes[archetypeKey] = compendium.archetypes[archetypeKey] ?? {
            key: archetypeKey,
            name: archetype,
            roles: {},
            subtypes: {},
            talents: [],
            talentChoices: [],
        } as Archetype;
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
            }
        } as Subtype;
    });
    // add roles to compendium
    const roles = await sheetUrlToCsv(sheets.roles);
    roles.forEach(item => {
        const name = item.Role;
        const key = name.toLowerCase();
        const archetypeKey = item.Archetype.toLowerCase();
        const archetype = compendium.archetypes[archetypeKey];
        assertDefined(archetype, 'archetype', 'roles', { item, compendium });
        archetype.roles[key] = { key, name };
    })
    // add talents to compendium
    const rawTalentsList = await sheetUrlToCsv(sheets.talentsList);
    rawTalentsList.forEach(talent => {
        const name = talent.Talent;
        const key = name.toLowerCase();
        const description = talent.Description;
        compendium.talents[key] = { name, description };
    });
    // add talents to archetypes, subtypes, and roles
    const archetypeTalents = await sheetUrlToCsv(sheets.talents);
    archetypeTalents.forEach(item => {
        const archetype = compendium.archetypes[item.Archetype.toLowerCase()];
        assertDefined(archetype, 'archetype', 'archetype talents', { item, compendium });
        const role = item.Role === '*' ? null : archetype.roles[item.Role.toLowerCase()];
        assertDefined(role, 'role', 'archetype talents', { item, compendium, archetype });
        const subtype = item.Subtype === '*' ? null : archetype.subtypes[item.Subtype.toLowerCase()];
        assertDefined(subtype, 'subtype', 'archetype talents', { item, compendium, archetype });
        // check to see if this is a talent choice (ex: "Any 3")
        const anyMatch = item.Talent.toLowerCase().match(/any (?<numTalents>\d+)/);
        const { numTalents } = anyMatch?.groups || {};
        if (numTalents) {
            archetype.talentChoices.push({ numTalents: parseInt(numTalents), role, subtype });
        } else {
            const talent = compendium.talents[item.Talent.toLowerCase()];
            assertDefined(talent, 'talent', 'archetype talents', { item, compendium, talent });
            archetype.talents.push({ talent, role, subtype });
        }
    });
    return compendium;
}