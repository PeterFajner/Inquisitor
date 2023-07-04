import { FunctionComponent } from 'react';
import './ProgressBar.css';

export const ProgressBar: FunctionComponent<{
    progress: number;
    maxProgress: number;
    status: string;
}> = ({ progress, maxProgress, status }) => (
    <>
        <div>
            <progress id="progress" value={progress} max={maxProgress}>
                {progress}/{maxProgress}
            </progress>
            <label htmlFor="progress">{status}</label>
        </div>
    </>
);
