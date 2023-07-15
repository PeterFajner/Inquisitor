import { FunctionComponent, ReactNode } from 'react';

export const Section: FunctionComponent<{
    type: 'narrow' | 'wide';
    children?: ReactNode;
    title?: string;
    leftOfTitle?: ReactNode;
    rightOfTitle?: ReactNode;
    classes?: string;
}> = ({ type, children, title, leftOfTitle, rightOfTitle, classes }) => (
    <section className={type + ' ' + classes ?? ''}>
        <h3>
            {leftOfTitle ? (
                <span style={{ marginRight: 20 }}>{leftOfTitle}</span>
            ) : null}
            {title && <span className="title">{title}</span>}
            {rightOfTitle ? (
                <span style={{ marginLeft: 20 }}>{rightOfTitle}</span>
            ) : null}
        </h3>
        {children}
    </section>
);
