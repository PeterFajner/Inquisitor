import { buildCompendium } from 'helpers/CompendiumHelper/CompendiumHelper';
import { useEffect, useState } from 'react';
import { Compendium } from 'types/Compendium';

export const useCompendium = () => {
    const [compendium, setCompendium] = useState<Compendium>();
    const [progress, setProgress] = useState<number>(0);
    const [maxProgress, setMaxProgress] = useState<number>(0);
    const [status, setStatus] = useState<string>('');

    useEffect(() => {
        const compile = async () => {
            const compendium = await buildCompendium(
                setMaxProgress,
                (progress, status) => {
                    setProgress(progress);
                    setStatus(status);
                }
            );
            setCompendium(compendium);
        };
        compile();
    }, []);

    return {
        compendium,
        progress,
        maxProgress,
        status,
    };
};
