import { Compendium, Talent } from "helpers/CompendiumHelper/CompendiumTypes";
import { Character } from "helpers/CharacterHelper/Character";
import { useCharacter } from "hooks/CharacterHooks/CharacterHooks";
import { FunctionComponent } from "react";

interface Props {
    id: string;
    compendium: Compendium;
}

interface HelperComponentProps {
    data: Character;
    compendium: Compendium;
}

const buildTitle = (data: Character) => {
    const additionalInfo = data.archetype
        ? {
              archetype: data.archetype.name,
          }
        : null;
    const additionalInfoString = additionalInfo
        ? ` (${additionalInfo.archetype ?? ""})`
        : null;
    return `${data.name || "Unnamed Character"}${additionalInfoString}`;
};

const TalentList: FunctionComponent<HelperComponentProps> = ({
    data,
    compendium,
}) => (
    <div>
        {Array.from(data.talents).map((item) => (
            <span className="columns" key={item.talent.name}>
                <span>
                    {item.talent.name}: {item.talent.description}
                </span>
            </span>
        ))}
    </div>
);

const characterHasTalent = (character: Character, talent: Talent) =>
    Array.from(character.talents)
        .map((item) => item.talent)
        .includes(talent);

const characterHasBaseTalent = (character: Character, talent: Talent) =>
    Array.from(character.talents).filter((item) => ({ talent, chosen: false }))
        .length > 0;

const TalentSelectorList: FunctionComponent<{
    data: Character;
    compendium: Compendium;
    numRemaining: number;
}> = ({ data, compendium, numRemaining }) => (
    <div>
        {Object.entries(compendium.talents).map(([key, talent]) => (
            <span className="columns" key={key}>
                <input
                    type="checkbox"
                    name={`${data.id}-talents`}
                    value={key}
                    disabled={
                        numRemaining <= 0 ||
                        characterHasBaseTalent(data, talent)
                    }
                    checked={characterHasTalent(data, talent)}
                    onChange={(e) => {
                        console.debug({ e });
                    }}
                />
                <label htmlFor={key}>
                    {talent.name}: {talent.description}
                </label>
            </span>
        ))}
    </div>
);

export const CharacterBuilder: FunctionComponent<Props> = ({
    id = "",
    compendium,
}) => {
    const {
        data,
        canChooseTalents,
        numTalentsAvailableForChoosing,
        setName,
        setRole,
        setArchetype,
        setSubtype,
    } = useCharacter({ id });
    console.debug({ data, compendium });
    const { archetypes } = compendium;
    const { subtypes } = data.archetype;
    const { roles } = data.archetype;

    return (
        <section>
            <h2>{buildTitle(data)}</h2>
            <section>
                <label htmlFor="nameInput">Character name: </label>
                <input
                    id="nameInput"
                    value={data.name}
                    onChange={(e) =>
                        setName((e.target as HTMLInputElement).value)
                    }
                />
            </section>
            <section>
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
            <section>
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
            <section>
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
                    <span>
                        Archetype '{data.archetype.name}' has no roles
                    </span>
                )}
            </section>
            <section>
                <h3>Talents</h3>
                {canChooseTalents ? (
                    <TalentSelectorList
                        data={data}
                        compendium={compendium}
                        numRemaining={numTalentsAvailableForChoosing}
                    />
                ) : (
                    <TalentList data={data} compendium={compendium} />
                )}
            </section>
        </section>
    );
};
