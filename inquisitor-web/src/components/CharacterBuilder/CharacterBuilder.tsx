import { BoonList } from 'components/CharacterBuilder/BoonList';
import {
    Archetype,
    Role,
    Subtype,
    TalentChoiceList,
} from 'helpers/ArchetypeHelper/Archetype';
import {
    Character,
    STATS_ORDER,
    Stats,
} from 'helpers/CharacterHelper/Character';
import { initCharacter } from 'helpers/CharacterHelper/Placeholders';
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
import { triggerDocxDownload } from 'helpers/DocxHelper/DocxHelper';
import { buildTagLine, rollD100 } from 'helpers/Util';
import { FunctionComponent, useEffect, useState } from 'react';
import './CharacterBuilder.css';

const buildTitle = (data: Character) => {
    const tagLine = buildTagLine(data);
    const additionalInfoString = tagLine ? ` (${tagLine})` : null;
    return `${data.name || 'Unnamed Character'}${additionalInfoString}`;
};

const TalentEntry: FunctionComponent<{
    name: string;
    description: string;
}> = ({ name, description }) => (
    <div className="columns" style={{ marginBottom: '10px' }}>
        <span>
            <span style={{ fontWeight: 'bold' }}>{name}: </span>
            {description}
        </span>
    </div>
);

export const CharacterBuilder: FunctionComponent<{
    id: string;
    compendium: Compendium;
}> = ({ id = '', compendium }) => {
    const [data, setData] = useState<Character>(initCharacter(compendium));

    const { archetype, subtype, role, boons } = data;

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

    const setChosenTalents = (chosenTalents: Talent[]) => {
        setData({
            ...data,
            chosenTalents,
        });
    };

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
        const numBoons = new DieCode('1+1D3').roll();
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
        rollStats();
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

    const { archetypes } = compendium;
    const { subtypes, roles } = archetype;
    const talentChoices: {
        talentChoiceList: TalentChoiceList;
        talent: Talent;
    }[] = [];
    let i = 0;
    data.archetype.talentChoices
        .filter(
            (tc) =>
                (tc.role === data.role || !tc.role) &&
                (tc.subtype === data.subtype || !tc.subtype)
        )
        .forEach((tc) => {
            for (let talentNum = 0; talentNum < tc.numTalents; talentNum++) {
                talentChoices.push({
                    talentChoiceList: tc,
                    talent: data.chosenTalents[i],
                });
                i++;
            }
        });

    const subtypeGetsBoons = !!compendium.boons[subtype.key];

    return (
        <div className="character-builder">
            <section className="wide center">
                <h2>{buildTitle(data)}</h2>
                <label htmlFor={`${id}-nameInput`}>Character name: </label>
                <input
                    id={`${id}-nameInput`}
                    value={data.name}
                    onChange={(e) =>
                        setName((e.target as HTMLInputElement).value)
                    }
                />
            </section>
            <section className="narrow">
                <h3>Archetype</h3>
                {Object.values(archetypes).map((archetype) => (
                    <span className="columns" key={archetype.key}>
                        <input
                            type="radio"
                            name={`${id}-archetype`}
                            value={archetype.key}
                            checked={data.archetype.key === archetype.key}
                            onChange={(e) => {
                                setArchetype(archetypes[e.currentTarget.value]);
                            }}
                        />
                        <label htmlFor={archetype.key}>{archetype.name}</label>
                    </span>
                ))}
            </section>
            <section className="narrow">
                <h3>Subtype</h3>
                {Object.values(subtypes).map((subtype) => (
                    <span className="columns" key={subtype.key}>
                        <input
                            type="radio"
                            name={`${id}-subtype`}
                            value={subtype.key}
                            checked={data.subtype.key === subtype.key}
                            onChange={(e) => {
                                setSubtype(subtypes[e.currentTarget.value]);
                            }}
                        />
                        <label htmlFor={subtype.key}>{subtype.name}</label>
                    </span>
                ))}
                {Object.values(subtypes).length === 0 && (
                    <span>
                        Archetype '{data.archetype.name}' has no subtypes
                    </span>
                )}
            </section>
            <section className="narrow">
                <h3>Role</h3>
                {Object.values(roles).map((role) => (
                    <span className="columns" key={role.key}>
                        <input
                            type="radio"
                            name={`${id}-role`}
                            value={role.key}
                            checked={data.role?.key === role.key}
                            onChange={(e) => {
                                setRole(roles[e.currentTarget.value]);
                            }}
                        />
                        <label htmlFor={role.key}>{role.name}</label>
                    </span>
                ))}
                {Object.values(roles).length === 0 && (
                    <span>Archetype '{data.archetype.name}' has no roles</span>
                )}
            </section>
            <h3>Stats</h3>
            <section className="wide">
                <button onClick={rerollStats}>Reroll stats</button>
                {STATS_ORDER.map((stat) => (
                    <div key={stat}>
                        <label htmlFor={`${id}-stat-${stat}`}>{stat} </label>
                        <input
                            type="number"
                            id={`${id}-stat-${stat}`}
                            value={(data.stats as any)[stat]}
                            onChange={(e) =>
                                setStat(
                                    stat,
                                    parseInt(
                                        (e.target as HTMLInputElement).value
                                    )
                                )
                            }
                        />
                    </div>
                ))}
            </section>
            <section className="wide">
                <h3>Talents</h3>
                <ul>
                    {Array.from(data.baseTalents).map((t) => (
                        <li key={t.key}>
                            <TalentEntry
                                name={t.name}
                                description={t.description}
                            />
                        </li>
                    ))}
                    {talentChoices.map((tc, index) => (
                        <li>
                            <select
                                key={index}
                                name={`${id}-talent-choice-${index}`}
                                id={`${id}-talent-choice-${index}`}
                                onChange={(event) => {
                                    tc.talent =
                                        compendium.talents[event.target.value];
                                    setChosenTalents(
                                        talentChoices.map((tc) => tc.talent)
                                    );
                                }}
                            >
                                {(
                                    tc.talentChoiceList.talentList ??
                                    Object.values(compendium.talents)
                                ).map((t) => (
                                    <option value={t.key}>{t.name}</option>
                                ))}
                            </select>
                            <label htmlFor={`${id}-talent-choice-${index}`}>
                                {talentChoices[index].talent ? (
                                    <TalentEntry
                                        {...talentChoices[index].talent}
                                    />
                                ) : (
                                    <div>{`Choose a talent ${
                                        tc.talentChoiceList.talentList
                                            ? 'from the list'
                                            : ''
                                    }`}</div>
                                )}
                            </label>
                        </li>
                    ))}
                </ul>
            </section>
            <section className="wide">
                <h3>Boons</h3>
                {subtypeGetsBoons ? (
                    <>
                        <button onClick={() => rollBoons(compendium)}>
                            {boons.length ? 'Reroll Boons' : 'Roll Boons'}
                        </button>
                        <BoonList boons={boons}></BoonList>
                    </>
                ) : (
                    <p>Your subtype doesn't get any Boons.</p>
                )}
            </section>
            <button
                onClick={() => {
                    triggerDocxDownload([data], compendium);
                }}
            >
                Download Docx
            </button>
        </div>
    );
};
