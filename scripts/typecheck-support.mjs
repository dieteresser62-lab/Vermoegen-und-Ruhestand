import ts from 'typescript';
import path from 'node:path';
import { readFileSync } from 'node:fs';

export const projectRoot = path.resolve(import.meta.dirname, '..');
/** @param {string} file @returns {string} */
export const relativePath = file => path.relative(projectRoot, file).split(path.sep).join('/');

/** @param {string} [name] @returns {ts.ParsedCommandLine} */
export function readConfig(name = 'tsconfig.json') {
    const configFile = path.join(projectRoot, name);
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, ' '));
    const config = ts.parseJsonConfigFileContent(read.config, ts.sys, projectRoot, undefined, configFile);
    if (config.errors.length) throw new Error(config.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n'));
    return config;
}

/** @param {string} text @param {string} [file] @returns {boolean} */
export function hasTsCheck(text, file = 'source.js') {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const directive = source.checkJsDirective;
    const leadingEnd = source.statements[0]?.getStart(source) ?? text.length;
    return directive?.enabled === true && directive.end <= leadingEnd
        && /^\/\/\s*@ts-check\b/.test(text.slice(directive.pos, directive.end).trim());
}

/** @param {string[]} files @returns {string[]} */
export function readStrictFiles(files) {
    const entries = JSON.parse(readFileSync(path.join(projectRoot, 'typcheck/streng.json'), 'utf8'));
    if (!Array.isArray(entries) || entries.some(file => typeof file !== 'string')) {
        throw new Error('typcheck/streng.json muss eine Liste von Dateipfaden enthalten.');
    }
    const available = new Set(files);
    const selected = [...new Set(entries.map(file => path.resolve(projectRoot, file)))];
    for (const file of selected) if (!available.has(file)) throw new Error(`Unbekannte strenge Datei: ${relativePath(file)}`);
    return selected;
}

/** @param {Pick<ts.ParsedCommandLine, 'fileNames' | 'options'>} config
 * @param {string[]} selected @param {{all?: boolean}} [options] @returns {ts.Diagnostic[]}
 */
export function collectDiagnostics(config, selected, { all = false } = {}) {
    if (!selected.length) return [];
    const enabled = new Set(selected);
    const declarations = config.fileNames.filter(file => file.endsWith('.d.ts'));
    const program = ts.createProgram({ rootNames: [...selected, ...declarations],
        options: { ...config.options, checkJs: all || config.options.strict || config.options.checkJs } });
    return ts.getPreEmitDiagnostics(program).filter(d => !d.file || enabled.has(path.resolve(d.file.fileName)));
}

/** Eine Unterdrückung für strictNullChecks ist im Normalmodus unbenutzt.
 * Sie bleibt nur dann gültig, wenn dieselbe Stelle streng geprüft und dort benutzt wird.
 * @param {ts.Diagnostic[]} normal
 * @param {ts.Diagnostic[]} strict
 * @param {string[]} strictFiles
 * @returns {ts.Diagnostic[]}
 */
export function reconcileNormalDiagnostics(normal, strict, strictFiles) {
    const checked = new Set(strictFiles.map(file => path.resolve(file)));
    const key = diagnostic => `${path.resolve(diagnostic.file.fileName)}:${diagnostic.start}`;
    const unusedStrict = new Set(strict.filter(d => d.code === 2578 && d.file).map(key));
    return normal.filter(d => d.code !== 2578 || !d.file
        || !checked.has(path.resolve(d.file.fileName)) || unusedStrict.has(key(d)));
}

/** @param {ts.Diagnostic} diagnostic @returns {string} */
export function formatDiagnostic(diagnostic) {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
    if (!diagnostic.file) return `tsconfig.json:1:1 TS${diagnostic.code} ${text}`;
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    return `${relativePath(diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code} ${text}`;
}
