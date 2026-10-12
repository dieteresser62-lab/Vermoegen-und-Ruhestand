import { overviewImportFixture, boundedImport } from './overview-close-dialog-import.test.mjs';
import { prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { CONFIG } from '../app/balance/balance-config.js';
import { loadProfilverbundProfiles, buildProfilverbundAssetSummary } from '../app/profile/profilverbund-balance.js';
import { calculateAggregatedValues } from '../app/tranches/depot-tranchen-status.js';
import { loadTranchesFromStorage } from '../app/tranches/tranchen-manager-state.js';
import { loadProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const entry = f => JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY)).wealthHistory.entries.find(item => item.asOf === '2026-10-08');
for (const options of [{}, { single: true }, { quoteAge: 604800 }, { quoteAge: 604801 }, { quoteAge: -1 }, { quoteAge: null }, { synthetic: true }, { noLots: true }]) {
    const f = await overviewImportFixture(options);
    try {
        await f.open(); const outside = JSON.stringify(JSON.parse(f.backend.get('rs_profiles_v1')).profiles.outside);
        const preview = f.capture.update({ mode: 'preview' });
        const expected = buildProfilverbundAssetSummary(loadProfilverbundProfiles());
        assertEqual(JSON.stringify(preview.inputData), JSON.stringify({ tagesgeld: expected.totalTagesgeld, geldmarktEtf: expected.totalGeldmarkt,
            depotwertAlt: expected.totalDepotAlt, depotwertNeu: expected.totalDepotNeu, detailledTranches: expected.mergedTranches }), 'Verbundkomponenten und vollständige Kursbelege entsprechen Balance-Verbundorakel');
        const before = f.batches.length;
        await f.csv();
        const saved = !options.synthetic && (options.noLots || options.quoteAge !== null && (options.quoteAge ?? 0) >= 0 && (options.quoteAge ?? 0) <= 604800);
        assertEqual(Boolean(entry(f)), saved, 'CSV-Erfassung folgt unveränderter Sieben-Tage-Regel: ' + JSON.stringify(options));
        const wealthBatches = f.batches.slice(before).filter(batch => batch.some(([key, raw]) => key === CONFIG.STORAGE.LS_KEY && raw.includes('manual:2026-10-08')));
        assertEqual(wealthBatches.length, saved ? 1 : 0, 'Genau eine Verlaufstransaktion bei erlaubter Erfassung');
        if (saved) {
            for (const key of ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu']) assertEqual(entry(f)[key], preview.inputData[key], 'Tagespunkt erhält Balance-Komponente ' + key);
            await f.csv();
            assertEqual(JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY)).wealthHistory.entries.filter(item => item.asOf === '2026-10-08').length, 1, 'Zweite gleiche Dateiauswahl ersetzt Tagespunkt gemäß Upsertvertrag');
        }
        assertEqual(JSON.stringify(JSON.parse(f.backend.get('rs_profiles_v1')).profiles.outside), outside, 'CSV-Folgejob erhält Außenprofil bytegleich');
    } finally { await f.close(); }
}
for (const failWealth of ['write', 'preview', 'readback']) {
    const f = await overviewImportFixture({ failWealth });
    try {
        await f.open(); await f.csv();
        assert(JSON.parse(f.backend.get('balance_expenses_v1')).years[2026].months[9].profiles.muster_a, 'Folgefehler erhält dauerhaft bestätigten Ausgabenrecord');
        assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Ausgaben importiert.'), 'Folgefehler erhält Importerfolgsstatus');
        assert(f.doc.getElementById('overviewExpensesWealthStatus').textContent.startsWith('Ausgaben importiert; Vermögensstand nicht bestätigt:'), 'Erfassungsfehler ausschließlich im Kanal expenses-wealth');
        assert(!entry(f), 'Fehler bestätigt keinen Vermögenspunkt');
    } finally { await f.close(); }
}
for (const action of ['one', 'all']) {
    const f = await overviewImportFixture({ probelauf: true });
    try {
        await f.open();
        const button = action === 'one' ? f.doc.querySelector('[data-overview-example-target="muster_a"]') : f.doc.querySelector('[data-overview-example="all"]');
        const before = f.backend.get(CONFIG.STORAGE.LS_KEY), job = button.fire('click');
        await f.waitPreview(job); await f.doc.querySelector('[data-expenses-preview-accept]').fire('click'); await boundedImport(job);
        const imported = JSON.parse(f.backend.get('balance_expenses_v1')).years[2026].months[9].profiles;
        assertEqual(imported.muster_a.source, 'probelauf-example', 'Beispielimport erhält Herkunft');
        assertEqual(f.backend.get(CONFIG.STORAGE.LS_KEY), before, 'Einzel-/Sammelbeispiel erzeugt keinen Vermögenspunkt');
    } finally { await f.close(); }
}
{
    const f = await overviewImportFixture();
    try {
        await f.open(); await prepareCloseFixture(f.doc);
        assertEqual(f.doc.querySelector('[data-overview-month-accept]').disabled, false, 'Besuche und Tagesgeldbestätigung geben den Monatsknopf vor dem CSV-Folgejob frei');
        const hold = f.holdWealth();
        const importJob = f.csv(); await boundedImport(hold.entered.promise);
        assert(f.guard.reasons().some(reason => reason.phase === 'commit'), 'Laufender CSV-Folgejob besitzt eigene Commitlease');
        const dialog = f.doc.getElementById('overviewMonthConfirmation'); await dialog.fire('cancel'); assert(dialog.open, 'CSV-Erfassungscommit sperrt Dialogschließen');
        const provisionBefore = f.backend.get('overview_month_provision_v1');
        assert(f.doc.querySelector('[data-overview-month-accept]').disabled, 'CSV-Folgejob sperrt Abschlussaktionen bis zum Jobende');
        assert(f.backend.get('overview_month_provision_v1') === provisionBefore, 'Monatsabschluss wartet auf laufenden Erfassungsfolgejob');
        hold.release.resolve(); await boundedImport(importJob);
        assertEqual(f.doc.querySelector('[data-overview-month-accept]').disabled, false, 'Beendeter CSV-Folgejob erhält Besuche und Tagesgeldbestätigung und gibt den Monatsknopf erneut frei');
        const save = f.doc.querySelector('[data-overview-month-accept]').fire('click'); await boundedImport(save);
        assert(f.doc.getElementById('overviewMonthStatus').textContent.includes('September abgeschlossen ✓'), 'Monatsabschluss nach CSV-Folgejob ohne Eigenblockade');
        assertEqual(f.snapshots.size, 1, 'Genau ein Monatswiederherstellungspunkt nach Folgejob');
    } finally { await f.close(); }
}
for (const change of ['profile', 'household', 'date', 'source']) {
    const f = await overviewImportFixture();
    try {
        await f.open();
        const originalFlush = (await import('../app/shared/persistence-facade.js')).PersistenceFacade.flush;
        let entered = false;
        const P = (await import('../app/shared/persistence-facade.js')).PersistenceFacade;
        P.flush = async (...args) => {
            const lease = f.guard.reasons().find(reason => String(reason.owner).includes('balance-wealth-history'));
            if (lease && !entered) {
                entered = true;
                if (change === 'profile') { f.storage.setItem('rs_current_profile', 'muster_b'); f.storage.setItem('rs_active_profile', 'muster_b'); }
                if (change === 'household') { const registry = JSON.parse(f.storage.getItem('rs_profiles_v1')); registry.profiles.muster_b.meta.belongsToHousehold = false; f.storage.setItem('rs_profiles_v1', JSON.stringify(registry)); }
                if (change === 'source') f.storage.setItem('profile_tagesgeld', '19000');
                if (change === 'date') setAppTestDate('2026-10-09');
            }
            return originalFlush(...args);
        };
        try { await f.csv(); } finally { P.flush = originalFlush; }
        assert(entered, 'Kontextmutation erreicht tatsächliche Erfassungsvorbereitung');
        assert(!entry(f), 'Veraltete Erfassung verhindert: ' + change);
    } finally { await f.close(); }
}

{
    const f = await overviewImportFixture({ unselected: true });
    try {
        const preview = f.capture.update({ mode: 'preview' }), lots = loadTranchesFromStorage(f.storage), totals = calculateAggregatedValues(lots.tranches);
        assertEqual(JSON.stringify(preview.inputData), JSON.stringify({ tagesgeld: loadProfileAssetValues(f.storage).tagesgeld,
            geldmarktEtf: totals.geldmarktEtf, depotwertAlt: totals.depotwertAlt, depotwertNeu: totals.depotwertNeu, detailledTranches: lots.tranches }), 'Einzelprofilkomponenten und vollständige Kursbelege entsprechen Balance-Leseraggregaten');
    } finally { await f.close(); }
}
