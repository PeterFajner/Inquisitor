import { rollStats } from 'helpers/Util';
import { Archetype, Character, Compendium, DieCode } from 'types/Compendium';

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
    const fallbackArchetype: Archetype = {
        key: 'n/a',
        name: 'N/A',
        roles: {},
        subtypes: {
            'n/a': {
                key: 'n/a',
                name: 'N/A',
                stats: {
                    BS: new DieCode('0'),
                    I: new DieCode('0'),
                    Ld: new DieCode('0'),
                    Nv: new DieCode('0'),
                    S: new DieCode('0'),
                    Sg: new DieCode('0'),
                    T: new DieCode('0'),
                    WS: new DieCode('0'),
                    Wp: new DieCode('0'),
                },
            },
        },
        talents: [],
        talentChoices: [],
    };
    const archetype =
        Object.values(compendium.archetypes)?.[0] ?? fallbackArchetype;
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
