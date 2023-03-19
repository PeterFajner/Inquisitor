import { useEffect, useMemo } from "react";
import { EmptyCharacter } from "helpers/CharacterHelper/Placeholders";
import { Archetype, Role, Subtype } from "helpers/ArchetypeHelper/Archetype";
import { useState } from "react";
import { Character } from "helpers/CharacterHelper/Character";
import { Talent } from "helpers/CompendiumHelper/CompendiumTypes";

/**
 * Includes dynamic readonly properties like talents (baseTalents + chosenTalents)
 */
export interface DynamicCharacter extends Character {
    talents: Set<Talent>;
}

export const useCharacter = ({ id = "", defaultData = EmptyCharacter }) => {
    const [data, setData] = useState<Character>(
        Object.assign({}, defaultData, { id })
    );

    const { archetype, subtype, role } = data;

    // total number of talents the player can select
    const numTalentsToSelect = data.archetype.talentChoices
        // select talents for this class's role/subtype or for unrestricted roles & subtypes
        .filter(
            (item) =>
                (!item.subtype || item.subtype === data.subtype) &&
                (!item.role || item.role === data.role)
        )
        // get the number of talent choices for each entry
        .map((item) => item.numTalents)
        // sum them
        .reduce((sum, current) => sum + current, 0);

    // number of talents left to choose
    const numTalentsAvailableForChoosing =
        numTalentsToSelect - data.chosenTalents.size;

    const canChooseTalents = numTalentsToSelect > 0;

    const setName = (name: string) => {
        setData({ ...data, name });
    };

    const setArchetype = (archetype: Archetype) => {
        setData({ ...data, archetype });
    };

    const setSubtype = (subtype: Subtype) => {
        setData({ ...data, subtype });
    };

    const setRole = (role: Role) => {
        setData({ ...data, role });
    };

    const setChosenTalents = (chosenTalents: Set<Talent>) => {
        setData({ ...data, chosenTalents });
    };

    /**
     * Add a talent to a character if they don't have it, and remove it if they do
     * Errors if you try to toggle a base talent
     *
     * @param talent talent to add/remove from the character
     * @returns true if talent was added, false if talent was removed
     */
    const toggleTalent = (talent: Talent) => {
        if (data.baseTalents.has(talent)) {
            throw new Error(
                `Tried to add Talent '${talent.name}' but it is a base talent`
            );
        } else if (data.chosenTalents.has(talent)) {
            data.chosenTalents.delete(talent);
            return false;
        } else {
            data.chosenTalents.add(talent);
            return true;
        }
    };

    const talents = useMemo(
        () => new Set([...data.baseTalents, ...data.chosenTalents]),
        [data.baseTalents, data.chosenTalents]
    );

    // recalculate talents when archetype, subtype, or role changes
    useEffect(() => {
        // set new base talents
        data.baseTalents = new Set(
            archetype.talents
                .filter(
                    ({ subtype: s, role: r }) =>
                        (!s || s === subtype) && (!r || r === role)
                )
                .map(({ talent }) => talent)
        );
        // delete chosen talents that are now base talents
        Array.from(data.chosenTalents)
            .filter((t) => data.baseTalents.has(t))
            .forEach((t) => data.chosenTalents.delete(t));
        // we shouldn't add 'data' as a dependency because we're not reading from baseTalents
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [archetype, subtype, role]);

    const dynamicData: DynamicCharacter = {
        ...data,
        talents,
    };

    return {
        data: dynamicData,
        canChooseTalents,
        numTalentsAvailableForChoosing,
        setName,
        setArchetype,
        setSubtype,
        setRole,
        setChosenTalents,
        toggleTalent,
    };
};
