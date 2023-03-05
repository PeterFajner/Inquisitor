import { EmptyRole, EmptySubtype, EmptyArchetype } from 'helpers/ArchetypeHelper/Placeholders';
import { EmptyCharacter, EmptyStats } from 'helpers/CharacterHelper/Placeholders';
import { Archetype, Role, Subtype } from 'helpers/ArchetypeHelper/Archetype';
import { v4 as uuidv4 } from 'uuid';
import { useState } from 'react';
import { Character } from 'helpers/CharacterHelper/Character';

export const useCharacter = ({ id = '', defaultData = EmptyCharacter }) => {
    const [data, setData] = useState<Character>(Object.assign(defaultData, { id }));

    const setName = (name: string) => {
        setData({ ...data, name });
    };

    const setArchetype = (archetype: Archetype) => {
        setData({ ...data, archetype });
    }

    const setSubtype = (subtype: Subtype) => {
        setData({ ...data, subtype });
    }

    return { data, setName, setArchetype, setSubtype };
}