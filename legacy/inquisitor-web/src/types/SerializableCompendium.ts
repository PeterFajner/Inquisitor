import {
    AbilityBoon,
    Archetype,
    ArchetypeKey,
    BoonType,
    BoostBoon,
    ExoticAbility,
    ExoticAbilityKey,
    RandomExoticAbility,
    RerollBoon,
    Role,
    RoleKey,
    RolledExoticBoon,
    Stats,
    Subtype,
    SubtypeKey,
    Talent,
    TalentKey,
} from 'types/Compendium';
import { TalentChoiceList } from './Compendium';

// serializable interfaces are a top-down tree that can be serialized, instead of a graph linked by object references
export interface SerializableCompendium {
    archetypes: SerializableArchetype[];
    roles: SerializableRole[];
    talents: Talent[];
    archetypeTalents: SerializableArchetypeTalent[];
    archetypeTalentChoices: SerializableTalentChoiceList[];
    boons: SerializableBoon[];
    exoticAbilities: ExoticAbility[];
    randomExoticAbilities: SerializableRandomExoticAbility[]; // ordered by lowroll
}

export interface SerializableArchetype
    extends Omit<Archetype, 'roles' | 'subtypes' | 'talents' | 'talentChoices'> {
    subtypes: Subtype[],
}

export interface SerializableRole extends Role {
    archetypeKey: ArchetypeKey;
}

export interface SerializableRandomExoticAbility
    extends Omit<RandomExoticAbility, 'exoticAbility'> {
    exoticAbilityKey: ExoticAbilityKey;
}

export interface SerializableBoon {
    subtypeKey: SubtypeKey;
    lowRoll: number; // 1-100
    highRoll: number; // 1-100
    type: BoonType;
}

export interface SerializableAbilityBoon extends Omit<AbilityBoon, 'ability'>, Omit<SerializableBoon, 'type'> {
    abilityKey: TalentKey;
}

export interface SerializableBoostBoon extends BoostBoon, Omit<SerializableBoon, 'type'> {
}

export interface SerializableRerollBoon extends Omit<RerollBoon, 'subtype'>, Omit<SerializableBoon, 'type'> {
    targetSubtypeKey: SubtypeKey;
}

export interface SerializableRolledExoticBoon
    extends Omit<RolledExoticBoon, 'exoticAbility'> {
    exoticAbilityKey: ExoticAbilityKey;
}

export interface SerializableRolledPsychicBoon {
    // todo
}

export interface SerializableArchetypeTalent {
    archetypeKey: ArchetypeKey
        talentKey: TalentKey;
        subtypeKey: SubtypeKey | null;
        roleKey: RoleKey | null;
}

export interface SerializableTalentChoiceList
    extends Omit<TalentChoiceList, 'subtype' | 'role' | 'talentList'> {
    archetypeKey: ArchetypeKey;
    subtypeKey: SubtypeKey | null;
    roleKey: RoleKey | null;
    talentKeyList: string[] | null;
}

export type RawDataRows = { [key: string]: string }[];

export type SerializableDefiniteBoon =
    | SerializableAbilityBoon
    | BoostBoon
    | SerializableRolledExoticBoon
    | SerializableRolledPsychicBoon;

export interface SerializableCharacter {
    id: string;
    name: string;
    archetypeKey: ArchetypeKey;
    roleKey: RoleKey | null;
    subtypeKey: SubtypeKey;
    stats: Stats;
    baseTalentKeys: Set<TalentKey>;
    chosenTalentkeys: (TalentKey | undefined)[];
    boonKeys: SerializableDefiniteBoon[];
}
