import React, { useEffect, useState } from "react";
import "./App.css";
import { CharacterBuilder } from 'components/CharacterBuilder/CharacterBuilder';
import { ArchetypeCompendium } from 'helpers/ArchetypeHelper/Archetype';
import { compileArchetypes } from 'helpers/ArchetypeHelper/ArchetypeHelper';
import { v4 as uuidv4 } from 'uuid';

function App() {
    const [characterIDs, setCharacterIDs] = useState<string[]>([]);
    const [compendium, setCompendium] = useState<ArchetypeCompendium>({});

    useEffect(() => {
        const compile = async () => {
            const compendium = await compileArchetypes();
            setCompendium(compendium);
        };
        compile();
    }, []);
    
    const addCharacter = () => {
        setCharacterIDs([...characterIDs, uuidv4()]);
    }

    return (
        <div className="App">
            <header className="App-header">
                <h1>Inquisitor Character Generator</h1>
                <ul>
                    {characterIDs.map(id => (
                        <li key={id}><CharacterBuilder id={id} compendium={compendium} /></li>
                    ))}
                </ul>
                <button onClick={addCharacter}>Add character</button>
            </header>
        </div>
    );
}

export default App;
