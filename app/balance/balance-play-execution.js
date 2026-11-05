import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { canGenerateExampleExpenses } from '../demo/beispielausgaben.js';
import { PersistenceFacade as P, persistenceStorage } from '../shared/persistence-facade.js';
import { PROBELAUF_STATE_KEY } from '../shared/probelauf-state.js';
import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { prepareCashRecords, readCashPerson, parseCashInput } from '../profile/profile-cash-update.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { PROFILE_CASH_HISTORY_KEY } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection, equityPurchaseTemplate } from '../../types/tranche-contract.js';
import { settleTaxYear, settleHouseholdTaxYear, capitalGainsTaxRate } from '../../engine/tax-settlement.mjs';
import { calculateTargetLiquidityDetails } from '../../engine/transactions/transaction-utils.mjs';
import { resolveLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';
import { syntheticQuote } from '../shared/probelauf-prices.js';
import { recordTrancheCollection } from '../tranches/tranchen-recording.js';
import { CONFIG } from './balance-config.js';
import { HOUSEHOLD_PLAN_KEY, readBalanceHouseholdPlan } from '../profile/household-plan.js';
import { registeredPlanTrial } from '../shared/plan-trial.js';
import { personalCashTargets } from './balance-liquidity-targets.js';
import { commitTrancheReconciliation, commitCashPostingConfirmation, projectReconciliationCashStatuses } from '../tranches/tranche-reconciliation.js';

const REGISTRY = 'rs_profiles_v1';
const BATCHES = 'playActionExecutions';
const cents = value => Math.round(value * 100) / 100;
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
const defaults = {
    aktien: { type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', name: 'Spielwert Aktien-ETF', tqf: .3 },
    gold: { type: 'gold', category: 'gold', ticker: '4GLD.DE', name: 'Spielwert Gold', tqf: 0 },
    bonds: { type: 'anleihe', category: 'bonds', ticker: 'IBGS.DE', name: 'Spielwert Anleihen', tqf: 0 },
    geldmarkt: { type: 'geldmarkt', category: 'money_market', ticker: 'XEON.DE', name: 'Spielwert Geldmarkt-ETF', tqf: 0 }
};
const writeKeys = new Set([REGISTRY, 'depot_tranchen', 'profile_wealth_history_lots_v1', 'profile_tagesgeld', PROFILE_CASH_HISTORY_KEY,
    'rs_current_profile', 'rs_active_profile', PROBELAUF_STATE_KEY]);

/** Gemeinsame Cashaufteilung für dargestellte und automatisch eingetragene Anweisungen. */
/**
 * @param spending Eingabe für die bestehende Projektion.
 * @param targetLiquidity Eingabe für die bestehende Projektion.
 * @param input Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function resolveTargetTagesgeld(spending, targetLiquidity, input = {}) {
    input ||= {};
    const months = resolveLiquidityRunwayYears(input).years * 12;
    let cashMonths = input.liquidityCashMonths;
    if (cashMonths === undefined) {
        const trial = registeredPlanTrial(globalThis.document);
        const plan = trial?.read().active ? trial.values() : readBalanceHouseholdPlan().entry?.values;
        cashMonths = plan?.liquidityCashMonths ?? 12;
    }
    if (!Number.isFinite(months) || !Number.isInteger(cashMonths) || cashMonths < 0 || cashMonths > months) throw new Error('Ungültige Tagesgeldmonate oder Reichweite.');
    const plannedNeed = Number.isFinite(input.floorBedarf) && Number.isFinite(input.flexBedarf)
        ? Math.max(0, input.floorBedarf + input.flexBedarf - (input.renteAktiv ? (input.renteMonatlich || 0) * 12 : 0))
        : Math.max(0, (spending?.monatlicheEntnahme || 0) * 12);
    const target = Number.isFinite(targetLiquidity) ? Math.max(0, targetLiquidity)
        : calculateTargetLiquidityDetails(null, null, plannedNeed, /** @type {Parameters<typeof calculateTargetLiquidityDetails>[3]} */ (input)).targetLiquidity;
    const grossNeed = Number.isFinite(input.floorBedarf) || Number.isFinite(input.flexBedarf)
        ? positive(input.floorBedarf) + positive(input.flexBedarf) : plannedNeed;
    const minimumCash = input.minimumTagesgeld ?? grossNeed / 12 * (input.minCashBufferMonths ?? 2);
    return input.personalTagesgeldTarget ?? Math.max(target / months * cashMonths, minimumCash);
}

/** Erlösverteilung ohne interne Transfers; identisch in Karte, Dialog und Jahresabschluss. */
/**
 * @param input Eingabe für die bestehende Projektion.
 * @param action Eingabe für die bestehende Projektion.
 * @param spending Eingabe für die bestehende Projektion.
 * @param targetLiquidity Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function liquidityInflowRouting(input, action, spending, targetLiquidity) {
    const incoming = positive(action?.verwendungen?.liquiditaet);
    if (Number.isFinite(action?.liquidityInflowToMoneyMarket)) return {
        tagesgeld: cents(incoming - action.liquidityInflowToMoneyMarket), geldmarkt: action.liquidityInflowToMoneyMarket };
    if (!Number.isFinite(input?.tagesgeld)) return null;
    const split = splitPlayLiquidity(input, action, spending, targetLiquidity);
    const tagesgeld = cents(Math.min(incoming, Math.max(0, (split?.zielTagesgeld ?? resolveTargetTagesgeld(spending, targetLiquidity, input))
        - Math.max(0, input.tagesgeld - (split?.fromTagesgeld || 0)))));
    return { tagesgeld, geldmarkt: cents(incoming - tagesgeld) };
}

/**
 * @param input Eingabe für die bestehende Projektion.
 * @param action Eingabe für die bestehende Projektion.
 * @param spending Eingabe für die bestehende Projektion.
 * @param targetLiquidity Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function splitPlayLiquidity(input, action, spending, targetLiquidity) {
    if (!input || typeof input.tagesgeld !== 'number' || typeof input.geldmarktEtf !== 'number') return null;
    const zielTagesgeld = resolveTargetTagesgeld(spending, targetLiquidity, input);
    const outflow = (Array.isArray(action?.quellen) ? action.quellen : [])
        .filter(source => source.kind === 'liquiditaet' || source.source === 'Liquidität').reduce((sum, source) => sum + (source.brutto || 0), 0);
    if (!Number.isFinite(outflow) || outflow <= 0) return null;
    const availableCash = Math.max(0, input.tagesgeld), availableMoneyMarket = Math.max(0, input.geldmarktEtf);
    if (outflow > availableCash + availableMoneyMarket + .01) throw new Error('Die Liquiditätsquelle übersteigt den vorhandenen Bestand.');
    const fromTagesgeld = Math.min(outflow, availableCash, Math.max(0, availableCash - zielTagesgeld, outflow - availableMoneyMarket));
    return { zielTagesgeld, fromTagesgeld, fromGeldmarkt: Math.min(availableMoneyMarket, Math.max(0, outflow - fromTagesgeld)), totalOutflow: outflow };
}

/** Persönliche Tagesgeldziele nach Bedarf; das Haushaltsziel bleibt erhalten. */
/**
 * @param entries Eingabe für die bestehende Projektion.
 * @param householdTarget Eingabe für die bestehende Projektion.
 * @param options Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function withProfileLiquidityTargets(entries, householdTarget, options) {
    if (!entries?.length || !Number.isFinite(householdTarget)) return entries;
    const weights = entries.map(() => 1);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let rest = cents(householdTarget);
    const result = entries.map((entry, index) => {
        const targetLiquidity = entry.targetLiquidity ?? (index === entries.length - 1 ? rest : cents(householdTarget * weights[index] / total));
        rest = cents(rest - targetLiquidity);
        return { ...entry, targetLiquidity };
    });
    if (entries.length === 1 || entries.every(entry => Number.isFinite(entry.input?.personalTagesgeldTarget))) return result;
    const first = entries[0].input || {};
    const householdMinimum = (positive(first.floorBedarf) + positive(first.flexBedarf)) / 12 * (first.minCashBufferMonths ?? 2);
    const householdCash = resolveTargetTagesgeld(entries[0].spending, householdTarget, { ...first, minimumTagesgeld: householdMinimum });
    return personalCashTargets(result, householdCash, householdMinimum, options);
}

/** Beleg bleibt unverändert; die Anzeige teilt seine Erlöse mit bekannten Beständen auf. */
/**
 * @param action Eingabe für die bestehende Projektion.
 * @param context Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function annualLiquidityInflowRouting(action, context) {
    if (!context) return null;
    if (!context.entries?.length) return liquidityInflowRouting(context.input, action, context.spending, context.targetLiquidity);
    const entries = withProfileLiquidityTargets(context.entries, context.targetLiquidity);
    if (entries.some(entry => !Number.isFinite(entry.input?.tagesgeld))) return null;
    const net = entry => (action.quellen || []).filter(source => source.sourceProfileId === entry.profileId
        || entries.length === 1 && !source.sourceProfileId).reduce((sum, source) => sum + (source.netto || 0), 0);
    const weights = entries.map(net), total = weights.reduce((sum, value) => sum + value, 0);
    if (!(total > 0)) return null;
    let rest = cents(action.verwendungen?.liquiditaet || 0);
    return entries.reduce((sum, entry, i) => {
        const incoming = i === entries.length - 1 ? rest : cents((action.verwendungen?.liquiditaet || 0) * weights[i] / total);
        rest = cents(rest - incoming);
        const personalAction = { quellen: (action.quellen || []).filter(source => source.sourceProfileId === entry.profileId
            || entries.length === 1 && !source.sourceProfileId), verwendungen: { liquiditaet: incoming } };
        const routing = liquidityInflowRouting(entry.input, personalAction, entry.spending, entry.targetLiquidity);
        return { tagesgeld: cents(sum.tagesgeld + routing.tagesgeld), geldmarkt: cents(sum.geldmarkt + routing.geldmarkt) };
    }, { tagesgeld: 0, geldmarkt: 0 });
}

/** Nur die Werte, die die Beleganzeige braucht; keine Engine-Diagnosen im Dialogkontext. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {{input?: import('../../typcheck/balance-ui.js').Input, spending?: Partial<import('../../typcheck/rechenkern.js').SpendingResult>, targetLiquidity?: number, entries?: import('../../typcheck/balance-ui.js').ActionEntry[]}} [options] @returns Lesender Liquiditätskontext. */
export function liquidityDisplayContext({ input, spending, targetLiquidity, entries } = {}) {
    if (entries?.length) entries = withProfileLiquidityTargets(entries, targetLiquidity);
    const pick = values => Object.fromEntries(['tagesgeld', 'geldmarktEtf', 'floorBedarf', 'flexBedarf', 'renteAktiv', 'renteMonatlich',
        'minCashBufferMonths', 'liquidityRunwayYears', 'liquidityCashMonths', 'minimumTagesgeld', 'personalTagesgeldTarget'].map(key => [key, values?.[key]]).filter(([, value]) => value !== undefined));
    return { input: pick(input), spending: { monatlicheEntnahme: spending?.monatlicheEntnahme }, targetLiquidity,
        ...(entries?.length ? { entries: entries.map(entry => ({ profileId: entry.profileId, input: pick(entry.input),
            spending: { monatlicheEntnahme: entry.spending?.monatlicheEntnahme }, targetLiquidity: entry.targetLiquidity })) } : {}) };
}

/** Gleiche Tranchenfolge für Anzeige und Eintragung; Einstand ist Pflicht. */
/**
 * @param lots Eingabe für die bestehende Projektion.
 * @param amount Eingabe für die bestehende Projektion.
 * @param reserved Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function selectMoneyMarketSales(lots, amount, reserved = new Map()) {
    const ordered = lots.filter(lot => lot.category === 'money_market' && lot.marketValue > 0).sort((a, b) =>
        (1 - a.costBasis / a.marketValue) - (1 - b.costBasis / b.marketValue)
        || a.purchaseDate.localeCompare(b.purchaseDate) || a.trancheId.localeCompare(b.trancheId));
    const sales = [];
    for (const lot of ordered) {
        const gross = Math.min(amount, lot.marketValue - (reserved.get(lot.trancheId) || 0));
        if (gross > 0) { sales.push({ lot, gross }); amount -= gross; }
    }
    if (amount > .01) {
        const error = /** @type {Error & {code?: string}} */ (new Error('Steuer nicht ermittelbar – Einstand im Vermögen fehlt'));
        error.code = 'MONEY_MARKET_BASIS_MISSING'; throw error;
    }
    return sales;
}

/** Gemeinsame Jahressteuer, zuerst Transfer, danach Kaufdeckung aus dem Geldmarkt. */
/**
 * @param entries Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function priceMoneyMarketTransfers(entries) {
    const joint = entries.length === 2 && entries.some(entry => entry.input?.jointAssessment || entry.action.taxSettlement?.jointAssessment);
    const selected = entries.map(({ input, action, amount = 0, cashSplit }) => {
        if (!joint && !(amount > 0) && !(cashSplit?.fromGeldmarkt > 0)) return null;
        const lots = normalizeTrancheCollection(input?.detailledTranches || [], { mode: 'engine' });
        const reserved = new Map();
        const sources = action.quellen || [];
        for (const source of sources) {
            const lot = lots.find(lot => lot.trancheId === source.trancheId
                || source.sourceProfileId && `${source.sourceProfileId}:${lot.trancheId}` === source.trancheId);
            if (lot) reserved.set(lot.trancheId, (reserved.get(lot.trancheId) || 0) + source.brutto);
        }
        let coverage, transfer;
        try {
            coverage = selectMoneyMarketSales(lots, cashSplit?.fromGeldmarkt || 0, reserved);
            for (const { lot, gross } of coverage) reserved.set(lot.trancheId, (reserved.get(lot.trancheId) || 0) + gross);
            transfer = selectMoneyMarketSales(lots, amount, reserved);
        } catch (error) {
            if (joint || error.code !== 'MONEY_MARKET_BASIS_MISSING') throw error;
            return { unknown: error.message };
        }
        const taxable = ({ lot, gross }) => lot.taxExempt ? 0 : gross * (1 - lot.costBasis / lot.marketValue);
        const previousTax = cents(action.steuer ?? sources.reduce((sum, source) => sum + (source.steuer || 0), 0));
        const lossCarry = action.taxSettlement?.lossCarryStart ?? input?.taxState?.lossCarry ?? 0;
        const missing = !Number.isFinite(action.taxSettlement?.sumTaxableAfterTqfSigned)
            && previousTax > 0 && (!sources.length || sources.some(source => !['liquiditaet', 'cash'].includes(source.kind)
                && !Number.isFinite(source.taxableAfterTqfSigned)));
        // Alte Aktionen ohne Gewinnbasis bleiben sichtbar, aber ausdrücklich geschätzt.
        const priorTaxable = Number.isFinite(action.taxSettlement?.sumTaxableAfterTqfSigned) ? action.taxSettlement.sumTaxableAfterTqfSigned : (missing
            ? previousTax / capitalGainsTaxRate(input?.kirchensteuerSatz) + (input?.sparerPauschbetrag || 0) + lossCarry
            : sources.reduce((sum, source) => sum + (source.taxableAfterTqfSigned || 0), 0));
        return { transfer, coverage, taxable, previousTax, priorTaxable, lossCarry, estimated: missing };
    });
    const settle = includeCoverage => settleHouseholdTaxYear(entries.map(({ input }, index) => {
        const row = selected[index];
        if (!row || row.unknown) return { rawAggregate: { sumTaxableAfterTqfSigned: 0 } };
        return { rawAggregate: { sumTaxableAfterTqfSigned: row.priorTaxable + row.transfer.reduce((sum, sale) => sum + row.taxable(sale), 0)
            + (includeCoverage ? row.coverage.reduce((sum, sale) => sum + row.taxable(sale), 0) : 0) },
            sparerPauschbetrag: input?.sparerPauschbetrag, kirchensteuerSatz: input?.kirchensteuerSatz,
            taxStatePrev: { lossCarry: row.lossCarry } };
    }), joint);
    const transferSettlements = settle(false), finalSettlements = settle(true);
    return selected.map((row, index) => {
        if (!row || row.unknown) return row;
        const settlement = finalSettlements[index]; settlement.taxDue = cents(settlement.taxDue);
        const transferTax = row.transfer.some(sale => row.taxable(sale) > 0)
            ? Math.min(settlement.taxDue, cents(Math.max(0, transferSettlements[index].taxDue - row.previousTax))) : 0;
        const coverageTax = row.coverage.some(sale => row.taxable(sale) > 0)
            ? cents(Math.max(0, settlement.taxDue - Math.min(row.previousTax, cents(transferSettlements[index].taxDue)) - transferTax)) : 0;
        const allocate = (sales, totalTax, internal) => {
            const gains = sales.map(row.taxable), positiveGains = gains.reduce((sum, value) => sum + Math.max(0, value), 0);
            const last = gains.findLastIndex(value => value > 0);
            let rest = totalTax;
            return sales.map(({ lot, gross }, i) => {
                const steuer = i === last ? rest : positiveGains > 0 ? Math.min(rest, cents(totalTax * Math.max(0, gains[i]) / positiveGains)) : 0;
                rest = cents(rest - steuer);
                return { kind: 'geldmarkt', trancheId: lot.trancheId, name: lot.name, purchaseDate: lot.purchaseDate,
                    brutto: gross, steuer, netto: cents(gross - steuer), taxableAfterTqfSigned: gains[i],
                    ...(internal ? { internalCashRebalance: true } : {}) };
            });
        };
        const lossOwners = joint ? entries.filter((_, i) => selected[i].transfer.concat(selected[i].coverage)
            .some(sale => selected[i].taxable(sale) < 0)).map(entry => entry.name || entry.profileId || 'Partner') : [];
        return { previousTax: row.previousTax, settlement, estimated: row.estimated, joint, lossOwners,
            taxReduction: cents(Math.max(0, row.previousTax - settlement.taxDue)), cashOutflowTax: coverageTax,
            sources: allocate(row.transfer, transferTax, true), cashOutflowSales: allocate(row.coverage, coverageTax, false) };
    });
}

/**
 * @param input Eingabe für die bestehende Projektion.
 * @param action Eingabe für die bestehende Projektion.
 * @param amount Eingabe für die bestehende Projektion.
 * @param cashSplit Eingabe für die bestehende Projektion.
 * @param householdEntries Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function priceMoneyMarketTransfer(input, action, amount, cashSplit = null, householdEntries = null) {
    const rows = householdEntries || [{ input, action, amount, cashSplit }];
    return priceMoneyMarketTransfers(rows)[0];
}

/**
 * @param controller Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function canExecutePlayAction(controller) {
    return canGenerateExampleExpenses(controller) && P.getPersistenceStatus().activeArea === 'spiel';
}
function requirePlay(controller) {
    if (!canExecutePlayAction(controller)) throw new Error('Anweisungen lassen sich nur im bestätigten aktiven Spielbereich eintragen.');
}
function capture(storage) {
    return Object.fromEntries([...new Set([...Object.keys(captureProfileData(storage)), ...PROFILE_SCOPED_FIXED_KEYS, ...writeKeys, CONFIG.STORAGE.LS_KEY, HOUSEHOLD_PLAN_KEY])].sort()
        .map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
}
function assertFresh(prepared, controller, storage) {
    requirePlay(controller);
    if (prepared.date !== localCalendarDate(appNow()) || JSON.stringify(capture(storage)) !== JSON.stringify(prepared.before)) {
        throw new Error('Bestand oder Spielbereich hat sich geändert. Bitte die Anweisung erneut öffnen.');
    }
}
function memory(data) {
    const copy = { ...data };
    return { copy, getItem: key => copy[key] ?? null, setItem: (key, raw) => { copy[key] = String(raw); }, removeItem: key => { delete copy[key]; } };
}
function profileStore(registry, id) {
    const storage = memory({ ...registry.profiles[id].data, [REGISTRY]: JSON.stringify(registry), rs_current_profile: id, rs_active_profile: id });
    const save = () => {
        const next = JSON.parse(storage.getItem(REGISTRY));
        for (const key of PROFILE_SCOPED_FIXED_KEYS) {
            const raw = storage.getItem(key);
            if (raw === null) delete next.profiles[id].data[key]; else next.profiles[id].data[key] = raw;
        }
        storage.setItem(REGISTRY, JSON.stringify(next)); return true;
    };
    const persistence = { async replaceRecordsTransactional(records, options) {
        for (const key of writeKeys) if (options.allowKey(key)) {
            if (records[key] === undefined) storage.removeItem(key); else storage.setItem(key, records[key]);
        }
        return { ok: true };
    } };
    return { storage, options: { storage, saveCurrentProfile: save, getCurrentProfileId: () => id, getActiveProfileId: () => id,
        flush: async () => true, persistence }, save };
}
function updateCash(data, value, date) {
    const changes = prepareCashRecords(data, cents(value), date);
    if (changes[PROFILE_CASH_HISTORY_KEY]) {
        const history = JSON.parse(changes[PROFILE_CASH_HISTORY_KEY]);
        const entry = history.entries.find(item => item.date === date);
        if (entry) entry.source = 'spielwert';
        changes[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history);
    }
    Object.assign(data, changes);
}
function finalRecords(before, registry, activeId) {
    const records = Object.fromEntries(Object.entries(before).filter(([key]) => writeKeys.has(key)));
    records[REGISTRY] = JSON.stringify(registry);
    for (const key of writeKeys) if (PROFILE_SCOPED_FIXED_KEYS.includes(key)) {
        if (registry.profiles[activeId].data[key] === undefined) delete records[key];
        else records[key] = registry.profiles[activeId].data[key];
    }
    return records;
}

/** Nur private Stringrecords: dieselben Verkaufs-, Kauf- und Cashwriter wie im Manager. */
/**
 * @param options Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export async function preparePlayAction({ entries, controller, storage = persistenceStorage, id = globalThis.crypto?.randomUUID?.() || `spiel-${Date.now()}` }) {
    requirePlay(controller);
    const before = capture(storage), date = localCalendarDate(appNow());
    const activeId = storage.getItem('rs_current_profile');
    let registry = JSON.parse(storage.getItem(REGISTRY));
    if (!registry?.profiles?.[activeId] || storage.getItem('rs_active_profile') !== activeId) throw new Error('Profilbestand nicht verfügbar.');
    registry.profiles[activeId].data = captureProfileData(storage);
    const members = Object.keys(registry.profiles).filter(key => registry.profiles[key].meta.belongsToHousehold !== false).sort();
    const ids = entries.map(entry => entry.profileId).sort();
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(key => !registry.profiles[key])
        || (ids.length > 1 && JSON.stringify(ids) !== JSON.stringify(members))) throw new Error('Anweisung passt nicht mehr zum Haushalt.');
    if (pendingPlayActions(registry).length) throw new Error('Bitte zuerst die ausstehende Gutschrift bestätigen.');
    const allLots = ids.flatMap(key => normalizeTrancheCollection(JSON.parse(registry.profiles[key].data.depot_tranchen || '[]'), { mode: 'persisted' }));
    const people = [], lines = [];
    for (const entry of entries) {
        if (entry.action.automaticExecutionBlocked) throw new Error(entry.action.automaticExecutionBlocked);
        const profileId = entry.profileId, data = registry.profiles[profileId].data;
        const name = registry.profiles[profileId].meta.name;
        const person = readCashPerson(profileId, name, data);
        if (person.error || person.value === null) throw new Error(`${name}: Tagesgeld-Stand fehlt oder ist beschädigt.`);
        const original = normalizeTrancheCollection(JSON.parse(data.depot_tranchen || '[]'), { mode: 'persisted' });
        const equityTemplate = equityPurchaseTemplate(original);
        const reserved = new Map(), sales = [];
        const addSale = (lot, gross, taxes = null) => {
            const available = lot.marketValue - (reserved.get(lot.trancheId) || 0);
            if (gross > available + .01) throw new Error(`${name}: Verkauf übersteigt den Tranchenbestand.`);
            const amount = Math.min(gross, available);
            if (amount <= 0) return;
            reserved.set(lot.trancheId, (reserved.get(lot.trancheId) || 0) + amount);
            sales.push({ lot, gross: amount, taxes });
        };
        const sellMoneyMarket = amount => {
            for (const sale of selectMoneyMarketSales(original, amount, reserved)) addSale(sale.lot, sale.gross);
        };
        for (const q of entry.action.quellen || []) {
            if (!positive(q.brutto)) continue;
            if (q.kind === 'liquiditaet' || q.source === 'Liquidität') {
                if (!entry.cashSplit) throw new Error('Aufteilung zwischen Tagesgeld und Geldmarkt fehlt.');
                continue;
            }
            const lot = original.find(lot => lot.trancheId === q.trancheId
                || q.sourceProfileId === profileId && `${profileId}:${lot.trancheId}` === q.trancheId);
            if (q.sourceProfileId && q.sourceProfileId !== profileId) throw new Error('Verkauf gehört zu einer anderen Person.');
            if (lot) addSale(lot, q.brutto, Number.isFinite(q.steuer) ? q.steuer : null);
            else if (q.kind === 'geldmarkt') sellMoneyMarket(q.brutto);
            else throw new Error(`${name}: Konkrete Verkaufstranche fehlt. Bitte den Bestand in Vermögen prüfen.`);
        }
        if (entry.action.cashOutflowSales?.length) {
            for (const source of entry.action.cashOutflowSales) {
                const lot = original.find(lot => lot.trancheId === source.trancheId);
                if (!lot) throw new Error('Geldmarkttranche für die Kaufdeckung fehlt.');
                addSale(lot, source.brutto, source.steuer);
            }
        } else if (positive(entry.cashSplit?.fromGeldmarkt)) sellMoneyMarket(entry.cashSplit.fromGeldmarkt);
        // Konkrete Balance-Verkäufe behalten ihre finale Steuer. Zusätzliche
        // Geldmarktverkäufe nutzen die bestehende Settlementrechnung auf allen Quellen.
        const taxable = sale => sale.gross * (1 - sale.lot.purchasePrice / sale.lot.currentPrice) * (sale.lot.taxExempt ? 0 : 1 - sale.lot.tqf);
        const plannedTaxes = sales.reduce((sum, sale) => sum + (sale.taxes ?? 0), 0);
        const rawAggregate = { sumTaxableAfterTqfSigned: sales.reduce((sum, sale) => sum + taxable(sale), 0) };
        const balanceState = JSON.parse(data[CONFIG.STORAGE.LS_KEY] || '{}');
        const computed = entry.action.taxSettlement && Number.isFinite(entry.action.steuer) ? entry.action.steuer : settleTaxYear({ rawAggregate, sparerPauschbetrag: entry.input?.sparerPauschbetrag,
            kirchensteuerSatz: entry.input?.kirchensteuerSatz,
            taxStatePrev: { lossCarry: entry.action.taxSettlement?.lossCarryStart ?? balanceState.lastState?.taxState?.lossCarry ?? 0 } }).taxDue;
        let extraTax = Math.max(0, computed - plannedTaxes);
        for (const sale of sales.filter(sale => sale.taxes === null)) { sale.taxes = Math.min(extraTax, sale.gross); extraTax -= sale.taxes; }
        const saleIds = [], purchases = [];
        let net = 0;
        for (const [index, sale] of sales.entries()) {
            const context = profileStore(registry, profileId), actionId = `${id}-${profileId}-${index + 1}`;
            const result = await commitTrancheReconciliation({ profileId, action: { actionId, profileId,
                trancheId: sale.lot.trancheId, executedAt: date, grossProceeds: sale.gross,
                sharesSold: sale.gross / sale.lot.currentPrice, fees: 0, taxes: sale.taxes, source: 'spielwert' } }, context.options);
            // @ts-expect-error TP-Befund TP-6-2: Regulär neue UUID je Vorschau plus Person/Verkaufsnummer; assertFresh sperrt Doppelbestätigung, Neustart verwirft Spielaudit. duplicate ohne registry setzt injizierte ID oder Kennungskollision voraus (fs-2-play-action-ids.test.mjs).
            registry = structuredClone(result.registry); saleIds.push(actionId); net += result.preview.action.netProceeds;
            lines.push({ profileId, name, kind: 'sale', asset: sale.lot.name, amount: sale.gross, taxes: sale.taxes,
                net: result.preview.action.netProceeds, price: sale.lot.currentPrice });
        }
        for (const [key, fallback] of Object.entries(defaults)) {
            const amount = positive(entry.action.verwendungen?.[key]) + (key === 'geldmarkt' ? positive(entry.action.liquidityInflowToMoneyMarket) : 0);
            if (!amount) continue;
            const template = key === 'aktien' ? equityTemplate
                : allLots.find(lot => lot.type === fallback.type) || allLots.find(lot => lot.category === fallback.category);
            const quote = template ? { price: template.currentPrice, asOf: template.asOf } : syntheticQuote(fallback.ticker, date);
            const lot = { ...(template || fallback), trancheId: `${id}-${profileId}-buy-${key}`, schemaVersion: 2,
                type: fallback.type, category: fallback.category, shares: amount / quote.price, currentPrice: quote.price,
                purchasePrice: quote.price, purchaseDate: date, ...(quote.asOf ? { asOf: quote.asOf } : {}),
                taxExempt: key === 'gold' && data.profile_gold_steuerfrei === 'true',
                source: 'spielwert', notes: 'Spielwert · Anweisung als ausgeführt eingetragen' };
            purchases.push(lot);
            lines.push({ profileId, name, kind: 'buy', asset: lot.name, amount, price: quote.price, synthetic: !template });
        }
        const purchaseTotal = lines.filter(line => line.profileId === profileId && line.kind === 'buy').reduce((sum, line) => sum + line.amount, 0);
        const finalCash = cents(person.value + net - purchaseTotal);
        if (finalCash < 0) throw new Error(`${name}: Tagesgeld reicht nach den Buchungen nicht aus.`);
        if (purchases.length) {
            const context = profileStore(registry, profileId);
            const current = JSON.parse(context.storage.getItem('depot_tranchen') || '[]');
            recordTrancheCollection([...current, ...purchases], context.storage, { previousTranches: current, date });
            context.save(); registry = JSON.parse(context.storage.getItem(REGISTRY));
        }
        if (!saleIds.length && purchaseTotal) updateCash(registry.profiles[profileId].data, finalCash, date);
        people.push({ profileId, name, saleIds, net: cents(net), purchaseTotal: cents(purchaseTotal), cashBefore: person.value, finalCash });
    }
    if (!lines.length) throw new Error('Die Anweisung enthält keine Buchungen.');
    const batch = { id, source: 'spielwert', date, people };
    registry[BATCHES] = [...(registry[BATCHES] || []), batch];
    return { before, date, activeId, batch, lines, records: finalRecords(before, registry, activeId) };
}

/**
 * @param registry Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function pendingPlayActions(registry = JSON.parse(persistenceStorage.getItem(REGISTRY) || '{}')) {
    const statuses = projectReconciliationCashStatuses(registry);
    return (registry[BATCHES] || []).filter(batch => batch.source === 'spielwert' && batch.people.some(person =>
        person.saleIds.some(id => statuses.some(status => status.targetActionId === id && status.canConfirm))));
}

/**
 * @param prepared Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param prepared Vorbereitete Buchung. @param {{controller?: import('../../typcheck/balance-ui.js').PlayController, storage?: typeof persistenceStorage, navigationOperation?: import('../../typcheck/speicher-integration.js').Operation, validate?: ()=>void}} [options] @returns Bestätigter Buchungsstapel. */
export async function commitPlayAction(prepared, { controller, storage = persistenceStorage, navigationOperation, validate = () => {} } = {}) {
    return withAnnualWriteAccess(async () => {
        assertFresh(prepared, controller, storage); validate();
        await P.replaceRecordsTransactional(prepared.records, { probelaufDomainWrite: true, navigationOperation,
            allowKey: key => writeKeys.has(key), expectedRecords: Object.fromEntries(Object.entries(prepared.before).filter(([key]) => writeKeys.has(key))),
            postValidate: () => { requirePlay(controller); return true; } });
        return prepared.batch;
    });
}

/**
 * @param batchId Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param {string} batchId @param {{controller?: import('../../typcheck/balance-ui.js').PlayController, storage?: typeof persistenceStorage, values?: Record<string, number|string>}} [options] @returns Vorbereitete Spielgutschrift. */
export async function preparePlayCredit(batchId, { controller, storage = persistenceStorage, values = {} } = {}) {
    requirePlay(controller);
    const before = capture(storage), date = localCalendarDate(appNow()), activeId = storage.getItem('rs_current_profile');
    let registry = JSON.parse(storage.getItem(REGISTRY));
    registry.profiles[activeId].data = captureProfileData(storage);
    const batch = pendingPlayActions(registry).find(batch => batch.id === batchId);
    if (!batch) throw new Error('Keine ausstehende Spielgutschrift vorhanden.');
    const statuses = projectReconciliationCashStatuses(registry);
    for (const person of batch.people) {
        const pendingIds = person.saleIds.filter(id => statuses.some(status => status.targetActionId === id && status.canConfirm));
        const cash = readCashPerson(person.profileId, person.name, registry.profiles[person.profileId].data);
        if (pendingIds.length && (cash.error || cash.value !== person.cashBefore)) throw new Error(`${person.name}: Tagesgeld wurde inzwischen geändert. Bitte den Cashstatus in Vermögen prüfen.`);
        if (pendingIds.length !== person.saleIds.length) throw new Error('Eine Gutschrift wurde bereits außerhalb dieses Dialogs bestätigt. Bitte den Cashstatus in Vermögen prüfen.');
        const value = parseCashInput(values[person.profileId] ?? person.finalCash);
        for (const targetActionId of pendingIds) {
            const context = profileStore(registry, person.profileId);
            const result = await commitCashPostingConfirmation({ profileId: person.profileId, targetActionId,
                cashBalanceAfterPostingEur: value, confirmedAt: appNow().toISOString() }, context.options);
            registry = structuredClone(result.registry);
        }
        if (pendingIds.length) {
            const history = JSON.parse(registry.profiles[person.profileId].data[PROFILE_CASH_HISTORY_KEY] || 'null');
            const historyEntry = history?.entries.find(item => item.date === date);
            if (historyEntry) { historyEntry.source = 'spielwert'; registry.profiles[person.profileId].data[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history); }
        }
    }
    return { before, date, activeId, batch, records: finalRecords(before, registry, activeId) };
}
