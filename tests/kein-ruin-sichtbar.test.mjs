// TX-1: Das Wort „Ruin“ erscheint in keinem sichtbaren Text mehr (Nutzer 17.11.2026).
// Geprüft werden Zeichenketten in Anführungszeichen unter app/ und die HTML-Seiten.
// Code-Namen wie isRuin, breakOnRuin, 'ruin' oder '!!! RUIN !!!' bleiben erlaubt,
// weil das Muster nur das deutsche Wort am Wortanfang (groß) oder als Wortende (Geldruin) trifft.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const VISIBLE_WORD = /(?<![\p{L}\p{N}_])(?:Ruin|ruinier)|(?<=\p{Ll})ruin/u;

function jsFiles(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return jsFiles(path);
        return /\.(?:m?js)$/u.test(name) ? [path] : [];
    });
}

/** Liefert alle Zeichenkettenteile einer JS-Datei; Kommentare und Code dazwischen fallen weg. */
function stringLiterals(source) {
    const parts = [];
    const stack = []; // offene Template-Ausdrücke: Tiefe geschweifter Klammern
    let i = 0;
    const readQuoted = quote => {
        let text = '';
        i++;
        while (i < source.length && source[i] !== quote) {
            if (source[i] === '\\') { text += source[i + 1] ?? ''; i += 2; continue; }
            if (source[i] === '\n') break;
            text += source[i++];
        }
        i++;
        parts.push(text);
    };
    const readTemplate = () => {
        let text = '';
        while (i < source.length) {
            const char = source[i];
            if (char === '\\') { text += source[i + 1] ?? ''; i += 2; continue; }
            if (char === '`') { i++; parts.push(text); return; }
            if (char === '$' && source[i + 1] === '{') { i += 2; parts.push(text); stack.push(0); return; }
            text += char; i++;
        }
        parts.push(text);
    };
    while (i < source.length) {
        const char = source[i];
        const next = source[i + 1];
        if (char === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue; }
        if (char === '/' && next === '*') { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
        if (char === '\'' || char === '"') { readQuoted(char); continue; }
        if (char === '`') { i++; readTemplate(); continue; }
        if (stack.length && char === '{') { stack[stack.length - 1]++; i++; continue; }
        if (stack.length && char === '}') {
            if (stack[stack.length - 1] === 0) { stack.pop(); i++; readTemplate(); continue; }
            stack[stack.length - 1]--; i++; continue;
        }
        i++;
    }
    return parts;
}

const findings = [];
for (const file of jsFiles(join(root, 'app'))) {
    for (const text of stringLiterals(readFileSync(file, 'utf8'))) {
        if (VISIBLE_WORD.test(text)) findings.push(`${relative(root, file)}: ${text.trim().slice(0, 120)}`);
    }
}
for (const name of readdirSync(root).filter(entry => entry.endsWith('.html'))) {
    readFileSync(join(root, name), 'utf8').split('\n').forEach((line, index) => {
        if (VISIBLE_WORD.test(line)) findings.push(`${name}:${index + 1}: ${line.trim().slice(0, 120)}`);
    });
}

const probe = stringLiterals("const a = isRuin; const b = 'ruin'; const c = `x ${f('Ruin')} y`; // Ruin\nconst d = \"!!! RUIN !!!\";");
assert(probe.includes('Ruin') && !probe.some(text => text.includes('isRuin')), 'Scanner findet Zeichenketten in Template-Ausdrücken und übergeht Code und Kommentare');
assertEqual(findings.join('\n'), '', 'Kein sichtbares „Ruin“ in Oberfläche, Meldungen und HTML-Seiten');
