import React, { useEffect, useState } from "react";
import "./App.css";
import { CharacterBuilder } from 'components/CharacterBuilder/CharacterBuilder';
import { ArchetypeCompendium, EmptyCompendium } from 'helpers/ArchetypeHelper/Archetype';
import { compileArchetypes } from 'helpers/ArchetypeHelper/ArchetypeHelper';
import { v4 as uuidv4 } from 'uuid';

function App() {
    const [characterIDs, setCharacterIDs] = useState<string[]>([]);
    const [compendium, setCompendium] = useState<ArchetypeCompendium>(EmptyCompendium);

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
            </header>
            <main>
                <div className='all-characters'>
                    {characterIDs.map(id => (
                        <section className='character-builder' key={id}><CharacterBuilder id={id} compendium={compendium} /></section>
                    ))}
                </div>
                <div className='buttons-wrapper'>
                    <button onClick={addCharacter}>Add character</button>
                </div>
            </main>
        </div>
    );
}

export default App;
