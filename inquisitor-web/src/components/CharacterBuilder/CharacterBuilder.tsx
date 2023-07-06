import { BoonList } from 'components/CharacterBuilder/BoonList';
import { TalentChoiceList } from 'helpers/ArchetypeHelper/Archetype';
import { Character, STATS_ORDER } from 'helpers/CharacterHelper/Character';
import { Compendium, Talent } from 'helpers/CompendiumHelper/CompendiumTypes';
import { triggerDocxDownload } from 'helpers/DocxHelper/DocxHelper';
import { buildTagLine } from 'helpers/Util';
import { useCharacter } from 'hooks/CharacterHooks/CharacterHooks';
import { FunctionComponent } from 'react';
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
    const {
        data,
        setName,
        setRole,
        setArchetype,
        setSubtype,
        setStat,
        rerollStats,
        setChosenTalents,
        rollBoons,
    } = useCharacter(id, compendium);
    console.debug({ data, compendium });
    const { archetypes } = compendium;
    const { boons, subtype, archetype } = data;
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
