import { FunctionComponent } from 'react';

export const TalentEntry: FunctionComponent<{
    name?: string;
    description?: string;
}> = ({ name, description }) => (
    <div className="columns" style={{ marginBottom: '10px' }}>
        <span>
            <span style={{ fontWeight: 'bold' }}>{name}: </span>
            {description}
        </span>
    </div>
);
