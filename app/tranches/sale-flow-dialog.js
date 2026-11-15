// FR-79: geführter Verkauf als Abschlussdialog (Rahmen `createCloseDialog`). Ein Ablauf, zwei Einstiege: mit Planbezug aus der
// Balance („Verkauf starten“, „Weiter mit Schritt n“), ohne Planbezug aus Personen & Vermögen („Verkauf eintragen“).
// Geschrieben wird nur über den gemeinsamen Haushaltsschreiber; Schritt 1 und 2 speichern nichts (Entscheidung 3).
import { createCloseDialog } from '../shared/close-dialog.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { readCashPerson } from '../profile/profile-cash-update.js';
import { readAnnualPlanResolutions, KEEP_IN_DEPOT } from '../profile/annual-plan-resolutions.js';
import { projectAnnualActionProgress, readAnnualActionSales, annualActionAssetClass, annualActionDecisionDay } from '../balance/annual-action-progress.js';
import { openHouseholdRegistry, prepareSaleFlowWrite, commitSaleFlowWrite } from './household-sale-writer.js';
import { projectSaleFlowLines, projectSaleFlowState, bankOrderTranches, allocateBankOrder, splitOrder, settleSale, restQuestionAmount,
    distributeCredits, moneyMarketBought, trancheTypeName, shownPrice, cashBeforeCredits, settlementReady, saleStartTrancheId } from './sale-flow-model.js';
import { overviewStep, sellStep, trancheChoice, settleStep, creditStep, distributeStep, personSegment, el, button, euro, flowNumber, joinNames, parseMoney, parseQuantity, parseShares, quoteDate, shownPlanTotal } from './sale-flow-steps.js';
import { openMoneyMarketBuy } from './buy-flow-dialog.js';
import { buyRestLimit } from './buy-flow-model.js';

const open = new WeakMap();
const bound = new WeakSet();
const PLAN_STEPS = /** @type {const} */ (['overview', 'sell', 'settle', 'credit', 'distribute']);
const FREE_STEPS = /** @type {const} */ (['sell', 'settle', 'credit']);
const TITLES = { overview: 'Überblick', sell: 'Verkaufen', settle: 'Abrechnung', credit: 'Gutschrift', distribute: 'Geld verteilen' };

/** Ist der Ablauf in diesem Dokument offen (dann kein Auto-Reload bei Rückkehr in die Seite). @param {Document} doc */
export const isSaleFlowOpen = doc => open.has(doc);
/** Versprechen auf das Schließen des offenen Ablaufs (sonst sofort erfüllt). @param {Document} doc @returns {Promise<unknown>} */
export const saleFlowClosed = doc => open.get(doc)?.closed ?? Promise.resolve();

/** Geldmarkt je Person: Tranche als Vorlage, Kurs und schon gekaufter Betrag seit dem Beschluss.
 * @param {any} registry @param {string[]} ids @param {{year: number, decidedOn?: string|null}} plan */
export function moneyMarketByPerson(registry, ids, plan) {
    return Object.fromEntries(ids.map(id => {
        let tranches = [];
        try { tranches = JSON.parse(registry?.profiles?.[id]?.data?.depot_tranchen || '[]'); } catch { tranches = []; }
        const tranche = tranches.find((/** @type {any} */ item) => annualActionAssetClass(item) === 'money_market' && item.shares > 0)
            || tranches.find((/** @type {any} */ item) => annualActionAssetClass(item) === 'money_market') || null;
        return [id, { tranche, price: shownPrice(tranche?.currentPrice), bought: moneyMarketBought(tranches, plan), open: 0, due: false }];
    }));
}

/** Verteilung der Gutschriften aus dem Plan (Schritt 5 und Zeile „Geldmarkt kaufen“ in „Was zu tun ist“). Alle Personen des Plans
 * zählen mit ihrem Tagesgeld vor den Gutschriften zur Lücke (Gutachten VK-1 P1-01, P2-3). Ist ein Tagesgeld nicht lesbar, gibt es
 * keine Verteilung, sondern die Namen in `unreadable`.
 * @param {{lines: any[], registry: any, people: {id: string, name: string}[], cashContext: {householdTarget: number, targets: Record<string, number>}|null, plan: {year: number, decidedOn?: string|null}}} options */
export function projectSaleFlowDistribution({ lines, registry, people, cashContext, plan }) {
    if (!cashContext || !Number.isFinite(cashContext.householdTarget)) return null;
    const sales = lines.flatMap(line => line.sales);
    if (!sales.some(sale => sale.net > 0.004)) return null;
    const rows = people.map(person => {
        const own = sales.filter(sale => sale.profileId === person.id);
        const credit = own.reduce((sum, sale) => sum + sale.net, 0);
        const cash = readCashPerson(person.id, person.name, registry?.profiles?.[person.id]?.data || {}).value;
        return { profileId: person.id, name: person.name, credit: Math.max(0, Math.round(credit * 100) / 100),
            cashBefore: cashBeforeCredits(own, Number.isFinite(cash) ? /** @type {number} */ (cash) : null), target: cashContext.targets?.[person.id] ?? 0 };
    });
    const unreadable = rows.filter(row => row.cashBefore === null).map(row => row.name);
    const pending = new Set(sales.filter(sale => sale.creditPending).map(sale => sale.profileId));
    if (unreadable.length) return { distribution: null, moneyMarket: {}, pending, unreadable };
    const distribution = distributeCredits({ people: /** @type {any[]} */ (rows), householdTarget: cashContext.householdTarget });
    const moneyMarket = moneyMarketByPerson(registry, people.map(person => person.id), plan);
    for (const row of distribution.rows) {
        const item = moneyMarket[row.profileId];
        item.open = Math.max(0, row.toMoneyMarket - item.bought);
        // Gutachten VK-1 P2-4, VK-2 Nachtrag 3: erledigt, solange weniger offen ist als das Größere aus einem Stück zum letzten Kurs
        // (mit Kurspuffer) und der Erledigt-Grenze nach FR-77 – dieselbe Regel wie bei Käufen aus dem Plan.
        item.due = !pending.has(row.profileId) && row.toMoneyMarket >= 0.5 && item.open >= Math.max(0.5, buyRestLimit(row.toMoneyMarket, item.price));
    }
    return { distribution, moneyMarket, pending, unreadable };
}

/** Planlesung für Dialog und Karte. @param {{plan: {year: number, decidedOn?: string|null, action: any, people: {id: string, name: string}[]}, registry: any}} options */
export function readSaleFlowPlan({ plan, registry }) {
    const ids = plan.people.map(person => person.id);
    const resolutions = readAnnualPlanResolutions({ year: plan.year, ids });
    const progress = projectAnnualActionProgress({ action: plan.action, year: plan.year, decidedOn: plan.decidedOn ?? null,
        sales: readAnnualActionSales(registry, ids), defaultProfileId: ids.length === 1 ? ids[0] : null, resolutions: resolutions.lines });
    const lines = projectSaleFlowLines({ action: plan.action, progress, registry, people: plan.people, decidedOn: plan.decidedOn ?? null, year: plan.year });
    return { ids, resolutions, progress, lines };
}

/** Plan des Ablaufs aus dem bestätigten Jahresbeleg der Balance. Personen aus dem Planbereich, Namen aus der Registry.
 * @param {any} confirmed @param {string[]} ids @param {any} registry */
export function saleFlowPlanFromConfirmed(confirmed, ids, registry) {
    if (!confirmed?.action || !Array.isArray(ids) || !ids.length) return null;
    const decidedOn = annualActionDecisionDay(confirmed.committedAt);
    return { year: confirmed.year, decidedOn, decidedLabel: decidedOn ? decidedOn.split('-').reverse().join('.') : '', action: confirmed.action,
        people: ids.filter(id => registry?.profiles?.[id]).map(id => ({ id, name: registry.profiles[id].meta?.name || 'Person' })) };
}

/** Kauflink in Personen & Vermögen: „Kauf eintragen“ mit dem Geldmarkt-ETF der Person vorbelegt (VK-2 ersetzt ihn durch den geführten Kauf).
 * @param {{profileId: string, toMoneyMarket?: number}} row @param {{tranche?: any, open?: number}|undefined} moneyMarket */
export function moneyMarketBuyHref(row, moneyMarket) {
    const amount = Math.round((moneyMarket?.open ?? row.toMoneyMarket ?? 0) * 100) / 100;
    const tranche = moneyMarket?.tranche?.trancheId ? `&tranche=${encodeURIComponent(moneyMarket.tranche.trancheId)}` : '';
    return `depot-tranchen-manager.html?person=${encodeURIComponent(row.profileId)}${tranche}&betrag=${amount.toFixed(2)}#kauf`;
}

/** Stand des Ablaufs für die Karte „Was zu tun ist“ (FR-79 Punkt 2, Ergänzung 1 Punkte 6 und 7): Schritte aus Eingetragenem,
 * „Weiter mit Schritt n“ bis zur Gutschrift, danach je Person die offene Zeile „Geldmarkt kaufen“.
 * @param {{plan: any, registry: any, cashContext?: any}} options */
export function projectSaleFlowCard({ plan, registry, cashContext = null }) {
    const result = readSaleFlowPlan({ plan, registry });
    if (!result.lines.length) return null;
    const distribution = projectSaleFlowDistribution({ lines: result.lines, registry, people: plan.people, cashContext, plan });
    const flow = projectSaleFlowState(result.lines, { distributionDone: true });
    const started = flow.sales.length > 0 || result.lines.some(line => line.keptInDepot);
    const pendingNames = [...new Set(flow.pending.map((/** @type {any} */ sale) => plan.people.find((/** @type {any} */ person) => person.id === sale.profileId)?.name))].filter(Boolean);
    const kept = Boolean(result.resolutions.distribution?.keepCash);
    // Gutachten VK-1 P2-05: Zeile auch ohne Geldmarkt-Tranche; der Kauf öffnet dann mit Anlageform Geldmarkt und Betrag.
    const buys = flow.complete && !kept && distribution?.distribution ? distribution.distribution.rows.filter((/** @type {any} */ row) => distribution.moneyMarket[row.profileId]?.due)
        .map((/** @type {any} */ row) => ({ profileId: row.profileId, name: row.name, amount: distribution.moneyMarket[row.profileId].open,
            href: moneyMarketBuyHref(row, distribution.moneyMarket[row.profileId]) })) : [];
    // TRG-1b (P3-9): Ist ein Tagesgeld nicht lesbar, ist „Verteilen“ nicht erledigt; die Karte führt in Schritt 5 mit dem Hinweis.
    const unreadable = flow.complete && !kept && !flow.pending.length && distribution?.unreadable?.length ? distribution.unreadable : [];
    const titles = ['Überblick', 'Verkaufen', 'Abrechnung', 'Gutschrift', 'Verteilen'];
    const done = [flow.steps.overview.done, flow.steps.sell.done, flow.steps.settle.done, flow.steps.credit.done,
        buys.length === 0 && flow.complete && !flow.pending.length && !unreadable.length];
    return { started, next: unreadable.length ? 5 : flow.next === 5 || flow.next === null ? null : flow.next, steps: titles.map((title, index) => ({ title, done: Boolean(done[index]) })),
        allEntered: flow.complete, pendingNames, buys, unreadable, lines: result.lines };
}

/** Entscheidung „Rest bleibt im Depot“ für eine Planzeile und die übrigen offenen Zeilen ihrer Gruppe; die Rücknahme gilt allen
 * Zeilen der Gruppe mit dieser Entscheidung (Gutachten VK-1 P3-6). @param {any[]} lines @param {string} key @param {boolean} keep @param {string} [reason] */
export function groupDecision(lines, key, keep, reason = '') {
    const line = lines.find(item => item.key === key);
    const keys = line?.group?.keys || [key];
    const members = lines.filter(item => keys.includes(item.key));
    const chosen = keep ? members.filter(item => item.key === key || item.status !== 'erledigt') : members.filter(item => item.key === key || item.keptInDepot);
    return (chosen.length ? chosen : [{ key }]).map(item => ({ key: item.key, decision: keep ? KEEP_IN_DEPOT : null, ...(keep && reason ? { reason } : {}) }));
}

/** Bindet Start, Fortsetzen und „Rest doch verkaufen“ der Karte in der Balance an den Ablauf. Nach einer Änderung lädt die Seite neu.
 * @param {HTMLElement} host @param {() => {plan: any, cashContext?: any}|null} context */
export function bindSaleFlowCard(host, context) {
    if (bound.has(host)) return;
    bound.add(host);
    const doc = host.ownerDocument;
    const reload = () => void getPageNavigationGuard(doc).reload({ flush: () => PersistenceFacade.flush(), reload: () => doc.defaultView?.location?.reload?.() }).catch(() => {});
    host.addEventListener('click', event => {
        const target = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target)?.closest?.('[data-sale-flow-start], [data-sale-flow-revoke], [data-sale-flow-keep]'));
        if (!target) return;
        const current = context();
        if (!current?.plan) return;
        event.preventDefault();
        const decide = target.dataset.saleFlowRevoke ?? target.dataset.saleFlowKeep;
        if (decide !== undefined) {
            // „Rest doch verkaufen“ und (Gutachten VK-1 P3-2) „Rest bleibt im Depot“ aus der Karte, je Gruppe derselben Person und Anlageklasse.
            const keep = target.dataset.saleFlowKeep !== undefined;
            const lifecycle = createNavigationOperationLifecycle({ guard: getPageNavigationGuard(doc), message: 'Entscheidung wird gespeichert – bitte warten.' });
            void lifecycle.run({}, async operation => {
                const lines = readSaleFlowPlan({ plan: current.plan, registry: openHouseholdRegistry(persistenceStorage).registry }).lines;
                const prepared = await prepareSaleFlowWrite({ resolution: { year: current.plan.year, ids: current.plan.people.map((/** @type {any} */ person) => person.id),
                    lines: groupDecision(lines, decide, keep) } });
                operation.check();
                await commitSaleFlowWrite(prepared, { navigationOperation: operation });
            }).then(reload, () => { target.setAttribute('title', 'Speichern nicht möglich. Bitte die Seite neu laden.'); });
            return;
        }
        let changed = false, buy = null;
        const handle = openSaleFlow({ doc, plan: current.plan, cashContext: current.cashContext ?? null, startStep: Number(target.dataset.saleFlowStart) || 1,
            opener: target, onChanged: () => { changed = true; }, buyHref: moneyMarketBuyHref,
            // VK-2: „Geldmarkt kaufen“ in Schritt 5 schließt den Verkauf und öffnet den geführten Kauf vorbelegt.
            onBuy: (/** @type {any} */ row, /** @type {any} */ mm) => { buy = { row, mm }; handle?.close(true); } });
        void handle?.closed.then(() => {
            if (!buy) { if (changed) reload(); return; }
            const next = openMoneyMarketBuy(doc, buy.row.profileId, buy.mm?.open ?? buy.row.toMoneyMarket ?? 0, target, () => { changed = true; });
            void (next ? next.closed : Promise.resolve()).then(() => { if (changed) reload(); });
        });
    });
}

/**
 * Öffnet den Ablauf. Mit `plan` fünf Schritte, ohne Plan drei (Verkaufen → Abrechnung → Gutschrift) für `profileId`.
 * @param {{doc?: Document, plan?: {year: number, decidedOn?: string|null, decidedLabel?: string, action: any, people: {id: string, name: string}[]}|null,
 * profileId?: string|null, trancheId?: string|null, cashContext?: {householdTarget: number, targets: Record<string, number>, months?: number}|null,
 * startStep?: number|null, opener?: HTMLElement|null, onChanged?: () => void, buyHref?: (row: any, moneyMarket: any) => string|null,
 * onBuy?: ((row: any, moneyMarket: any) => void)|null}} options
 */
export function openSaleFlow({ doc = document, plan = null, profileId = null, trancheId = null, cashContext = null, startStep = null, opener = null,
    onChanged = () => {}, buyHref = () => null, onBuy = null }) {
    if (open.has(doc)) return open.get(doc);
    const mode = plan ? 'plan' : 'free';
    const stepIds = mode === 'plan' ? PLAN_STEPS : FREE_STEPS;
    const guard = getPageNavigationGuard(doc);
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Verkauf wird gespeichert – bitte warten.' });
    const state = { drafts: /** @type {Record<string, any>} */ ({}), credits: /** @type {Record<string, any>} */ ({}), person: /** @type {Record<string, string>} */ ({}),
        model: /** @type {any} */ (null), revision: 0, current: '' };
    const today = () => localCalendarDate(appNow());
    // RK-4 (FR-82): Das Tranchenfeld beginnt mit der Tranche, die die Bank zuerst verkauft.
    const draftFor = (/** @type {any} */ line) => (state.drafts[line.key] ||= { executedAt: today(), openedOn: today(), trancheId: saleStartTrancheId(line),
        initialTrancheId: saleStartTrancheId(line),
        actionId: `sale-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}` });
    // Gutachten VK-1 P3-03: jede Eingabe zählt (Stück, Tranche, Tag, Ordernummer, Rest-Entscheidung, Warum, Kontostand).
    const dirty = () => Object.values(state.drafts).some(draft => ['price', 'fees', 'taxes', 'credit', 'orderNo', 'reason'].some(field => String(draft[field] ?? '').trim())
        || draft.sharesEdited || draft.shares !== undefined || draft.restDecision === 'keep' || draft.fromCredit
        || draft.executedAt !== draft.openedOn || draft.trancheId !== draft.initialTrancheId)
        || Object.values(state.credits).some(draft => draft.choice === 'now' || draft.cash !== undefined);
    const owner = Symbol('sale-flow');
    const registration = guard.register(owner, { read: () => ({ phase: 'idle', dirty: dirty(), revision: state.revision,
        message: 'Ungespeicherte Eingaben im Verkauf gehen verloren.' }), cancel: () => { handle?.close(false); return true; } });
    const secondary = button(doc, ''), primary = button(doc, '', 'ds-button ds-button-primary');
    secondary.dataset.saleFlowSecondary = ''; primary.dataset.saleFlowPrimary = '';
    const play = (() => { try { return PersistenceFacade.getPersistenceStatus().activeArea === 'spiel'; } catch { return false; } })();

    const read = () => {
        const { registry } = openHouseholdRegistry(persistenceStorage);
        if (mode === 'plan' && plan) {
            const result = readSaleFlowPlan({ plan, registry });
            const distribution = projectSaleFlowDistribution({ lines: result.lines, registry, people: plan.people, cashContext, plan });
            const kept = Boolean(result.resolutions.distribution?.keepCash);
            const distributionDone = kept || Boolean(distribution?.distribution && distribution.distribution.rows.every((/** @type {any} */ row) =>
                !distribution.moneyMarket[row.profileId]?.due) && !distribution.pending.size);
            return { registry, ...result, distribution, kept, flow: projectSaleFlowState(result.lines, { distributionDone }) };
        }
        const person = registry.profiles[/** @type {string} */ (profileId)];
        if (!person) throw new Error('Die Person ist nicht mehr vorhanden.');
        const tranches = (JSON.parse(person.data.depot_tranchen || '[]') || []).filter((/** @type {any} */ item) => item?.shares > 0);
        // VN-1 Punkt 2: Ohne vorgegebene Tranche wählt der Nutzer; nur eine einzige verkaufbare Tranche ist vorgewählt.
        const chosen = tranches.find((/** @type {any} */ item) => item.trancheId === (state.drafts.free?.trancheId ?? trancheId)) || (tranches.length === 1 ? tranches[0] : null);
        const line = { key: 'free', index: 0, profileId, name: person.meta.name, tranche: chosen, tranches, price: shownPrice(chosen?.currentPrice),
            security: { name: chosen?.name || 'Wertpapier', isin: chosen?.isin || '', ticker: chosen?.ticker || '', typeName: trancheTypeName(chosen), shares: chosen?.shares ?? null },
            planNet: 0, planTax: 0, restNet: 0, soldNet: 0, status: 'offen', keptInDepot: false, sales: [],
            suggestion: { shares: 0, gross: 0, taxes: 0, net: 0 }, bank: { differs: false, parts: [], tax: null, planTax: 0, planShares: 0 } };
        return { registry, lines: [line], ids: [profileId], flow: null, distribution: null, kept: false };
    };

    const linePeople = () => state.model.lines.map((/** @type {any} */ line) => ({ id: line.key, label: line.status === 'erledigt'
        ? `${line.name} · eingetragen` : `${line.name} · ${euro(line.restNet || line.planNet)}`, done: line.status === 'erledigt' }));
    const selected = (/** @type {string} */ step) => {
        const lines = state.model.lines;
        const keep = lines.find((/** @type {any} */ line) => line.key === state.person[step]);
        if (keep) return keep;
        const first = lines.find((/** @type {any} */ line) => step === 'sell' ? !line.sales.length && line.status !== 'erledigt' : line.status !== 'erledigt') || lines[0];
        state.person[step] = first?.key; return first;
    };
    const subtitleText = () => {
        if (mode === 'free') return `${state.model.lines[0].name} · Verkauf ohne Planbezug`;
        const lines = state.model.lines, names = joinNames(plan.people.map(person => person.name)).replace(' und ', ' + ');
        const entered = lines.filter((/** @type {any} */ line) => line.sales.length || line.keptInDepot).length;
        const pending = [...new Set(state.model.flow.pending.map((/** @type {any} */ sale) => lines.find((/** @type {any} */ line) => line.profileId === sale.profileId)?.name))].filter(Boolean);
        // Summe der gezeigten ganzen Euro, wie die Zeile „Zusammen“ im Überblick.
        const total = shownPlanTotal(lines);
        if (entered === lines.length && lines.length) return `${names} · ${lines.length === 2 ? 'beide Verkäufe' : 'alle Verkäufe'} eingetragen${pending.length ? ` · Gutschrift ${joinNames(pending)} offen` : ''}`;
        return `${names} · ${lines.length} ${lines.length === 1 ? 'Verkauf' : 'Verkäufe'} · Plan ${flowNumber(total)} € netto · ${entered ? `${entered} von ${lines.length} eingetragen` : 'noch nichts eingetragen'}`;
    };
    const openText = () => {
        const lines = state.model.lines;
        const parts = [];
        const unsold = lines.filter((/** @type {any} */ line) => line.status !== 'erledigt');
        if (unsold.length) parts.push(unsold.map((/** @type {any} */ line) => `${line.status === 'teilweise' ? 'Rest ' : ''}Verkauf ${line.name}`).join(', '));
        if (mode === 'plan') {
            const pending = [...new Set(state.model.flow.pending.map((/** @type {any} */ sale) => plan.people.find(person => person.id === sale.profileId)?.name))].filter(Boolean);
            if (pending.length) parts.push(`Gutschrift ${joinNames(/** @type {string[]} */ (pending))}`);
            const buy = state.model.distribution?.distribution && !state.model.kept ? state.model.distribution.distribution.rows.filter((/** @type {any} */ row) =>
                state.model.distribution.moneyMarket[row.profileId]?.due).map((/** @type {any} */ row) => row.name) : [];
            if (buy.length && state.current === 'distribute') parts.push(`Geldmarktkauf ${joinNames(buy)}`);
        }
        return parts.length ? `Noch offen: ${parts.join(' · ')}` : 'Alles eingetragen.';
    };

    const steps = () => stepIds.map(id => {
        const flow = state.model.flow;
        const info = mode === 'plan' ? flow.steps[id] : { label: 'offen', done: false };
        return { id, title: TITLES[id], chip: TITLES[id], statusLabel: info.label, done: info.done, nextAction: true, content: content(id) };
    });

    const content = (/** @type {string} */ id) => {
        const lines = state.model.lines;
        const wrap = el(doc, 'div', 'sale-flow-step'); wrap.dataset.saleFlowStep = id;
        if (id === 'overview') {
            wrap.append(overviewStep(doc, { lines, decidedOn: plan?.decidedLabel || '', quoteDate: quoteDate(lines[0]?.priceAsOf) || today(), play, people: plan?.people || [] }));
            return wrap;
        }
        if (id === 'sell' || id === 'settle') {
            const line = selected(id), index = lines.indexOf(line);
            const top = el(doc, 'div', 'sale-flow-top');
            if (lines.length > 1) top.append(segment(id));
            else top.append(el(doc, 'span'));
            if (id === 'settle' && mode === 'plan') top.append(el(doc, 'span', 'ds-source', `Verkauf ${index + 1} von ${lines.length} · ${line.security.name} · ${line.security.typeName}${line.security.isin ? ` · ${line.security.isin}` : ''}`));
            else if (lines.length > 1) top.append(el(doc, 'span', 'ds-source', `Verkauf ${index + 1} von ${lines.length}`));
            wrap.append(top);
            const draft = draftFor(line);
            if (id === 'sell' && mode === 'free') {
                wrap.append(trancheChoice(doc, line, trancheId => { state.drafts[line.key] = Object.assign(draft, { trancheId }); state.revision++; registration.notify(); refresh(true); }));
                if (!line.tranche) return wrap;
            }
            if (id === 'sell') wrap.append(sellStep(doc, line, { draft, number: index + 1, count: lines.length, quoteDate: quoteDate(line.priceAsOf) || today(), tranches: line.tranches, plan: mode === 'plan',
                onPrint: () => globalThis.print?.(), onChange: next => { state.drafts[line.key] = next; state.revision++; registration.notify(); refresh(true); } }));
            else {
                wrap.append(settleStep(doc, line, { draft, plan: mode === 'plan', tranches: line.tranches, scope: plan ? { year: plan.year, decidedOn: plan.decidedOn ?? null } : null,
                    onChange: (next) => { state.drafts[line.key] = next; state.revision++; registration.notify(); handle?.setMessage(''); refresh(true); },
                    onKeepRevoke: () => void writeResolution(line, null), onAnother: () => { state.drafts[line.key] = { ...draft, another: true }; refresh(); refocus('[data-sale-flow-step="settle"] input'); } }));
            }
            return wrap;
        }
        if (id === 'credit') {
            wrap.append(creditStep(doc, { people: creditPeople(), drafts: state.credits,
                onChange: (person, next) => { state.credits[person] = next; state.revision++; registration.notify(); handle?.setMessage(''); refresh(true); } }));
            return wrap;
        }
        const view = state.model.distribution;
        if (!view) { wrap.append(el(doc, 'p', 'ds-note', 'Noch keine Gutschrift aus dem Plan. Das Verteilen folgt nach der Abrechnung.')); return wrap; }
        if (!view.distribution) {
            wrap.append(el(doc, 'p', 'ds-note ds-note-warning', `Das Tagesgeld von ${joinNames(view.unreadable)} ist nicht lesbar. Trag den Stand unter Personen & Vermögen ein; dann rechnet die App die Verteilung.`));
            return wrap;
        }
        wrap.append(distributeStep(doc, { distribution: view.distribution, moneyMarket: view.moneyMarket, months: cashContext?.months ?? 12, pending: view.pending,
            kept: state.model.kept, buyHref: row => buyHref(row, view.moneyMarket[row.profileId]), onKeepCash: keep => void writeResolution(null, null, keep),
            onBuy: onBuy ? row => onBuy(row, view.moneyMarket[row.profileId]) : null }));
        return wrap;
    };
    const segment = (/** @type {string} */ step) => personSegment(doc, linePeople(), state.person[step], id => { state.person[step] = id; refresh(); refocus(`[data-sale-flow-person="${id}"]`); });
    const creditPeople = () => {
        const lines = state.model.lines;
        const people = mode === 'plan' ? plan.people : [{ id: profileId, name: lines[0].name }];
        if (mode === 'free') {
            const line = lines[0], draft = draftFor(line), values = draftSettlement(line, draft);
            const cash = readCashPerson(/** @type {string} */ (profileId), line.name, state.model.registry.profiles[/** @type {string} */ (profileId)].data);
            return Number.isFinite(values.net) ? [{ profileId, name: line.name, pending: true, cash: cash.value, cashError: cash.error,
                sales: [{ executedAt: draft.executedAt, shares: values.shares, gross: values.gross, fees: values.fees, taxes: values.taxes, net: values.net }] }] : [];
        }
        return people.map(person => {
            const sales = lines.flatMap((/** @type {any} */ line) => line.sales).filter((/** @type {any} */ sale) => sale.profileId === person.id);
            const cash = readCashPerson(person.id, person.name, state.model.registry.profiles[person.id]?.data || {});
            return { profileId: person.id, name: person.name, sales, pending: sales.some((/** @type {any} */ sale) => sale.creditPending), cash: cash.value, cashError: cash.error };
        }).filter(person => person.sales.length);
    };
    const draftSettlement = (/** @type {any} */ line, /** @type {any} */ draft) => {
        const shares = draft.sharesEdited ? parseShares(draft.shares) : (draft.shares ?? line.suggestion.shares);
        const fees = parseMoney(draft.fees), taxes = parseMoney(draft.taxes);
        const result = settleSale({ shares, price: parseQuantity(draft.price), fees: Number.isFinite(fees) ? fees : 0, taxes: Number.isFinite(taxes) ? taxes : 0,
            credit: parseMoney(draft.credit), fromCredit: Boolean(draft.fromCredit) });
        return { shares, ...result };
    };

    const updateFooter = () => {
        const id = state.current;
        handle?.setStatus(openText());
        const lines = state.model.lines;
        const set = (/** @type {HTMLButtonElement} */ node, /** @type {string} */ label, /** @type {(() => void)|null} */ action, disabled = false) => {
            node.hidden = !label; node.textContent = label; node.disabled = disabled || Boolean(handle?.busy); node.onclick = action;
        };
        const complete = mode === 'plan' && state.model.flow.complete;
        const finish = () => handle?.close(true);
        if (id === 'overview') {
            set(secondary, complete ? 'Weiter zum Verkaufen' : '', () => handle?.activate('sell'));
            set(primary, complete ? 'Verkauf abschließen' : 'Weiter zum Verkaufen', complete ? finish : () => handle?.activate('sell'));
        } else if (id === 'sell') {
            const line = selected('sell');
            const next = lines.find((/** @type {any} */ item) => item !== line && item.status !== 'erledigt' && !item.sales.length);
            set(secondary, next ? `Weiter zu ${next.name}` : mode === 'free' ? '' : 'Zurück', next ? () => { state.person.sell = next.key; refresh(); } : () => handle?.activate('overview'));
            set(primary, 'Ausgeführt? Abrechnung eintragen', () => { state.person.settle = line.key; handle?.activate('settle'); }, !line?.tranche);
        } else if (id === 'settle') {
            const line = selected('settle');
            const draft = draftFor(line), values = draftSettlement(line, draft);
            const ready = line.status !== 'erledigt' || draft.another;
            set(secondary, 'Zurück', () => handle?.activate('sell'));
            // Gutachten VK-1 P2-03: dieselbe Sperre wie mit Plan (Netto und Stück größer 0, Steuern lesbar).
            const invalid = !settlementReady(values);
            if (mode === 'free') set(primary, 'Weiter zur Gutschrift', () => handle?.activate('credit'), invalid || !line.tranche);
            else if (!ready) {
                const nextLine = lines.find((/** @type {any} */ item) => item.status !== 'erledigt');
                set(primary, nextLine ? `Weiter zu ${nextLine.name}` : 'Weiter zur Gutschrift', nextLine ? () => { state.person.settle = nextLine.key; refresh(); } : () => handle?.activate('credit'));
            } else set(primary, 'Verkauf eintragen und weiter', () => void writeSale(line), invalid);
        } else if (id === 'credit') {
            const people = creditPeople();
            if (mode === 'free') {
                set(secondary, 'Zurück', () => handle?.activate('settle'));
                const values = draftSettlement(lines[0], draftFor(lines[0]));
                set(primary, 'Verkauf eintragen', () => void writeSale(lines[0]), !people.length || !settlementReady(values));
            } else {
                set(secondary, 'Später weitermachen', () => handle?.close(false));
                const choose = people.filter(person => person.pending && state.credits[person.profileId]?.choice === 'now');
                // VN-1 Punkt 3: Ist noch eine Verkaufszeile offen, führt der Ablauf nach der Gutschrift dorthin, sonst zum Verteilen.
                const open = lines.find((/** @type {any} */ line) => line.status !== 'erledigt');
                const target = open ? `zu ${open.status === 'teilweise' ? 'Rest ' : ''}Verkauf ${open.name}` : 'zum Verteilen';
                set(primary, choose.length ? `Speichern und weiter ${target}` : `Weiter ${target}`, choose.length ? () => void writeCredits(choose) : () => continueAfterCredit());
            }
        } else if (id === 'distribute') {
            set(secondary, 'Später weitermachen', () => handle?.close(false));
            set(primary, 'Verkauf abschließen', finish, !complete);
        }
    };

    const fail = (/** @type {any} */ error) => {
        const code = error?.code || '';
        const stale = code === 'persistence_precondition_mismatch' || code === 'HOUSEHOLD_WRITE_STALE';
        // Gutachten VK-1 P3-5: Nach geändertem Bestand lädt die Seite beim Schließen neu, auch ohne eigene Änderung.
        if (stale) onChanged();
        const text = code === 'RECONCILIATION_ACTION_CONFLICT' ? 'Diese Ordernummer gehört am selben Ausführungstag schon zu einer anderen Abrechnung. Bitte Ordernummer und Tag prüfen.'
            : stale ? 'Der Bestand hat sich inzwischen geändert. Bitte den Verkauf schließen und neu öffnen.'
                : code === 'ANNUAL_OPERATION_BUSY' ? 'Eine andere Seite speichert gerade. Bitte kurz warten und erneut versuchen.'
                    // Gutachten VK-1 P3-7: Prüffehler des Belegs in Worten statt technisch.
                    : /^RECONCILIATION_(NUMBER|FEES|ACTION_INVALID|DATE)/.test(code) || code === 'SALE_FLOW_NO_PARTS'
                        ? 'Die Abrechnung passt so nicht zum Bestand. Bitte Stückzahl, Kurs, Gebühren und Steuern prüfen.'
                        : error?.message || 'Speichern nicht möglich.';
        handle?.setMessage(`${text} Es wurde nichts geändert, wenn nicht ausdrücklich gemeldet.`);
    };
    const run = async (/** @type {() => Promise<any>} */ prepare, /** @type {() => void} */ after) => {
        if (handle?.busy) return false;
        handle?.setMessage(''); handle?.setBusy(true); handle?.setStatus('Wird gespeichert …');
        try {
            await lifecycle.run({}, async operation => {
                const prepared = await prepare();
                operation.check();
                await commitSaleFlowWrite(prepared, { navigationOperation: operation });
            });
            handle?.setBusy(false);
            onChanged(); after(); refresh();
            return true;
        } catch (error) {
            handle?.setBusy(false); fail(error); updateFooter();
            return false;
        }
    };
    const writeSale = async (/** @type {any} */ line) => {
        const draft = draftFor(line), values = draftSettlement(line, draft);
        const tranche = line.tranches.find((/** @type {any} */ item) => item.trancheId === draft.trancheId) || line.tranche;
        if (!tranche) { handle?.setMessage('Keine Tranche ausgewählt.'); return; }
        const allocation = allocateBankOrder(bankOrderTranches(line.tranches, tranche), values.shares);
        if (allocation.missing > 1e-6) { handle?.setMessage(`Die Stückzahl übersteigt den Bestand dieses Wertpapiers um ${flowNumber(allocation.missing, 3)} Stück.`); return; }
        const parts = splitOrder(allocation.parts, { shares: values.shares, gross: values.gross, fees: values.fees, taxes: values.taxes })
            .map(part => ({ trancheId: part.tranche.trancheId, shares: part.shares, gross: part.gross, fees: part.fees, taxes: part.taxes }));
        if (!(values.shares > 0) || !parts.length) { handle?.setMessage('Bitte die verkaufte Stückzahl eintragen.'); return; }
        const order = String(draft.orderNo || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
        // Gutachten VK-1 P3-4: Ausführungstag in der Kennung, damit dieselbe Bank-Nummer für Teilausführungen an verschiedenen Tagen geht.
        const executedAt = draft.executedAt || today();
        const actionId = order ? `order-${line.profileId}-${executedAt}-${order}`.slice(0, 120) : draft.actionId;
        let cashValue = null;
        if (mode === 'free') {
            const credit = state.credits[/** @type {string} */ (profileId)] || {};
            if (credit.choice === 'now') {
                const person = creditPeople()[0];
                cashValue = credit.cash !== undefined ? parseMoney(credit.cash) : Math.round((person?.cash ?? 0) + values.net);
                if (!Number.isFinite(cashValue) || cashValue < 0) { handle?.setMessage('Bitte einen gültigen Tagesgeld-Stand eintragen.'); return; }
            }
        }
        const rest = mode === 'plan' ? restQuestionAmount(line, values.net) : null;
        const resolution = rest !== null && draft.restDecision === 'keep' && plan
            ? { year: plan.year, ids: state.model.ids, lines: groupDecision(state.model.lines, line.key, true, draft.reason || '') } : null;
        const recommendation = mode === 'plan' && line.suggestion.shares > 0 ? { sharesSold: line.suggestion.shares, grossProceeds: Math.round(line.restGross * 100) / 100 } : null;
        await run(() => prepareSaleFlowWrite({ sales: [{ profileId: line.profileId, actionId, bankOrder: Boolean(order), executedAt, parts, recommendation, cashValue }], resolution }),
            () => {
                delete state.drafts[line.key];
                if (mode === 'free') { handle?.close(true); return; }
                const lines = readSaleFlowPlan({ plan: /** @type {any} */ (plan), registry: openHouseholdRegistry(persistenceStorage).registry }).lines;
                // VN-1 Punkt 3: Nach einer Teilabrechnung folgt die Gutschrift dieser Person, nicht still die nächste Person.
                const next = lines.find(item => item.status !== 'erledigt');
                if (lines.find(item => item.key === line.key)?.status === 'teilweise' || !next) handle?.activate('credit');
                else state.person.settle = next.key;
            });
    };
    const writeCredits = async (/** @type {any[]} */ people) => {
        const credits = [];
        for (const person of people) {
            const draft = state.credits[person.profileId] || {};
            // Gutachten VK-1 P2-1: nur offene Gutschriften; bestätigte sind schon im Tagesgeld.
            const net = person.sales.filter((/** @type {any} */ sale) => sale.creditPending).reduce((/** @type {number} */ sum, /** @type {any} */ sale) => sum + sale.net, 0);
            const value = draft.cash !== undefined ? parseMoney(draft.cash) : Math.round(((person.cash ?? 0) + net) * 100) / 100;
            if (!Number.isFinite(value) || value < 0) { handle?.setMessage(`Bitte für ${person.name} einen gültigen Tagesgeld-Stand eintragen.`); return; }
            credits.push({ profileId: person.profileId, targetActionIds: person.sales.filter((/** @type {any} */ sale) => sale.creditPending).map((/** @type {any} */ sale) => sale.actionId), value });
        }
        await run(() => prepareSaleFlowWrite({ credits }), () => { for (const person of people) delete state.credits[person.profileId]; continueAfterCredit(); });
    };
    /** Nach der Gutschrift: nächste offene Verkaufszeile (ohne Verkauf zum Merkzettel, mit Teilverkauf zur Abrechnung), sonst Verteilen. */
    const continueAfterCredit = () => {
        const next = readSaleFlowPlan({ plan: /** @type {any} */ (plan), registry: openHouseholdRegistry(persistenceStorage).registry }).lines.find(item => item.status !== 'erledigt');
        if (!next) { handle?.activate('distribute'); return; }
        const step = next.sales.length ? 'settle' : 'sell';
        state.person[step] = next.key; refresh(); handle?.activate(step);
    };
    const writeResolution = async (/** @type {any} */ line, /** @type {string|null} */ decision, keepCash = undefined) => {
        if (!plan) return;
        await run(() => prepareSaleFlowWrite({ resolution: { year: plan.year, ids: state.model.ids, ...(line ? { lines: groupDecision(state.model.lines, line.key, decision === KEEP_IN_DEPOT) } : {}),
            ...(keepCash !== undefined ? { keepCash } : {}) } }), () => {});
    };

    /** @param {boolean} [input] Eingabe im aktiven Schritt: Inhalt bleibt, berechnete Werte ändern sich an Ort und Stelle (VN-1 Punkt 1). */
    /** VN-3 (Breitensuche zu Gemini Befund 2): Ein Knopf im Schritt, der den Schritt neu aufbaut (Person, Anlageklasse, weitere
     * Abrechnung), gibt den Fokus an das sichtbare Gegenstück im neuen Schritt weiter, statt ihn auf BODY fallen zu lassen.
     * @param {string} selector */
    const refocus = selector => /** @type {HTMLElement|undefined} */ ([...(handle?.root.querySelectorAll(selector) || [])]
        .find(node => /** @type {HTMLElement} */ (node).getClientRects().length > 0))?.focus();
    const refresh = (input = false) => {
        try { state.model = read(); }
        catch (error) { handle?.setMessage(error?.message || 'Der Bestand ist nicht lesbar.'); return; }
        handle?.setSubtitle(subtitleText());
        handle?.updateSteps(steps(), { patch: input });
        updateFooter();
    };

    state.model = read();
    const first = mode === 'free' ? 'sell' : startStep ? stepIds[Math.min(stepIds.length, Math.max(1, startStep)) - 1] : 'overview';
    const handle = createCloseDialog({ doc, id: 'saleFlowDialog', eyebrow: mode === 'plan' ? `Verkauf aus dem Plan ${plan?.year}` : 'Verkauf ohne Planbezug',
        title: 'Aktien verkaufen', subtitle: '', steps: [], actions: [secondary, primary], returnFocus: () => opener?.focus?.(),
        // Ungespeicherte Eingaben: dieselbe Verwerfrückfrage wie der Planversuch; Abbrechen ändert nichts.
        onClose: async () => {
            if (!dirty()) return true;
            const attempt = await guard.prepare({ owners: [owner], intent: 'discard', opener });
            if (!attempt) return false;
            const accepted = guard.validate(attempt); guard.end(attempt);
            if (accepted) { state.drafts = {}; state.credits = {}; registration.notify(); }
            return accepted;
        } });
    if (!handle) { registration.unregister(); return null; }
    handle.root.classList.add('sale-flow-dialog');
    handle.setFootnote('Bedingungen', mode === 'plan'
        ? 'Schritt 1 und 2 speichern nichts. „Verkauf eintragen“ ändert das Depot, „Speichern“ in Schritt 4 das Tagesgeld. Abschließen geht, sobald alle Abrechnungen eingetragen oder entschieden sind.'
        : 'Erst „Verkauf eintragen“ ändert Depot und Tagesgeld. Bis dahin wird nichts gespeichert.');
    // VN-2 P3 (Gutachten 2.2 a): Ein Schrittwechsel bewertet die Meldung neu (alte Fehler bleiben nicht stehen).
    handle.setOnVisit(id => { state.current = id; handle?.setMessage(''); updateFooter(); });
    state.current = first;
    handle.setSubtitle(subtitleText());
    handle.updateSteps(steps());
    handle.activate(first);
    updateFooter();
    open.set(doc, handle);
    void handle.closed.then(() => { open.delete(doc); registration.unregister(); });
    return handle;
}
