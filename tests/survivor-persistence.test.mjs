import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { readWidowOptions } from '../app/simulator/simulator-input-pension.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;
let records = {};
const makeDocument = () => {
    const doc = createSelectionDocument();
    doc.addEventListener = () => {};
    for (const [id, value] of [['survivorFloorPercent', '75'], ['survivorFlexPercent', '50'], ['survivorMinimumFlexPercent', '50']]) addField(doc, id, value);
    addField(doc, 'displayPortfolioBreakdown', '');
    return doc;
};
try {
    PersistenceFacade.resetPersistenceForTests({ name: 'synthetic-survivor-percent', async init() {},
        async loadAll() { return { ...records }; },
        async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => delete records[key]);
            upserts.forEach(([key, value]) => { records[key] = value; });
        } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
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
} finally {
    PersistenceFacade.resetPersistenceForTests();
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
}
