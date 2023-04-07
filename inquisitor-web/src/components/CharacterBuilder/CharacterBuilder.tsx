import { Compendium, Talent } from 'helpers/CompendiumHelper/CompendiumTypes';
import { Character, STATS_ORDER } from 'helpers/CharacterHelper/Character';
import {
    DynamicCharacter,
    useCharacter,
} from 'hooks/CharacterHooks/CharacterHooks';
import { FunctionComponent } from 'react';
import { EmptySubtype } from 'helpers/ArchetypeHelper/Placeholders';
import './CharacterBuilder.css';
import { TalentChoiceList } from 'helpers/ArchetypeHelper/Archetype';
import { triggerDocxDownload } from 'helpers/DocxHelper/DocxHelper';

const sortTalents = (a: Talent, b: Talent) => (a.key < b.key ? -1 : 1);

const buildTitle = (data: Character) => {
    const additionalInfo = data.archetype
        ? {
              archetype: data.archetype.name,
          }
        : null;
    const additionalInfoString = additionalInfo
        ? ` (${additionalInfo.archetype ?? ''})`
        : null;
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

const TalentList: FunctionComponent<{
    data: DynamicCharacter;
    compendium: Compendium;
}> = ({ data, compendium }) => (
    <div>{Array.from(data.talents).sort(sortTalents).map(TalentEntry)}</div>
);

const selectorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
};

const TalentSelectorList: FunctionComponent<{
    data: DynamicCharacter;
    compendium: Compendium;
    toggleTalent: (t: Talent) => boolean;
}> = ({ data, compendium, toggleTalent }) => (
    <>
        <div style={{ marginBottom: '10px' }}>
            Selected {data.numTalentChoices - data.numTalentChoicesRemaining}/
            {data.numTalentChoices} talents
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {Object.values(compendium.talents)
                .sort(sortTalents)
                .map((talent) => (
                    <span style={selectorStyle} key={talent.key}>
                        <input
                            type="checkbox"
                            name={`${data.id}-talents`}
                            value={talent.key}
                            disabled={
                                (!data.talents.has(talent) &&
                                    data.numTalentChoicesRemaining <= 0) ||
                                data.baseTalents.has(talent)
                            }
                            checked={data.talents.has(talent)}
                            onChange={(e) => {
                                toggleTalent(
                                    compendium.talents[e.currentTarget.value]
                                );
                            }}
                        />
                        <label htmlFor={talent.key}>
                            {TalentEntry(talent)}
                        </label>
                    </span>
                ))}
        </div>
    </>
);

export const CharacterBuilder: FunctionComponent<{
    id: string;
    compendium: Compendium;
}> = ({ id = '', compendium }) => {
    const {
        data,
        setName,
        setRole,
        setArchetype,
        setSubtype,
        toggleTalent,
        setStat,
        rerollStats,
        setChosenTalents,
    } = useCharacter({ id });
    console.debug({ data, compendium });
    const { archetypes } = compendium;
    const { subtypes } = data.archetype;
    const { roles } = data.archetype;
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
                            checked={data.role.key === role.key}
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
                {data.subtype === EmptySubtype ? (
                    <span>Select a subtype to generate stats</span>
                ) : (
                    STATS_ORDER.map((stat) => (
                        <div key={stat}>
                            <label htmlFor={`${id}-stat-${stat}`}>
                                {stat}{' '}
                            </label>
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
                    ))
                )}
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
        <button onClick={() => { triggerDocxDownload([data], compendium)}}>Download Docx</button>
        </div>
    );
};
