import { B } from 'components/CharacterBuilder/Bold';
import { DefiniteBoon } from 'helpers/CompendiumHelper/CompendiumTypes';
import { FunctionComponent } from 'react';

export const Boon: FunctionComponent<{
    boon: DefiniteBoon;
}> = ({ boon }) => {
    switch (boon.type) {
        case 'Ability':
            return (
                <li key={boon.ability.key}>
                    <B>{boon.ability.name}</B> (Ability):{' '}
                    {boon.ability.description}
                </li>
            );
        case 'Boost':
            return (
                <li key={boon.stat + boon.type}>
                    <B>
                        +{boon.amount} {boon.stat}
                    </B>{' '}
                    (not reflected in stat total)
                </li>
            );
        case 'Exotic':
            return (
                <li key={boon.exoticAbility.key}>
                    <B>{boon.exoticAbility.name}</B> (Exotic Ability):{' '}
                    {boon.exoticAbility.description}
                </li>
            );
        case 'Psychic':
            return (
                <li key={boon.type}>
                    <B>👺 Summon Bigger Demon 👺</B> (Psychic Power): Psychic
                    Powers are not yet implemented
                </li>
            );
    }
};

export const BoonList: FunctionComponent<{
    boons: DefiniteBoon[];
}> = ({ boons }) => (
    <ul>
        {boons.map((boon) => (
            <Boon boon={boon} />
        ))}
    </ul>
);
