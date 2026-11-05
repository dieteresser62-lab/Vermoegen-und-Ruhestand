// Nur dokumentlokale Bedienzustände; keine Archiv- oder Speicherentscheidungen.
const documents = new WeakMap();
function state(doc) {
    if (!documents.has(doc)) documents.set(doc, { busy: false, pointId: null, points: new Map(), removed: new Map(), messages: new Map(), locks: new Map() });
    return documents.get(doc);
}
export const snapshotActionBusy = doc => state(doc).busy;

/** Entfernte Punkte bleiben bis zum nächsten Seitenstart als sichtbare Quittung am Anlass. */
export function snapshotDisplayPoints(doc, points) {
    const current = state(doc);
    current.points = new Map(points.map(point => [point.id, point]));
    return [...points, ...[...current.removed.values()].filter(point => !current.points.has(point.id))];
}
export const snapshotPointRemoved = (doc, id) => state(doc).removed.has(id);
export function rememberSnapshotRemoval(doc, id) {
    const current = state(doc), point = current.points.get(id);
    if (point) current.removed.set(id, point);
}
export function reportSnapshotAction(doc, pointId, message, kind = 'info') {
    const current = state(doc);
    current.messages.set(pointId, { message, kind }); current.revealId = pointId;
    applySnapshotFeedback(doc);
}
export function beginSnapshotAction(doc, pointId = null) {
    const current = state(doc);
    if (current.busy) return false;
    current.busy = true; current.pointId = pointId;
    reportSnapshotAction(doc, pointId, pointId ? 'Punkt wird geprüft …' : 'Aufräumen wird geprüft …');
    return true;
}
export function endSnapshotAction(doc) {
    const current = state(doc);
    current.busy = false;
    for (const [button, original] of current.locks) {
        button.disabled = original.disabled;
        button.textContent = original.text;
    }
    current.locks.clear();
    applySnapshotFeedback(doc);
}
/** Auch ein paralleler Listenrefresh erhält Meldungen und laufende Knopfsperren. */
export function applySnapshotFeedback(doc, rendered = false) {
    const current = state(doc);
    for (const [id, feedback] of current.messages) {
        const host = id === null ? doc.getElementById('dataRetentionReason')
            : [...doc.querySelectorAll('[data-point-status]')].find(node => node.dataset.pointStatus === id);
        if (host) {
            host.textContent = feedback.message; host.dataset.kind = feedback.kind;
            if (id !== null && (current.revealId === id || current.busy && current.pointId === id)) for (let node = host.parentNode; node; node = node.parentNode) {
                if (node.tagName?.toLowerCase() === 'details') node.open = true;
            }
        }
    }
    current.revealId = null;
    const retention = doc.getElementById('dataRetentionPreview');
    if (rendered && current.locks.has(retention)) current.locks.get(retention).disabled = retention.disabled;
    if (!current.busy) return;
    const buttons = [...doc.querySelectorAll('[data-delete-point], [data-restore-preview]'), retention,
        doc.getElementById('dataRestoreConfirm'), doc.getElementById('dataRestoreCancel')].filter(Boolean);
    for (const button of buttons) {
        if (!current.locks.has(button)) current.locks.set(button, { disabled: button.disabled, text: button.textContent });
        button.disabled = true;
        if (button.dataset.deletePoint === current.pointId) button.textContent = 'wird gelöscht …';
        if (button === retention && current.pointId === null) button.textContent = 'wird aufgeräumt …';
    }
}
