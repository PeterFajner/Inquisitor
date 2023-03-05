import { ArchetypeCompendium } from 'helpers/ArchetypeHelper/Archetype';
import { useCharacter } from 'hooks/CharacterHooks/CharacterHooks';
import { FunctionComponent } from 'react';

interface Props {
    id: string;
    compendium: ArchetypeCompendium;
}

export const CharacterBuilder: FunctionComponent<Props> = ({ id = '', compendium }) => {
    const { data, setName } = useCharacter({ id });

    return (
    <section>
        <h2>{ data.name || 'Unnamed Character' }</h2>
        <section>
            <label htmlFor='nameInput'>Character name: </label>
            <input id='nameInput' value={data.name} onChange={e => setName((e.target as HTMLInputElement).value)}/>
        </section>
        <section>
            <h3>Archetype</h3>
        </section>
    </section>)
}