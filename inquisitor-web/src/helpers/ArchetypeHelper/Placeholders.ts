import { DieCode, Role, Subtype, Archetype } from './Archetype';

export const EmptySubtype: Subtype = {
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
    name: 'None',
};

export const EmptyArchetype: Archetype = {
    name: 'None',
    roles: {},
    subtypes: {},
}