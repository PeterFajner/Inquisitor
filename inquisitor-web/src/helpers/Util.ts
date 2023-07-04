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
