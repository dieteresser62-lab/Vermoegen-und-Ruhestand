// JD-2a, Nachtrag Punkt 8: Jahreslieferungen sind für Git binär (-text). Sonst könnte Git Zeilenenden umschreiben,
// und der SHA-256 der Rohantwort in lieferung.json stimmte nach dem Commit nicht mehr. Die Regel steht in
// data/historical/.gitattributes, weil der Slice-16-Beleg die Bytes der .gitattributes in der Wurzel festschreibt.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eigenesRepoPruefen, gitFreieUmgebung } from './helpers/git-isoliert.mjs';

console.log('--- Jahresdaten: Zeilenenden der Lieferungen ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Test 1 liest nur das Projekt-Repo (in der Gegenprobe ggf. über GIT_DIR). Das Temp-Repo in Test 2 läuft ohne GIT_*-Variablen.
const leseEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
const env = gitFreieUmgebung(process.env, { GIT_OPTIONAL_LOCKS: '0' });
const git = (cwd, args, input, umgebung = env) => execFileSync('git', args, { cwd, env: umgebung, encoding: 'utf8', input });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

console.log('Test 1: .gitattributes im Repo');
assert(fs.readFileSync(path.join(root, 'data/historical/.gitattributes'), 'utf8').split('\n').includes('*/jahre/** -text'),
    'data/historical/.gitattributes behandelt */jahre/** als binär (-text)');
const slice16 = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/backtest-data-validation-slice-16-v1.json'), 'utf8'));
assertEqual(sha256(fs.readFileSync(path.join(root, '.gitattributes'))), slice16.atomicBinaryContract.attributesSha256,
    '.gitattributes der Wurzel bleibt bytegleich zum Slice-16-Beleg');
const pfade = [
    'data/historical/german-cpi-chain/jahre/2026/lieferung.json',
    'data/historical/us-shiller-cape-chain/jahre/2026/rohauszug-shiller-cape.csv',
    'data/historical/german-cash-money-market-chain/jahre/2031/rohantwort.txt',
    'data/historical/global-equity-research-chain/jahre/2026/rohauszug-oecd.csv'
];
const attribute = git(root, ['check-attr', 'text', '--', ...pfade], undefined, leseEnv);
for (const pfad of pfade) assert(attribute.includes(`${pfad}: text: unset`), `${pfad} ist für Git binär (-text)`);
assert(git(root, ['check-attr', 'text', '--', 'data/historical/german-cpi-chain/README.md'], undefined, leseEnv).includes('text: set'),
    'Übrige Textdateien unter data/historical bleiben Text');

console.log('Test 2: Rohantworten mit CRLF und gemischten Zeilenenden kommen bytegleich aus Git zurück');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-gitattributes-'));
try {
    git(repo, ['init', '-q']);
    eigenesRepoPruefen(repo, env);
    git(repo, ['config', 'user.email', 'test@example.invalid']);
    git(repo, ['config', 'user.name', 'Jahresdaten-Test']);
    git(repo, ['config', 'core.autocrlf', 'true']);
    fs.copyFileSync(path.join(root, '.gitattributes'), path.join(repo, '.gitattributes'));
    const ordner = path.join(repo, 'data/historical/german-cpi-chain/jahre/2026');
    fs.mkdirSync(ordner, { recursive: true });
    fs.copyFileSync(path.join(root, 'data/historical/.gitattributes'), path.join(repo, 'data/historical/.gitattributes'));
    const dateien = {
        'rohantwort.html': Buffer.from('<table>\r\n<tr><td>2026</td></tr>\r\n</table>\r\n', 'utf8'),
        'rohauszug.csv': Buffer.from('Jahr;Wert\r\n2025;1,0\n2026;2,0\r\n', 'utf8'),
        'lieferung.json': Buffer.from('{\r\n  "jahr": 2026\r\n}\r\n', 'utf8')
    };
    for (const [name, bytes] of Object.entries(dateien)) fs.writeFileSync(path.join(ordner, name), bytes);
    git(repo, ['add', '.']);
    git(repo, ['commit', '-q', '-m', 'Lieferung']);
    for (const [name, bytes] of Object.entries(dateien)) {
        const blob = execFileSync('git', ['show', `HEAD:data/historical/german-cpi-chain/jahre/2026/${name}`], { cwd: repo, env });
        assertEqual(sha256(blob), sha256(bytes), `${name}: gespeicherter Inhalt ist bytegleich`);
        fs.rmSync(path.join(ordner, name));
    }
    git(repo, ['checkout', '--', '.']);
    for (const [name, bytes] of Object.entries(dateien)) {
        assertEqual(sha256(fs.readFileSync(path.join(ordner, name))), sha256(bytes), `${name}: ausgecheckte Datei ist bytegleich`);
    }
} finally {
    fs.rmSync(repo, { recursive: true, force: true });
}

console.log('✅ Jahresdaten gitattributes tests passed');
