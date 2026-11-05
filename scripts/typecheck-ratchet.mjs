import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Nur echte TypeScript-Direktiven zählen; Texte in Literalen sind keine Ausnahmen.
 * TypeScript 5.9.3 liefert commentDirectives zusätzlich zu checkJsDirective am AST.
 * @param {string} text @param {string} [file]
 * @returns {{exceptions: number, noCheck: boolean}}
 */
export function inspectTypeDirectives(text, file = 'source.js') {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const exceptions = (source.commentDirectives || [])
        .filter(directive => directive.type === ts.CommentDirectiveType.ExpectError).length;
    return { exceptions, noCheck: source.checkJsDirective?.enabled === false };
}

/** @param {string[]} current @param {string[]} previous
 * @param {Record<string, number>} counts @param {Record<string, number>} limits
 * @returns {string[]}
 */
export function checkTypeRatchet(current, previous, counts, limits) {
    if (!Array.isArray(previous) || previous.some(file => typeof file !== 'string')) {
        throw new Error('Die bisherige strenge Liste muss Dateipfade enthalten.');
    }
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
        throw new Error('typcheck/ausnahmen.json muss Ordner mit Ausnahmezahlen enthalten.');
    }
    const errors = [];
    const selected = new Set(current);
    for (const file of previous) {
        if (!selected.has(file)) errors.push(`${file}: aus typcheck/streng.json entfernt; die Liste darf nur wachsen`);
    }
    for (const [folder, limit] of Object.entries(limits)) {
        if (!Number.isSafeInteger(limit) || limit < 0) errors.push(`${folder}: ungültige Ausnahmegrenze`);
    }
    for (const [folder, count] of Object.entries(counts)) {
        const limit = Object.hasOwn(limits, folder) ? limits[folder] : 0;
        if (count > limit) errors.push(`${folder}: ${count} @ts-expect-error, höchstens ${limit} erlaubt`);
    }
    return errors;
}

/** @param {string[]} files @param {string[]} strictFiles @param {string} root
 * @returns {{errors: string[], counts: Record<string, number>}}
 */
export function inspectTypeRatchet(files, strictFiles, root) {
    const relative = file => path.relative(root, file).split(path.sep).join('/');
    const counts = {};
    const disabled = [];
    for (const file of files) {
        const folder = path.posix.dirname(relative(file));
        const directives = inspectTypeDirectives(readFileSync(file, 'utf8'), file);
        counts[folder] = (counts[folder] || 0) + directives.exceptions;
        if (directives.noCheck) disabled.push(`${relative(file)}: @ts-nocheck ist nicht erlaubt`);
    }
    // Lesender Git-Zugriff: auch neue Einträge sind nach dem Commit vor Entfernung geschützt.
    const previous = JSON.parse(execFileSync('git', ['show', 'HEAD:typcheck/streng.json'], {
        cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
    }));
    const limits = JSON.parse(readFileSync(path.join(root, 'typcheck/ausnahmen.json'), 'utf8'));
    return { counts, errors: [...disabled, ...checkTypeRatchet(strictFiles.map(relative), previous, counts, limits)] };
}
