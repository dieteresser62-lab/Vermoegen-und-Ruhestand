import { canExecutePlayAction, preparePlayAction, commitPlayAction, pendingPlayActions, preparePlayCredit } from './balance-play-execution.js';
import { getProbelaufController } from '../shared/probelauf-state.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { requestPageChoice } from '../shared/page-choice-dialog.js';
import { runPageDialog } from '../shared/page-dialog.js';
import { parseMonthlyCashInput } from '../shared/tagesgeld-fields.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';

const bindings = new WeakMap();
const money = amount => `${formatDisplayNumber(amount, { fractionDigits: 2 })} €`;
const price = amount => `${formatDisplayNumber(amount, { fractionDigits: 4 })} €`;

export function describePlayBookings(prepared) {
    const lines = prepared.lines.map(line => line.kind === 'sale'
        ? `- ${line.name}: ${line.asset} für ${money(line.amount)} verkaufen (Kurs ${price(line.price)}). Nach ${money(line.taxes)} Steuern bleiben ${money(line.net)}.`
        : `- ${line.name}: ${line.asset} für ${money(line.amount)} kaufen (Kurs ${price(line.price)}${line.synthetic ? ', Spielkurs' : ''}).`);
    for (const person of prepared.batch.people) if (person.saleIds.length) {
        lines.push(`- ${person.name}: Gutschrift ${money(person.net)} ist danach offen. Käufe von ${money(person.purchaseTotal)} sind beim vorbelegten Tagesgeld-Stand von ${money(person.finalCash)} berücksichtigt.`);
    } else if (person.purchaseTotal) lines.push(`- ${person.name}: Tagesgeld danach ${money(person.finalCash)}.`);
    return `Diese Buchungen werden als Spielwert eingetragen.\n\n${lines.join('\n')}\n\nErst die Bestätigung speichert die Buchungen.`;
}

function requestPlayCredit(batch, { doc, signal, onConfirm }) {
    return runPageDialog({ doc, signal, id: 'balancePlayCreditDialog', title: 'Gutschrift bestätigen',
        description: 'Die Käufe sind bereits eingetragen. Ihr Betrag ist im vorgeschlagenen Tagesgeld nach Gutschrift abgezogen. Alle Beträge sind Spielwerte.' },
    ({ dialog, listen, finish }) => {
        const fields = new Map(), controls = [];
        let saving = false;
        for (const person of batch.people.filter(person => person.saleIds.length)) {
            const text = doc.createElement('p'); text.textContent = `${person.name}: ${money(person.net)} Gutschrift, ${money(person.purchaseTotal)} Käufe.`;
            const label = doc.createElement('label'); label.textContent = `Tagesgeld ${person.name} nach Gutschrift (€)`;
            const field = doc.createElement('input'); field.type = 'text'; field.inputMode = 'decimal'; field.dataset.playCreditPerson = person.profileId;
            field.value = formatDisplayNumber(person.finalCash, { fractionDigits: 2 });
            label.appendChild(field); dialog.append(text, label); fields.set(person.profileId, field); controls.push(field);
        }
        const status = doc.createElement('p'); status.setAttribute('role', 'status');
        const actions = doc.createElement('div'); actions.className = 'ds-actions';
        const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Abbrechen'; cancel.className = 'ds-button ds-button-secondary';
        const accept = doc.createElement('button'); accept.type = 'button'; accept.textContent = 'Gutschrift bestätigen'; accept.className = 'ds-button ds-button-primary'; accept.dataset.playCreditConfirm = '';
        listen(cancel, 'click', () => { if (!saving) finish(false); });
        listen(accept, 'click', async () => {
            if (saving) return;
            try {
                const values = Object.fromEntries([...fields].map(([id, field]) => [id, parseMonthlyCashInput(field.value)]));
                saving = true; controls.forEach(node => { node.disabled = true; }); status.textContent = 'Gutschrift wird gespeichert …';
                await onConfirm(values); saving = false; finish(true);
            } catch (error) {
                saving = false; controls.forEach(node => { node.disabled = false; }); status.textContent = error.message;
            }
        });
        controls.push(cancel, accept); actions.append(cancel, accept); dialog.append(status, actions);
        return { controls: () => controls, blocked: () => saving };
    });
}

/** Der Renderer liefert exakt die dargestellten Quellen, Verwendungen und Cashaufteilung. */
export function renderBalancePlayExecution(doc, entries = null) {
    const button = doc?.getElementById?.('balancePlayExecute');
    if (!button) return;
    let state = bindings.get(doc);
    if (!state) {
        state = { entries: null, busy: false, revision: 0, lifecycle: createNavigationOperationLifecycle({ guard: getPageNavigationGuard(doc) }) };
        bindings.set(doc, state);
        const execute = async credit => {
            if (state.busy) return;
            const controller = getProbelaufController(doc);
            const status = doc.getElementById('balancePlayExecutionStatus');
            state.busy = true; refresh();
            try {
                await state.lifecycle.run({}, async operation => {
                    if (!canExecutePlayAction(controller)) throw new Error('Bitte den aktiven Spielbereich prüfen.');
                    if (credit) {
                        const batch = pendingPlayActions()[0];
                        if (!batch) throw new Error('Keine ausstehende Gutschrift vorhanden.');
                        await requestPlayCredit(batch, { doc, signal: operation.controller.signal,
                            onConfirm: async values => {
                                const prepared = await preparePlayCredit(batch.id, { controller, values });
                                await commitPlayAction(prepared, { controller, navigationOperation: operation });
                                status.textContent = 'Gutschrift als Spielwert bestätigt.'; changed();
                            } });
                    } else {
                        const revision = state.revision;
                        const prepared = await preparePlayAction({ entries: state.entries, controller });
                        await requestPageChoice({ doc, signal: operation.controller.signal, title: 'Anweisung als ausgeführt eintragen',
                            description: describePlayBookings(prepared), confirmLabel: 'Buchungen eintragen', cancelLabel: 'Abbrechen',
                            onConfirm: async () => {
                                await commitPlayAction(prepared, { controller, navigationOperation: operation,
                                    validate: () => { if (revision !== state.revision) throw new Error('Die Anweisung wurde geändert. Bitte neu öffnen.'); } });
                                status.textContent = 'Buchungen als Spielwert eingetragen.'; changed();
                            } });
                    }
                });
            } catch (error) { if (error.name !== 'AbortError') status.textContent = error.message; }
            finally { state.busy = false; refresh(); }
        };
        button.addEventListener('click', () => execute(false));
        doc.getElementById('balancePlayCredit')?.addEventListener('click', () => execute(true));
    }
    if (entries !== null) { state.entries = structuredClone(entries); state.revision++; }
    function changed() {
        doc.dispatchEvent(new Event('balance-play-booked'));
    }
    function refresh() {
        const allowed = canExecutePlayAction(getProbelaufController(doc));
        let pending = [];
        try { if (allowed) pending = pendingPlayActions(); } catch { /* Erfassung prüft und meldet beschädigten Auditbestand. */ }
        const material = state.entries?.some(entry => (entry.action.quellen || []).some(q => q.brutto > 0)
            || ['aktien', 'gold', 'bonds', 'geldmarkt'].some(key => entry.action.verwendungen?.[key] > 0));
        button.hidden = !allowed || !material;
        button.disabled = state.busy || pending.length > 0;
        const credit = doc.getElementById('balancePlayCredit');
        if (credit) {
            credit.hidden = !allowed || !pending.length; credit.disabled = state.busy;
            const amount = doc.getElementById('balancePlayCreditAmount');
            if (amount) amount.textContent = pending.length ? `${money(pending[0].people.reduce((sum, person) => sum + person.net, 0))} · Spielwert` : '';
        }
    }
    refresh();
}
