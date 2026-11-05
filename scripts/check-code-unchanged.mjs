import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sameExecutableCode } from './javascript-syntax.mjs';

export { sameExecutableCode } from './javascript-syntax.mjs';
const root = path.resolve(import.meta.dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
const splitPaths = buffer => buffer.toString('utf8').split('\0').filter(Boolean);
const isCode = file => /^(?:(?:app|engine|workers|types)\/.*\.(?:js|mjs)|engine\.js)$/.test(file);
const isBytes = file => /\.html$/.test(file) || /^(?:css|src-tauri)\//.test(file) || file === 'scripts/sync-dist.mjs';

/** @param {string} commit @returns {{files: number, commentsOnly: number, changed: string[]}} */
export function checkCodeUnchanged(commit) {
    // Commit zunächst auflösen; keine Git-Optionen oder Pfadausdrücke als Revision akzeptieren.
    const revision = git(['rev-parse', '--verify', '--end-of-options', `${commit}^{commit}`]).toString().trim();
    const before = new Set(splitPaths(git(['ls-tree', '-r', '--name-only', '-z', revision])));
    const current = new Set(splitPaths(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])));
    const files = [...new Set([...before, ...current])].filter(file => isCode(file) || isBytes(file)).sort();
    const changed = [];
    let commentsOnly = 0;
    for (const file of files) {
        const fullPath = path.join(root, file);
        if (!before.has(file) || !current.has(file) || !existsSync(fullPath)) {
            changed.push(`${file}: Datei neu oder gelöscht`);
            continue;
        }
        const oldBytes = git(['show', `${revision}:${file}`]);
        const newBytes = readFileSync(fullPath);
        if (oldBytes.equals(newBytes)) continue;
        try {
            if (isCode(file) && sameExecutableCode(oldBytes.toString('utf8'), newBytes.toString('utf8'), file)) commentsOnly++;
            else changed.push(`${file}: ${isCode(file) ? 'ausführbarer Code geändert' : 'Bytes geändert'}`);
        } catch (error) {
            changed.push(`${file}: Vergleich fehlgeschlagen (${error.message})`);
        }
    }
    return { files: files.length, commentsOnly, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length !== 3) throw new Error('Aufruf: node scripts/check-code-unchanged.mjs <commit>');
        const result = checkCodeUnchanged(process.argv[2]);
        for (const message of result.changed) console.error(message);
        console.log(`${result.changed.length ? 'Code geändert' : 'Code unverändert'}: ${result.files} Dateien geprüft, ${result.commentsOnly} nur Kommentare geändert`);
        if (result.changed.length) process.exitCode = 1;
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
