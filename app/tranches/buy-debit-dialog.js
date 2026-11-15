// VK-2b P2-2 (Gutachten Fable VK2): Jede offene Abbuchung lässt sich bestätigen, auch ohne passende Planzeile (Kauf ohne Plan,
// „Geldmarkt kaufen“). Ein Schritt im Rahmen des geführten Kaufs: je Person „Schon abgegangen“ mit Kontostand oder „Kommt noch“.
// Geschrieben wird nur über den gemeinsamen Haushaltsschreiber (vorhandene Cash-Ereignisse mit Ziel Kauf).
import { createCloseDialog } from '../shared/close-dialog.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { readCashPerson } from '../profile/profile-cash-update.js';
import { openHouseholdRegistry, prepareSaleFlowWrite, commitSaleFlowWrite } from './household-sale-writer.js';
import { readFlowBuys } from './buy-flow-model.js';
import { debitStep } from './buy-flow-steps.js';
import { button, parseMoney } from './sale-flow-steps.js';

/** Offene Abbuchungen je Person (alle Käufe, mit oder ohne Plan). @param {any} registry @param {string[]} ids */
export function pendingDebitPeople(registry, ids) {
    return ids.filter(id => registry?.profiles?.[id]).map(id => {
        const buys = readFlowBuys(registry, [id]).filter(buy => buy.debitPending);
        const cash = readCashPerson(id, '', registry.profiles[id].data || {});
        return { profileId: id, name: registry.profiles[id].meta?.name || 'Person', buys, pending: buys.length > 0,
            cash: Number.isFinite(cash.value) ? /** @type {number} */ (cash.value) : null, cashError: cash.error };
    }).filter(person => person.buys.length);
}

/** Offene Abbuchungen als Hinweisdaten (Datum, Betrag, Person, Kennung). @param {any} registry @param {string[]} ids */
export function openDebitNotes(registry, ids) {
    try {
        return pendingDebitPeople(registry, ids).flatMap(person => person.buys.map(buy => ({ actionId: buy.actionId, profileId: person.profileId, who: person.name,
            date: buy.executedAt.split('-').reverse().join('.'), amount: buy.debit })));
    } catch { return []; }
}

/** Öffnet „Abbuchung eintragen“ für die genannten Personen. @param {{doc?: Document, ids: string[], opener?: HTMLElement|null, onChanged?: () => void}} options */
export function openPendingDebits({ doc = document, ids, opener = null, onChanged = () => {} }) {
    const drafts = /** @type {Record<string, any>} */ ({});
    const guard = getPageNavigationGuard(doc);
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Abbuchung wird gespeichert – bitte warten.' });
    const secondary = button(doc, 'Schließen'), primary = button(doc, 'Speichern', 'ds-button ds-button-primary');
    const people = () => pendingDebitPeople(openHouseholdRegistry(persistenceStorage).registry, ids);
    /** @type {any} */
    let handle = null;
    const step = () => ({ id: 'debit', title: 'Abbuchung', chip: 'Abbuchung', statusLabel: people().length ? 'offen' : 'erledigt', done: !people().length, nextAction: true,
        content: debitStep(doc, { people: people(), missing: [], drafts, lines: [], plan: false, onChange: (id, next, rerender = true) => { drafts[id] = next; if (rerender) refresh(); else footer(); },
            onSettle: () => {} }) });
    const chosen = () => people().filter(person => drafts[person.profileId]?.choice === 'now');
    const footer = () => {
        secondary.onclick = () => handle?.close(false);
        primary.disabled = !chosen().length || Boolean(handle?.busy);
        primary.onclick = () => void save();
        handle?.setStatus(people().length ? `Noch offen: Abbuchung ${people().map(person => person.name).join(' und ')}` : 'Alles eingetragen.');
    };
    const refresh = () => { handle?.updateSteps([step()]); footer(); };
    const save = async () => {
        const debits = [];
        for (const person of chosen()) {
            const draft = drafts[person.profileId] || {};
            const debit = person.buys.reduce((sum, buy) => sum + buy.debit, 0);
            const value = draft.cash !== undefined ? parseMoney(draft.cash) : Math.round((person.cash ?? 0) - debit);
            if (!Number.isFinite(value) || value < 0) { handle?.setMessage(`Bitte für ${person.name} einen gültigen Tagesgeld-Stand eintragen.`); return; }
            debits.push({ profileId: person.profileId, targetActionIds: person.buys.map(buy => buy.actionId), value });
        }
        handle?.setMessage(''); handle?.setBusy(true);
        try {
            await lifecycle.run({}, async operation => {
                const prepared = await prepareSaleFlowWrite({ debits });
                operation.check();
                await commitSaleFlowWrite(prepared, { navigationOperation: operation });
            });
            for (const person of chosen()) delete drafts[person.profileId];
            onChanged();
        } catch (error) {
            const code = /** @type {any} */ (error)?.code || '';
            handle?.setMessage(code === 'HOUSEHOLD_WRITE_STALE' || code === 'persistence_precondition_mismatch'
                ? 'Der Bestand hat sich inzwischen geändert. Bitte schließen und neu öffnen. Es wurde nichts geändert.' : 'Speichern nicht möglich. Es wurde nichts geändert.');
        }
        handle?.setBusy(false);
        refresh();
    };
    handle = createCloseDialog({ doc, id: 'buyDebitDialog', eyebrow: 'Kauf', title: 'Abbuchung eintragen', subtitle: 'Offene Abbuchungen vom Tagesgeld',
        steps: [], actions: [secondary, primary], returnFocus: () => opener?.focus?.() });
    if (!handle) return null;
    handle.root.classList.add('sale-flow-dialog', 'buy-flow-dialog');
    handle.updateSteps([step()]);
    handle.activate('debit');
    footer();
    return handle;
}
