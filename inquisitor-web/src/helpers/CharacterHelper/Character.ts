import { Archetype, Role, Subtype } from 'helpers/ArchetypeHelper/Archetype';

export interface Stats {
    BS: number,
    I: number,
    Ld: number,
    Nv: number,
    S: number,
    Sg: number,
    T: number,
    WS: number,
    Wp: number,
}

export interface Character {
    id: string;
    name: string;
    archetype: Archetype;
    role: Role;
    subtype: Subtype;
    stats: Stats;

    /*constructor(id: string | null = null) {
        this.id = id || uuidv4();
        this.name = '';
        this.archetype = EmptyArchetype;
        this.role = EmptyRole;
        this.subtype = EmptySubtype;
        this.stats = EmptyStats;
    }

    setName(name: string): Character {
        this.name = name;
        return this;
    }*/
}