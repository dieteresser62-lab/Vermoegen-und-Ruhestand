// VK-2 (FR-79 Punkte 5–8): geführter Kauf im Rahmen des geführten Verkaufs (`createCloseDialog`). Ein Ablauf, drei Einstiege: mit
// Planbezug aus der Balance („Kauf starten“, „Weiter mit Schritt n“), ohne Planbezug aus Personen & Vermögen („Kauf eintragen“) und
// vorbelegt aus „Geldmarkt kaufen“ (Verkaufsschritt 5, Karte). Geschrieben wird nur über den gemeinsamen Haushaltsschreiber.
import { createCloseDialog } from '../shared/close-dialog.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { getPageNavigationGuard } from '../shared/navigation-guard-dialog.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { readCashPerson } from '../profile/profile-cash-update.js';
import { readAnnualPlanResolutions, KEEP_IN_DEPOT } from '../profile/annual-plan-resolutions.js';
import { annualActionAssetClass, annualActionDecisionDay } from '../balance/annual-action-progress.js';
import { activeCarrier } from '../profile/household-withdrawal-mode.js';
import { openHouseholdRegistry, prepareSaleFlowWrite, commitSaleFlowWrite } from './household-sale-writer.js';
import { generateTrancheId } from './tranchen-manager-state.js';
import { searchSecurities, probeSearchQuote } from './tranchen-price-service.js';
import { openPendingDebits } from './buy-debit-dialog.js';
import { annualBuyLines, readFlowBuys, projectBuyLines, projectBuyFlowState, suggestBuyShares, estimateBuy, cashBeforeDebits, restBuyQuestionAmount,
    BUY_TYPES, CLASS_NAMES } from './buy-flow-model.js';
import { buyOverviewStep, buyStep, buySettleStep, debitStep, draftBuySettlement, personSegment, futureBuyMessage } from './buy-flow-steps.js';
import { el, button, euro, flowNumber, joinNames, parseMoney, parseQuantity, quoteDate } from './sale-flow-steps.js';
import { stockFromPurchaseDate } from './tranche-detail-model.js';
import { shownPrice } from './sale-flow-model.js';

const open = new WeakMap();
const bound = new WeakSet();
const PLAN_STEPS = /** @type {const} */ (['overview', 'buy', 'settle', 'debit']);
const FREE_STEPS = /** @type {const} */ (['overview', 'settle', 'debit']);
const TITLES = /** @type {Record<string, string>} */ ({ overview: 'Überblick', buy: 'Kaufen', settle: 'Abrechnung', debit: 'Abbuchung' });
const FREE_TITLES = /** @type {Record<string, string>} */ ({ overview: 'Wertpapier', settle: 'Abrechnung', debit: 'Abbuchung' });
const parse = (/** @type {string|null|undefined} */ raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
const cents = (/** @type {number} */ value) => Math.round(value * 100) / 100;
const FEMALE = new Set(['w', 'f', 'weiblich']);
const EXCHANGES = /** @type {Record<string, string>} */ ({ DE: 'Xetra', F: 'Frankfurt', MI: 'Mailand', L: 'London', AS: 'Amsterdam', PA: 'Paris', SW: 'Zürich', VI: 'Wien' });
/** Börse aus dem Kürzel (Endung nach dem Punkt), sonst leer. @param {string} ticker */
const exchangeOf = ticker => EXCHANGES[String(ticker || '').split('.')[1] || ''] || '';

/** Ist der Kauf in diesem Dokument offen. @param {Document} doc */
export const isBuyFlowOpen = doc => open.has(doc);
/** Versprechen auf das Schließen des offenen Kaufs. @param {Document} doc @returns {Promise<unknown>} */
export const buyFlowClosed = doc => open.get(doc)?.closed ?? Promise.resolve();

/** Vorschlag je Anlageklasse: ein Wertpapier derselben Klasse, das der Haushalt schon hat; bei mehreren das mit dem größten Bestand.
 * @param {any} registry @param {{id: string, name: string}[]} people @param {string} assetClass */
export function suggestedSecurity(registry, people, assetClass) {
    const groups = new Map();
    for (const person of people) {
        for (const tranche of parse(registry?.profiles?.[person.id]?.data?.depot_tranchen) || []) {
            if (annualActionAssetClass(tranche) !== assetClass || !(tranche.shares > 0)) continue;
            const key = tranche.isin || tranche.ticker || tranche.name;
            const group = groups.get(key) || { name: tranche.name || 'Wertpapier', isin: tranche.isin || '', ticker: tranche.ticker || '', price: tranche.currentPrice,
                asOf: tranche.asOf ?? null, tqf: tranche.tqf ?? (assetClass === 'equity' ? 0.3 : 0), taxExempt: tranche.taxExempt === true, assetClass, value: 0, holders: [] };
            group.value += tranche.shares * (tranche.currentPrice || 0);
            const holder = group.holders.find((/** @type {any} */ row) => row.id === person.id);
            if (holder) holder.shares += tranche.shares; else group.holders.push({ id: person.id, name: person.name, shares: tranche.shares });
            groups.set(key, group);
        }
    }
    const best = [...groups.values()].sort((a, b) => b.value - a.value)[0];
    return best ? { ...best, type: BUY_TYPES[assetClass], symbol: best.ticker, exchange: exchangeOf(best.ticker), check: best.ticker || best.isin ? 'pending' : 'failed', available: false } : null;
}

/** Wertpapier aus einem Suchtreffer (oder ohne Treffer). VK-2b P2-3: Eine feste Anlageklasse (Planzeile, Vorbelegung, Wahl des Nutzers)
 * bleibt; der Typ des Treffers ist nur Vorschlag, wenn noch nichts gesetzt ist. @param {any} hit
 * @param {{fixed?: string|null, fallback?: string, isin?: string}} options */
export function securityFromHit(hit, { fixed = null, fallback = 'equity', isin = '' } = {}) {
    // VN-3 (Fable P2-2): Ohne Treffer und ohne feste Anlageform bleibt sie leer („Bitte wählen“), statt still „Aktien“ zu setzen.
    const assetClass = fixed || hit?.assetClass || fallback || null;
    const base = { assetClass, tqf: assetClass && assetClass !== 'equity' ? 0 : null, taxExempt: false, type: assetClass ? BUY_TYPES[assetClass] : undefined };
    return hit ? { ...base, symbol: hit.symbol, name: hit.name, isin: hit.isin || isin, ticker: hit.symbol, exchange: hit.exchange, price: hit.price ?? NaN, asOf: hit.asOf,
        available: hit.status === 'ok', check: hit.status }
        : { ...base, symbol: null, name: '', isin, ticker: '', exchange: '', price: NaN, asOf: null, available: false, check: 'failed' };
}

/** Neue Tranche aus gewähltem Wertpapier und Abrechnung (FR-79 Punkt 5, Schritt 3). Die Anlageklasse kommt aus dem Wertpapier der Zeile.
 * VK-2b P3-3: Ein Kauf von heute ist nie ganz steuerfrei. P3-5/Gemini P3-2: „Ohne Kursabruf“ nur ohne Kürzel (nicht bei veraltetem Kurs).
 * @param {any} chosen @param {{assetClass: string}} line @param {{shares: number, pricePerShare: number, gross: number}} values
 * @param {{trancheId: string, executedAt: string}} meta */
export function buildBuyTranche(chosen, line, values, { trancheId, executedAt }) {
    const assetClass = chosen.assetClass || line.assetClass;
    const priced = chosen.available || chosen.check === 'stale';
    return { schemaVersion: 2, trancheId, name: String(chosen.name || '').trim(), type: assetClass === 'equity' ? stockFromPurchaseDate(executedAt, BUY_TYPES[assetClass]) : BUY_TYPES[assetClass],
        category: assetClass, ticker: String(chosen.ticker || ''), isin: chosen.isin || '', shares: values.shares,
        purchasePrice: values.pricePerShare, currentPrice: chosen.price > 0 ? chosen.price : values.gross / values.shares,
        ...(priced && Number.isInteger(chosen.asOf) ? { asOf: chosen.asOf } : {}), purchaseDate: executedAt,
        tqf: assetClass === 'equity' ? chosen.tqf ?? 0.3 : 0, taxExempt: false,
        notes: String(chosen.ticker || '').trim() ? '' : 'Ohne Kursabruf – Kurs von Hand pflegen.' };
}

/** Plan des Kaufs aus dem bestätigten Jahresbeleg. Bei „Eine Person trägt“ zahlt die tragende Person alle Käufe (Nachtrag 2).
 * @param {any} confirmed @param {string[]} ids @param {any} registry @param {string} [mode] */
export function buyFlowPlanFromConfirmed(confirmed, ids, registry, mode = '') {
    if (!confirmed?.action || !Array.isArray(ids) || !ids.length) return null;
    const people = ids.filter(id => registry?.profiles?.[id]).map(id => ({ id, name: registry.profiles[id].meta?.name || 'Person' }));
    let lines = annualBuyLines(confirmed.action, people.map(person => person.id));
    const carrier = activeCarrier(mode, people.map(person => ({ profileId: person.id })));
    if (carrier) {
        const merged = new Map();
        for (const line of lines) {
            const key = `buy:${carrier}:${line.assetClass}`;
            const old = merged.get(key);
            merged.set(key, { key, profileId: carrier, assetClass: line.assetClass, amount: cents((old?.amount || 0) + line.amount) });
        }
        lines = [...merged.values()];
    }
    if (!lines.length) return null;
    const decidedOn = annualActionDecisionDay(confirmed.committedAt);
    return { year: confirmed.year, decidedOn, decidedLabel: decidedOn ? decidedOn.split('-').reverse().join('.') : '', lines, people };
}

/** Kaufzeilen mit Stand. @param {{plan: any, registry: any, prices?: Record<string, number>}} options */
export function readBuyFlowPlan({ plan, registry, prices = {} }) {
    const ids = plan.people.map((/** @type {any} */ person) => person.id);
    const resolutions = readAnnualPlanResolutions({ year: plan.year, ids });
    const names = Object.fromEntries(plan.people.map((/** @type {any} */ person) => [person.id, person.name]));
    const lines = projectBuyLines({ lines: plan.lines, buys: readFlowBuys(registry, ids), year: plan.year, decidedOn: plan.decidedOn ?? null,
        resolutions: resolutions.lines, prices }).map(line => ({ ...line, name: names[line.profileId] || 'Person' }));
    return { ids, resolutions, lines };
}

/** Stand des Kaufs für die Karte „Was zu tun ist“ (FR-79 Punkt 7, Ergänzung 1 Punkte 6 und 7). @param {{plan: any, registry: any}} options */
export function projectBuyFlowCard({ plan, registry }) {
    const prices = Object.fromEntries(plan.lines.map((/** @type {any} */ line) => [line.key, suggestedSecurity(registry, plan.people, line.assetClass)?.price ?? NaN]));
    const result = readBuyFlowPlan({ plan, registry, prices });
    const flow = projectBuyFlowState(result.lines);
    const pending = flow.pending.map((/** @type {any} */ buy) => ({ actionId: buy.actionId, date: buy.executedAt.split('-').reverse().join('.'), amount: buy.debit,
        who: plan.people.find((/** @type {any} */ person) => person.id === buy.profileId)?.name || '' }));
    return { started: flow.buys.length > 0 || result.lines.some(line => line.keptCash), next: flow.next === 1 ? null : flow.next,
        steps: PLAN_STEPS.map(id => ({ title: TITLES[id], done: Boolean(/** @type {any} */ (flow.steps)[id]?.done) })), allEntered: flow.complete,
        lines: result.lines, pending, bought: result.lines.reduce((sum, line) => sum + line.bought, 0), plan: result.lines.reduce((sum, line) => sum + line.amount, 0) };
}

/** Bindet „Kauf starten“, „Weiter mit Schritt n“, „Rest doch kaufen“ und „Geldmarkt kaufen“ der Karte in der Balance an den Ablauf.
 * @param {HTMLElement} host @param {() => {plan: any, cashContext?: any}|null} context */
export function bindBuyFlowCard(host, context) {
    if (bound.has(host)) return;
    bound.add(host);
    const doc = host.ownerDocument;
    const reload = () => void getPageNavigationGuard(doc).reload({ flush: () => PersistenceFacade.flush(), reload: () => doc.defaultView?.location?.reload?.() }).catch(() => {});
    host.addEventListener('click', event => {
        const target = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (event.target)?.closest?.('[data-buy-flow-start], [data-buy-flow-revoke], [data-buy-flow-money], [data-buy-debit-open]'));
        if (!target) return;
        const current = context();
        event.preventDefault();
        if (target.dataset.buyDebitOpen !== undefined) {
            let changed = false;
            const handle = openPendingDebits({ doc, ids: target.dataset.buyDebitOpen.split(',').filter(Boolean), opener: target, onChanged: () => { changed = true; } });
            void handle?.closed.then(() => { if (changed) reload(); });
            return;
        }
        if (target.dataset.buyFlowMoney !== undefined) {
            let changed = false;
            const handle = openMoneyMarketBuy(doc, target.dataset.buyFlowMoney, Number(target.dataset.buyFlowAmount) || 0, target, () => { changed = true; });
            void handle?.closed.then(() => { if (changed) reload(); });
            return;
        }
        if (!current?.plan) return;
        if (target.dataset.buyFlowRevoke !== undefined) {
            const lifecycle = createNavigationOperationLifecycle({ guard: getPageNavigationGuard(doc), message: 'Entscheidung wird gespeichert – bitte warten.' });
            void lifecycle.run({}, async operation => {
                const prepared = await prepareSaleFlowWrite({ resolution: { year: current.plan.year, ids: current.plan.people.map((/** @type {any} */ person) => person.id),
                    line: { key: /** @type {string} */ (target.dataset.buyFlowRevoke), decision: null } } });
                operation.check();
                await commitSaleFlowWrite(prepared, { navigationOperation: operation });
            }).then(reload, () => { target.setAttribute('title', 'Speichern nicht möglich. Bitte die Seite neu laden.'); });
            return;
        }
        let changed = false;
        const handle = openBuyFlow({ doc, plan: current.plan, cashContext: current.cashContext ?? null, startStep: Number(target.dataset.buyFlowStart) || 1,
            opener: target, onChanged: () => { changed = true; } });
        void handle?.closed.then(() => { if (changed) reload(); });
    });
}

/** „Geldmarkt kaufen“: geführter Kauf ohne Planbezug mit dem Geldmarkt-ETF der Person (oder Anlageform Geldmarkt) und dem Betrag.
 * @param {Document} doc @param {string|undefined} profileId @param {number} amount @param {HTMLElement|null} opener @param {() => void} onChanged */
export function openMoneyMarketBuy(doc, profileId, amount, opener, onChanged) {
    if (!profileId) return null;
    return openBuyFlow({ doc, profileId, preset: { assetClass: 'money_market', amount }, opener, onChanged });
}

/**
 * Öffnet den Kauf. Mit `plan` vier Schritte; ohne Plan drei (Wertpapier → Abrechnung → Abbuchung) für `profileId`, wahlweise vorbelegt.
 * @param {{doc?: Document, plan?: any, profileId?: string|null, preset?: {assetClass?: string, amount?: number, trancheId?: string|null}|null,
 * cashContext?: {ironReserve?: number|null}|null, startStep?: number|null, opener?: HTMLElement|null, onChanged?: () => void}} options
 */
export function openBuyFlow({ doc = document, plan = null, profileId = null, preset = null, cashContext = null, startStep = null, opener = null, onChanged = () => {} }) {
    if (open.has(doc)) return open.get(doc);
    const mode = plan ? 'plan' : 'free';
    const stepIds = mode === 'plan' ? PLAN_STEPS : FREE_STEPS;
    const guard = getPageNavigationGuard(doc);
    const lifecycle = createNavigationOperationLifecycle({ guard, message: 'Kauf wird gespeichert – bitte warten.' });
    const today = () => localCalendarDate(appNow());
    const play = (() => { try { return PersistenceFacade.getPersistenceStatus().activeArea === 'spiel'; } catch { return false; } })();
    const state = { drafts: /** @type {Record<string, any>} */ ({}), debits: /** @type {Record<string, any>} */ ({}), person: /** @type {Record<string, string>} */ ({}),
        selection: /** @type {Record<string, {choice: string, security: any, suggestion?: any, other?: any, confirmed?: boolean, userClass?: boolean}>} */ ({}), search: /** @type {any} */ ({ query: '', status: 'idle' }),
        amount: preset?.amount ?? null, model: /** @type {any} */ (null), revision: 0, current: '', touched: false, overviewClass: /** @type {string|null} */ (null) };
    const people = () => mode === 'plan' ? plan.people : [{ id: /** @type {string} */ (profileId), name: openHouseholdRegistry(persistenceStorage).registry.profiles[/** @type {string} */ (profileId)]?.meta?.name || 'Person' }];
    const draftFor = (/** @type {any} */ line) => (state.drafts[line.key] ||= { executedAt: today(), openedOn: today(),
        actionId: `buy-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}` });
    const dirty = () => state.touched || Object.values(state.drafts).some(draft => ['price', 'fees', 'orderNo', 'reason'].some(field => String(draft[field] ?? '').trim())
        || draft.sharesEdited || draft.shares !== undefined || draft.restDecision === 'keep' || draft.executedAt !== draft.openedOn)
        || Object.values(state.debits).some(draft => draft.choice === 'now' || draft.cash !== undefined);
    const owner = Symbol('buy-flow');
    const registration = guard.register(owner, { read: () => ({ phase: 'idle', dirty: dirty(), revision: state.revision,
        message: 'Ungespeicherte Eingaben im Kauf gehen verloren.' }), cancel: () => { handle?.close(false); return true; } });
    const secondary = button(doc, ''), primary = button(doc, '', 'ds-button ds-button-primary');
    secondary.dataset.buyFlowSecondary = ''; primary.dataset.buyFlowPrimary = '';

    // VK-2b P1-1: Jede Anlageklasse des Plans bekommt in Schritt 1 ihre eigene Wertpapierwahl; `overviewClass` ist die gerade gezeigte.
    const planClasses = () => mode === 'plan' ? [...new Set(plan.lines.map((/** @type {any} */ line) => line.assetClass))] : [];
    const lineClass = () => (mode === 'plan' && state.overviewClass) || state.model?.lines.find((/** @type {any} */ line) => line.status !== 'erledigt')?.assetClass
        || state.model?.lines[0]?.assetClass || preset?.assetClass || 'equity';
    /** VK-2b P2-3: Feste Anlageklasse (Planzeile oder Vorbelegung, im Kauf ohne Plan auch die vom Nutzer gewählte); ein Suchtreffer überschreibt sie nicht.
     * @param {any} selection */
    const fixedClass = selection => mode === 'plan' ? lineClass() : preset?.assetClass || (selection?.userClass ? selection.other?.assetClass : null) || null;
    /** VN-3 (Fable P2-2): Gesperrt ist die Anlageform nur mit Planzeile oder Vorbelegung; die eigene Wahl bleibt mit Maus und Tastatur änderbar. */
    const classLocked = () => mode === 'plan' || Boolean(preset?.assetClass);
    /** Gewählte Sicherheit der Anlageklasse. @param {string} assetClass */
    const selectionFor = assetClass => {
        if (!state.selection[assetClass]) {
            const registry = openHouseholdRegistry(persistenceStorage).registry;
            const fromTranche = preset?.trancheId ? (parse(registry.profiles[/** @type {string} */ (profileId)]?.data?.depot_tranchen) || []).find((/** @type {any} */ item) => item.trancheId === preset.trancheId) : null;
            const suggestion = suggestedSecurity(registry, people(), assetClass);
            const security = fromTranche ? { ...suggestedSecurity(registry, people().filter(person => person.id === profileId), assetClass), name: fromTranche.name, isin: fromTranche.isin, ticker: fromTranche.ticker } : suggestion;
            state.selection[assetClass] = { choice: security ? 'suggestion' : 'other', security, suggestion: security };
            if (security?.check === 'pending') void verify(assetClass, security);
        }
        return state.selection[assetClass];
    };
    /** Kursprüfung des Vorschlags über den vorhandenen Kursabruf („✓ Kurs abrufbar“ erst mit Kurs). @param {string} assetClass @param {any} security */
    const verify = async (assetClass, security) => {
        // VK-2b P3-5: Ohne Kürzel löst erst die Suche die ISIN auf (der Kursabruf kennt keine ISIN).
        if (!security.ticker && security.isin) {
            const hit = /** @type {any} */ (await searchSecurities(security.isin).catch(() => null))?.hits?.find((/** @type {any} */ item) => item.status === 'ok' || item.status === 'stale');
            if (hit) Object.assign(security, { ticker: hit.symbol, symbol: hit.symbol, exchange: hit.exchange || exchangeOf(hit.symbol) });
        }
        const result = /** @type {any} */ (security.ticker ? await probeSearchQuote(security.ticker, null).catch(() => ({ status: 'failed' })) : { status: 'failed' });
        Object.assign(security, { check: result.status, available: result.status === 'ok', ...(result.price > 0 ? { price: result.price, asOf: result.asOf } : {}) });
        // VN-2 (Codex F02): Eine späte Kursantwort aktualisiert den aktiven Schritt an Ort und Stelle; Eingabefelder, Text und Cursor bleiben.
        if (state.selection[assetClass]?.security === security || state.selection[assetClass]?.suggestion === security) refresh(true);
    };
    // VN-1 Punkt 13: Im Kauf ohne Plan ist die freie Wahl die einzige Quelle für Anzeige, Freigabe und Anlegen. Die Anlageklasse der Zeile
    // folgt dem Treffer; eine Wahl je Klasse gäbe für Geldmarkt, Anleihen und Gold ein leeres Wertpapier.
    const securityOf = (/** @type {any} */ line) => mode === 'free' ? currentSelection().security : selectionFor(line?.assetClass || lineClass()).security;

    const read = () => {
        const { registry } = openHouseholdRegistry(persistenceStorage);
        if (mode === 'plan') {
            const prices = Object.fromEntries(plan.lines.map((/** @type {any} */ line) => [line.key, shownPrice(state.selection[line.assetClass]?.security?.price ?? NaN)]));
            const result = readBuyFlowPlan({ plan, registry, prices });
            const securityChosen = plan.lines.every((/** @type {any} */ line) => state.selection[line.assetClass]?.confirmed);
            return { registry, ...result, flow: projectBuyFlowState(result.lines, { securityChosen }) };
        }
        const person = registry.profiles[/** @type {string} */ (profileId)];
        if (!person) throw new Error('Die Person ist nicht mehr vorhanden.');
        const assetClass = state.selection.free?.security?.assetClass || preset?.assetClass || 'equity';
        const amount = Number.isFinite(state.amount) && /** @type {number} */ (state.amount) > 0 ? /** @type {number} */ (state.amount) : 0;
        const line = { key: 'free', profileId, name: person.meta.name, assetClass, amount, restAmount: amount, openAmount: amount, bought: 0, status: 'offen', keptCash: false, buys: [], price: NaN };
        return { registry, lines: [line], ids: [profileId], flow: null, resolutions: null };
    };
    const currentSelection = () => {
        if (mode === 'free' && !state.selection.free) {
            const sel = selectionFor(preset?.assetClass || 'equity');
            state.selection.free = sel;
        }
        return mode === 'free' ? state.selection.free : selectionFor(lineClass());
    };
    const cashOf = (/** @type {string} */ id) => {
        const cash = readCashPerson(id, '', state.model.registry.profiles[id]?.data || {});
        return { value: Number.isFinite(cash.value) ? /** @type {number} */ (cash.value) : null, error: cash.error };
    };
    const cashBefore = () => Object.fromEntries((mode === 'plan' ? plan.people : people()).map((/** @type {any} */ person) => {
        const own = state.model.lines.flatMap((/** @type {any} */ line) => line.buys).filter((/** @type {any} */ buy) => buy.profileId === person.id);
        return [person.id, cashBeforeDebits(own, cashOf(person.id).value)];
    }));
    /** Wertpapier gewählt und vollständig (Name, bei Aktien bestätigte Teilfreistellung); je Anlageklasse (VK-2b P1-1).
     * @param {string} [assetClass] */
    const securityReady = assetClass => {
        const chosen = mode === 'plan' && assetClass ? selectionFor(assetClass).security : currentSelection().security;
        // VN-2 P1 (Gutachten 1.1): Ohne gewählte oder feste Anlageform ist das Wertpapier nicht vollständig; bei Aktien braucht es die Teilfreistellung.
        const effective = chosen?.assetClass || (mode === 'plan' ? assetClass || lineClass() : preset?.assetClass) || null;
        return Boolean(chosen && String(chosen.name || '').trim() && effective && (effective !== 'equity' || chosen.tqf !== null && chosen.tqf !== undefined));
    };
    /** Nächste Anlageklasse des Plans, deren Wertpapier noch nicht bestätigt ist (außer der gezeigten). */
    const nextOpenClass = () => planClasses().find(assetClass => assetClass !== lineClass() && !state.selection[assetClass]?.confirmed) || null;

    const content = (/** @type {string} */ id) => {
        const lines = state.model.lines;
        const wrap = el(doc, 'div', 'sale-flow-step'); wrap.dataset.buyFlowStep = id;
        if (id === 'overview') {
            const selection = currentSelection();
            const classes = planClasses().length > 1 ? planClasses().map(assetClass => ({ id: assetClass, label: CLASS_NAMES[assetClass] || assetClass,
                active: assetClass === lineClass(), done: Boolean(state.selection[assetClass]?.confirmed) && securityReady(assetClass) })) : [];
            wrap.append(buyOverviewStep(doc, { lines, plan: mode === 'plan', decidedOn: plan?.decidedLabel || '', cash: cashBefore(), suggestion: selection.suggestion, choice: selection.choice,
                classes, onClass: assetClass => { if (securityReady()) currentSelection().confirmed = true; state.overviewClass = assetClass; refresh(); refocus(`[data-buy-flow-class="${assetClass}"]`); }, classFixed: classLocked(), fixedClass: fixedClass(selection),
                security: selection.security, search: state.search, quoteDate: quoteDate(selection.security?.asOf) || today(), play, amount: state.amount,
                onAmount: value => { const amount = parseMoney(value); state.amount = Number.isFinite(amount) && amount > 0 ? amount : null; state.touched = true; refresh(true); },
                onChoose: choice => { selection.choice = choice; selection.security = choice === 'suggestion' ? selection.suggestion : selection.other || null; touch(); },
                onSearch: query => void runSearch(query),
                onPick: hit => {
                    // VN-4 (Abnahme ST-2): Eine Anlageform, die der Nutzer für ein Wertpapier ohne Treffer gewählt hat, bindet einen späteren
                    // Treffer nicht; der Treffer setzt Anlageform und Titel. Eine geänderte Anlageform eines Treffers bleibt (VK-2b P2-3).
                    if (selection.userClass && !selection.other?.symbol) selection.userClass = false;
                    selection.choice = 'other'; selection.other = pickSecurity(hit, selection); selection.security = selection.other; touch();
                },
                onSecurity: patch => {
                    const next = { ...selection.security, ...patch };
                    // VN-3 (Gemini Befund 3): Beim Wechsel auf Aktien ist keine Teilfreistellung gewählt, bis der Nutzer sie bestätigt.
                    if (Object.hasOwn(patch, 'assetClass')) { selection.userClass = true; next.type = BUY_TYPES[patch.assetClass];
                        next.tqf = patch.assetClass !== 'equity' ? 0 : selection.security?.assetClass === 'equity' ? selection.security?.tqf ?? null : null; }
                    if (Object.hasOwn(patch, 'price')) next.price = parseQuantity(patch.price);
                    if (Object.hasOwn(patch, 'isin')) next.isin = String(patch.isin || '').trim().toUpperCase();
                    if (Object.hasOwn(patch, 'ticker')) next.ticker = String(patch.ticker || '').trim().toUpperCase();
                    selection.other = next; selection.security = next; touch();
                } }));
            return wrap;
        }
        if (id === 'buy' || id === 'settle') {
            const line = selected(id), index = lines.indexOf(line);
            const top = el(doc, 'div', 'sale-flow-top');
            if (lines.length > 1) top.append(personSegment(doc, linePeople(), state.person[id], key => { state.person[id] = key; refresh(); refocus(`[data-sale-flow-person="${key}"]`); }));
            else top.append(el(doc, 'span'));
            const chosen = securityOf(line);
            top.append(el(doc, 'span', 'ds-source', `${lines.length > 1 ? `Kauf ${index + 1} von ${lines.length}` : 'Kauf'}${id === 'settle' && chosen ? ` · ${chosen.name}${chosen.isin ? ` · ${chosen.isin}` : ''}` : ''}`));
            wrap.append(top);
            const draft = draftFor(line);
            if (id === 'buy') wrap.append(buyStep(doc, line, { draft, security: chosen, quoteDate: quoteDate(chosen?.asOf) || today(), cash: cashBefore(), payers: payers(line),
                reserve: Number.isFinite(cashContext?.ironReserve) ? /** @type {number} */ (cashContext?.ironReserve) : null, onPrint: () => globalThis.print?.(),
                onChange: next => { state.drafts[line.key] = next; state.revision++; registration.notify(); refresh(true); } }));
            else wrap.append(buySettleStep(doc, line, { draft, security: chosen, plan: mode === 'plan', tranche: newTranche(line, draftBuySettlement(line, draft, chosen), draft),
                scope: plan ? { year: plan.year, decidedOn: plan.decidedOn ?? null } : null,
                onChange: (next) => { state.drafts[line.key] = next; state.revision++; registration.notify(); handle?.setMessage(''); refresh(true); },
                onKeepRevoke: () => void writeResolution(line, null), onAnother: () => { state.drafts[line.key] = { ...draft, another: true }; refresh(); refocus('[data-buy-flow-step="settle"] input'); } }));
            return wrap;
        }
        wrap.append(debitStep(doc, { people: debitPeople(), missing: missingLines(), drafts: state.debits, lines, plan: mode === 'plan',
            onChange: (person, next) => { state.debits[person] = next; state.revision++; registration.notify(); handle?.setMessage(''); refresh(true); },
            onSettle: key => { state.person.settle = key; handle?.activate('settle'); } }));
        return wrap;
    };
    /** VN-1 Punkt 14: Im Kauf ohne Plan folgt der Titel der gewählten Anlageform. */
    const freeTitle = () => {
        const assetClass = currentSelection().security?.assetClass || preset?.assetClass || null;
        return assetClass ? `${CLASS_NAMES[assetClass] || assetClass} kaufen` : 'Kauf eintragen';
    };
    const touch = () => { state.touched = true; state.revision++; registration.notify(); handle?.setMessage(''); refresh(true); };
    // VN-3 (Fable P2-2): Im Kauf ohne Plan und ohne Vorbelegung gibt es keinen Rückfall auf „Aktien“.
    const pickSecurity = (/** @type {any} */ hit, /** @type {any} */ selection) => securityFromHit(hit, { fixed: fixedClass(selection),
        fallback: mode === 'plan' ? selection.suggestion?.assetClass || lineClass() : null, isin: state.search.result?.isin || '' });
    const runSearch = async (/** @type {string} */ query) => {
        // VN-3 (Gemini Befund 2): Auch der Suchstart patcht den Schritt an Ort und Stelle; Suchfeld und Knopf behalten den Fokus.
        state.search = { query, status: 'busy' }; refresh(true);
        try { state.search = { query, status: 'done', result: await searchSecurities(query) }; }
        catch (error) { state.search = { query, status: 'error', error: /** @type {any} */ (error)?.code || 'QUOTE_FAILED' }; }
        refresh(true);
    };
    const linePeople = () => state.model.lines.map((/** @type {any} */ line) => ({ id: line.key, label: line.status === 'erledigt' ? `${line.name} · eingetragen` : `${line.name} · ${euro(line.restAmount || line.amount)}`, done: line.status === 'erledigt' }));
    const selected = (/** @type {string} */ step) => {
        const lines = state.model.lines;
        const keep = lines.find((/** @type {any} */ line) => line.key === state.person[step]);
        if (keep) return keep;
        const first = lines.find((/** @type {any} */ line) => line.status !== 'erledigt') || lines[0];
        state.person[step] = first?.key; return first;
    };
    const payers = (/** @type {any} */ current) => {
        const registry = state.model.registry;
        return [...new Set(state.model.lines.map((/** @type {any} */ line) => line.profileId))].map(id => {
            const open = state.model.lines.filter((/** @type {any} */ line) => line.profileId === id && line.status !== 'erledigt' && line !== current);
            const price = shownPrice(securityOf(open[0] || current)?.price);
            return { profileId: id, name: state.model.lines.find((/** @type {any} */ line) => line.profileId === id).name,
                female: FEMALE.has(String(registry.profiles[id]?.data?.profile_geschlecht || '').toLowerCase()),
                estimateDebit: open.reduce((/** @type {number} */ sum, /** @type {any} */ line) => sum + estimateBuy(suggestBuyShares(line.restAmount, price), price).debit, 0) };
        });
    };
    const newTranche = (/** @type {any} */ line, /** @type {any} */ values, /** @type {any} */ draft) =>
        buildBuyTranche(securityOf(line) || {}, line, values, { trancheId: draft.trancheId ||= uniqueTrancheId(line.profileId), executedAt: draft.executedAt || today() });
    const uniqueTrancheId = (/** @type {string} */ id) => {
        const used = new Set((parse(state.model.registry.profiles[id]?.data?.depot_tranchen) || []).map((/** @type {any} */ item) => item.trancheId));
        for (let attempt = 0; attempt < 100; attempt++) { const next = generateTrancheId(); if (!used.has(next)) return next; }
        throw new Error('Keine freie Tranchenkennung.');
    };
    const debitPeople = () => {
        const lines = state.model.lines;
        if (mode === 'free') {
            const line = lines[0], draft = draftFor(line), values = draftBuySettlement(line, draft, securityOf(line));
            const cash = cashOf(/** @type {string} */ (profileId));
            return Number.isFinite(values.debit) ? [{ profileId, name: line.name, pending: true, cash: cash.value, cashError: cash.error,
                buys: [{ executedAt: draft.executedAt, shares: values.shares, gross: values.gross, fees: values.fees, debit: values.debit, debitPending: true }] }] : [];
        }
        return plan.people.map((/** @type {any} */ person) => {
            const buys = lines.flatMap((/** @type {any} */ line) => line.buys).filter((/** @type {any} */ buy) => buy.profileId === person.id);
            const cash = cashOf(person.id);
            return { profileId: person.id, name: person.name, buys, pending: buys.some((/** @type {any} */ buy) => buy.debitPending), cash: cash.value, cashError: cash.error };
        }).filter((/** @type {any} */ person) => person.buys.length);
    };
    const missingLines = () => mode === 'free' ? [] : state.model.lines.filter((/** @type {any} */ line) => !line.buys.length && !line.keptCash).map((/** @type {any} */ line) => {
        const chosen = securityOf(line);
        return { key: line.key, name: line.name, amount: line.amount, suggestedShares: suggestBuyShares(line.restAmount, chosen?.price), securityName: chosen?.name || '' };
    });

    const subtitleText = () => {
        const lines = state.model.lines;
        if (mode === 'free') return `${lines[0].name} · Kauf ohne Planbezug`;
        const names = joinNames(plan.people.filter((/** @type {any} */ person) => lines.some((/** @type {any} */ line) => line.profileId === person.id)).map((/** @type {any} */ person) => person.name)).replace(' und ', ' + ');
        const entered = state.model.flow.entered;
        const total = lines.reduce((/** @type {number} */ sum, /** @type {any} */ line) => sum + Math.round(line.amount), 0);
        if (entered) return `${names} · ${entered} von ${lines.length} ${lines.length === 1 ? 'Kauf' : 'Käufen'} eingetragen`;
        return `${names} · ${lines.length} ${lines.length === 1 ? 'Kauf' : 'Käufe'} · Plan ${flowNumber(total)} € aus dem Tagesgeld · noch nichts eingetragen`;
    };
    const openText = () => {
        const lines = state.model.lines, parts = [];
        const unsold = lines.filter((/** @type {any} */ line) => line.status !== 'erledigt');
        if (mode === 'plan' && unsold.length) parts.push(unsold.map((/** @type {any} */ line) => `${line.status === 'teilweise' ? 'Rest ' : ''}Kauf ${line.name}`).join(', '));
        if (mode === 'plan') {
            const pending = [...new Set(state.model.flow.pending.map((/** @type {any} */ buy) => lines.find((/** @type {any} */ line) => line.profileId === buy.profileId)?.name))].filter(Boolean);
            if (pending.length) parts.push(`Abbuchung ${joinNames(/** @type {string[]} */ (pending))}`);
        }
        if (mode === 'free') parts.push(securityReady() ? `Kauf ${lines[0].name}` : 'Wertpapier wählen');
        return parts.length ? `Noch offen: ${parts.join(' · ')}` : 'Alles eingetragen.';
    };
    const steps = () => stepIds.map(id => {
        const info = mode === 'plan' ? /** @type {any} */ (state.model.flow.steps)[id] : { label: id === 'overview' && securityReady() ? 'gewählt' : 'offen', done: id === 'overview' && securityReady() };
        return { id, title: (mode === 'plan' ? TITLES : FREE_TITLES)[id], chip: (mode === 'plan' ? TITLES : FREE_TITLES)[id], statusLabel: info.label, done: info.done, nextAction: true, content: content(id) };
    });

    const updateFooter = () => {
        const id = state.current;
        handle?.setStatus(openText());
        const lines = state.model.lines;
        const set = (/** @type {HTMLButtonElement} */ node, /** @type {string} */ label, /** @type {(() => void)|null} */ action, disabled = false) => {
            node.hidden = !label; node.textContent = label; node.disabled = disabled || Boolean(handle?.busy); node.onclick = action;
        };
        const complete = mode === 'plan' && state.model.flow.complete;
        const finish = () => handle?.close(true);
        const confirmSecurity = () => { currentSelection().confirmed = true; refresh(); };
        if (id === 'overview') {
            const next = mode === 'plan' ? 'buy' : 'settle';
            const otherClass = mode === 'plan' && !complete ? nextOpenClass() : null;
            const allReady = planClasses().every(assetClass => assetClass === lineClass() || state.selection[assetClass]?.confirmed && securityReady(assetClass));
            set(secondary, complete ? 'Weiter zum Kaufen' : '', () => { confirmSecurity(); handle?.activate(next); });
            if (otherClass) set(primary, `Weiter zu ${CLASS_NAMES[otherClass] || otherClass}`, () => { confirmSecurity(); state.overviewClass = otherClass; refresh(); }, !securityReady());
            else set(primary, complete ? 'Kauf abschließen' : mode === 'plan' ? 'Weiter zum Kaufen' : 'Ausgeführt? Abrechnung eintragen',
                complete ? finish : () => { confirmSecurity(); handle?.activate(next); }, !complete && (!securityReady() || !allReady));
        } else if (id === 'buy') {
            const line = selected('buy');
            const next = lines.find((/** @type {any} */ item) => item !== line && item.status !== 'erledigt' && !item.buys.length);
            set(secondary, next ? `Weiter zu ${next.name}` : 'Zurück', next ? () => { state.person.buy = next.key; refresh(); } : () => handle?.activate('overview'));
            set(primary, 'Ausgeführt? Abrechnung eintragen', () => { state.person.settle = line.key; handle?.activate('settle'); }, !securityReady(line.assetClass));
        } else if (id === 'settle') {
            const line = selected('settle'), draft = draftFor(line), values = draftBuySettlement(line, draft, securityOf(line));
            const invalid = !(values.shares > 0) || !Number.isFinite(values.debit) || !securityReady(line.assetClass);
            set(secondary, 'Zurück', () => handle?.activate(mode === 'plan' ? 'buy' : 'overview'));
            if (mode === 'free') set(primary, 'Weiter zur Abbuchung', () => handle?.activate('debit'), invalid);
            else if (line.status === 'erledigt' && !draft.another) {
                const nextLine = lines.find((/** @type {any} */ item) => item.status !== 'erledigt');
                set(primary, nextLine ? `Weiter zu ${nextLine.name}` : 'Weiter zur Abbuchung', nextLine ? () => { state.person.settle = nextLine.key; refresh(); } : () => handle?.activate('debit'));
            } else set(primary, 'Kauf eintragen und weiter', () => void writeBuy(line), invalid);
        } else if (id === 'debit') {
            if (mode === 'free') {
                set(secondary, 'Zurück', () => handle?.activate('settle'));
                const line = lines[0], values = draftBuySettlement(line, draftFor(line), securityOf(line));
                set(primary, 'Kauf eintragen', () => void writeBuy(line), !(values.shares > 0) || !Number.isFinite(values.debit) || !securityReady()
                    || !state.debits[/** @type {string} */ (profileId)]?.choice);
            } else {
                set(secondary, 'Später weitermachen', () => handle?.close(false));
                const choose = debitPeople().filter(person => person.pending && state.debits[person.profileId]?.choice === 'now');
                set(primary, choose.length ? 'Speichern' : 'Kauf abschließen', choose.length ? () => void writeDebits(choose) : finish, !choose.length && !complete);
            }
        }
    };

    const fail = (/** @type {any} */ error) => {
        const code = error?.code || '';
        const stale = code === 'persistence_precondition_mismatch' || code === 'HOUSEHOLD_WRITE_STALE';
        if (stale) onChanged();
        const text = code === 'RECONCILIATION_ACTION_CONFLICT' ? 'Diese Ordernummer gehört am selben Ausführungstag schon zu einer anderen Abrechnung. Bitte Ordernummer und Tag prüfen.'
            : stale ? 'Der Bestand hat sich inzwischen geändert. Bitte den Kauf schließen und neu öffnen.'
                : code === 'ANNUAL_OPERATION_BUSY' ? 'Eine andere Seite speichert gerade. Bitte kurz warten und erneut versuchen.'
                    : /^RECONCILIATION_|^TRANCHE_|^BUY_FLOW/.test(code) || error?.name === 'TrancheValidationError' ? 'Die Abrechnung passt so nicht. Bitte Stückzahl, Kurs, Gebühren und Wertpapier prüfen.'
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
    const writeBuy = async (/** @type {any} */ line) => {
        const draft = draftFor(line), chosen = securityOf(line), values = draftBuySettlement(line, draft, chosen);
        // VN-1 Punkt 13: Ohne Namen des Wertpapiers wird keine Tranche angelegt.
        if (!String(chosen?.name || '').trim()) { handle?.setMessage('Bitte zuerst das Wertpapier wählen (Name fehlt).'); return; }
        if (!(values.shares > 0) || !Number.isFinite(values.debit)) { handle?.setMessage('Bitte Stückzahl, Kurs und Gebühren eintragen.'); return; }
        const executedAt = draft.executedAt || today();
        if (executedAt > today()) { handle?.setMessage(futureBuyMessage(executedAt)); return; }
        const order = String(draft.orderNo || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
        const actionId = order ? `order-buy-${line.profileId}-${executedAt}-${order}`.slice(0, 120) : draft.actionId;
        let cashValue = null;
        if (mode === 'free') {
            const debit = state.debits[/** @type {string} */ (profileId)] || {};
            if (debit.choice === 'now') {
                const person = debitPeople()[0];
                // VK-3d P2: Ohne lesbaren Stand gibt es keinen Vorschlag; dann zählt nur die Eingabe.
                cashValue = debit.cash !== undefined ? parseMoney(debit.cash) : Number.isFinite(person?.cash) ? Math.round((person?.cash ?? 0) - values.debit) : NaN;
                if (!Number.isFinite(cashValue) || cashValue < 0) { handle?.setMessage('Bitte einen gültigen Tagesgeld-Stand eintragen.'); return; }
            }
        }
        const rest = mode === 'plan' ? restBuyQuestionAmount(line, values.debit) : null;
        const resolution = rest !== null && draft.restDecision === 'keep' && plan
            ? { year: plan.year, ids: state.model.ids, line: { key: line.key, decision: KEEP_IN_DEPOT, reason: draft.reason || '' } } : null;
        const tranche = newTranche(line, values, draft);
        await run(() => prepareSaleFlowWrite({ buys: [{ profileId: line.profileId, actionId, executedAt, assetClass: tranche.category, tranche,
            shares: values.shares, gross: values.gross, fees: values.fees, cashValue }], resolution }),
        () => {
            delete state.drafts[line.key];
            if (mode === 'free') { handle?.close(true); return; }
            const next = readBuyFlowPlan({ plan, registry: openHouseholdRegistry(persistenceStorage).registry }).lines.find(item => item.status !== 'erledigt');
            if (next) state.person.settle = next.key; else handle?.activate('debit');
        });
    };
    const writeDebits = async (/** @type {any[]} */ chosen) => {
        const debits = [];
        for (const person of chosen) {
            const draft = state.debits[person.profileId] || {};
            const debit = person.buys.filter((/** @type {any} */ buy) => buy.debitPending).reduce((/** @type {number} */ sum, /** @type {any} */ buy) => sum + buy.debit, 0);
            const value = draft.cash !== undefined ? parseMoney(draft.cash) : Math.round((person.cash ?? 0) - debit);
            if (!Number.isFinite(value) || value < 0) { handle?.setMessage(`Bitte für ${person.name} einen gültigen Tagesgeld-Stand eintragen.`); return; }
            debits.push({ profileId: person.profileId, targetActionIds: person.buys.filter((/** @type {any} */ buy) => buy.debitPending).map((/** @type {any} */ buy) => buy.actionId), value });
        }
        await run(() => prepareSaleFlowWrite({ debits }), () => { for (const person of chosen) delete state.debits[person.profileId]; });
    };
    const writeResolution = async (/** @type {any} */ line, /** @type {string|null} */ decision) => {
        if (!plan) return;
        await run(() => prepareSaleFlowWrite({ resolution: { year: plan.year, ids: state.model.ids, line: { key: line.key, decision } } }), () => {});
    };

    /** @param {boolean} [input] Eingabe im aktiven Schritt: Inhalt bleibt, berechnete Werte ändern sich an Ort und Stelle (VN-1 Punkt 1). */
    /** VN-3 (Breitensuche zu Gemini Befund 2): Ein Knopf im Schritt, der den Schritt neu aufbaut (Person, Anlageklasse, weitere
     * Abrechnung), gibt den Fokus an das sichtbare Gegenstück im neuen Schritt weiter, statt ihn auf BODY fallen zu lassen.
     * @param {string} selector */
    const refocus = selector => /** @type {HTMLElement|undefined} */ ([...(handle?.root.querySelectorAll(selector) || [])]
        .find(node => /** @type {HTMLElement} */ (node).getClientRects().length > 0))?.focus();
    const refresh = (input = false) => {
        try { state.model = read(); }
        catch (error) { handle?.setMessage(/** @type {any} */ (error)?.message || 'Der Bestand ist nicht lesbar.'); return; }
        handle?.setSubtitle(subtitleText());
        if (mode === 'free') handle?.setTitle(freeTitle());
        handle?.updateSteps(steps(), { patch: input });
        updateFooter();
    };

    state.model = read();
    if (mode === 'plan') for (const line of state.model.lines) selectionFor(line.assetClass);
    else currentSelection();
    const first = startStep ? stepIds[Math.min(stepIds.length, Math.max(1, startStep)) - 1] || 'overview' : 'overview';
    if (mode === 'plan' && first !== 'overview') for (const line of state.model.lines) selectionFor(line.assetClass).confirmed = true;
    const handle = createCloseDialog({ doc, id: 'buyFlowDialog', eyebrow: mode === 'plan' ? `Kauf aus dem Plan ${plan?.year}` : 'Kauf ohne Planbezug',
        title: mode === 'plan' ? `${joinNames(planClasses().map(assetClass => CLASS_NAMES[assetClass] || assetClass))} kaufen` : freeTitle(), subtitle: '', steps: [], actions: [secondary, primary], returnFocus: () => opener?.focus?.(),
        onClose: async () => {
            if (!dirty()) return true;
            const attempt = await guard.prepare({ owners: [owner], intent: 'discard', opener });
            if (!attempt) return false;
            const accepted = guard.validate(attempt); guard.end(attempt);
            if (accepted) { state.drafts = {}; state.debits = {}; state.touched = false; registration.notify(); }
            return accepted;
        } });
    if (!handle) { registration.unregister(); return null; }
    handle.root.classList.add('sale-flow-dialog', 'buy-flow-dialog');
    handle.setFootnote('Bedingungen', mode === 'plan'
        ? 'Schritt 1 und 2 speichern nichts. „Kauf eintragen“ legt die Tranche an, „Speichern“ in Schritt 4 das Tagesgeld. Abschließen geht, sobald alle Abrechnungen eingetragen oder entschieden sind.'
        : 'Erst „Kauf eintragen“ legt die Tranche an und ändert das Tagesgeld. Bis dahin wird nichts gespeichert.');
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
