// JD-2a Nachtrag Punkt 3: Gegenprobe mit einem erfundenen Folgejahr (Profil „schwer“). In einer Wegwerfkopie werden
// Lieferungen für Endjahr + 1 angelegt, geprüft und übernommen. Danach müssen Bauskripte, Generator und Sollwerte den
// Stand reproduzieren, und alle jahresabhängigen Tests müssen in der Kopie grün sein: Klasse 1 vergleicht 1925–2025,
// Klasse 2 liest den Datenstand, Klasse 3 ist neu erzeugt oder rechnet eingefroren auf dem Grundbestand. Die volle
// Live-Rechnung prüfen jahresdaten-live-sollwerte (Backtests bis zum neuen Endjahr), mc-worker-contract (Test 5) und
// worker-parity (Test 9).
// Die Slice-14/15-Belege nutzen den Grundbestand über den Import-Adapter. Die drei Slice-Belege lesen die Git-Historie
// über das ausdrücklich gesetzte GIT_DIR und prüfen Dateien in der Wegwerfkopie. Schreibende Git-Tests sind ausgeschlossen.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KETTEN } from '../scripts/lib/jahresdaten/ketten.mjs';
import { GRUNDBESTAND, grundbestandRecords } from '../scripts/lib/jahresdaten/grundbestand.mjs';
import { HISTORICAL_DATENSTAND } from '../app/simulator/simulator-data.js';
import { computeHistoricalDatasetHash } from '../app/simulator/historical-backtest-contract.js';
import { erfundeneLieferungenSchreiben } from './helpers/jahresdaten-gegenprobe.mjs';
import { GIT_SCHREIBENDE_TESTS, gitFreieUmgebung } from './helpers/git-isoliert.mjs';

console.log('--- Jahresdaten: Gegenprobe mit erfundenem Folgejahr ---');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JAHR = HISTORICAL_DATENSTAND.endYear + 1;
const GIT_LESENDE_BELEGE = new Set(['backtest-data-validation-slice-14.test.mjs',
    'backtest-data-validation-slice-15.test.mjs', 'backtest-data-validation-slice-16.test.mjs']);
const AUSGENOMMEN = new Set(['jahresdaten-gegenprobe.test.mjs', 'simulator-backtest-characterization.test.mjs', ...GIT_SCHREIBENDE_TESTS]);
const KLASSE_1_2 = ['historical-data-manifest', 'historical-data-generate', 'historical-end-year', 'german-cpi-current-table',
    'historical-data-mc-preflight', 'simulation-data-inventory', 'historical-data-jahresneutral', 'file-size-gate',
    'global-equity-research-chain', 'german-cpi-chain', 'german-cash-money-market-chain', 'german-gross-wage-growth-chain',
    'gold-german-investor-chain', 'us-shiller-cape-chain', 'global-equity-source-reconstruction', 'german-cpi-source-reconstruction',
    'gold-german-investor-independent-oracle', 'german-gross-wage-independent-oracle', 'us-shiller-cape-independent-oracle',
    'muster-haushalt-simulator', 'profilverbund-bond-ownership', 'log-analysis-muster-backtest', 'simulator-headless',
    'ff-e-regression', 'plan-view-income', 'simulator-ui-orchestration', 'jahresdaten-ketten', 'jahresdaten-lieferung',
    'jahresdaten-pruefen', 'jahresdaten-uebernahme', 'jahresdaten-live-sollwerte', 'mc-worker-contract', 'worker-parity',
    'jahresdaten-live-stand'].map(name => `${name}.test.mjs`);

/** Jahresabhängige Testdateien: feste Liste plus alle, die die Grundbestandssicht nutzen. */
function testliste() {
    const tests = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.mjs'));
    const sicht = tests.filter(name => /helpers\/grundbestand-(sicht|stichprobe)/.test(fs.readFileSync(path.join(root, 'tests', name), 'utf8')));
    return [...new Set([...KLASSE_1_2, ...GIT_LESENDE_BELEGE, ...sicht])].filter(name => !AUSGENOMMEN.has(name) && tests.includes(name)).sort();
}

/** Git-Metadaten des Ausgangsstands und Arbeitsdateien der Kopie für die lesenden Belege. */
function gitUmgebung(kopie) {
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
        cwd: root, encoding: 'utf8', env: gitFreieUmgebung()
    }).trim();
    return { GIT_DIR: gitDir, GIT_WORK_TREE: kopie, GIT_OPTIONAL_LOCKS: '0' };
}

function einzeltest(kopie, name, gitEnv) {
    return new Promise(resolve => {
        const env = gitFreieUmgebung(process.env, GIT_LESENDE_BELEGE.has(name) ? gitEnv : {});
        const kind = spawn(process.execPath, ['tests/run-single.mjs', `tests/${name}`], { cwd: kopie, env: { ...env, TEST_PROFIL: 'schnell' } });
        let ausgabe = '';
        kind.stdout.on('data', chunk => { ausgabe += chunk; });
        kind.stderr.on('data', chunk => { ausgabe += chunk; });
        kind.on('close', code => resolve({ name, code, ausgabe }));
    });
}

async function alleTests(kopie, namen, gitEnv, parallel = 4) {
    const offen = [...namen], ergebnisse = [];
    await Promise.all(Array.from({ length: parallel }, async () => {
        while (offen.length) ergebnisse.push(await einzeltest(kopie, offen.shift(), gitEnv));
    }));
    return ergebnisse.sort((a, b) => a.name.localeCompare(b.name));
}

const kopie = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresdaten-gegenprobe-'));
try {
    fs.cpSync(root, kopie, { recursive: true, filter: quelle => !['.git', 'node_modules', '.testlauf', 'auftrag'].includes(path.relative(root, quelle)) });
    fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(kopie, 'node_modules'));
    const lauf = args => spawnSync(process.execPath, args, { cwd: kopie, encoding: 'utf8', env: gitFreieUmgebung() });

    console.log(`Test 1: erfundenes ${JAHR} prüfen und übernehmen`);
    erfundeneLieferungenSchreiben(kopie, JAHR);
    const pruefen = lauf(['scripts/jahresdaten.mjs', String(JAHR), '--pruefen']);
    assertEqual(pruefen.status, 0, `--pruefen ${JAHR} ist grün: ${pruefen.stdout}${pruefen.stderr}`);
    const uebernehmen = lauf(['scripts/jahresdaten.mjs', String(JAHR), '--uebernehmen']);
    assertEqual(uebernehmen.status, 0, `--uebernehmen ${JAHR} läuft durch: ${uebernehmen.stdout}${uebernehmen.stderr}`);
    assert(uebernehmen.stdout.includes('Nächster Schritt: Prüfkette, Messung MC 2.000 Pfade alt/neu, Backtest, Abnahme'), 'Übernahme nennt den nächsten Schritt');

    console.log('Test 2: Datenstand, Lieferungen und Grundbestand');
    const { default: stand } = await import(`${new URL(`file://${path.join(kopie, 'app/simulator/historical-datenstand.js')}`).href}`);
    const { HISTORICAL_DATA: daten } = await import(`${new URL(`file://${path.join(kopie, 'app/simulator/historical-data-records.js')}`).href}`);
    assertEqual(stand.endYear, JAHR, 'Endjahr des Datenstands');
    assertEqual(stand.revision, `${JAHR}-1`, 'Revision <Y>-1');
    for (const { seriesId } of KETTEN.map(modul => modul.KETTE)) {
        assert(stand.seriesHashes[seriesId].lieferungen.some(eintrag => eintrag.jahr === JAHR && /^[a-f0-9]{64}$/.test(eintrag.sha256)), `${seriesId}: Lieferung ${JAHR} mit SHA-256 im Datenstand`);
        assertEqual(stand.seriesHashes[seriesId].rawDataHash, HISTORICAL_DATENSTAND.seriesHashes[seriesId].rawDataHash, `${seriesId}: Rohdaten-Hash bleibt der Hash über die Originale`);
    }
    assertEqual(computeHistoricalDatasetHash(grundbestandRecords(daten)), GRUNDBESTAND.contentHash, 'Jahre 1925–2025 unverändert (Inhaltshash des Grundbestands)');

    console.log('Test 3: Bauskripte, Generator und Sollwerte reproduzieren den Stand');
    for (const skript of ['build-german-cpi-chain.mjs', 'build-german-gross-wage-growth-chain.mjs', 'build-gold-german-investor-chain.mjs', 'build-us-shiller-cape-chain.mjs']) {
        const ergebnis = lauf([`scripts/${skript}`, '--verify-only']);
        assertEqual(ergebnis.status, 0, `${skript} --verify-only übernimmt die angehängten Jahre aus den Lieferungen: ${ergebnis.stderr}`);
    }
    const aktienModul = path.join(kopie, 'app/simulator/global-equity-research-chain.js');
    const aktienVorher = fs.readFileSync(aktienModul, 'utf8');
    assertEqual(lauf(['scripts/build-global-equity-research-chain.mjs']).status, 0, 'Aktien-Bauskript läuft');
    assert(fs.readFileSync(aktienModul, 'utf8') === aktienVorher, 'Aktien-Bauskript schreibt dieselbe Ausgabe samt angehängtem Jahr');
    const cpiLieferung = path.join(kopie, 'data/historical/german-cpi-chain/jahre', String(JAHR), 'lieferung.json');
    const cpiModul = path.join(kopie, 'app/simulator/german-cpi-chain.js');
    const lieferungVorher = fs.readFileSync(cpiLieferung), modulVorher = fs.readFileSync(cpiModul, 'utf8');
    fs.writeFileSync(cpiLieferung, JSON.stringify({ ...JSON.parse(lieferungVorher.toString('utf8')), werte: { jahresrate: 4.1, indexstand: 127.0 } }));
    const umgeschrieben = lauf(['scripts/build-german-cpi-chain.mjs']);
    assert(umgeschrieben.status !== 0 && `${umgeschrieben.stderr}`.includes('weicht vom übernommenen Stand ab'), 'Bau bricht ab, wenn eine übernommene Lieferung nachträglich geändert ist');
    assert(fs.readFileSync(cpiModul, 'utf8') === modulVorher, 'Abgebrochener Bau schreibt die Kette nicht um');
    fs.writeFileSync(cpiLieferung, lieferungVorher);
    assertEqual(lauf(['scripts/historical-data-generate.mjs', '--verify-only']).status, 0, 'Generator: Module aktuell');
    assertEqual(lauf(['scripts/jahresdaten-sollwerte.mjs', '--pruefen']).status, 0, 'Sollwerte sind neu erzeugt');

    console.log('Test 4: jahresabhängige Tests in der Kopie');
    const namen = testliste();
    assert(namen.length >= 40, `Mindestens 40 jahresabhängige Testdateien (${namen.length})`);
    for (const { name, code, ausgabe } of await alleTests(kopie, namen, gitUmgebung(kopie))) {
        assertEqual(code, 0, `${name} grün mit ${JAHR}${code ? `: ${ausgabe.split('\n').filter(line => /Error|FAIL/.test(line)).slice(0, 3).join(' | ')}` : ''}`);
    }
} finally {
    fs.rmSync(kopie, { recursive: true, force: true });
}

console.log('✅ Jahresdaten Gegenprobe tests passed');
