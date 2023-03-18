import { useEffect } from "react";
import { EmptyCharacter } from "helpers/CharacterHelper/Placeholders";
import { Archetype, Role, Subtype } from "helpers/ArchetypeHelper/Archetype";
import { useState } from "react";
import { Character } from "helpers/CharacterHelper/Character";
import { Talent } from "helpers/CompendiumHelper/CompendiumTypes";

export const getBaseTalents = (character: Character): Set<Talent> =>
    new Set(
        character.archetype.talents
            .filter(
                (item) =>
                    (!item.subtype || item.subtype === character.subtype) &&
                    (!item.role || item.role === character.role)
            )
            .map(item => item.talent)
    );

const getChosenTalents = (character: Character): Set<Talent> => new Set(Array.from(character.talents).filter(item => item.chosen).map(item => item.talent));

export const useCharacter = ({ id = "", defaultData = EmptyCharacter }) => {
    const [data, setData] = useState<Character>(
        Object.assign({}, defaultData, { id })
    );

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
    const numTalentsAvailableForChoosing = numTalentsToSelect - getChosenTalents(data).size;

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
    }

    const setChosenTalents = (chosenTalents: Set<Talent>) => {
        const baseTalents = getBaseTalents(data);
        console.debug("setChosenTalents", { chosenTalents, baseTalents });
        const talents = new Set([
            ...Array.from(baseTalents).map((talent) => ({
                talent,
                chosen: false,
            })),
            ...Array.from(chosenTalents).map((talent) => ({
                talent,
                chosen: true,
            })),
        ]);
        setData({ ...data, talents });
    };

    // recalculate talents when archetype, subtype, or role changes
    useEffect(() => {
        setChosenTalents(new Set());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.archetype, data.subtype, data.role]);

    return { data, canChooseTalents, numTalentsAvailableForChoosing, setName, setArchetype, setSubtype, setRole, setChosenTalents };
};
