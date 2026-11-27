// MS-1: Vorgabe Stationary Bootstrap mit Blocklänge 5; nur regime_markov ohne Merkmal „nutzer“ gilt als alte Vorgabe (MS-1b).
// Nur synthetische Daten (Beispielhaushalt Max und Erika, Testdatum 23.10.2026).
import { readFileSync } from 'node:fs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { MONTE_CARLO_DEFAULT_SAMPLING_METHOD, MONTE_CARLO_PARAMETER_LIMITS, normalizeMonteCarloParametersV1 } from '../app/simulator/monte-carlo-parameters.js';
import { MONTE_CARLO_METHOD_SOURCE_KEY, readStoredMonteCarloMethod } from '../app/simulator/monte-carlo-method-choice.js';
import { monteCarloMethodLabel, runLabel } from '../app/simulator/simulator-assumption-lines.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { overviewScope } from '../app/overview/overview-storage.js';

console.log('--- MS-1 Vorgabe Tests ---');

// Vorgabe im Code und auf der Seite.
{
    assertEqual(MONTE_CARLO_DEFAULT_SAMPLING_METHOD, 'stationary', 'Vorgabe im Code ist Stationary Bootstrap');
    const defaults = normalizeMonteCarloParametersV1();
    assertEqual(`${defaults.methode}/${defaults.blockSize}`, 'stationary/5', 'Rückfall ohne Angabe: Stationary Bootstrap, Blocklänge 5');
    assertEqual(MONTE_CARLO_PARAMETER_LIMITS.blockLengthYears.default, 5, 'Blocklänge 5 ist die Vorgabe');
    const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const select = html.match(/<select id="mcMethode"[^>]*>([\s\S]*?)<\/select>/)[1];
    const options = [...select.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)].map(m => [m[1], Boolean(m[2]), m[3]]);
    assertEqual(JSON.stringify(options[0]), JSON.stringify(['stationary', true, 'Stationary Bootstrap']), 'Seite: Stationary Bootstrap steht vorn und ist gewählt');
    assertEqual(options.filter(option => option[1]).length, 1, 'Seite: genau eine Option ist gewählt');
    assertEqual(options.find(option => option[0] === 'regime_markov')?.[2], 'Marktregime mit Übergängen (bisherige Vorgabe)', 'Seite: alte Methode bleibt wählbar und heißt „bisherige Vorgabe“');
    assert(/id="mcBlockSize" value="5"/.test(html), 'Seite: Blocklänge 5 im Feld');
    const info = html.match(/aria-controls="mcMethodInfo"[^>]*>ⓘ<\/button><span id="mcMethodInfo" class="ds-info-pop" role="tooltip">([^<]+)<\/span>/);
    assert(info, 'Seite: ⓘ als ds-info-Knopf an „Simulationsmethode“');
    assertEqual(info?.[1].split(/(?<=\.)\s+/).length, 2, 'ⓘ erklärt in zwei Sätzen');
    assert(/label[\s\S]{0,40}for="mcMethode">Simulationsmethode<\/label><span class="ds-info">/.test(html), 'ⓘ steht direkt an der Beschriftung');
}

// Beschriftung im Laufkopf: Name wie im Auswahlfeld, dazu die Blocklänge.
{
    assertEqual(runLabel('methode', 'stationary'), 'Stationary Bootstrap', 'RUN_LABELS heißt weiter „Stationary Bootstrap“');
    assertEqual(monteCarloMethodLabel('stationary', 5), 'Stationary Bootstrap, Blocklänge 5', 'Laufkopf nennt die Blocklänge');
    assertEqual(monteCarloMethodLabel('block', 3), 'Block-Bootstrap, Blocklänge 3', 'feste Blöcke nennen ihre Länge');
    assertEqual(monteCarloMethodLabel('regime_markov', 5), 'Marktregime mit Übergängen', 'Marktregime ohne Blocklänge');
}

// Lesen (MS-1b): nur regime_markov ohne Merkmal ist die alte Vorgabe; andere Werte stammen aus dem Formular und bleiben.
assertEqual(readStoredMonteCarloMethod('regime_markov', null), null, 'regime_markov ohne Merkmal: Vorgabe der Seite');
assertEqual(readStoredMonteCarloMethod('regime_markov', 'nutzer'), 'regime_markov', 'regime_markov mit Merkmal: gespeicherte Wahl');
assertEqual(readStoredMonteCarloMethod('block', null), 'block', 'block ohne Merkmal: gespeicherte Wahl');
assertEqual(readStoredMonteCarloMethod(null, null), null, 'kein Wert: Vorgabe der Seite');
const previous = { window: globalThis.window, document: globalThis.document };
try {
    for (const [stored, source, expected, label, blockSize = null] of [
        [null, null, 'stationary', 'kein Wert'],
        ['regime_markov', null, 'stationary', 'alte Vorgabe regime_markov ohne Merkmal'],
        ['block', null, 'block', 'block ohne Merkmal bleibt samt Blocklänge', '3'],
        ['stationary', null, 'stationary', 'stationary ohne Merkmal bleibt samt Blocklänge', '8'],
        ['regime_iid', null, 'regime_iid', 'regime_iid ohne Merkmal bleibt'],
        ['regime_markov', 'nutzer', 'regime_markov', 'regime_markov mit Merkmal'],
        ['block', 'nutzer', 'block', 'ausdrücklich gewählter Block-Bootstrap']]) {
        const records = createMusterHaushaltRecords('2026-10-23', 'max-erika');
        if (stored !== null) records.sim_mcMethode = stored;
        if (blockSize !== null) records.sim_mcBlockSize = blockSize;
        if (source !== null) records[MONTE_CARLO_METHOD_SOURCE_KEY] = source;
        const writes = [];
        PersistenceFacade.resetPersistenceForTests({ name: 'MS-1', async init() {}, async loadAll() { return { ...records }; },
            async saveBatch({ upserts }) { for (const [key] of upserts) writes.push(key); } });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        globalThis.document = simulatorDocument();
        globalThis.window = { addEventListener() {}, removeEventListener() {} };
        initInputPersistence();
        const method = document.getElementById('mcMethode');
        assertEqual(method.value, expected, `${label}: Methode im Feld`);
        assertEqual(document.getElementById('mcBlockSize').value, blockSize ?? '5', `${label}: Blocklänge im Feld`);
        await PersistenceFacade.flush();
        assertEqual(PersistenceFacade.getItemSync('sim_mcMethode'), stored, `${label}: gespeicherte Methode unverändert`);
        assertEqual(PersistenceFacade.getItemSync(MONTE_CARLO_METHOD_SOURCE_KEY), source, `${label}: Merkmal unverändert`);
        assertEqual(writes.filter(key => key.startsWith('sim_mc')).length, 0, `${label}: Lesen schreibt nichts`);
        if (label === 'alte Vorgabe regime_markov ohne Merkmal') {
            // Wahl im Formular: Methode und Merkmal werden geschrieben.
            method.value = 'regime_markov';
            method.dispatchEvent({ type: 'change' });
            assertEqual(PersistenceFacade.getItemSync('sim_mcMethode'), 'regime_markov', 'Wahl im Formular speichert die Methode');
            assertEqual(PersistenceFacade.getItemSync(MONTE_CARLO_METHOD_SOURCE_KEY), 'nutzer', 'Wahl im Formular setzt das Merkmal „nutzer“');
        }
    }
} finally { globalThis.window = previous.window; globalThis.document = previous.document; }

// Schlüsselpolitik, Vollsicherung und Import alter Sicherungen.
{
    assert(isAllowedPersistenceImportKey(MONTE_CARLO_METHOD_SOURCE_KEY), 'Merkmal gehört zur Schlüsselpolitik des Imports');
    assert(isAllowedSnapshotCaptureKey(MONTE_CARLO_METHOD_SOURCE_KEY), 'Merkmal gehört zum Wiederherstellungspunkt');
    assert(isProfileScopedKey(MONTE_CARLO_METHOD_SOURCE_KEY), 'Merkmal wandert mit dem Profil');
    const records = { ...createMusterHaushaltRecords('2026-10-23', 'max-erika'), sim_mcMethode: 'block', [MONTE_CARLO_METHOD_SOURCE_KEY]: 'nutzer' };
    const storage = { getItem: key => records[key] ?? null, key: index => Object.keys(records)[index] ?? null, get length() { return Object.keys(records).length; } };
    const backup = buildFullPersistenceBackup({ storage });
    assertEqual(backup.records[MONTE_CARLO_METHOD_SOURCE_KEY], 'nutzer', 'Vollsicherung enthält das Merkmal');
    const restored = normalizeFullPersistenceBackup(JSON.parse(JSON.stringify(backup)));
    assert(restored.ok, 'Vollsicherung mit Merkmal ist einspielbar');
    assertEqual(restored.backup?.records[MONTE_CARLO_METHOD_SOURCE_KEY], 'nutzer', 'Einspielen übernimmt das Merkmal');
    const oldRecords = createMusterHaushaltRecords('2026-10-23', 'max-erika');
    oldRecords.sim_mcMethode = 'regime_markov';
    assert(validatePersistenceDomainRecords(oldRecords).ok, 'alte Sicherung ohne Merkmal bleibt gültig');
    const oldStorage = { getItem: key => oldRecords[key] ?? null, key: index => Object.keys(oldRecords)[index] ?? null, get length() { return Object.keys(oldRecords).length; } };
    const oldBackup = normalizeFullPersistenceBackup(JSON.parse(JSON.stringify(buildFullPersistenceBackup({ storage: oldStorage }))));
    assert(oldBackup.ok && !(MONTE_CARLO_METHOD_SOURCE_KEY in oldBackup.backup.records), 'alte Sicherung ohne Merkmal wird eingespielt, nichts wird ergänzt');
}

// Übersicht: eine ausdrückliche Wahl ändert den Fingerprint der Monte-Carlo-Annahmen, auch wenn der gespeicherte Name gleich bleibt.
{
    const records = createMusterHaushaltRecords('2026-10-23', 'max-erika'), registry = JSON.parse(records.rs_profiles_v1);
    const scope = overviewScope('household', Object.keys(registry.profiles));
    const fingerprint = (extra = {}, kind = 'montecarlo') => {
        const copy = structuredClone(registry);
        for (const profile of Object.values(copy.profiles)) Object.assign(profile.data, extra);
        return sourceFingerprint({ registry: copy, activeId: records.rs_current_profile, liveData: { ...records, ...extra }, scope, kind });
    };
    const legacy = { sim_mcMethode: 'regime_markov' };
    assert(fingerprint(legacy) !== fingerprint({ ...legacy, [MONTE_CARLO_METHOD_SOURCE_KEY]: 'nutzer' }),
        'Wahl der bisherigen Methode macht ein Stationary-Ergebnis auf der Übersicht veraltet');
    assertEqual(fingerprint(legacy, 'balance'), fingerprint({ ...legacy, [MONTE_CARLO_METHOD_SOURCE_KEY]: 'nutzer' }, 'balance'),
        'Balance-Fingerprint bleibt vom Merkmal unberührt');
}

console.log('--- MS-1 Vorgabe Tests Completed ---');
