import { Buffer } from 'buffer';
import { Boon } from 'components/CharacterBuilder/BoonList';
import createReport from 'docx-templates';
import { Character } from 'helpers/CharacterHelper/Character';
import { Compendium } from 'helpers/CompendiumHelper/CompendiumTypes';
import { buildTagLine } from 'helpers/Util';
import { renderToStaticMarkup } from 'react-dom/server';

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
    characters: Character[],
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
        ${[...character.baseTalents, ...character.chosenTalents]
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

        const tagLine = buildTagLine(character);
        const boons = `
        <meta charset="UTF-8">
        <body style="font-size: 10.67; font-family: Helvetica">
        ${character.boons
            .map((boon) => renderToStaticMarkup(<Boon boon={boon} />))
            .join('')}
        </body>
        `;

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
                name: character.name || 'Unnamed Character',
                boons,
            },
        });

        saveDataToFile(
            filledTemplate,
            `${character.name || 'Unnamed Character'}.docx`,
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        );
    });
};
