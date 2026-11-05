import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(import.meta.dirname, '..');
const isSource = file => /^(?:(?:app|engine|workers|types)\/.*\.(?:js|mjs)|engine\.js)$/.test(file);
const options = { allowJs: true, noEmit: true, noLib: true, types: [],
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };

// Auch die Auflösung alter Re-Exporte verwendet ausschließlich den damaligen Baum.
function snapshotHost(root, revision, files, git) {
    const host = ts.createCompilerHost(options);
    const paths = new Set(files.map(file => path.join(root, file)));
    const folders = new Set();
    for (const file of paths) {
        for (let dir = path.dirname(file); dir.startsWith(root); dir = path.dirname(dir)) {
            folders.add(dir);
            if (dir === root) break;
        }
    }
    const cache = new Map();
    host.fileExists = file => paths.has(path.resolve(file));
    host.directoryExists = dir => folders.has(path.resolve(dir));
    host.getDirectories = dir => [...folders].filter(folder => path.dirname(folder) === path.resolve(dir));
    host.realpath = file => file;
    host.readFile = file => {
        file = path.resolve(file);
        if (!paths.has(file)) return undefined;
        if (!cache.has(file)) cache.set(file, git(['show', `${revision}:${path.relative(root, file).split(path.sep).join('/')}`]).toString('utf8'));
        return cache.get(file);
    };
    host.getSourceFile = (file, languageVersion) => {
        const text = host.readFile(file);
        return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion, true);
    };
    return host;
}

function exportsOf(program, checker, file) {
    const source = program.getSourceFile(file);
    const symbol = source && checker.getSymbolAtLocation(source);
    if (!symbol) return new Set();
    return new Set(checker.getExportsOfModule(symbol).filter(entry => {
        const target = entry.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(entry) : entry;
        return Boolean(target.declarations?.length);
    }).map(entry => entry.name));
}

/** @param {string} commit @param {{root?: string}} [configuration] */
export function checkFacadeExports(commit, { root = projectRoot } = {}) {
    root = path.resolve(root);
    const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
    const revision = git(['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]).toString().trim();
    const tracked = git(['ls-tree', '-r', '--name-only', '-z', revision]).toString('utf8').split('\0').filter(Boolean);
    const files = tracked.filter(isSource).sort();
    const roots = files.map(file => path.join(root, file));
    const before = ts.createProgram(roots, options, snapshotHost(root, revision, tracked, git));
    const after = ts.createProgram(roots.filter(existsSync), options);
    const oldChecker = before.getTypeChecker(), newChecker = after.getTypeChecker();
    const errors = [];
    for (const file of files) {
        const fullPath = path.join(root, file);
        if (!existsSync(fullPath)) {
            errors.push(`${file}: Datei fehlt`);
            continue;
        }
        const current = exportsOf(after, newChecker, fullPath);
        for (const name of exportsOf(before, oldChecker, fullPath)) {
            if (!current.has(name)) errors.push(`${file}: Export ${name} fehlt`);
        }
    }
    return { files: files.length, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3) throw new Error('Aufruf: node scripts/check-facade-exports.mjs <commit>');
        const result = checkFacadeExports(process.argv[2]);
        for (const error of result.errors) console.error(error);
        console.log(`Exporte erhalten: ${result.files} Dateien`);
        if (result.errors.length) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
