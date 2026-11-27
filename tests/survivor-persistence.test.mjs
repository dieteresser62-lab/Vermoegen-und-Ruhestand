import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { switchProfile } from '../app/profile/profile-storage.js';
import { isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { readWidowOptions } from '../app/simulator/simulator-input-pension.js';
import { HOUSEHOLD_WIDOW_KEY } from '../app/simulator/simulator-household-widow-persistence.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
let records = {};
const makeDocument = () => {
    const doc = createSelectionDocument();
    doc.addEventListener = () => {};
    for (const [id, value] of [['survivorFloorPercent', '75'], ['survivorFlexPercent', '50'], ['survivorMinimumFlexPercent', '50']]) addField(doc, id, value);
    // HL-1 (H-10): Vorgaben wie in Simulator.html.
    addField(doc, 'widowPensionMode', 'percent', [['stop', 'Rente endet vollständig'], ['percent', 'Prozentregel']]);
    for (const [id, value] of [['widowPensionPct', '55'], ['widowMarriageOffsetYears', '0'], ['widowMinMarriageYears', '1']]) addField(doc, id, value);
    addField(doc, 'displayPortfolioBreakdown', '');
    return doc;
};
async function loadRecords(initialRecords = {}) {
    records = initialRecords;
    PersistenceFacade.resetPersistenceForTests({ name: 'synthetic-survivor-percent', async init() {},
        async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => delete records[key]);
            upserts.forEach(([key, value]) => { records[key] = value; });
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}

try {
    await loadRecords();
    globalThis.window = {};
    globalThis.document = makeDocument();
    initInputPersistence();
    assertEqual(readWidowOptions().survivorFloorPercent, 75, 'FR-55: ohne Altbestand zeigt der Simulator 75 %');
    assertEqual(readWidowOptions().survivorFlexPercent, 50, 'FR-55: Wunsch-Flex startet mit 50 %');
    assertEqual(readWidowOptions().survivorMinimumFlexPercent, 50, 'FR-55: Mindest-Flex startet mit 50 %');
    for (const id of ['survivorFlexPercent', 'survivorMinimumFlexPercent']) {
        const flexField = document.getElementById(id);
        flexField.value = '0'; flexField.dispatchEvent({ type: 'input' });
    }
    const field = document.getElementById('survivorFloorPercent');
    field.value = '150'; field.dispatchEvent({ type: 'input' });
    await PersistenceFacade.flush();
    assertEqual(persistenceStorage.getItem('sim_survivorFloorPercent'), '150', 'FR-21: Eingabe speichert über die vorhandene Persistenz');
    assertEqual(records.sim_survivorFloorPercent, '150', 'FR-21: Backend erhält den Feldwert');
    globalThis.document = makeDocument();
    initInputPersistence();
    assertEqual(readWidowOptions().survivorFloorPercent, 150, 'FR-21: Seitenreload stellt den Anteil wieder her');
    for (const id of ['survivorFlexPercent', 'survivorMinimumFlexPercent']) {
        assertEqual(readWidowOptions()[id], 0, 'FR-55: gespeicherte Null bleibt nach Reload erhalten');
        assertEqual(records['sim_' + id], '0', 'FR-55: Backend erhält den Flex-Anteil');
    }
    persistenceStorage.setItem('sim_survivorFloorPercent', '70');
    globalThis.document = makeDocument(); initInputPersistence();
    assertEqual(readWidowOptions().survivorFloorPercent, 70, 'FR-55: gespeicherte 70 % bleiben erhalten');

    // HL-1 (H-10): Helga und Werner tragen „Rente endet“ bzw. 0 % ein; nach dem Seitenwechsel gilt nicht still wieder 55 %.
    assertEqual(JSON.stringify(readWidowOptions().widowOptions), JSON.stringify({ mode: 'percent', percent: .55, marriageOffsetYears: 0, minMarriageYears: 1 }),
        'H-10: ohne gespeicherten Wert gilt die Formularvorgabe');
    for (const [id, value] of [['widowPensionMode', 'stop'], ['widowPensionPct', '0'], ['widowMarriageOffsetYears', '3'], ['widowMinMarriageYears', '2']]) {
        const widowField = document.getElementById(id);
        widowField.value = value; widowField.dispatchEvent({ type: 'change' });
    }
    await PersistenceFacade.flush();
    const widowRecord = JSON.parse(records[HOUSEHOLD_WIDOW_KEY]);
    assertEqual(widowRecord.values.widowPensionMode, 'stop', 'H-10: Verhalten bei Todesfall wird gespeichert');
    assertEqual(widowRecord.values.widowPensionPct, '0', 'H-10: 0 % wird gespeichert');
    assertEqual(records.sim_widowPensionMode, undefined, 'HL-1b: neue Eingaben gehören nicht ins Personenprofil');
    assert(isAllowedSnapshotCaptureKey(HOUSEHOLD_WIDOW_KEY), 'HL-1b: Rückkehrpunkte erfassen die Haushaltswerte');
    globalThis.document = makeDocument(); initInputPersistence();
    assertEqual(JSON.stringify(readWidowOptions().widowOptions), JSON.stringify({ mode: 'stop', percent: 0, marriageOffsetYears: 3, minMarriageYears: 2 }),
        'H-10: Seitenwechsel stellt alle vier Witwenrentenfelder wieder her');

    await loadRecords(createMusterHaushaltRecords('2026-10-28', 'helga-werner'));
    globalThis.document = makeDocument(); initInputPersistence();
    assertEqual(persistenceStorage.getItem('rs_current_profile'), 'muster_helga', 'HL-1b: Helga ist aktiv');
    const mode = document.getElementById('widowPensionMode');
    mode.value = 'stop'; mode.dispatchEvent({ type: 'change' });
    for (const id of ['muster_werner', 'muster_helga']) {
        assertEqual(switchProfile(id), true, `HL-1b: Personenwechsel zu ${id}`);
        assertEqual(persistenceStorage.getItem('rs_current_profile'), id, `HL-1b: ${id} ist aktiv`);
        globalThis.document = makeDocument(); initInputPersistence();
        assertEqual(document.getElementById('widowPensionMode').value, 'stop', `HL-1b: Rente endet auch mit ${id} aktiv`);
    }
    await PersistenceFacade.flush();
    assert(validatePersistenceDomainRecords(records).ok, 'HL-1b: Vollsicherung akzeptiert den Haushaltsdatensatz');

    for (const wernerHasLegacy of [true, false]) {
        const legacyRecords = createMusterHaushaltRecords('2026-10-28', 'helga-werner');
        const registry = JSON.parse(legacyRecords.rs_profiles_v1);
        Object.assign(registry.profiles.muster_helga.data, { sim_widowPensionMode: 'stop', sim_widowPensionPct: '23' });
        if (wernerHasLegacy) registry.profiles.muster_werner.data.sim_widowPensionPct = '40';
        legacyRecords.rs_profiles_v1 = JSON.stringify(registry);
        await loadRecords(legacyRecords);
        assertEqual(switchProfile('muster_werner'), true, 'HL-1b: Altbestand zuerst mit Werner öffnen');
        if (wernerHasLegacy) persistenceStorage.setItem('sim_widowPensionPct', '0');
        globalThis.document = makeDocument(); initInputPersistence();
        const expectedMode = wernerHasLegacy ? 'percent' : 'stop';
        const expectedPct = wernerHasLegacy ? 0 : .23;
        assertEqual(readWidowOptions().widowOptions.mode, expectedMode, 'HL-1b: aktive Altwerte haben Vorrang vor der ersten Person');
        assertEqual(readWidowOptions().widowOptions.percent, expectedPct, 'HL-1b: Livewert der aktiven oder Altwert der ersten Person gilt');
        await PersistenceFacade.flush();
        assert(records[HOUSEHOLD_WIDOW_KEY], 'HL-1b: Altwerte wurden einmalig im Haushalt gespeichert');
        assertEqual(switchProfile('muster_helga'), true, 'HL-1b: Altbestand danach mit Helga öffnen');
        globalThis.document = makeDocument(); initInputPersistence();
        assertEqual(readWidowOptions().widowOptions.mode, expectedMode, 'HL-1b: Haushaltswert hat Vorrang vor dem gewechselten Profil');
        assertEqual(readWidowOptions().widowOptions.percent, expectedPct, 'HL-1b: übernommener Prozentsatz bleibt erhalten');
    }
} finally {
    PersistenceFacade.resetPersistenceForTests();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
}
