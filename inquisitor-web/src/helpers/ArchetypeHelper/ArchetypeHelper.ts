import config from 'config';
import { sheetUrlToCsv } from 'helpers/SheetsHelper/SheetsHelper';
import { ArchetypeCompendium, DieCode } from './Archetype';

export const compileArchetypes = async (): Promise<ArchetypeCompendium> => {
    const { sheets } = config;
    const rawStats = await sheetUrlToCsv(sheets.stats);
    const compendium: ArchetypeCompendium = {};
    rawStats.forEach(item => {
        const archetype = item.Archetype;
        const subtype = item.Subtype;
        compendium[archetype] = compendium[archetype] ?? {
            name: archetype,
            roles: {},
            subtypes: {},
        };
        compendium[archetype].subtypes[subtype] = {
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
        };
    });
    return compendium;
}