import { bindDataExchange } from './data-exchange.js';
import { initSuiteFrame } from '../shared/suite-frame.js';
import { initializeProfilePage } from '../profile/profile-navigation.js';
import { PersistenceFacade } from '../shared/persistence-facade.js';
import { bindFullBackupButton, bindFullBackupImport, assertFullBackupAllowed } from '../shared/persistence-backup.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { readDataModel } from './data-model.js';
import { bindDataRestoration, reportDataRestoration } from './data-restoration.js';
import { bindDataPrices } from './data-prices.js';
import { bindPersistenceLocation } from '../shared/persistence-location.js';
import { renderDataPage } from './data-renderer.js';
import { bindDataNewBeginning } from './data-new-beginning-ui.js';

const initialized = new WeakMap();
// Der bestehende Sicherungsbinder behält seine Entscheidungen; nur seine Ausgabe
// wird für diese Seite auf Hauptmeldung und technische Einzelheiten verteilt.
export function dataBackupStatus(doc) {
    const host = doc.getElementById('fullBackupStatus'), detail = doc.getElementById('dataBackupTechnical');
    return {
        dataset: host.dataset,
        get textContent() { return host.textContent; },
        set textContent(raw) {
            if (detail) detail.textContent = raw;
            const technical = /IndexedDB|localStorage|UTF-8|Quota|\bSHA(?:-256)?\b|Fingerabdruck|serialisiert|\b(?:kv|metadata|snapshots|ruhestand-suite)\b|(?:rs_|profile_|snapshot_|overview_|balance_)[\w-]+|\b[A-Z]+(?:_[A-Z]+)+\b|Store|Browser-Dateidialog/i.test(raw);
            if (host.dataset.kind === 'error') {
                host.textContent = /Probelauf/.test(raw) ? 'Im Probelauf ist diese Sicherungsaktion gesperrt. Bitte zuerst den Probelauf beenden.'
                    : !technical && /Wiederherstellungspunkt|wiederherstellen|erneut|nicht bestätigt/.test(raw) ? raw
                        : 'Die Sicherungsaktion konnte nicht abgeschlossen werden. Weitere Hinweise findest du unter „Technische Details“.';
            } else if (/Komplettes fachliches Backup erstellt/.test(raw)) host.textContent = 'Vollsicherung erstellt. Wähle einen sicheren Ablageort.';
            else if (/Backup wird erstellt/.test(raw)) host.textContent = 'Vollsicherung wird erstellt …';
            else host.textContent = technical ? 'Die Sicherungsaktion ist noch nicht abgeschlossen. Weitere Hinweise findest du unter „Technische Details“.' : raw;
        }
    };
}
export function initDataPage(doc = globalThis.document, win = doc.defaultView) {
    if (!initialized.has(doc)) initialized.set(doc, initializeDataPage(doc, win));
    return initialized.get(doc);
}
async function initializeDataPage(doc, win) {
    initSuiteFrame(doc); // Handoff ist vor jedem asynchronen Wartepunkt gebunden.
    const ready = await initializeProfilePage({ doc, win });
    // Vollimport bleibt auch ohne gültigen Profilbestand erreichbar.
    const options = { document: doc, window: win, probelaufController: getProbelaufController(doc), status: dataBackupStatus(doc) };
    bindFullBackupButton(options);
    bindFullBackupImport(options);
    let revision = 0, prices, newBeginning;
    const refresh = async () => {
        // Tauri-Adapter dürfen während eines offenen Kursflushs vorbereitete
        // Records führen. Erst das Jobende projiziert sie als bestätigt.
        if (prices?.isRunning()) return;
        const currentRevision = ++revision;
        try {
            const model = await readDataModel(PersistenceFacade, prices?.reportOptions());
            if (currentRevision === revision && !prices?.isRunning()) {
                renderDataPage(doc, model);
                doc.getElementById('dataPageStatus').textContent = '';
            }
        }
        catch (error) { if (currentRevision === revision) {
            const { backend, recordCount, migrationWarning } = PersistenceFacade.getPersistenceStatus();
            renderDataPage(doc, { age: { days: null, warning: true }, backupUnknown: true, snapshots: [], archiveError: error.message,
                error: error.message, totalBytes: null, knownBytes: null, liveBytes: null, priceBytes: null, archiveBytes: null,
                shares: null, backend, recordCount, migrationWarning, priceCoverage: { state: 'unknown', total: null, openIntervals: null, rows: [] } });
            doc.getElementById('dataPageStatus').textContent = 'Die Daten konnten nicht gelesen werden. Weitere Hinweise findest du unter „Technische Details“.';
            doc.getElementById('dataPageTechnical').textContent = error.message;
        } }
        await newBeginning?.update();
    };
    prices = bindDataPrices(doc, { win, refresh, readModel: () => readDataModel(PersistenceFacade, prices?.reportOptions()) });
    await bindPersistenceLocation(doc, { win });
    doc.addEventListener('overview-backup-changed', refresh);
    await refresh();
    bindDataRestoration(doc, { refresh });
    bindDataExchange(doc, { win, refresh });
    try { await assertFullBackupAllowed(options); }
    catch (error) { options.status.dataset.kind = 'error'; options.status.textContent = error.message; }
    const pageError = doc.getElementById('error-container');
    if (pageError?.textContent.trim()) {
        doc.getElementById('dataPageTechnical').textContent = pageError.textContent;
        pageError.textContent = 'Die Personendaten konnten nicht vollständig geladen werden. Du kannst eine Vollsicherung einspielen.';
    }
    const openTarget = () => {
        const hash = win.location?.hash;
        if (['#balance-austausch', '#dataBalanceExport', '#dataBalanceImport'].includes(hash)) { const details = doc.getElementById('balance-austausch'); if (details) details.open = true; }
        const target = hash && doc.getElementById(hash.slice(1));
        if (target) { if (!target.hasAttribute?.('tabindex')) target.setAttribute?.('tabindex', '-1'); target.focus?.(); target.scrollIntoView?.({ block: 'start' }); }
    };
    win.addEventListener?.('hashchange', openTarget); openTarget();
    try {
        if (await PersistenceFacade.flush() === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
    } catch (error) {
        reportDataRestoration(doc, {
            message: 'Die Startdaten konnten nicht vollständig gespeichert werden. Du kannst eine Vollsicherung einspielen. Weitere Hinweise findest du unter „Technische Details“.',
            technical: error?.message || String(error)
        });
        newBeginning = bindDataNewBeginning(doc, { win, refresh, ready: false });
        return false;
    }
    // Der Recovery-Einstieg gehört nur zum Seitenstart; Hashwechsel navigieren.
    const id = new URLSearchParams(win.location?.search || '').get('punkt');
    if (id) Array.from(doc.querySelectorAll?.('[data-restore-preview]') || []).find(button => button.dataset.restorePreview === id)?.click();
    doc.documentElement.dataset.dataReady = 'true';
    newBeginning = bindDataNewBeginning(doc, { win, refresh, ready });
    return ready;
}
if (globalThis.document?.documentElement?.dataset?.suitePage === 'data') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void initDataPage(), { once: true });
    else void initDataPage();
}
