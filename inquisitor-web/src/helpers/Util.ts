import { Subtype } from 'helpers/ArchetypeHelper/Archetype';
import { Character, Stats } from 'helpers/CharacterHelper/Character';
import { DieCode } from 'helpers/CompendiumHelper/CompendiumTypes';
import { D100Rollable } from 'types/Rolls.d';

export const sortByKeyAscending = <T>(
    array: Array<T>,
    key: (_: T) => number | string
): Array<T> => {
    array.sort((a, b) => {
        const keyA = key(a);
        const keyB = key(b);
        if (keyA === keyB) return 0;
        if (keyA < keyB) return -1;
        return 1;
    });
    return array;
};

export const rollD100 = <T extends D100Rollable>(list: T[]): T => {
    const value = new DieCode('1D100').roll();
    const result = list.find((e) => e.lowRoll <= value && e.highRoll >= value);
    if (!result) {
        throw new Error(
            `D100 list does not contain an element for the rolled value: ${value}`
        );
    }
    return result;
};

export const buildTagLine = (char: Character) =>
    [char.archetype.name, char.subtype.name, char.role?.name]
        .filter((e) => e)
        .join(', ');

export const rollStats = (subtype: Subtype): Stats => {
    const stats: Stats = {
        BS: subtype.stats.BS.roll(),
        I: subtype.stats.I.roll(),
        Ld: subtype.stats.Ld.roll(),
        Nv: subtype.stats.Nv.roll(),
        S: subtype.stats.S.roll(),
        Sg: subtype.stats.Sg.roll(),
        T: subtype.stats.T.roll(),
        WS: subtype.stats.WS.roll(),
        Wp: subtype.stats.Wp.roll(),
    };
    return stats;
};
