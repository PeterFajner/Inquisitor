import { ArchetypeCompendium } from 'helpers/ArchetypeHelper/Archetype';
import { EmptyArchetype } from 'helpers/ArchetypeHelper/Placeholders';
import { Character } from 'helpers/CharacterHelper/Character';
import { useCharacter } from 'hooks/CharacterHooks/CharacterHooks';
import { FunctionComponent } from 'react';

interface Props {
    id: string;
    compendium: ArchetypeCompendium;
}

const buildTitle = (data: Character) => {
    const additionalInfo = data.archetype ? {
        archetype: data.archetype.name,
    } : null;
    const additionalInfoString = additionalInfo ? ` (${additionalInfo.archetype ?? ''})` : null;
    return `${data.name || 'Unnamed Character'}${additionalInfoString}`;
}

export const CharacterBuilder: FunctionComponent<Props> = ({ id = '', compendium }) => {
    const { data, setName, setArchetype, setSubtype } = useCharacter({ id });
    const { archetypes } = compendium;
    const { subtypes } = data.archetype;

    return (
    <section>
        <h2>{ buildTitle(data) }</h2>
        <section>
            <label htmlFor='nameInput'>Character name: </label>
            <input id='nameInput' value={data.name} onChange={e => setName((e.target as HTMLInputElement).value)}/>
        </section>
        <section>
            <h3>Archetype</h3>
            { Object.values(archetypes).map(archetype => (
                <span className='columns'>
                    <input 
                    type='radio' 
                    name={`${id}-archetype`}
                    value={archetype.name} 
                    checked={data.archetype.name === archetype.name} 
                    onChange={(e) => {
                        setArchetype(archetypes[e.currentTarget.value]);
                    }} />
                    <label htmlFor={archetype.name}>{archetype.name}</label>
                </span>
            )) }
        </section>
        <section>
            <h3>Subtype</h3>
            { Object.values(subtypes).map(subtype => (
                <span className='columns'>
                <input 
                type='radio' 
                name={`${id}-subtype`}
                value={subtype.name}
                checked={data.subtype.name === subtype.name} 
                onChange={(e) => {
                    setSubtype(subtypes[e.currentTarget.value]);
                }} />
                <label htmlFor={subtype.name}>{subtype.name}</label>
            </span>
            ))}
            { Object.values(subtypes).length === 0 && <span>Archetype '{data.archetype.name}' has no subtypes</span> }
        </section>
    </section>)
}