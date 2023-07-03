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
