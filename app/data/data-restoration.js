import { previewSnapshotRestore, executeSnapshotRestore } from '../shared/snapshot-restore.js';
import { previewSnapshotRetention, executeSnapshotRetention } from '../shared/snapshot-retention.js';
import { requestPageConfirmation, showPageAlert } from '../shared/page-dialog.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { snapshotTitle } from './data-snapshot-presentation.js';

/** Vorschau speichert ausstehende Eingaben; Zielstand und Archiv bleiben unverändert. */
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

/** Ausschließlich Anzeige des bestehenden Plans, ohne neue Restoreentscheidung. */
export function restorePreviewRows(plan) {
    const names = {
        profile_tagesgeld: 'Tagesgeld', profile_cash_history_v1: 'Tagesgeld-Verlauf', depot_tranchen: 'Tranchen',
        overview_month_provision_v1: 'Monatsbelege', overview_balance_summary_v1: 'Balance-Belege',
        rs_daily_prices_v1: 'Tageskurse', rs_wealth_history_start_v1: 'Verlaufsbeginn',
        overview_last_full_backup_v1: 'Zeit der Vollsicherung', rs_data_backup_summary_v1: 'Sicherungsvergleich',
        featureFlags: 'Funktionseinstellungen', balance_expenses_v1: 'Ausgaben',
        profile_geburtsdatum: 'Personendaten', profile_person_data_v1: 'Personendaten', profile_rente: 'Personendaten',
        profile_familienstand: 'Personendaten', profile_geschlecht: 'Personendaten'
    };
    const parse = raw => { try { return JSON.parse(raw || 'null'); } catch { return null; } };
    const title = key => names[key] || (key.startsWith('balance_expenses_') ? 'Ausgaben ' + key.slice('balance_expenses_'.length)
        : key.startsWith('ruhestandsmodellValues') ? 'Balance einschließlich Jahresbelegen und Vermögensverlauf'
            : key.startsWith('sim') ? 'Simulatoreinstellungen' : 'Weitere Einstellungen');
    const money = raw => raw !== null && raw !== undefined && raw !== '' && Number.isFinite(Number(raw))
        ? Number(raw).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' €' : 'nicht vorhanden';
    const quantity = (key, raw) => {
        const value = parse(raw);
        if (key === 'depot_tranchen') return Array.isArray(value) ? value.length : null;
        if (key === 'profile_cash_history_v1') return Array.isArray(value?.entries) ? value.entries.length : null;
        if (key === 'rs_daily_prices_v1') {
            const symbols = value?.symbols;
            return symbols && typeof symbols === 'object' && !Array.isArray(symbols) && Object.values(symbols).every(item => Array.isArray(item?.days))
                ? Object.values(symbols).reduce((n, item) => n + item.days.length, 0) : null;
        }
        if (key === 'overview_month_provision_v1') return value?.entries ? Object.keys(value.entries).length : null;
        return null;
    };
    const beforeProfiles = parse(plan.before.rs_profiles_v1)?.profiles || {};
    const afterProfiles = parse(plan.records.rs_profiles_v1)?.profiles || {};
    const rows = [];
    const identityKeys = ['rs_profiles_v1', 'rs_current_profile', 'rs_active_profile'];
    for (const key of new Set([...Object.keys(plan.before), ...Object.keys(plan.records)])) {
        if (identityKeys.includes(key)) continue;
        const before = plan.before[key], after = plan.records[key];
        const same = before === after, n = quantity(key, after);
        const action = after === undefined ? 'entfällt' : same ? `unverändert${n === null ? '' : ' (' + n + ')'}`
            : before === undefined ? 'kommt hinzu' : 'wird zurückgesetzt';
        const detail = key === 'profile_tagesgeld' && !same && after !== undefined ? `${money(before)} → ${money(after)}` : '';
        if (key === 'overview_month_provision_v1' && !same) {
            const previous = parse(before)?.entries || {}, next = parse(after)?.entries || {};
            const entries = [];
            for (const id of new Set([...Object.keys(previous), ...Object.keys(next)])) {
                if (JSON.stringify(previous[id]) === JSON.stringify(next[id])) continue;
                const month = (next[id] || previous[id])?.month;
                if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month || '')) continue;
                const label = new Date(month + '-01T12:00:00').toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
                entries.push({ title: 'Monatsabschluss ' + label, action: !next[id] ? 'entfällt' : !previous[id] ? 'kommt hinzu' : 'wird zurückgesetzt', detail: '', removed: !next[id] });
            }
            if (entries.length) { rows.push(...entries); continue; }
        }
        rows.push({ title: title(key), action, detail, removed: after === undefined });
    }
    for (const id of new Set([...Object.keys(beforeProfiles), ...Object.keys(afterProfiles)])) {
        const before = beforeProfiles[id], after = afterProfiles[id];
        if (plan.mode === 'standard' && id !== plan.targetProfileId) continue;
        rows.push({ title: 'Person: ' + (after?.meta?.name || before?.meta?.name || 'ohne gespeicherten Namen'),
            action: !after ? 'entfällt' : !before ? 'kommt hinzu' : JSON.stringify(before) === JSON.stringify(after) ? 'unverändert' : 'wird zurückgesetzt',
            detail: '', removed: !after });
    }
    const activeName = (records, profiles) => profiles[records.rs_current_profile || records.rs_active_profile]?.meta?.name || 'Person ohne gespeicherten Namen';
    if (plan.before.rs_current_profile !== plan.records.rs_current_profile || plan.before.rs_active_profile !== plan.records.rs_active_profile)
        rows.push({ title: 'Aktive Person', action: 'wird zurückgesetzt', detail: `${activeName(plan.before, beforeProfiles)} → ${activeName(plan.records, afterProfiles)}` });
    // Die Keypolicy des echten Plans entscheidet auch über die erhaltenen Bereiche.
    for (const [key, label] of [['rs_daily_prices_v1', 'Tageskurse'], ['rs_wealth_history_start_v1', 'Verlaufsbeginn'],
        ['featureFlags', 'Funktionseinstellungen'], ['overview_last_full_backup_v1', 'Zeit der Vollsicherung']]) {
        if (!plan.allowKey(key)) rows.push({ title: label, action: 'bleiben erhalten', detail: '' });
    }
    if (plan.mode === 'standard') rows.push({ title: 'Andere Personen', action: 'bleiben erhalten', detail: '' });
    rows.push({ title: 'Wiederherstellungspunkte', action: 'bleiben erhalten', detail: '' });
    // Gemeinsam benannte Einstellungen bleiben eine lesbare Fachzeile.
    const grouped = new Map();
    return rows.filter(row => {
        if (!['Weitere Einstellungen', 'Simulatoreinstellungen', 'Personendaten'].includes(row.title)) return true;
        const existing = grouped.get(row.title);
        if (!existing) { grouped.set(row.title, row); return true; }
        if (row.action !== existing.action) { existing.action = 'wird zurückgesetzt'; existing.removed = false; }
        return false;
    });
}

/** Gemeinsame Hostausgabe ohne eigene Restore- oder Löschentscheidung. */
export function reportDataRestoration(doc, { message, kind = 'error', technical = '' }) {
    const status = doc.getElementById('dataRestoreStatus');
    const detail = doc.getElementById('dataRestoreTechnical');
    if (status) { status.textContent = message; status.dataset.kind = kind; }
    if (detail) detail.textContent = technical;
}

export function bindDataRestoration(doc, { refresh = async () => {}, ...options } = {}) {
    const guard = options.guard || getPageNavigationGuard(doc);
    const controller = createDataRestorationController({ ...options, guard, document: doc });
    const status = doc.getElementById('dataRestoreStatus'), host = doc.getElementById('dataRestorePreview');
    let opener, opening = false, retentionBusy = false;
    const allowed = () => {
        const trial = getProbelaufController(doc);
        if (trial?.state || trial?.blocked || trial?.busy) throw new Error('Zurückholen und Aufräumen sind im Probelauf gesperrt. Beende ihn zuerst über das Probelaufband.');
        if (controller.blocked) throw new Error('Bitte die Seite neu laden. Der angezeigte Stand ist veraltet.');
    };
    const report = error => {
        const message = /seit der Vorschau geändert|während der Sicherung geändert/.test(error.message)
            ? 'Der Stand hat sich geändert. Bitte öffne die Vorschau erneut.'
            : /Probelauf/.test(error.message) ? 'Beende bitte zuerst den Probelauf.'
                : controller.blocked ? 'Bitte lade die Seite neu, bevor du weiterarbeitest.'
                    : 'Die Aktion konnte nicht abgeschlossen werden. Weitere Hinweise findest du unter „Technische Details“.';
        reportDataRestoration(doc, { message, technical: error.message });
    };
    const close = () => {
        if (controller.busy) return;
        controller.cancel(); host.hidden = true;
        if (opener) {
            opener.textContent = 'Zurückholen …'; opener.setAttribute('aria-expanded', 'false');
            const row = opener.closest('li'); if (row) row.dataset.selected = 'false';
            if (opener.isConnected !== false) opener.focus();
            opener = null;
        }
    };
    doc.getElementById('dataSnapshotList').addEventListener('click', async event => {
        const button = event.target.closest('[data-restore-preview]');
        if (!button || opening || controller.busy || retentionBusy) return;
        if (button === opener && !host.hidden) { close(); return; }
        close(); opening = true;
        try {
            allowed(); opener = button; status.textContent = '';
            const preview = await controller.preview(button.dataset.restorePreview);
            if (!preview) return;
            const title = doc.getElementById('dataRestorePreviewTitle');
            title.textContent = `${snapshotTitle(preview.snapshot)} – was sich ändert`;
            const list = doc.getElementById('dataRestoreChanges'); list.replaceChildren();
            for (const row of restorePreviewRows(preview)) {
                const item = doc.createElement('tr');
                const area = doc.createElement('td'); area.textContent = row.title;
                const change = doc.createElement('td'); change.textContent = row.detail || row.action;
                if (row.removed) change.className = 'data-restore-removed';
                item.appendChild(area); item.appendChild(change); list.appendChild(item);
            }
            button.closest('li').appendChild(host); host.hidden = false;
            button.closest('li').dataset.selected = 'true'; button.textContent = 'Vorschau schließen'; button.setAttribute('aria-expanded', 'true');
            title.focus();
        } catch (error) { report(error); }
        finally { opening = false; }
    });
    doc.getElementById('dataRestoreCancel').addEventListener('click', close);
    host.addEventListener('keydown', event => { if (event.key === 'Escape') doc.getElementById('dataRestoreCancel').click(); });
    doc.getElementById('dataRestoreConfirm').addEventListener('click', async () => {
        if (controller.busy || controller.blocked || opening || retentionBusy) return;
        const button = doc.getElementById('dataRestoreConfirm'); button.disabled = true;
        try {
            allowed(); const result = await controller.executeRestore();
            if (result.status === 'reload_required') report(new Error(result.message));
            else if (result.status === 'cancelled') status.textContent = 'Zurückholen abgebrochen.';
            close();
        } catch (error) { report(error); }
        finally { button.disabled = controller.blocked; }
    });
    doc.getElementById('dataRetentionPreview').addEventListener('click', async event => {
        if (retentionBusy || controller.busy || opening || controller.blocked) return;
        const retentionOpener = event.currentTarget;
        retentionBusy = true; retentionOpener.disabled = true;
        try {
            allowed(); const preview = await previewSnapshotRetention(options);
            if (!preview.remove.length) {
                await showPageAlert({ doc, title: 'Nichts aufzuräumen', description: 'Alle vorhandenen Punkte bleiben erhalten.', opener: retentionOpener });
                return;
            }
            const confirmed = await requestPageConfirmation({ doc, title: 'Wiederherstellungspunkte aufräumen',
                description: (preview.remove.length === 1 ? '1 älterer Punkt ist durch einen neueren abgedeckt und kann weg.' : `${preview.remove.length} ältere Punkte sind durch neuere abgedeckt und können weg.`) + ' Dauerhafte Punkte bleiben.',
                confirmLabel: 'Jetzt aufräumen', cancelLabel: 'Abbrechen', opener: retentionOpener });
            if (!confirmed) return;
            allowed(); const result = await executeSnapshotRetention(preview, { ...options, guard });
            status.textContent = result.status === 'cleaned' ? `${result.deleted.length} ${result.deleted.length === 1 ? 'Punkt' : 'Punkte'} entfernt.`
                : `${result.deleted.length} Punkte entfernt. Aufräumen konnte nicht abgeschlossen werden.`;
            if (result.error) { const detail = doc.getElementById('dataRestoreTechnical'); if (detail) detail.textContent = result.error.message; }
            status.dataset.kind = result.status === 'cleaned' ? 'ok' : 'error';
            controller.cancel(); host.hidden = true; doc.getElementById('dataRestorePreviewHome').appendChild(host);
            await refresh();
        } catch (error) { report(error); }
        finally { retentionBusy = false; doc.getElementById('dataRetentionPreview').disabled = controller.blocked; }
    });
    return controller;
}
