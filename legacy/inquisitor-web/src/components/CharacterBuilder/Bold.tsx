import { FunctionComponent, ReactNode } from 'react';

export const B: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
    <span style={{ fontWeight: 'bold' }}>{children}</span>
);
