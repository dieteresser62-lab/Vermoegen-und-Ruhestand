import { previewSnapshotRestore, executeSnapshotRestore, ROLLBACK_FAILED_MESSAGE, HOUSEHOLD_RESTORE_NOTICE } from '../shared/snapshot-restore.js';
import { SNAPSHOT_KINDS, IMPORT_POINT_LABELS } from '../shared/snapshot-archive.js';
import { requestPageConfirmation } from '../shared/page-dialog.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';

// SV-1: Zurückholen setzt immer den ganzen Haushalt auf den Stand des Punkts. Davor steht eine einfache Bestätigung.

/** @param {string} month „JJJJ-MM“ @returns {string} „Oktober 2026“ */
const monthName = month => {
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
};

/** Anlass eines Punkts in Worten. @param {{kind: string, label?: string, createdAt: string}} point @returns {string} */
export function snapshotTitle(point) {
    if (point.kind === SNAPSHOT_KINDS.monthlyClosePreMutation) {
        const month = /(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(point.label || '')?.[1];
        return 'Vor dem Monatsabschluss' + (month ? ' ' + monthName(month) : '');
    }
    // Der Jahresabschluss läuft im Folgejahr; der Punkt trägt das Datum des Abschlusses.
    if (point.kind === SNAPSHOT_KINDS.annualClosePreMutation) return `Vor dem Jahresabschluss ${new Date(point.createdAt).getFullYear() - 1}`;
    return /** @type {string[]} */ (Object.values(IMPORT_POINT_LABELS)).includes(point.label || '') ? String(point.label) : 'Vor dem Einspielen einer Sicherung';
}

/** @param {string} raw @returns {string} „18.11.2026, 10:15“ */
export const snapshotTime = raw => new Date(raw).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Ein Vorgang je Seite: Punkt lesen, bestätigen lassen, zurückholen.
 * @param options Optionen des Aufrufers. */
export function createDataRestorationController(options = {}) {
    let preview = null, busy = false, blocked = false;
    return {
        get busy() { return busy; }, get blocked() { return blocked; },
        async preview(id) {
            if (busy || blocked) return null;
            preview = null;
            preview = await previewSnapshotRestore(id, options);
            return preview;
        },
        cancel() { if (!busy) preview = null; },
        async executeRestore() {
            if (busy || blocked || !preview) return { status: 'in_flight' };
            busy = true;
            try {
                const result = await executeSnapshotRestore(preview, options);
                blocked = ['restored', 'reload_required'].includes(result.status);
                return result;
            } catch (error) { if (error.code === 'rollback_failed') blocked = true; throw error; }
            finally { busy = false; preview = null; }
        }
    };
}

/** Gemeinsame Ausgabe für Meldung und technische Einzelheiten.
 * @param doc Dokument der Seite. @param options Meldung, Art und technische Einzelheiten. */
export function reportDataRestoration(doc, { message, kind = 'error', technical = '' }) {
    const status = doc.getElementById('dataRestoreStatus');
    const detail = doc.getElementById('dataRestoreTechnical');
    if (status) { status.textContent = message; status.dataset.kind = kind; }
    if (detail) detail.textContent = technical;
}

/**
 * @param {Document} doc
 * @param {import("../../typcheck/data-ui.js").DataBindingOptions} [options]
 */
export function bindDataRestoration(doc, { refresh = async () => {}, ...options } = {}) {
    const guard = options.guard || getPageNavigationGuard(doc);
    const controller = createDataRestorationController({ ...options, guard, document: doc });
    let opening = false;
    const allowed = () => {
        const trial = getProbelaufController(doc);
        if (trial?.state || trial?.blocked || trial?.busy) throw new Error('Zurückholen ist im Spielbereich gesperrt. Beende ihn zuerst über das Spielbereichsband.');
        if (controller.blocked) throw new Error('Bitte die Seite neu laden. Der angezeigte Stand ist veraltet.');
    };
    const report = error => {
        const message = error.code === 'rollback_failed' ? ROLLBACK_FAILED_MESSAGE
            : error.code === 'restore_point_damaged' ? 'Dieser Punkt ist beschädigt und lässt sich nicht zurückholen. Dein heutiger Stand ist unverändert.'
            : /seit der Bestätigung geändert|während der Sicherung geändert/.test(error.message)
            ? 'Der Stand hat sich geändert. Bitte versuche es erneut.'
            : /Spielbereich/.test(error.message) ? 'Beende bitte zuerst den Spielbereich.'
                : controller.blocked ? 'Bitte lade die Seite neu, bevor du weiterarbeitest.'
                    : 'Der frühere Stand konnte nicht zurückgeholt werden. Dein heutiger Stand ist unverändert. Weitere Hinweise findest du unter „Technische Details“.';
        reportDataRestoration(doc, { message, technical: error.message });
    };
    doc.getElementById('dataSnapshotList').addEventListener('click', async event => {
        const button = /** @type {HTMLButtonElement|null} */ (/** @type {Element} */ (event.target).closest('[data-restore-point]'));
        if (!button || button.disabled || opening || controller.busy) return;
        opening = true; button.disabled = true;
        try {
            allowed(); reportDataRestoration(doc, { message: '', kind: 'info' });
            const preview = await controller.preview(button.dataset.restorePoint);
            if (!preview) return;
            const confirmed = await requestPageConfirmation({ doc, opener: button, title: 'Früheren Stand zurückholen',
                description: `${snapshotTitle(preview.snapshot)} vom ${snapshotTime(preview.snapshot.createdAt)} zurückholen?\n\n`
                    // JW-1a (Fable P2-5): Die Rückfrage sagt deutlich, was seit dem Punkt erfasst wurde und verloren geht.
                    + 'Der heutige Stand wird ersetzt. Was du seitdem eingetragen hast, etwa Verkäufe, importierte Ausgaben oder Tagesgeld, geht dabei verloren. '
                    + 'Vorher legt die App einen Punkt „Vor dem Zurückholen“ an, der den heutigen Stand aufhebt.',
                notice: HOUSEHOLD_RESTORE_NOTICE,
                confirmLabel: 'Zurückholen', cancelLabel: 'Abbrechen' });
            if (!confirmed) { controller.cancel(); reportDataRestoration(doc, { message: 'Zurückholen abgebrochen.', kind: 'info' }); return; }
            allowed();
            const result = await controller.executeRestore();
            if (result.status === 'reload_required') report(new Error(result.message));
            else if (result.status === 'cancelled') reportDataRestoration(doc, { message: 'Zurückholen abgebrochen.', kind: 'info' });
            else if (result.status !== 'restored') await refresh();
        } catch (error) { controller.cancel(); report(error); }
        finally { opening = false; button.disabled = controller.blocked; }
    });
    return controller;
}
