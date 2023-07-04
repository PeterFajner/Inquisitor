import { Archetype, Role, Subtype } from 'helpers/ArchetypeHelper/Archetype';
import { EmptySubtype } from 'helpers/ArchetypeHelper/Placeholders';
import { Character, Stats } from 'helpers/CharacterHelper/Character';
import {
    EmptyCharacter,
    EmptyStats,
} from 'helpers/CharacterHelper/Placeholders';
import {
    AbilityBoon,
    BoostBoon,
    Compendium,
    DefiniteBoon,
    DieCode,
    RerollBoon,
    RolledExoticBoon,
    RolledPsychicBoon,
    Talent,
} from 'helpers/CompendiumHelper/CompendiumTypes';
import { rollD100 } from 'helpers/Util';
import { useEffect, useMemo, useState } from 'react';

/**
 * Includes dynamic readonly properties like talents (baseTalents + chosenTalents)
 */
export interface DynamicCharacter extends Character {
    talents: Set<Talent>;
    numTalentChoices: number;
    numTalentChoicesRemaining: number;
}

export const useCharacter = ({ id = '', defaultData = EmptyCharacter }) => {
    const [data, setData] = useState<Character>(
        Object.assign({}, defaultData, { id })
    );

    const { archetype, subtype, role } = data;

    const numTalentChoices = useMemo(
        () =>
            data.archetype.talentChoices
                // select talents for this class's role/subtype or for unrestricted roles & subtypes
                .filter(
                    (item) =>
                        (!item.subtype || item.subtype === data.subtype) &&
                        (!item.role || item.role === data.role)
                )
                // get the number of talent choices for each entry
                .map((item) => item.numTalents)
                // sum them
                .reduce((sum, current) => sum + current, 0),
        [data.archetype.talentChoices, data.role, data.subtype]
    );

    // number of talents left to choose
    const numTalentChoicesRemaining =
        numTalentChoices - data.chosenTalents.length;

    const setName = (name: string) => {
        setData({ ...data, name });
    };

    const setArchetype = (archetype: Archetype) => {
        setData({
            ...data,
            archetype,
        });
    };

    const setSubtype = (subtype: Subtype) => {
        // if subtype changes, roll new stats and clear boons
        if (subtype !== data.subtype) {
            const newStats = rollStats(subtype);
            console.debug('setting subtype and stats', { subtype, newStats });
            setData({
                ...data,
                subtype,
                stats: newStats,
                boons: [],
            });
        }
    };

    const setRole = (role: Role) => {
        setData({ ...data, role });
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
        } else if (data.chosenTalents.includes(talent)) {
            const newChosenTalents = new Set(data.chosenTalents);
            newChosenTalents.delete(talent);
            setData({
                ...data,
                chosenTalents: Array.from(newChosenTalents),
            });
            return false;
        } else {
            setData({
                ...data,
                chosenTalents: [...data.chosenTalents, talent],
            });
            return true;
        }
    };

    const setChosenTalents = (chosenTalents: Talent[]) => {
        setData({
            ...data,
            chosenTalents,
        });
    };

    const talents = useMemo(
        () => new Set([...data.baseTalents, ...data.chosenTalents]),
        [data.baseTalents, data.chosenTalents]
    );

    const rollStats = (subtype: Subtype = data.subtype): Stats => {
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

    const rerollStats = () => {
        setData({
            ...data,
            stats: rollStats(),
        });
    };

    const setStat = (key: string, value: number) => {
        setData({
            ...data,
            stats: {
                ...data.stats,
                [key]: value,
            },
        });
    };

    const rollBoon = (
        compendium: Compendium,
        subtypeKey: string
    ): DefiniteBoon => {
        const boon = rollD100(compendium.boons[subtype.key]);
        switch (boon.type) {
            case 'Ability':
                return boon as AbilityBoon;
            case 'Boost':
                return boon as BoostBoon;
            case 'Exotic':
                return {
                    ...boon,
                    exoticAbility: rollD100(compendium.randomExoticAbilities)
                        .exoticAbility,
                } as RolledExoticBoon;
            case 'Psychic':
                // todo roll a psychic power
                return boon as RolledPsychicBoon;
            case 'Reroll':
                return rollBoon(compendium, (boon as RerollBoon).subtypeKey);
        }
    };

    const rollBoons = (compendium: Compendium) => {
        const availableBoons = compendium.boons[subtype.key];
        if (!availableBoons) return;
        const numBoons = new DieCode('1D3+1').roll();
        const boons: DefiniteBoon[] = [];
        for (let i = 0; i < numBoons; i++) {
            boons.push(rollBoon(compendium, subtype.key));
        }
        setData((data) => ({
            ...data,
            boons,
        }));
        console.debug('rollBoons', { boons });
    };

    // roll stats first time a subtype is selected
    useEffect(() => {
        console.debug('roll stats?', {
            subtype: data.subtype,
            stats: data.stats,
            subtypeeq: data.subtype === EmptySubtype,
            statseq: data.stats === EmptyStats,
        });
        if (data.subtype !== EmptySubtype && data.stats === EmptyStats) {
            rollStats();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.subtype]);

    // recalculate talents when archetype, subtype, or role changes
    useEffect(() => {
        // set new base talents
        const newBaseTalents = new Set(
            archetype.talents
                .filter(
                    ({ subtype: s, role: r }) =>
                        (!s || s === subtype) && (!r || r === role)
                )
                .map(({ talent }) => talent)
        );
        // delete chosen talents that are now base talents
        const newChosenTalents = new Set([...data.chosenTalents]);
        Array.from(data.chosenTalents)
            .filter((t) => newBaseTalents.has(t))
            .forEach((t) => newChosenTalents.delete(t));
        setData({
            ...data,
            baseTalents: newBaseTalents,
            chosenTalents: Array.from(newChosenTalents),
        });
        // we shouldn't add 'data' as a dependency because we're not reading from baseTalents
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [archetype, subtype, role]);

    const dynamicData: DynamicCharacter = {
        ...data,
        talents,
        numTalentChoices,
        numTalentChoicesRemaining,
    };

    console.debug({ dynamicData });

    return {
        data: dynamicData,
        setName,
        setArchetype,
        setSubtype,
        setRole,
        toggleTalent,
        setStat,
        rerollStats,
        setChosenTalents,
        rollBoons,
    };
};
