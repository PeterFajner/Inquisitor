import { Stat } from 'helpers/CompendiumHelper/CompendiumTypes';
import { FunctionComponent } from 'react';

export const StatsRow: FunctionComponent<{
    id: string;
    stat: Stat;
    base: number;
    boon: number | undefined;
    setStat: (key: Stat, value: number) => void;
}> = ({ id, stat, base, boon, setStat }) => (
    <tr>
        <th>
            <label htmlFor={`${id}-stat-${stat}`}>{stat} </label>
        </th>
        <td key={stat}>
            <input
                type="number"
                id={`${id}-stat-${stat}`}
                value={base}
                onChange={(e) => setStat(
                    stat,
                    parseInt((e.target as HTMLInputElement).value)
                )}
                size={3} />
        </td>
        <td>{boon ?? '-'}</td>
        <td>{base + (boon ?? 0)}</td>
    </tr>
);
