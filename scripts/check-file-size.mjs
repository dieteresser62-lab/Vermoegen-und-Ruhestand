import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countCodeLines } from './javascript-syntax.mjs';

export { countCodeLines } from './javascript-syntax.mjs';
const projectRoot = path.resolve(import.meta.dirname, '..');

/** @param {string} [root] @returns {Record<string, number>} */
export function collectCodeSizes(root = projectRoot) {
    const sizes = {};
    function visit(folder) {
        for (const entry of readdirSync(path.join(root, folder), { withFileTypes: true })) {
            const file = `${folder}/${entry.name}`;
            if (entry.isDirectory()) visit(file);
            else if (/\.(?:js|mjs)$/.test(entry.name)) sizes[file] = countCodeLines(readFileSync(path.join(root, file), 'utf8'), file);
        }
    }
    for (const folder of ['app', 'engine', 'workers', 'types']) visit(folder);
    return Object.fromEntries(Object.entries(sizes).sort(([a], [b]) => a.localeCompare(b, 'en')));
}

/** @param {Record<string, number>} sizes @param {Record<string, number>} baseline @returns {string[]} */
export function checkFileSizes(sizes, baseline) {
    const errors = [];
    for (const [file, limit] of Object.entries(baseline)) {
        if (!Number.isInteger(limit) || limit <= 300) errors.push(`${file}: ungültiger Listenwert ${limit}`);
        if (!(file in sizes) || sizes[file] <= 300) errors.push(`${file}: aus der Liste streichen`);
        else if (sizes[file] > limit) errors.push(`${file}: ${sizes[file]} Codezeilen, Listenwert ${limit} überschritten`);
    }
    for (const [file, size] of Object.entries(sizes)) {
        if (!(file in baseline) && size > 300) errors.push(`${file}: ${size} Codezeilen, höchstens 300 erlaubt`);
    }
    return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const sizes = collectCodeSizes();
        const baseline = JSON.parse(readFileSync(path.join(projectRoot, 'typcheck/grosse-dateien.json'), 'utf8'));
        const errors = checkFileSizes(sizes, baseline);
        for (const error of errors) console.error(error);
        console.log(`Dateigrößen: ${Object.keys(sizes).length} Dateien geprüft, ${Object.keys(baseline).length} über 300 Codezeilen, ${errors.length} Fehler.`);
        if (errors.length) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
