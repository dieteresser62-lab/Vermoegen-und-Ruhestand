// JD-2b Nachtrag 2: Wächter gegen geerbtes GIT_DIR. Die Gegenprobe setzte in einem normalen Klon GIT_DIR, und
// jahresdaten-gitattributes schrieb daraufhin Config und einen Commit in das Eltern-Repo. Hier laufen alle Tests, die
// ein eigenes Git-Repo anlegen, mit GIT_DIR auf ein Wegwerf-Eltern-Repo. Danach müssen dessen Config und HEAD unverändert sein.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_SCHREIBENDE_TESTS, eigenesRepoPruefen, gitFreieUmgebung } from './helpers/git-isoliert.mjs';

console.log('--- Git-Isolation der Tests mit eigenem Repo ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frei = gitFreieUmgebung(process.env, { GIT_OPTIONAL_LOCKS: '0' });
const git = (cwd, args, env = frei) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

console.log('Test 1: Umgebung ohne GIT_*-Variablen');
const bereinigt = gitFreieUmgebung({ PATH: '/bin', GIT_DIR: '/x', GIT_WORK_TREE: '/y', GIT_INDEX_FILE: 'i', GIT_OBJECT_DIRECTORY: 'o',
    GIT_COMMON_DIR: 'c', GIT_CEILING_DIRECTORIES: '/', GIT_NAMESPACE: 'n', GIT_OPTIONAL_LOCKS: '0' }, { HOME: '/h' });
assertEqual(JSON.stringify(bereinigt), JSON.stringify({ PATH: '/bin', HOME: '/h' }), 'alle geerbten GIT_*-Variablen entfernt');

console.log('Test 2: Jeder Test mit eigenem Git-Repo nutzt die Isolation');
const alleTests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.mjs'));
const schreibend = alleTests.filter(name => {
    const text = fs.readFileSync(path.join(root, 'tests', name), 'utf8');
    return /['"]git['"]/.test(text) && /['"](init|commit|config)['"]/.test(text) && name !== 'git-isolation.test.mjs';
}).sort();
assertEqual(JSON.stringify(schreibend), JSON.stringify([...GIT_SCHREIBENDE_TESTS].sort()), 'Liste der schreibenden Git-Tests ist vollständig');
for (const name of GIT_SCHREIBENDE_TESTS) {
    const text = fs.readFileSync(path.join(root, 'tests', name), 'utf8');
    assert(text.includes('gitFreieUmgebung(') && text.includes('eigenesRepoPruefen('), `${name}: entfernt GIT_* und prüft das eigene Repo`);
}

const eltern = fs.mkdtempSync(path.join(os.tmpdir(), 'git-isolation-eltern-'));
const fremd = fs.mkdtempSync(path.join(os.tmpdir(), 'git-isolation-fremd-'));
try {
    git(eltern, ['init', '-q']);
    fs.writeFileSync(path.join(eltern, 'README.md'), 'Eltern\n');
    git(eltern, ['add', 'README.md']);
    git(eltern, ['-c', 'user.name=Eltern', '-c', 'user.email=eltern@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'Eltern']);
    const stand = () => ({ config: git(eltern, ['config', '--local', '--list']), head: git(eltern, ['rev-parse', 'HEAD']),
        anzahl: git(eltern, ['rev-list', '--count', '--all']) });
    const vorher = stand();
    const projektVorher = git(root, ['config', '--local', '--list'], { ...process.env, GIT_OPTIONAL_LOCKS: '0' });

    console.log('Test 3: eigenesRepoPruefen bricht bei geerbtem GIT_DIR ab');
    let abgebrochen = false;
    try { eigenesRepoPruefen(fremd, { ...frei, GIT_DIR: path.join(eltern, '.git') }); } catch (error) { abgebrochen = /nicht im Temp-Repo/.test(error.message); }
    assert(abgebrochen, 'Prüfung erkennt das fremde Repo');

    console.log('Test 4: Schreibende Git-Tests mit GIT_DIR auf ein Wegwerf-Eltern-Repo');
    for (const name of GIT_SCHREIBENDE_TESTS) {
        const lauf = spawnSync(process.execPath, ['tests/run-single.mjs', `tests/${name}`], { cwd: root, encoding: 'utf8',
            env: { ...frei, GIT_DIR: path.join(eltern, '.git'), TEST_PROFIL: 'schnell' } });
        assertEqual(lauf.status, 0, `${name}: grün mit gesetztem GIT_DIR${lauf.status ? `\n${`${lauf.stdout}${lauf.stderr}`.slice(-1500)}` : ''}`);
        assertEqual(JSON.stringify(stand()), JSON.stringify(vorher), `${name}: Config, HEAD und Commits des Eltern-Repos unverändert`);
    }
    assertEqual(git(root, ['config', '--local', '--list'], { ...process.env, GIT_OPTIONAL_LOCKS: '0' }), projektVorher, 'Config des Projekt-Repos unverändert');
} finally {
    fs.rmSync(eltern, { recursive: true, force: true });
    fs.rmSync(fremd, { recursive: true, force: true });
}
