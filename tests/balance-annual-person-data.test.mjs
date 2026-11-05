import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
const previous = globalThis.document;
try {
    for (const [birth, age, fallback] of [['1958-01-01', 69, false], ['1958-03-14', 68, false], ['', 67, true]]) {
        const records = { profile_person_schema_version: '1', profile_geburtsdatum: birth, profile_aktuelles_alter: '67' };
        const before = JSON.stringify(records);
        PersistenceFacade.resetPersistenceForTests({ name: 'annual-person-fixture', async open() {}, async loadAll() { return { ...records }; }, async saveBatch() { throw new Error('UNEXPECTED_PERSON_WRITE'); } });
        await PersistenceFacade.init({ installLifecycleHooks: false });
        const { doc } = createDialogFixture(); globalThis.document = doc;
        const result = { targetYear: 2026, startTime: 1, endTime: 2, errors: [], age: { old: 67, new: 999 }, confirmed: true };
        const handlers = createAnnualModalHandlers({ getLastUpdateResults: () => result, isCommitActive: () => false });
        for (const show of [
            () => handlers.showAnnualPreparation({ targetYear: 2026, validatePrice: () => ({}) }),
            () => handlers.showAnnualContinuation({ targetYear: 2026 }),
            () => handlers.showUpdateResultModal(result),
            () => handlers.handleShowUpdateLog(true),
            () => handlers.showUpdateResultModal({ ...result, errors: [{ step: 'Retry', error: 'SYNTHETIC_RETRY' }] }),
            () => handlers.handleShowUpdateLog(true)
        ]) {
            show();
            const text = dialogElements(doc.getElementById('balanceAnnualClose')).map(node => node.textContent).join(' ');
            assert(text.includes('01.01.2027'), 'Jede produktive Ansicht nennt Folgeplanungsjahr');
            assert(text.includes(`${age}\u00a0Jahre`), 'Richtiger Januarwert statt gespeicherten +1');
            assert(!text.includes('999') && !text.includes('Alter +1'), 'Alt-Ergebnisfeld ist keine Altersquelle');
            if (fallback) assert(text.includes('hinterlegte Alter bleibt') && text.includes('ergänzen') && !text.includes('Aus dem Geburtsdatum abgeleitet'), 'Fallback bleibt unverändert ohne erfundene Ableitung');
            else assert(text.includes('Aus dem Geburtsdatum abgeleitet'), 'Geprüfte Datumsherkunft');
            assert(!/Recovery-Snapshot|\bATH\b|festes Altalter/.test(text), 'Sichtbare Jahresbegriffe verständlich');
        }
        await doc.getElementById('annualCloseBtn').fire('click');
        await PersistenceFacade.flush();
        assertEqual(JSON.stringify(records), before, 'Dialoghandler schreiben keine zentralen Personenbytes');
        assertEqual(persistenceStorage.getItem('profile_aktuelles_alter'), '67', 'Altalter bleibt über Öffnen/Retry/Protokoll unverändert');
    }
} finally { globalThis.document = previous; PersistenceFacade.resetPersistenceRuntimeForTests(); }
