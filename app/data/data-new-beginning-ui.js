import { createNewBeginningController, canConfirmNewBeginning } from './data-new-beginning.js';
import { downloadFullPersistenceBackup } from '../shared/persistence-backup.js';
import { runPageDialog } from '../shared/page-dialog.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';

export function showNewBeginningDialog(doc, { controller, opener, names, backup = downloadFullPersistenceBackup, win = doc.defaultView, refresh = async () => {} }) {
    return runPageDialog({ doc, opener, id: 'newBeginningDialog', title: 'Neu beginnen',
        returnFocus: () => { if (!controller.blocked) opener.disabled = false; opener.focus?.(); }
    }, ({ dialog, listen, finish }) => {
        dialog.classList.add('data-new-beginning-dialog');
        const description = dialog.querySelector?.('#newBeginningDialogDescription');
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
        const remaining = node('p', '', 'newBeginningRemaining'); second.appendChild(remaining);
        const removePoints = checkbox(second, 'Auch alle Wiederherstellungspunkte löschen', 'newBeginningDeleteSnapshots');
        const warning = node('p', '', 'newBeginningWarning', 'ds-note ds-note-error'); warning.hidden = true; second.appendChild(warning);
        const third = step('3 · Bestätigen');
        const confirmed = checkbox(third, 'Ich habe verstanden, dass alles gelöscht wird', 'newBeginningConfirmed');
        const status = node('p', '', 'newBeginningStatus'); status.setAttribute('role', 'alert'); dialog.appendChild(status);
        const actions = node('div', '', '', 'ds-actions');
        const cancel = node('button', 'Abbrechen', 'newBeginningCancel', 'ds-button ds-button-secondary'); cancel.type = 'button';
        const accept = node('button', 'Endgültig neu beginnen', 'newBeginningConfirm', 'ds-button ds-button-danger'); accept.type = 'button';
        actions.append(cancel, accept); dialog.appendChild(actions);
        let busy = false, backupSaved = false;
        const selection = () => ({ busy, backupSaved, withoutBackup: without.checked, confirmed: confirmed.checked, deleteSnapshots: removePoints.checked });
        const controls = [save, without, removePoints, confirmed, cancel, accept];
        const render = () => {
            controls.forEach(control => { control.disabled = busy; });
            accept.disabled = controller.blocked || !canConfirmNewBeginning(selection());
            save.disabled = busy || controller.blocked;
            remaining.textContent = removePoints.checked ? 'Es bleiben keine Wiederherstellungspunkte. Einziger Rückweg ist eine gespeicherte Vollsicherung.' : 'Bleibt: Wiederherstellungspunkt „Vor Neu beginnen“ und alle bisherigen Punkte.';
            warning.hidden = !removePoints.checked;
            warning.textContent = without.checked && !backupSaved
                ? 'Ohne Vollsicherung und ohne Wiederherstellungspunkte gibt es keinen Rückweg. Alle Daten gehen endgültig verloren.'
                : 'Alle Wiederherstellungspunkte werden gelöscht. Nur eine gespeicherte Vollsicherung kann deine Daten zurückholen.';
        };
        for (const check of [without, removePoints, confirmed]) listen(check, 'change', render);
        listen(cancel, 'click', () => { if (!busy) finish(); });
        listen(save, 'click', async () => {
            if (busy || controller.blocked) return;
            busy = true; render(); backupStatus.textContent = 'Vollsicherung wird erstellt …';
            try {
                await controller.inspect();
                await backup({ document: doc, window: win, probelaufController: getProbelaufController(doc), guard: getPageNavigationGuard(doc, win) });
                backupSaved = true;
                backupStatus.textContent = '✓ Vollsicherung ausgegeben. Prüfe, dass die Datei gespeichert ist.';
            } catch (error) { backupSaved = false; backupStatus.textContent = 'Sicherung nicht abgeschlossen: ' + error.message; }
            finally { busy = false; render(); }
        });
        listen(accept, 'click', async () => {
            if (!canConfirmNewBeginning(selection()) || controller.blocked) return;
            const chosen = selection(); busy = true; render(); status.textContent = 'Neu beginnen wird vorbereitet …';
            try {
                const result = await controller.execute(chosen, opener);
                if (result.status === 'restarted') { finish(result); return; }
                status.textContent = result.status === 'reload_required' ? 'Alle Daten wurden gelöscht. Bitte öffne die Übersicht, um neu anzufangen.'
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

export function bindDataNewBeginning(doc, { win = doc.defaultView, refresh = async () => {}, ready = true, ...options } = {}) {
    const opener = doc.getElementById('dataNewBeginningOpen'); if (!opener) return null;
    const reason = doc.getElementById('dataNewBeginningReason');
    const guard = options.guard || getPageNavigationGuard(doc, win);
    const controller = createNewBeginningController({ ...options, guard, window: win, probelaufController: getProbelaufController(doc),
        recovery: () => !ready || doc.getElementById('dataRestorePreview')?.hidden === false });
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
    if (win?.MutationObserver) new win.MutationObserver(() => void update()).observe(doc.getElementById('dataRestorePreview'), { attributes: true, attributeFilter: ['hidden'] });
    void update();
    return { controller, update };
}
