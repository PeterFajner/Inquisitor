import { Background } from 'components/Background/Background';
import { CharacterBuilder } from 'components/CharacterBuilder/CharacterBuilder';
import { ProgressBar } from 'components/ProgressBar/ProgressBar';
import { useCompendium } from 'hooks/CompendiumHooks/CompendiumHooks';
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import './App.css';

function App() {
    const [characterIDs, setCharacterIDs] = useState<string[]>([]);
    const { compendium, progress, maxProgress, status } = useCompendium();

    const addCharacter = () => {
        setCharacterIDs([...characterIDs, uuidv4()]);
    };

    return (
        <div id="App">
            <Background />
            <header className="App-header">
                <h1>Inquisitor Character Generator</h1>
            </header>
            <main>
                {compendium ? (
                    <>
                        <div className="all-characters">
                            {characterIDs.map((id) => (
                                <CharacterBuilder
                                    id={id}
                                    compendium={compendium}
                                    key={id}
                                />
                            ))}
                        </div>
                        <div className="buttons-wrapper">
                            <button onClick={addCharacter}>
                                Add character
                            </button>
                        </div>
                    </>
                ) : (
                    <ProgressBar
                        progress={progress}
                        maxProgress={maxProgress}
                        status={status}
                    ></ProgressBar>
                )}
            </main>
        </div>
    );
}

export default App;
