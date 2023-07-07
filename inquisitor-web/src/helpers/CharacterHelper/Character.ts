import { rollStats } from 'helpers/Util';
import { Character, Compendium } from 'types/Compendium';

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

export const initCharacter = (compendium: Compendium): Character => {
    const archetype = Object.values(compendium.archetypes)[0];
    const subtype = Object.values(archetype.subtypes)[0];
    const role = Object.values(archetype.roles)?.[0];
    const stats = rollStats(subtype);

    return {
        id: '',
        name: '',
        archetype,
        role,
        subtype,
        stats,
        baseTalents: new Set(),
        chosenTalents: [],
        boons: [],
    };
};
