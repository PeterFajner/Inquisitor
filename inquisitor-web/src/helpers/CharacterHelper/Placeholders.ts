import { Subtype } from 'helpers/ArchetypeHelper/Archetype';
import { Character, Stats } from 'helpers/CharacterHelper/Character';
import { Compendium } from 'helpers/CompendiumHelper/CompendiumTypes';

export const makeEmptyStats = () => ({
    BS: 0,
    I: 0,
    Ld: 0,
    Nv: 0,
    S: 0,
    Sg: 0,
    T: 0,
    WS: 0,
    Wp: 0,
});

export const rollStats = (subtype: Subtype): Stats => ({
    BS: subtype.stats.BS.roll(),
    I: subtype.stats.I.roll(),
    Ld: subtype.stats.Ld.roll(),
    Nv: subtype.stats.Nv.roll(),
    S: subtype.stats.S.roll(),
    Sg: subtype.stats.Sg.roll(),
    T: subtype.stats.T.roll(),
    WS: subtype.stats.WS.roll(),
    Wp: subtype.stats.Wp.roll(),
});

export const initCharacter = (compendium: Compendium): Character => {
    const archetype = Object.values(compendium.archetypes)[0];
    const subtype = Object.values(archetype.subtypes)[0];
    const stats = rollStats(subtype);

    return {
        id: '',
        name: '',
        archetype,
        role: null,
        subtype,
        stats,
        baseTalents: new Set(),
        chosenTalents: [],
        boons: [],
    };
};
