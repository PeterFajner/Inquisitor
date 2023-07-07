import { BoonList } from 'components/CharacterBuilder/BoonList';
import { initCharacter } from 'helpers/CharacterHelper/Character';
import { triggerDocxDownload } from 'helpers/DocxHelper/DocxHelper';
import { buildTagLine, rollD100, rollStats } from 'helpers/Util';
import { FunctionComponent, useCallback, useEffect, useState } from 'react';
import {
    AbilityBoon,
    Archetype,
    BoostBoon,
    Character,
    Compendium,
    DefiniteBoon,
    DieCode,
    RerollBoon,
    Role,
    RolledExoticBoon,
    RolledPsychicBoon,
    Stat,
    Subtype,
    Talent,
    TalentChoiceList,
} from 'types/Compendium';
import './CharacterBuilder.css';
import { Dropdown } from './Dropdown';
import { Section } from './Section';
import { StatsTable } from './StatsTable';
import { TalentEntry } from './TalentEntry';

const buildTitle = (data: Character) => {
    const tagLine = buildTagLine(data);
    return tagLine ? ` (${tagLine})` : null;
};

export const CharacterBuilder: FunctionComponent<{
    id: string;
    compendium: Compendium;
}> = ({ id = '', compendium }) => {
    const [data, setData] = useState<Character>(initCharacter(compendium));
    const [talentChoices, setTalentChoices] = useState<
        { talentChoiceList: TalentChoiceList; talent: Talent | undefined }[]
    >([]);

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

    const setSubtype = useCallback((subtype: Subtype) => {
        setData((data) => ({
            ...data,
            subtype,
        }));
    }, []);

    const setRole = useCallback((role: Role) => {
        setData((data) => ({ ...data, role }));
    }, []);

    const setChosenTalents = (chosenTalents: (Talent | undefined)[]) => {
        setData({
            ...data,
            chosenTalents,
        });
    };

    const rerollStats = () => {
        setData({
            ...data,
            stats: rollStats(subtype),
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

    // roll stats and clear boons when a subtype is selected
    useEffect(() => {
        setData((data) => ({
            ...data,
            subtype,
            stats: rollStats(subtype),
            boons: [],
        }));
    }, [subtype]);

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
        // delete chosen talents
        const newChosenTalents: Talent[] = [];
        setData((data) => ({
            ...data,
            baseTalents: newBaseTalents,
            chosenTalents: newChosenTalents,
        }));
        // set talent choices
        const tmpTalentChoices: typeof talentChoices = [];
        archetype.talentChoices
            .filter(
                (tc) =>
                    (tc.role === role || !tc.role) &&
                    (tc.subtype === subtype || !tc.subtype)
            )
            .forEach((tc) => {
                for (let j = 0; j < tc.numTalents; j++) {
                    tmpTalentChoices.push({
                        talentChoiceList: tc,
                        talent: undefined,
                    });
                }
            });
        setTalentChoices(tmpTalentChoices);
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

    const subtypeGetsBoons = !!compendium.boons[subtype.key];
    if (subtypeGetsBoons && boons.length === 0) {
        rollBoons();
    }

    return (
        <div className="character-builder">
            <div className="wide header-footer header">
                <h2>
                    <input
                        className="character-name"
                        id={`${id}-nameInput`}
                        placeholder="Character name"
                        value={data.name}
                        onChange={(e) =>
                            setName((e.target as HTMLInputElement).value)
                        }
                        size={data.name.length ? data.name.length + 2 : 14}
                    />
                    <span> {buildTitle(data)}</span>
                </h2>
            </div>
            <div className="character-builder-inner">
                <Section type="narrow" title="Occupation">
                    <Dropdown
                        id={`${id}-archetype`}
                        label={'Archetype'}
                        options={Object.values(compendium.archetypes)}
                        keyExtractor={(a) => (a as Archetype).key}
                        labelExtractor={(a) => (a as Archetype).name}
                        value={archetype.key}
                        setValue={(key) =>
                            setArchetype(compendium.archetypes[key])
                        }
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
                    rightOfTitle={[
                        <button onClick={rerollStats}>Reroll</button>,
                    ]}
                >
                    <StatsTable
                        id={id}
                        stats={data.stats}
                        boons={data.boons}
                        setStat={setStat}
                    ></StatsTable>
                </Section>
                <Section type="narrow" title="Talents">
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
                                <Dropdown
                                    id={`${id}-talent-choice-${index}`}
                                    label={null}
                                    options={
                                        tc.talentChoiceList.talentList ??
                                        Object.values(compendium.talents)
                                    }
                                    keyExtractor={(t) => (t as Talent).key}
                                    labelExtractor={(t) => (t as Talent).name}
                                    value={tc.talent?.key}
                                    setValue={(key) => {
                                        tc.talent =
                                            compendium.talents?.[key] ??
                                            undefined;
                                        setChosenTalents(
                                            talentChoices.map((tc) => tc.talent)
                                        );
                                    }}
                                    includeDefault={true}
                                ></Dropdown>
                                <label htmlFor={`${id}-talent-choice-${index}`}>
                                    {talentChoices[index].talent ? (
                                        <TalentEntry
                                            {...talentChoices[index].talent}
                                        />
                                    ) : (
                                        <div>{`Choose a talent ${
                                            tc.talentChoiceList.talentList
                                                ? 'from the list'
                                                : 'from the compendium'
                                        }`}</div>
                                    )}
                                </label>
                            </li>
                        ))}
                    </ul>
                </Section>
                <Section
                    type="narrow"
                    title="Boons"
                    rightOfTitle={
                        subtypeGetsBoons && [
                            <button onClick={() => rollBoons()}>Reroll</button>,
                        ]
                    }
                >
                    {subtypeGetsBoons ? (
                        <>
                            <BoonList boons={boons}></BoonList>
                        </>
                    ) : (
                        <p>Your subtype doesn't get any Boons.</p>
                    )}
                </Section>
            </div>
            <div className="wide header-footer footer">
                <h2><button
                    onClick={() => {
                        triggerDocxDownload([data], compendium);
                    }}
                >
                    Download Docx
                </button></h2>
            </div>
        </div>
    );
};
