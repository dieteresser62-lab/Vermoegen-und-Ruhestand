import { createNewBeginningController, canConfirmNewBeginning } from './data-new-beginning.js';
import { downloadFullPersistenceBackup } from '../shared/persistence-backup.js';
import { runPageDialog } from '../shared/page-dialog.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { BACKUP_SAVE_CANCELLED_TEXT } from '../shared/save-file.js';

/**
 * @param {Document} doc
 * @param {{controller: ReturnType<typeof createNewBeginningController>; opener: HTMLButtonElement; names: string[]; backup?: typeof downloadFullPersistenceBackup; win?: Window & typeof globalThis; refresh?: ()=>Promise<void>}} options
 * @returns Ergebnis der bestehenden Projektion.
 */
export function showNewBeginningDialog(doc, { controller, opener, names, backup = downloadFullPersistenceBackup, win = doc.defaultView, refresh = async () => {} }) {
    return runPageDialog({ doc, opener, id: 'newBeginningDialog', title: 'Neu beginnen',
        returnFocus: () => { if (!controller.blocked) opener.disabled = false; opener.focus?.(); }
    }, ({ dialog, listen, finish }) => {
        dialog.classList.add('data-new-beginning-dialog');
        const description = /** @type {HTMLElement|null} */ (dialog.querySelector?.('#newBeginningDialogDescription'));
        if (description) description.hidden = true;
        const node = (tag, text, id, className) => {
            const item = doc.createElement(tag); if (text) item.textContent = text;
            if (id) item.id = id; if (className) item.className = className; return item;
        };
        const step = title => { const section = node('section', '', '', 'data-new-beginning-step'); section.appendChild(node('h3', title)); dialog.appendChild(section); return section; };
        const checkbox = (section, text, id) => {
            const label = node('label', '', '', 'data-new-beginning-choice');
            const input = node('input', '', id); input.type = 'checkbox';
            label.append(input, node('span', text)); section.appendChild(label); return input;
        };
        const first = step('1 · Vorher sichern');
        const save = node('button', 'Vollsicherung speichern', 'newBeginningBackup', 'ds-button ds-button-secondary'); save.type = 'button'; first.appendChild(save);
        const backupStatus = node('p', '', 'newBeginningBackupStatus'); backupStatus.setAttribute('role', 'status'); first.appendChild(backupStatus);
        const without = checkbox(first, 'Ohne Sicherung fortfahren', 'newBeginningWithoutBackup');
        const second = step('2 · Was gelöscht wird');
        second.appendChild(node('p', (names.length ? names.join(', ') + ' · ' : 'Alle Personen · ') + 'Haushalt & Plan · Ausgaben'));
        second.appendChild(node('p', 'Verlauf mit Tageskursen und Verlaufsbeginn · Jahres-/Monatsabschlüsse und Belege · Simulator-Einstellungen und -Ergebnisse · technische Einstellungen'));
        second.appendChild(node('p', 'Bleibt: ein Wiederherstellungspunkt „Vor Neu beginnen“ und die bisherigen Punkte.', 'newBeginningRemaining'));
        const third = step('3 · Bestätigen');
        const confirmed = checkbox(third, 'Ich habe verstanden, dass alles gelöscht wird', 'newBeginningConfirmed');
        const status = node('p', '', 'newBeginningStatus'); status.setAttribute('role', 'alert'); dialog.appendChild(status);
        const actions = node('div', '', '', 'ds-actions');
        const cancel = node('button', 'Abbrechen', 'newBeginningCancel', 'ds-button ds-button-secondary'); cancel.type = 'button';
        const accept = node('button', 'Endgültig neu beginnen', 'newBeginningConfirm', 'ds-button ds-button-danger'); accept.type = 'button';
        actions.append(cancel, accept); dialog.appendChild(actions);
        let busy = false, backupSaved = false;
        const selection = () => ({ busy, backupSaved, withoutBackup: without.checked, confirmed: confirmed.checked });
        const controls = [save, without, confirmed, cancel, accept];
        const render = () => {
            controls.forEach(control => { control.disabled = busy; });
            accept.disabled = controller.blocked || !canConfirmNewBeginning(selection());
            save.disabled = busy || controller.blocked;
        };
        for (const check of [without, confirmed]) listen(check, 'change', render);
        listen(cancel, 'click', () => { if (!busy) finish(); });
        listen(save, 'click', async () => {
            if (busy || controller.blocked) return;
            busy = true; render(); backupStatus.textContent = 'Vollsicherung wird erstellt …';
            try {
                await controller.inspect();
                const result = await backup({ document: doc, window: win, probelaufController: getProbelaufController(doc), guard: getPageNavigationGuard(doc, win) });
                // Abbruch im Speicherdialog: keine Sicherung, kein Fehler.
                backupSaved = result?.delivery !== 'abgebrochen';
                backupStatus.textContent = result?.delivery === 'abgebrochen' ? BACKUP_SAVE_CANCELLED_TEXT
                    : result?.delivery === 'bestaetigt' ? `✓ Vollsicherung gespeichert${result.path ? ` unter ${result.path}` : ''}.` : 'Sicherung angestoßen – bitte Ablage prüfen.';
            } catch (error) { backupSaved = false; backupStatus.textContent = 'Sicherung nicht abgeschlossen: ' + error.message; }
            finally { busy = false; render(); }
        });
        listen(accept, 'click', async () => {
            if (!canConfirmNewBeginning(selection()) || controller.blocked) return;
            const chosen = selection(); busy = true; render(); status.textContent = 'Neu beginnen wird vorbereitet …';
            try {
                const result = await controller.execute(chosen, opener);
                if (result.status === 'restarted') { finish(result); return; }
                status.textContent = result.status === 'reload_required' ? 'Alle Daten wurden gelöscht. Bitte öffne die Übersicht, um neu anzufangen.' + (result.warning ? ' Hinweis: ' + result.warning : '')
                    : result.status === 'cancelled' ? 'Neu beginnen wurde abgebrochen. Es wurde nichts gelöscht.'
                        : result.deletionStarted ? 'Neu beginnen konnte nicht vollständig abgeschlossen werden. Bitte stelle den Bestand wieder her.'
                            : 'Neu beginnen wurde angehalten. Es wurde nichts gelöscht. ' + (result.error?.message || 'Bitte erneut prüfen.');
                if (result.deletionStarted) {
                    const link = node('a', result.snapshotId ? 'Punkt „Vor Neu beginnen“ unter Wiederherstellungspunkte zurückholen' : 'Gespeicherte Vollsicherung einspielen');
                    link.href = result.snapshotId ? 'Daten-Sicherung.html?punkt=' + encodeURIComponent(result.snapshotId) : 'Daten-Sicherung.html#fullBackupImportBtn';
                    status.appendChild(node('br')); status.appendChild(link);
                }
                const detail = doc.getElementById('dataNewBeginningTechnical'); if (detail) detail.textContent = result.error?.message || '';
                await refresh();
            } catch (error) { status.textContent = 'Neu beginnen konnte nicht abgeschlossen werden. ' + error.message; }
            finally { busy = false; render(); }
        });
        render();
        return { controls: () => controls, initialFocus: cancel, blocked: () => busy };
    });
}

/**
 * @param {Document} doc
 * @param {import("../../typcheck/data-ui.js").DataBindingOptions & {ready?: boolean}} [options]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function bindDataNewBeginning(doc, { win = doc.defaultView, refresh = async () => {}, ready = true, ...options } = {}) {
    const opener = doc.getElementById('dataNewBeginningOpen'); if (!opener) return null;
    const reason = doc.getElementById('dataNewBeginningReason');
    const guard = options.guard || getPageNavigationGuard(doc, win);
    const controller = createNewBeginningController({ ...options, guard, window: win, probelaufController: getProbelaufController(doc),
        recovery: () => !ready });
    let opening = false, revision = 0;
    const update = async () => {
        const current = ++revision;
        if (opening || controller.busy) return;
        try {
            await controller.inspect();
            if (current !== revision) return;
            const locked = guard.isBusy() || guard.reasons().some(item => ['preparing', 'commit', 'running', 'cancelling'].includes(item.phase));
            opener.disabled = locked; reason.textContent = locked ? 'Bitte die laufende Aktion zuerst abschließen.' : '';
        } catch (error) { if (current === revision) { opener.disabled = true; reason.textContent = error.message; } }
    };
    opener.addEventListener('click', async () => {
        if (opening || controller.busy || controller.blocked) return;
        opening = true; opener.disabled = true;
        try {
            const { names } = await controller.inspect();
            await showNewBeginningDialog(doc, { controller, names, opener, win, refresh });
        } catch (error) { reason.textContent = error.message; }
        finally { opening = false; await update(); }
    });
    guard.subscribe(() => void update());
    doc.addEventListener('click', () => { if (!opening) void update(); });
    win?.addEventListener?.('focus', () => void update());
    void update();
    return { controller, update };
}
