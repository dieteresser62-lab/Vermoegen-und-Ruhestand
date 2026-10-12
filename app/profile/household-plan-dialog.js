import { runPageDialog } from '../shared/page-dialog.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { shouldResetGuardrailState } from '../balance/balance-guardrail-reset.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { chooseMigrationValues, migrateHouseholdPlans } from './household-plan-migration.js';

export function migrationResetWarning(analysis, selections) {
    const values = chooseMigrationValues(analysis, selections);
    return shouldResetGuardrailState(analysis.values, values);
}
function display(source) {
    if (source.status !== 'present') return source.status === 'unreadable' ? 'Unlesbar' : 'Nicht gespeichert';
    if (source.value === null) return 'Unbekannt';
    return typeof source.value === 'boolean' ? source.value ? 'Aktiv' : 'Aus' : String(source.value);
}
export function requestHouseholdPlanMigration(analysis, { doc = globalThis.document, signal, opener } = {}) {
    return runPageDialog({ doc, signal, opener, id: 'householdPlanDialog', title: 'Planungsdaten zusammenführen',
        description: 'Ein gemeinsamer Plan für diesen Bereich. Wähle bei abweichenden Angaben die Quelle. Vorschlag: Balance.' }, ({ dialog, finish, listen }) => {
        const fields = new Map(), corrections = new Map();
        const table = doc.createElement('table'); table.className = 'ds-table'; table.dataset.householdPlanSources = '';
        const head = doc.createElement('tr');
        for (const label of ['Wert', 'Balance', 'Simulator', 'Auswahl']) { const cell = doc.createElement('th'); cell.textContent = label; head.appendChild(cell); }
        table.appendChild(head);
        for (const field of analysis.fields) {
            const row = doc.createElement('tr');
            for (const label of [field.path, display(field.balance), display(field.simulator)]) {
                const cell = doc.createElement('td'); cell.textContent = label; row.appendChild(cell);
            }
            const cell = doc.createElement('td');
            if (analysis.coupledFields?.includes(field.path)) {
                const input = doc.createElement('input'); input.type = 'number'; input.min = '0'; input.step = 'any'; input.value = String(field.selected);
                input.className = 'ds-input'; input.dataset.householdPlanCorrection = field.path;
                input.setAttribute('aria-label', field.path === 'flexBedarf' ? 'Flex-Bedarf pro Jahr korrigieren' : 'Mindest-Flex pro Jahr korrigieren');
                corrections.set(field.path, input); cell.appendChild(input);
            } else if (field.conflict) {
                const select = doc.createElement('select'); select.className = 'ds-select'; select.dataset.householdPlanField = field.path;
                select.setAttribute('aria-label', `Quelle für ${field.path}`);
                for (const [value, label] of [['balance', 'Balance (Vorschlag)'], ['simulator', 'Simulator']]) {
                    const option = doc.createElement('option'); option.value = value; option.textContent = label; select.appendChild(option);
                }
                select.value = 'balance'; fields.set(field.path, select); cell.appendChild(select);
            } else cell.textContent = String(field.selected ?? 'Unbekannt');
            row.appendChild(cell); table.appendChild(row);
        }
        dialog.appendChild(table);
        const hints = doc.createElement('p'); hints.textContent = analysis.warnings.join(' '); dialog.appendChild(hints);
        if (corrections.size) {
            const explanation = doc.createElement('p'); explanation.textContent = 'Die gespeicherten Quellen ergeben einen Mindest-Flex über dem Flex-Bedarf. Korrigiere den Flex-Bedarf oder Mindest-Flex pro Jahr ausdrücklich, sodass Mindest-Flex ≤ Flex-Bedarf gilt. Die Altquellen bleiben erhalten; es wird nichts automatisch begrenzt.';
            dialog.appendChild(explanation);
        }
        const status = doc.createElement('p'); status.dataset.householdPlanValidation = ''; status.setAttribute('role', 'status'); dialog.appendChild(status);
        const reset = doc.createElement('p'); reset.dataset.householdPlanReset = ''; reset.textContent = 'Diese Auswahl setzt bei der nächsten Balance-Rechnung den bisherigen Guardrail-Verlauf zurück.'; dialog.appendChild(reset);
        const selections = () => ({ ...Object.fromEntries([...fields].map(([path, select]) => [path, select.value])),
            ...(corrections.size ? { corrections: Object.fromEntries([...corrections].map(([path, input]) => [path, input.value.trim() ? Number(input.value) : NaN])) } : {}) });
        const validate = () => {
            try { reset.hidden = !migrationResetWarning(analysis, selections()); status.textContent = ''; return true; }
            catch (error) { status.textContent = error.message; reset.hidden = true; return false; }
        };
        for (const select of fields.values()) listen(select, 'change', validate);
        for (const input of corrections.values()) { listen(input, 'input', validate); listen(input, 'change', validate); }
        validate();
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const later = doc.createElement('button'); later.type = 'button'; later.className = 'ds-button ds-button-secondary'; later.dataset.householdPlanLater = ''; later.textContent = 'Später';
        const accept = doc.createElement('button'); accept.type = 'button'; accept.className = 'ds-button ds-button-primary'; accept.dataset.householdPlanAccept = ''; accept.textContent = 'Plan übernehmen';
        actions.append(later, accept); dialog.appendChild(actions);
        listen(later, 'click', () => finish(null));
        listen(accept, 'click', () => { if (validate()) finish(selections()); });
        return { controls: () => [...fields.values(), ...corrections.values(), later, accept] };
    });
}
const pageStarts = new WeakMap();
/** Dokumentlokaler Aufschub, kein dauerhafter Abschlussmarker. */
export function initializeHouseholdPlanPage({ doc = globalThis.document, win = globalThis.window, reopen = false,
    migrate = migrateHouseholdPlans, storage = persistenceStorage } = {}) {
    if (!reopen && pageStarts.has(doc)) return pageStarts.get(doc);
    const job = (async () => {
        if (!storage.getItem('rs_profiles_v1')) return { status: 'unchanged' };
        try {
            const result = await migrate({ storage, guard: getPageNavigationGuard(doc, win),
                choose: (analysis, options) => requestHouseholdPlanMigration(analysis, { ...options, doc }) });
            if (result.status === 'deferred') showHouseholdPlanNotice({ doc, onOpen: () => initializeHouseholdPlanPage({ doc, win, reopen: true, migrate, storage }) });
            else { const notice = doc.getElementById?.('householdPlanNotice'); if (notice) notice.hidden = true; }
            return result;
        } catch (error) {
            showHouseholdPlanNotice({ doc, message: `Planumstellung nicht bestätigt: ${error.message} Die bisherigen Daten bleiben verfügbar.`,
                onOpen: () => initializeHouseholdPlanPage({ doc, win, reopen: true, migrate, storage }) });
            return { status: 'failed', error };
        }
    })();
    pageStarts.set(doc, job); return job;
}
export function showHouseholdPlanNotice({ doc, message = 'Planungsdaten können später zusammengeführt werden.', onOpen }) {
    let host = doc.getElementById?.('householdPlanNotice');
    if (!host) { host = doc.createElement('aside'); host.id = 'householdPlanNotice'; host.className = 'ds-note'; (doc.querySelector?.('main') || doc.body).appendChild(host); }
    host.replaceChildren(); host.hidden = false;
    const text = doc.createElement('p'); text.textContent = message;
    const open = doc.createElement('button'); open.type = 'button'; open.className = 'ds-button ds-button-secondary'; open.dataset.householdPlanOpen = ''; open.textContent = 'Planungsdaten zusammenführen';
    open.addEventListener('click', () => onOpen()); host.append(text, open);
    return host;
}
