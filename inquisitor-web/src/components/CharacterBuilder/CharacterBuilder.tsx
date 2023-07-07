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
    Stat,
    Talent,
} from 'helpers/CompendiumHelper/CompendiumTypes';
import { triggerDocxDownload } from 'helpers/DocxHelper/DocxHelper';
import { buildTagLine, rollD100 } from 'helpers/Util';
import { FunctionComponent, ReactNode, useEffect, useState } from 'react';
import './CharacterBuilder.css';

const buildTitle = (data: Character) => {
    const tagLine = buildTagLine(data);
    return tagLine ? ` (${tagLine})` : null;
};

const StatsRow: FunctionComponent<{
    id: string;
    stat: Stat;
    base: number;
    boon: number | undefined;
    setStat: (key: Stat, value: number) => void;
}> = ({ id, stat, base, boon, setStat }) => (
    <tr>
        <th>
            <label htmlFor={`${id}-stat-${stat}`}>{stat} </label>
        </th>
        <td key={stat}>
            <input
                type="number"
                id={`${id}-stat-${stat}`}
                value={base}
                onChange={(e) =>
                    setStat(
                        stat,
                        parseInt((e.target as HTMLInputElement).value)
                    )
                }
                size={3}
            />
        </td>
        <td>{boon ?? '-'}</td>
        <td>{base + (boon ?? 0)}</td>
    </tr>
);

const StatsTable: FunctionComponent<{
    id: string;
    stats: Stats;
    boons: DefiniteBoon[];
    setStat: (key: Stat, value: number) => void;
}> = ({ id, stats, boons, setStat }) => {
    const statBoonBoosts: { [key in Stat]?: number } = {};
    boons.forEach((boon) => {
        if (boon.type === 'Boost') {
            statBoonBoosts[boon.stat] =
                (statBoonBoosts[boon.stat] ?? 0) + boon.amount;
        }
    });
    return (
        <table className="stats-table">
            <thead>
                <tr>
                    <th></th>
                    <th>Base</th>
                    <th>Boon</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                {STATS_ORDER.map((stat) => (
                    <StatsRow
                        id={id}
                        stat={stat}
                        base={stats[stat]}
                        boon={statBoonBoosts[stat]}
                        setStat={setStat}
                    ></StatsRow>
                ))}
            </tbody>
        </table>
    );
};

const Section: FunctionComponent<{
    type: 'narrow' | 'wide';
    children?: ReactNode;
    title: string;
    leftOfTitle?: ReactNode[];
    rightOfTitle?: ReactNode[];
}> = ({ type, children, title, leftOfTitle, rightOfTitle }) => (
    <section className={type}>
        <h3>
            {leftOfTitle ? (
                <span style={{ marginRight: 20 }}>{leftOfTitle}</span>
            ) : null}
            <span>{title}</span>
            {rightOfTitle ? (
                <span style={{ marginLeft: 20 }}>{rightOfTitle}</span>
            ) : null}
        </h3>

        {children}
    </section>
);

const Dropdown: FunctionComponent<{
    id: string;
    label: string;
    options: any[];
    labelExtractor: (obj: any) => string;
    keyExtractor: (obj: any) => string;
    value: string;
    setValue: (v: string) => void;
}> = ({
    id,
    label,
    options,
    labelExtractor,
    keyExtractor,
    value,
    setValue,
}) => (
    <>
        <label htmlFor={id}>{label}</label>
        <select
            id={id}
            onChange={(e) => setValue(e.target.value)}
            disabled={options.length === 0}
            style={{ minWidth: 100 }}
            value={value}
        >
            {options.map((option) => (
                <option key={keyExtractor(option)} value={keyExtractor(option)}>
                    {labelExtractor(option)}
                </option>
            ))}
        </select>
    </>
);

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

    const setStat = (key: Stat, value: number) => {
        setData({
            ...data,
            stats: {
                ...data.stats,
                [key]: value,
            },
        });
    };

    const rollBoon = (subtypeKey: string): DefiniteBoon => {
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
                return rollBoon((boon as RerollBoon).subtypeKey);
        }
    };

    const rollBoons = () => {
        const availableBoons = compendium.boons[subtype.key];
        if (!availableBoons) return;
        const numBoons = new DieCode('1+1D3').roll();
        const boons: DefiniteBoon[] = [];
        for (let i = 0; i < numBoons; i++) {
            boons.push(rollBoon(subtype.key));
        }
        setData((data) => ({
            ...data,
            boons,
        }));
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

    // when archetype changes, make sure subtype and role are valid, and reset them if not
    useEffect(() => {
        if (role && !(role.key in archetype.roles)) {
            setRole(Object.values(archetype.roles)[0]);
        }
        if (!(subtype.key in archetype.subtypes)) {
            setSubtype(Object.values(archetype.subtypes)[0]);
        }
    }, [archetype, role, setRole, setSubtype, subtype.key]);

    const { archetypes } = compendium;
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

    if (subtypeGetsBoons && boons.length === 0) {
        rollBoons();
    }

    return (
        <div className="character-builder">
            <section className="wide center">
                <h2>
                    <input
                        className="character-name"
                        id={`${id}-nameInput`}
                        placeholder="Character name"
                        value={data.name}
                        onChange={(e) =>
                            setName((e.target as HTMLInputElement).value)
                        }
                    />{' '}
                    {buildTitle(data)}
                </h2>
            </section>
            <Section type="narrow" title="Occupation">
                <Dropdown
                    id={`${id}-archetype`}
                    label={'Archetype'}
                    options={Object.values(archetypes)}
                    keyExtractor={(a) => (a as Archetype).key}
                    labelExtractor={(a) => (a as Archetype).name}
                    value={archetype.key}
                    setValue={(key) => setArchetype(archetypes[key])}
                />
                <Dropdown
                    id={`${id}-subtype`}
                    label={'Subtype'}
                    options={Object.values(archetype.subtypes)}
                    keyExtractor={(a) => (a as Subtype).key}
                    labelExtractor={(a) => (a as Subtype).name}
                    value={subtype.key}
                    setValue={(key) => setSubtype(archetype.subtypes[key])}
                />
                <Dropdown
                    id={`${id}-role`}
                    label={'Role'}
                    options={Object.values(archetype.roles)}
                    keyExtractor={(a) => (a as Role).key}
                    labelExtractor={(a) => (a as Role).name}
                    value={role?.key ?? ''}
                    setValue={(key) => setRole(archetype.roles[key])}
                />
            </Section>
            <Section
                type="narrow"
                title="Stats"
                rightOfTitle={[<button onClick={rerollStats}>Reroll</button>]}
            >
                <StatsTable
                    id={id}
                    stats={data.stats}
                    boons={data.boons}
                    setStat={setStat}
                ></StatsTable>
            </Section>
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
            <Section
                type="wide"
                title="Boons"
                rightOfTitle={[
                    <button onClick={() => rollBoons()}>Reroll</button>,
                ]}
            >
                {subtypeGetsBoons ? (
                    <>
                        <BoonList boons={boons}></BoonList>
                    </>
                ) : (
                    <p>Your subtype doesn't get any Boons.</p>
                )}
            </Section>
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
