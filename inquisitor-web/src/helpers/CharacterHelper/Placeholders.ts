import {
    EmptyArchetype,
    EmptyRole,
    EmptySubtype,
} from 'helpers/ArchetypeHelper/Placeholders';
import { Character } from 'helpers/CharacterHelper/Character';

export const EmptyStats = {
    BS: 0,
    I: 0,
    Ld: 0,
    Nv: 0,
    S: 0,
    Sg: 0,
    T: 0,
    WS: 0,
    Wp: 0,
};

export const EmptyCharacter: Character = {
    id: '',
    name: '',
    archetype: EmptyArchetype,
    role: EmptyRole,
    subtype: EmptySubtype,
    stats: EmptyStats,
    baseTalents: new Set(),
    chosenTalents: new Set(),
};
