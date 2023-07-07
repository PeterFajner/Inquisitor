import { FunctionComponent } from 'react';

export const Dropdown: FunctionComponent<{
    id: string;
    label: string | null;
    options: any[];
    labelExtractor: (obj: any) => string;
    keyExtractor: (obj: any) => string;
    value: string | undefined;
    setValue: (v: string) => void;
    includeDefault?: Boolean;
}> = ({
    id, label, options, labelExtractor, keyExtractor, value, setValue, includeDefault = false,
}) => (
        <div className={`dropdown ${label ? 'with-label' : 'no-label'}`}>
            <label htmlFor={id}>{label}</label>
            <select
                id={id}
                onChange={(e) => setValue(e.target.value)}
                disabled={options.length === 0}
                style={{ minWidth: 100 }}
                value={value}
            >
                {includeDefault && <option value={undefined}></option>}
                {options.map((option) => (
                    <option key={keyExtractor(option)} value={keyExtractor(option)}>
                        {labelExtractor(option)}
                    </option>
                ))}
            </select>
        </div>
    );
