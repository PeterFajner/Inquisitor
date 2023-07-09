import { FunctionComponent } from 'react';
import { Stat } from 'types/Compendium';

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
                onChange={(e) =>
                    setStat(
                        stat,
                        parseInt((e.target as HTMLInputElement).value)
                    )
                }
                size={3}
            />
        </td>
        <td><span>{boon ?? '-'}</span></td>
        <td><span>{base + (boon ?? 0)}</span></td>
    </tr>
);
