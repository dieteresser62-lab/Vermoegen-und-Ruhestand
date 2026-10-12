import { overviewImportFixture } from './overview-close-dialog-import.test.mjs';
import { bindManagerWealthCapture } from '../app/tranches/tranchen-history-wealth-capture.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { createBalanceWealthHistoryPreview } from '../app/balance/balance-wealth-history-preview.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

for (const options of [{}, { quoteAge: 604800 }, { quoteAge: 604801 }, { quoteAge: null }, { noLots: true }, { failWealth: 'write' }, { failWealth: 'readback' }]) {
    const f = await overviewImportFixture(options);
    try {
        for (const id of ['managerCaptureWealthBtn', 'managerWealthStatus']) {
            const node = f.doc.createElement(id.includes('Btn') ? 'button' : 'p'); node.id = id; f.doc.body.append(node);
        }
        let refreshes = 0;
        const api = bindManagerWealthCapture(f.doc, { refresh: () => { refreshes++; } });
        assertEqual(bindManagerWealthCapture(f.doc), api, 'Erfassungsknopf wird nur einmal gebunden');
        const original = f.backend.get(CONFIG.STORAGE.LS_KEY);
        const saved = !options.failWealth && (options.noLots || options.quoteAge !== null && (options.quoteAge ?? 0) <= 604800);
        await f.doc.getElementById('managerCaptureWealthBtn').fire('click');
        const live = JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY));
        assertEqual(live.wealthHistory.entries.some(entry => entry.id === 'manual:2026-10-08'), saved, 'Managerklick folgt sieben Tagen, fehlendem Beleg und kursfreiem Bestand');
        assertEqual(refreshes, 1, 'Bestätigte Erfassung und Ablehnung erneuern die Anzeige');
        const message = f.doc.getElementById('managerWealthStatus').textContent;
        assertEqual(message.includes('Vermögensstand gesichert'), saved, 'Speicherfehler und abgelehnte Kurse melden keinen Erfolg');
        if (!saved) assertEqual(f.backend.get(CONFIG.STORAGE.LS_KEY), original, 'Abgelehnte Erfassung und Rollback erhalten alte Historie');
        else {
            const annualCount = live.wealthHistory.entries.filter(entry => entry.reason === 'annual_close').length;
            await api.capture();
            const second = JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY));
            assertEqual(second.wealthHistory.entries.filter(entry => entry.id === 'manual:2026-10-08').length, 1, 'Erfassung am gleichen Tag ersetzt genau einen Tagesstand');
            if (!options.quoteAge) {
                setAppTestDate('2026-10-09'); await api.capture();
                const third = JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY));
                assert(third.wealthHistory.entries.some(entry => entry.id === 'manual:2026-10-09'), 'Anderes Datum ergänzt einen weiteren Stand');
            }
            const confirmed = f.backend.get(CONFIG.STORAGE.LS_KEY);
            const registry = JSON.parse(f.backend.get('rs_profiles_v1'));
            assertEqual(registry.profiles.muster_a.data[CONFIG.STORAGE.LS_KEY], confirmed, 'Livezustand und aktive Registrykopie stimmen exakt überein');
            assertEqual(JSON.parse(confirmed).wealthHistory.entries.filter(entry => entry.reason === 'annual_close').length, annualCount, 'Manuelle Stände erhalten vorhandene Jahresstände');
            await f.restart();
            assertEqual(PersistenceFacade.getItemSync(CONFIG.STORAGE.LS_KEY), confirmed, 'Erfasster Stand übersteht echten Backendreload');
            const preview = createBalanceWealthHistoryPreview({ doc: f.doc, win: f.win }).update({ mode: 'preview' });
            assert(preview.ok && Number.isFinite(preview.inputData.tagesgeld), 'Manager-Vorschau liest bestätigte Quellen auch nach Reload');
        }
    } finally { await f.close(); }
}
