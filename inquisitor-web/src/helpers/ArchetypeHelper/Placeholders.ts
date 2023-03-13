import { Role, Subtype, Archetype } from './Archetype';
import { DieCode } from 'helpers/CompendiumHelper/CompendiumTypes';

export const EmptySubtype: Subtype = {
    key: 'none',
    name: 'None',
    stats: {
        BS: new DieCode('0'),
        I: new DieCode('0'),
        Ld: new DieCode('0'),
        Nv: new DieCode('0'),
        S: new DieCode('0'),
        Sg: new DieCode('0'),
        T: new DieCode('0'),
        WS: new DieCode('0'),
        Wp: new DieCode('0'),
    },
};

export const EmptyRole: Role = {
    key: 'none',
    name: 'None',
};

export const EmptyArchetype: Archetype = {
    key: 'none',
    name: 'None',
    roles: {},
    subtypes: {},
    talents: [],
    talentChoices: [],
}