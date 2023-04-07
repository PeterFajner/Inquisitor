import createReport from 'docx-templates';
import { Compendium } from 'helpers/CompendiumHelper/CompendiumTypes';
import { DynamicCharacter } from 'hooks/CharacterHooks/CharacterHooks';
import { Buffer } from 'buffer';
import { EmptyArchetype, EmptyRole, EmptySubtype } from 'helpers/ArchetypeHelper/Placeholders';

/*const IncrementCreator = () => {
    const IncrementCreator = function() {
        this.value = 0;
    }

    IncrementCreator.prototype = {
        value: this.value,
        increment: function() { this.value++; },
    }
};*/

// https://github.com/guigrpa/docx-templates/blob/79119723ff1c009b5bbdd28016558da9b405742f/examples/example-webpack/client/index.js#L91
const downloadURL = (data: any, fileName: any) => {
    const a = document.createElement('a');
    a.href = data;
    a.download = fileName;
    document.body.appendChild(a);
    //a.style = 'display: none';
    a.click();
    a.remove();
};

// https://github.com/guigrpa/docx-templates/blob/79119723ff1c009b5bbdd28016558da9b405742f/examples/example-webpack/client/index.js#L82
const saveDataToFile = (data: any, fileName: any, mimeType: any) => {
    const blob = new Blob([data], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    downloadURL(url, fileName);
    setTimeout(() => {
        window.URL.revokeObjectURL(url);
    }, 1000);
};

export const triggerDocxDownload = async (
    characters: DynamicCharacter[],
    compendium: Compendium
): Promise<void> => {
    // todo dynamically pick or generate a template for the correct number of characters
    const template = Buffer.from(
        await fetch('./template_3_characters.docx').then((res) =>
            res.arrayBuffer()
        )
    );

    characters.forEach(async (character) => {
        const talents = `
        <meta charset="UTF-8">
        <body>
        <ul>
        ${Array.from(character.talents)
            .map(
                (talent) => `
            <li style="font-size: 10.67; font-family: Helvetica">
                <strong style="color: red;">${talent.name}</strong> (${talent.description})
            </li>`
            )
            .join('')}
        </ul>
        </body>
        `;

        const archetype = character.archetype !== EmptyArchetype && character.archetype.name;
        const subtype = character.subtype !== EmptySubtype && character.subtype.name;
        const role = character.role !== EmptyRole && character.role.name;
        const tagLine = [archetype, subtype, role].filter(e => e).join(', ');

        const filledTemplate = await createReport({
            template,
            cmdDelimiter: ['{', '}'],
            data: {
                character,
                WS: character.stats.WS,
                BS: character.stats.BS,
                S: character.stats.S,
                T: character.stats.T,
                I: character.stats.I,
                Wp: character.stats.Wp,
                Sg: character.stats.Sg,
                Nv: character.stats.Nv,
                Ld: character.stats.Ld,
                talents,
                tagLine,
            },
        });

        saveDataToFile(
            filledTemplate,
            `${character.name || 'Unnamed Character'}.docx`,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
    });
};
