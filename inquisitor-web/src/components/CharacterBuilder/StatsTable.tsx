import {
    STATS_ORDER,
    Stats
} from 'helpers/CharacterHelper/Character';
import { DefiniteBoon, Stat } from 'helpers/CompendiumHelper/CompendiumTypes';
import { FunctionComponent } from 'react';
import { StatsRow } from './StatsRow';

export const StatsTable: FunctionComponent<{
    id: string;
    stats: Stats;
    boons: DefiniteBoon[];
    setStat: (key: Stat, value: number) => void;
}> = ({ id, stats, boons, setStat }) => {
    const statBoonBoosts: {
        [key in Stat]?: number;
    } = {};
    boons.forEach((boon) => {
        if (boon.type === 'Boost') {
            statBoonBoosts[boon.stat] =
                (statBoonBoosts[boon.stat] ?? 0) + boon.amount;
        }
    });
    return (
        <table className="stats-table">
            <thead>
                <tr>
                    <th></th>
                    <th>Base</th>
                    <th>Boon</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                {STATS_ORDER.map((stat) => (
                    <StatsRow
                        id={id}
                        stat={stat}
                        base={stats[stat]}
                        boon={statBoonBoosts[stat]}
                        setStat={setStat}
                    ></StatsRow>
                ))}
            </tbody>
        </table>
    );
};
