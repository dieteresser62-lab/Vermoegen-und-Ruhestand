import { annualEngineLoader } from '../shared/annual-engine-loader.js';
import { withAnnualActionProgress } from '../balance/annual-action-progress.js';
import { loadProfileRegistry } from '../profile/profile-registry.js';

/** GN-2c: Beleg der Übersicht samt Umsetzungsstand (eingetragene Verkäufe) und Personen, wie ihn die Reservekarte nimmt.
 * @param {any} model Übersichtsmodell. @param {() => any} [readRegistry]
 * @returns {{confirmed: any, people: {id: string, name: string}[]}|null} */
export function overviewReserveReceipt(model, readRegistry = () => loadProfileRegistry().value) {
    const origin = model?.actionOrigin;
    if (model?.planComparison?.recordStatus !== 'valid' || !origin?.confirmed?.action) return null;
    const members = model.members || [];
    let confirmed = origin.confirmed;
    try { confirmed = withAnnualActionProgress(origin, readRegistry, members.map((/** @type {any} */ person) => person.id)).confirmed; }
    catch { /* ohne Verkäufe: alles offen */ }
    return { confirmed, people: members.map((/** @type {any} */ person) => ({ id: person.id, name: person.name })) };
}

/** Rechnung der Reservekarte für die Übersicht laden: Engine und Balance-Bausteine erst bei Bedarf, sie schließen statisch
 * eingebunden über den Seitenrahmen einen Ladezyklus (wie im Probelauf-Vergleich).
 * @param {{engineLoader?: {load: () => Promise<any>}}} [options]
 * @returns {Promise<(options: {storage: import("../../typcheck/datenvertraege.js").RecordStorage, profileId: string|null, model: any}) =>
 *   ReturnType<typeof import('../balance/balance-reserve-today.js').balanceReserveCoverages>|null>} */
export async function loadOverviewReserveCalculator({ engineLoader = annualEngineLoader } = {}) {
    const [engineApi, balance] = await Promise.all([engineLoader.load(), import('../balance/balance-reserve-today.js')]);
    return ({ storage, profileId, model }) => {
        const currentYear = balance.evaluateBalanceCurrentYear({ storage, engineApi, profileId });
        return currentYear ? balance.balanceReserveCoverages(currentYear, overviewReserveReceipt(model) || {}) : null;
    };
}

/** Im Leerlauf ausführen, sonst nach dem nächsten Takt. @param {() => void} task */
const idle = task => { if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(task, { timeout: 1000 }); else setTimeout(task, 0); };

/** Deckung der Übersicht je Datenstand einmal rechnen, danach `onReady`. Bis dahin bleibt sie offen („—“).
 * GN-2e: Laden und Rechnen laufen nicht im Neuaufbau, sondern im Leerlauf, und nie während eines Seitenwechsels (`isBusy`): Eine
 * lange Rechnung neben einem Klick auf einen Seitenlink verzögerte sonst dessen Übergabe, bis ein anderer Seitenaufruf lief.
 * GN-2d: Nach einem Ladefehler versucht der nächste Neuaufbau es erneut; ein Fehler beim Neuzeichnen lässt „—“ stehen.
 * @param {{onReady: () => void, load?: typeof loadOverviewReserveCalculator, isBusy?: () => boolean, schedule?: (task: () => void) => void}} options */
export function createOverviewReserves({ onReady, load = loadOverviewReserveCalculator, isBusy = () => false, schedule = idle }) {
    /** @type {Awaited<ReturnType<typeof loadOverviewReserveCalculator>>|null} */
    let calculate = null;
    /** @type {Promise<void>|null} */
    let loading = null;
    /** @type {{key: string, storage: any, profileId: string|null, model: any}|null} */
    let pending = null;
    let scheduled = false;
    let last = { key: '', value: /** @type {any} */ (null) };
    const later = () => {
        if (scheduled) return;
        scheduled = true;
        schedule(() => {
            scheduled = false;
            if (isBusy()) { setTimeout(later, 200); return; }
            run();
        });
    };
    function run() {
        if (!pending) return;
        if (!calculate) {
            loading ||= load().then(fn => { calculate = fn; later(); },
                error => { loading = null; console.warn('Deckung der Übersicht nicht geladen:', error); });
            return;
        }
        const job = pending; pending = null;
        let value = null;
        try { value = calculate(job); }
        catch (error) { console.warn('Deckung der Übersicht nicht berechenbar:', error); }
        last = { key: job.key, value };
        try { onReady(); } catch (error) { console.warn('Übersicht nach dem Laden der Deckung nicht neu gezeichnet:', error); }
    }
    return {
        /** @param {any} model @param {{storage: import("../../typcheck/datenvertraege.js").RecordStorage, liveData: Record<string, string|null>}} source */
        project(model, { storage, liveData }) {
            if (!model?.available || !model.scope) return model;
            const key = JSON.stringify([model.now?.toDateString?.(), model.activeId, liveData]);
            if (last.key === key) return last.value ? { ...model, reserveCoverages: last.value } : model;
            pending = { key, storage, profileId: model.activeId, model };
            later();
            return model;
        }
    };
}
