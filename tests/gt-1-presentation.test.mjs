import fs from 'node:fs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { initializeProbelaufPage } from '../app/shared/probelauf-state.js';
import { PROBELAUF_RESTORE_HINT } from '../app/shared/probelauf-runtime.js';
import { confirmProfileDeletion, applyProfileManagementAction } from '../app/profile/profile-manager-bindings.js';
import { SnapshotArchive } from '../app/shared/snapshot-archive.js';
import { projectDataModel } from '../app/data/data-model.js';
import { renderDataPage } from '../app/data/data-renderer.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { inheritancePersonalAllowance } from '../app/profile/household-partnership.js';

const doc = createPresentationTestDocument();
for (const [, id] of fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8').matchAll(/\bid="([^"]+)"/g)) {
    const node = doc.createElement('div'); node.id = id; node.dataset = {}; doc.body.appendChild(node);
}
const create = doc.createElement.bind(doc);
doc.createElement = tag => { const node = create(tag); node.dataset = {}; return node; };
const descendants = node => [node, ...node.children.flatMap(descendants)];
const f = await playFixture('tauri', createMusterHaushaltRecords('2026-10-29', 'martin-petra'));
let controller = await f.boot();
await controller.start(async () => ({ source: 'demo', householdId: 'martin-petra', testDate: '2026-10-29' }));
await f.boot();
controller = await initializeProbelaufPage({ doc, win: f.win });
assert(controller.state?.active, 'Echter Spielbereich aktiv');
let description;
assert(await confirmProfileDeletion('muster_petra', text => { description = text; return true; }, { doc }), 'Löschrückfrage bestätigbar');
assert(description.includes(PROBELAUF_RESTORE_HINT) && !description.includes('Vollsicherung'), 'Spielbereich-Rückfrage verlangt keine gesperrte Vollsicherung');
// SV-1: Der Spielbereich zeigt keine Punkte; außerhalb erscheint jeder Punkt mit „Zurückholen …“.
const point = await SnapshotArchive.createSnapshot({ kind: 'monthly-close-pre-mutation', label: 'Monatsabschluss 2026-09', activeProfileId: 'muster_petra',
    records: SnapshotArchive.captureCurrentRecords({ keys: () => P.keysSync(), getItem: key => P.getItemSync(key) }) });
applyProfileManagementAction({ kind: 'delete', profileId: 'muster_petra' }); await P.flush();
assert(!JSON.parse(P.getItemSync('rs_profiles_v1')).profiles.muster_petra, 'Petra aus dem Beispielhaushalt tatsächlich gelöscht');
const model = await projectDataModel({ records: await P.readPersistedRecords(() => true), snapshots: await SnapshotArchive.listSnapshots() });
renderDataPage(doc, model);
let nodes = descendants(doc.getElementById('dataSnapshotList'));
assert(!nodes.some(node => node.dataset?.restorePoint), 'Spielbereich zeigt keinen Punkt');
assert(nodes.some(node => node.textContent === PROBELAUF_RESTORE_HINT), 'Grund steht in der Liste');
const outside = { ...model, trialActive: false };
renderDataPage(doc, outside);
nodes = descendants(doc.getElementById('dataSnapshotList'));
assert(nodes.some(node => node.dataset?.restorePoint === point.id && !node.disabled), 'Außerhalb ist der Punkt zurückholbar, auch nach Personenlöschung');
renderDataPage(doc, { ...outside, snapshots: [] });
assert(doc.getElementById('dataSnapshotList').children.some(node => node.textContent === 'Noch keine Wiederherstellungspunkte.'), 'Leere Liste erklärt fehlende Punkte');
await confirmProfileDeletion('muster_martin', text => { description = text; return false; }, { doc: {} });
assert(description.includes('Erstelle vorher eine Vollsicherung') && !description.includes(PROBELAUF_RESTORE_HINT), 'Rückfrage außerhalb erinnert an die Vollsicherung');

// Jahreszeilen aus vollständigen, reproduzierbaren Musterläufen; keine erfundenen Nachlasszeilen.
for (const householdId of ['martin-petra', 'max-erika']) {
    const inputs = await measurementInputs(0, householdId, '2026-10-29');
    const result = await runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parameters, anzahl: 8 }, widowOptions: inputs.widowOptions,
        useCapeSampling: false, runRange: { start: 0, count: 8 }, logIndices: Array.from({ length: 8 }, (_, i) => i) });
    assertEqual(result.batchStatus, 'completed', householdId + ': echte Läufe abgeschlossen');
    const rows = result.runMeta.flatMap(run => run.logDataRows);
    const death = rows.find(row => row.inheritance && row.inflation_factor_cum > 1);
    assert(death, householdId + ': protokollierter Todesfall mit Inflation vorhanden');
    const bytes = JSON.stringify(death), allowance = inheritancePersonalAllowance(inputs.partnership?.status);
    const money = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
    const options = { source: 'mc', inputs, startYear: 2026 };
    const real = renderProtocolTable([death], { ...options, moneyBasis: 'real' });
    const nominal = renderProtocolTable([death], { ...options, moneyBasis: 'nominal' });
    assert(real.includes(`Freibetrag ${money(allowance)} gilt nominal, in Euro von heute ${money(allowance / death.inflation_factor_cum)}.`), householdId + ': tatsächlicher Freibetrag mit Jahresfaktor im Erbe-ⓘ');
    assert(!nominal.includes('gilt nominal, in Euro von heute'), householdId + ': nominal ohne Zusatz');
    for (const difference of [0, .4, .6]) {
        const row = { ...death, inflation_factor_cum: allowance / (allowance - difference) };
        const html = renderProtocolTable([row], { ...options, moneyBasis: 'real' });
        // HP-4: Der steuerpflichtige Erwerb im Steuer-ⓘ hat einen eigenen Zusatz; geprüft wird der Satz zum Freibetrag.
        assertEqual(html.includes(`Freibetrag ${money(allowance)} gilt nominal, in Euro von heute`), difference > .5,
            `${householdId}: Freibetragshinweis nur bei Unterschied auf ganze Euro (${difference} Euro)`);
    }
    assertEqual(JSON.stringify(death), bytes, householdId + ': Rohzeile bytegleich');
}
