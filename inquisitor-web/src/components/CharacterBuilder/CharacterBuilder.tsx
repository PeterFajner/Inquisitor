import { Compendium, Talent } from "helpers/CompendiumHelper/CompendiumTypes";
import { Character } from "helpers/CharacterHelper/Character";
import { DynamicCharacter, useCharacter } from "hooks/CharacterHooks/CharacterHooks";
import { FunctionComponent } from "react";

const sortTalents = (a: Talent, b: Talent) => a.key < b.key ? -1 : 1;

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

const TalentEntry = ({key, name, description}: Talent) => (
    <span className="columns" key={key}>
        <span>
            {name}: {description}
        </span>
    </span>
)

const TalentList: FunctionComponent<{
    data: DynamicCharacter,
    compendium: Compendium,
}> = ({
    data,
    compendium,
}) => (
    <div>
        {Array.from(data.talents).sort(sortTalents).map(TalentEntry)}
    </div>
);

const selectorStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    marginBottom: '10px',
};

const TalentSelectorList: FunctionComponent<{
    data: DynamicCharacter;
    compendium: Compendium;
    numRemaining: number;
    toggleTalent: (t: Talent) => boolean;
}> = ({ data, compendium, numRemaining, toggleTalent }) => (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
        {Object.entries(compendium.talents).map(([key, talent]) => (
            <span style={selectorStyle} key={key}>
                <input
                    type="checkbox"
                    name={`${data.id}-talents`}
                    value={key}
                    disabled={
                        numRemaining <= 0 ||
                        data.baseTalents.has(talent)
                    }
                    checked={data.talents.has(talent)}
                    onChange={(e) => {
                        toggleTalent(compendium.talents[e.currentTarget.value]);
                    }}
                />
                <label htmlFor={key}>
                    <span style={{ fontWeight: 'bold' }}>{talent.name}:</span> {talent.description} :: NR:{numRemaining}, base:{data.baseTalents.has(talent)}, has:{data.talents.has(talent)}
                </label>
            </span>
        ))}
    </div>
);

export const CharacterBuilder: FunctionComponent<{
    id: string;
    compendium: Compendium;
}> = ({
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
        toggleTalent,
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
                        toggleTalent={toggleTalent}
                    />
                ) : (
                    <TalentList data={data} compendium={compendium} />
                )}
            </section>
        </section>
    );
};
