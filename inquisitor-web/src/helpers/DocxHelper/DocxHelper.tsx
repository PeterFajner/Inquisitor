import { Buffer } from 'buffer';
import { Boon } from 'components/CharacterBuilder/BoonList';
import createReport from 'docx-templates';
import { buildTagLine } from 'helpers/Util';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    Character,
    Compendium,
    DefiniteBoon,
    Stat,
    Talent,
} from 'types/Compendium';

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
        const tagLine = buildTagLine(character);

        // assign Ability and Boost boons to their respective sections and remove them from the boon list
        const statsPlusBoostBoons: { [key in Stat]: number } = Object.assign(
            {},
            character.stats
        );
        const talentsPlusBoons: Talent[] = [
            ...character.baseTalents,
            ...character.chosenTalents.filter((t): t is Talent => Boolean(t)),
        ];
        const remainingBoons: DefiniteBoon[] = [];
        character.boons.forEach((boon) => {
            switch (boon.type) {
                case 'Ability':
                    talentsPlusBoons.push(boon.ability);
                    break;
                case 'Boost':
                    statsPlusBoostBoons[boon.stat] += boon.amount;
                    break;
                default:
                    remainingBoons.push(boon);
            }
        });

        const talents = `
        <meta charset="UTF-8">
        <body>
        <ul>
        ${talentsPlusBoons
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

        const boons = remainingBoons.length
            ? `
        <meta charset="UTF-8">
        <body style="font-size: 10.67; font-family: Helvetica">
        <span style="font-weight: bold">Boons:</span>
        ${remainingBoons
            .map((boon) => renderToStaticMarkup(<Boon boon={boon} />))
            .join('')}
        </body>
        `
            : '';

        const filledTemplate = await createReport({
            template,
            cmdDelimiter: ['{', '}'],
            data: {
                character,
                ...statsPlusBoostBoons,
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
