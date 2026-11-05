/** @import {EngineTranche, Market, NormalizedEngineInput, SaleContext, SaleResult, SimulationPortfolio, SimulatorInputs} from '../../typcheck/rechenkern.js' */
/** Annual personal tax books. The Balance planner and settlement remain authoritative. */
import { attributeHouseholdAction } from '../profile/profilverbund-action-attribution.js';
import { settleTaxYear, settleHouseholdTaxYear } from '../../engine/tax-settlement.mjs';
import { personalProfiles, personalWithdrawalPlan, debitAccount, debitPersonalLiquidity, syncPersonalLiquidity } from './simulator-personal-accounts.js';
import { attachExecutedTaxContract, buildTaxRawAggregate, addTaxRawAggregate } from './simulator-tax-recompute.js';
import { calculateSaleAndTax } from '../../engine/transactions/sale-engine.mjs';
import { applySaleToPortfolio } from './simulator-portfolio-tranches.js';
import { buildDetailedTranchesFromPortfolio } from './simulator-engine-direct-utils.js';
import { inheritanceSale } from '../profile/household-inheritance-sale.js';
import { netPersonalAction, netActionEntriesOrOriginal, sumPersonalActions } from '../../engine/transactions/net-action.mjs';
import { quantizeAmount } from '../../engine/transactions/transaction-utils.mjs';

const books = new WeakMap();
const assessmentModes = new WeakMap();
const sum = (rows, key) => rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param [singlePersonFallback]
 * @returns Ergebnis der Operation.
 */
export function beginPersonalTaxYear(portfolio, singlePersonFallback = null) {
    // Older exports without individual allowances cannot prove their allocation.
    const fallback = portfolio.personAccounts.length === 1 ? singlePersonFallback : null;
    if (!fallback && !portfolio.personAccounts.every(person => Number.isFinite(person.sparerPauschbetrag))) return null;
    const rows = portfolio.personAccounts.map(account => ({ profileId: account.profileId, account,
        taxStatePrev: { ...(account.taxState || fallback?.taxState) }, sparerPauschbetrag: account.sparerPauschbetrag ?? fallback?.sparerPauschbetrag,
        kirchensteuerSatz: account.kirchensteuerSatz, rawAggregate: buildTaxRawAggregate(), reserved: 0 }));
    books.set(portfolio, rows);
    return rows;
}

/** Altformat: Eigentümer der Verkäufe erfassen, ohne persönliche Freibeträge zu erfinden.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @returns Ergebnis der Operation.
 */
export function beginAggregateTaxYear(portfolio) {
    const rows = portfolio.personAccounts.map(account => ({ profileId: account.profileId, account,
        sparerPauschbetrag: 0, kirchensteuerSatz: account.kirchensteuerSatz,
        rawAggregate: buildTaxRawAggregate(), reserved: 0 }));
    books.set(portfolio, rows);
    return rows;
}

/** Anspar-Altformat mit einem gemeinsamen Pauschbetrag und Verlustvortrag.
 *
 * @param {object} options
 * @param options.portfolio
 * @param options.book
 * @param options.personalInterest
 * @param options.actionResult
 * @param options.spendingNewState
 * @param options.inputs
 * @param options.taxStatePrev
 * @returns Ergebnis der Operation.
 */
export function settleAggregateTaxYear({ portfolio, book, personalInterest, actionResult, spendingNewState, inputs, taxStatePrev }) {
    const aggregate = () => book.reduce((raw, row) => addTaxRawAggregate(raw, row.rawAggregate), buildTaxRawAggregate());
    const cashInterest = personalInterest.items.reduce((total, row) => total + Math.max(0, row.cashInterest), 0);
    const assess = () => settleTaxYear({ rawAggregate: { ...aggregate(),
        sumTaxableAfterTqfSigned: aggregate().sumTaxableAfterTqfSigned + cashInterest },
        sparerPauschbetrag: inputs.startSPB, kirchensteuerSatz: inputs.kirchensteuerSatz, taxStatePrev });
    let paid = 0;
    for (let pass = 0; pass < 80; pass++) {
        const due = assess().taxDue - paid;
        if (due <= 1e-8) break;
        const payment = debitPersonalLiquidity(portfolio, due,
            personalWithdrawalPlan(personalProfiles(portfolio, inputs), due, inputs.householdWithdrawalMode)).total;
        paid += payment;
        const remaining = assess().taxDue - paid;
        if (remaining <= 1e-8) break;
        const order = personalWithdrawalPlan(personalProfiles(portfolio, inputs), remaining, inputs.householdWithdrawalMode);
        let raised = 0;
        for (const item of order.items) {
            const row = book.find(row => row.profileId === item.profileId);
            raised += fundPersonalCash(portfolio, row, Math.max(0, remaining - raised), {}, false, 'tax');
            if (raised >= remaining) break;
        }
        if (payment + raised <= 1e-8) break;
    }
    const final = assess();
    if (paid > final.taxDue) portfolio.personAccounts[0].tagesgeld += paid - final.taxDue;
    syncPersonalLiquidity(portfolio);
    const shortfall = Math.max(0, final.taxDue - paid);
    const adjustment = -Math.min(paid, final.taxDue);
    spendingNewState.taxState = final.taxStateNext;
    actionResult.steuer = final.taxDue;
    actionResult.taxRawAggregate = aggregate();
    actionResult.taxSettlement = { ...final.details, cashInterestIncomeSigned: cashInterest,
        taxableBaseIncludesCashInterest: true, taxCashAdjustment: adjustment };
    return { totalTaxesThisYear: final.taxDue, taxCashAdjustment: adjustment, taxFundingSaleGross: sum(book, 'taxFundingGross'),
        ...(shortfall > 1e-8 ? { taxShortfall: shortfall } : {}) };
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param lot
 * @param gross
 * @param cost
 * @returns {void}
 */
export function recordPersonalDisposal(portfolio, lot, gross, cost) {
    const rows = books.get(portfolio);
    if (!rows || gross <= 0) return;
    const row = rows.find(row => row.profileId === (lot.sourceProfileId || portfolio.simulationSourceProfileId));
    if (!row) throw new Error('SIM_PERSONAL_TAX_OWNER_MISSING');
    const gain = gross - cost;
    addTaxRawAggregate(row.rawAggregate, { sumRealizedGainSigned: gain,
        sumTaxableAfterTqfSigned: lot.taxExempt === true ? 0 : gain * (1 - (Number(lot.tqf) || 0)) });
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param snapshot
 * @param [sources]
 * @returns {void}
 */
export function recordPersonalSales(portfolio, snapshot, sources = []) {
    const rows = books.get(portfolio);
    if (!rows) return;
    for (const item of snapshot) recordPersonalDisposal(portfolio, item.lot,
        Math.max(0, item.value - item.lot.marketValue), Math.max(0, item.cost - item.lot.costBasis));
    for (const source of sources) {
        const row = rows.find(row => row.profileId === source.sourceProfileId);
        if (!row && source.steuer > 0) throw new Error('SIM_PERSONAL_TAX_RESERVE_OWNER_MISSING');
        if (row) row.reserved += Number(source.steuer) || 0;
    }
}

/** Persönlich verfügbare Beträge vor der Haushaltsplanung, mit derselben Mindestanlage.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param inputs Wirksame Simulationseingaben.
 * @param reserves
 * @param [rules]
 * @returns Ergebnis der Operation.
 */
export function personalCashInvestmentProfiles(portfolio, inputs, reserves, rules = { minimum: 500, isSavingsYear: true }) {
    return personalProfiles(portfolio, inputs).map(profile => {
        const reserve = reserves.find(row => row.profileId === profile.profileId)?.amount || 0;
        const free = Math.max(0, profile.inputs.tagesgeld + profile.inputs.geldmarktEtf - reserve);
        let capacity = rules.isSavingsYear ? Math.floor(free * 100) / 100 : quantizeAmount(free, 'floor');
        if (capacity < rules.minimum || !rules.isSavingsYear && capacity <= rules.minimum) capacity = 0;
        return { profileId: profile.profileId, capacity };
    });
}

/**
 * @param action
 * @param capacity
 * @returns {void}
 */
export function limitCashInvestment(action, capacity) {
    const cash = (action.quellen || []).filter(source => source.kind === 'liquiditaet');
    const requested = sum(cash, 'brutto'), invest = Math.min(requested, capacity);
    if (invest >= requested) return;
    let reduction = requested - invest;
    action.verwendungen = { ...action.verwendungen };
    for (const key of ['aktien', 'gold', 'bonds']) {
        const take = Math.min(action.verwendungen[key] || 0, reduction);
        if (take > 0) action.verwendungen[key] -= take; reduction -= take;
    }
    action.quellen = [...(invest > 0 ? [{ kind: 'liquiditaet', source: 'Liquidität', brutto: invest, netto: invest, steuer: 0 }] : []),
        ...action.quellen.filter(source => source.kind !== 'liquiditaet')];
    action.nettoErlös = (action.nettoErlös || 0) - requested + invest;
    if (!action.quellen.length) action.type = 'NONE';
    if (action.details) action.details = { ...action.details, kaufAkt: action.verwendungen.aktien || 0,
        kaufGld: action.verwendungen.gold || 0, verkaufLiquiditaet: invest };
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param action
 * @param inputs Wirksame Simulationseingaben.
 * @param {object} [options]
 * @param {boolean} [options.followup]
 * @param [options.onlyProfileId]
 * @param [options.cashReserves]
 * @returns Ergebnis der Operation.
 */
export function attributeSimulatorAction(portfolio, action, inputs, { followup = false, onlyProfileId = null, cashReserves = null } = {}) {
    const book = books.get(portfolio);
    if (!book || book.length < 2 || portfolio.personAccounts.length < 2) return inputs.decumulation?.mode === '3_bucket_jilge' ? netActionEntriesOrOriginal([{ action, input: personalProfiles(portfolio, inputs)[0]?.inputs }])[0].action : action;
    const profiles = personalProfiles(portfolio, inputs);
    const threeBucket = inputs.decumulation?.mode === '3_bucket_jilge';
    if (threeBucket) action = { ...action, quellen: (action.quellen || []).map(q => ({ ...q })), verwendungen: { ...action.verwendungen } };
    if (cashReserves && (action.quellen || []).some(source => source.kind === 'liquiditaet')) {
        const cashOnly = action.quellen.every(source => source.kind === 'liquiditaet');
        if (threeBucket) {
            const requested = sum(action.quellen.filter(source => source.kind === 'liquiditaet'), 'brutto');
            const rules = action.cashInvestmentRules || { minimum: 500, isSavingsYear: true };
            const capacities = personalCashInvestmentProfiles(portfolio, inputs, cashReserves, rules);
            let remaining = requested;
            for (const profile of profiles) {
                let amount = Math.min(remaining, capacities.find(p => p.profileId === profile.profileId).capacity);
                amount = rules.isSavingsYear ? Math.floor(amount * 100) / 100 : quantizeAmount(amount, 'floor');
                if (amount < rules.minimum || !rules.isSavingsYear && amount <= rules.minimum) amount = 0;
                profile.inputs.tagesgeld = amount;
                profile.inputs.geldmarktEtf = 0;
                remaining = Math.max(0, remaining - amount);
            }
            limitCashInvestment(action, requested - remaining);
        } else if (cashOnly) {
            for (const profile of profiles) {
                const reserve = cashReserves.find(row => row.profileId === profile.profileId)?.amount || 0;
                const cash = profile.inputs.tagesgeld;
                profile.inputs.tagesgeld = Math.max(0, cash - reserve);
                profile.inputs.geldmarktEtf = Math.max(0, profile.inputs.geldmarktEtf - Math.max(0, reserve - cash));
            }
            const capacity = profiles.reduce((sum, p) => sum + Math.floor((p.inputs.tagesgeld + p.inputs.geldmarktEtf) * 100) / 100, 0);
            const requested = sum(action.quellen, 'brutto'), invest = Math.min(requested, capacity);
            if (invest < requested) {
                const uses = { ...action.verwendungen };
                let reduction = requested - invest;
                for (const key of ['aktien', 'gold', 'bonds']) {
                    const take = Math.min(uses[key] || 0, reduction);
                    if (take > 0) uses[key] -= take;
                    reduction -= take;
                }
                action = { ...action, nettoErlös: invest, verwendungen: uses,
                    quellen: invest > 0 ? [{ kind: 'liquiditaet', source: 'Liquidität', brutto: invest, netto: invest, steuer: 0 }] : [] };
            }
        }
    }
    // Balance prefixes persisted IDs once; simulator IDs already include ownership
    // or are run-local purchase IDs. Adapt both directions without changing identity.
    const originalIds = new Map();
    // Zwei Ebenen (Profil → Los-ID) statt JSON-Schlüssel je Los; undefined/NaN/±Infinity werden
    // wie in JSON.stringify als null gleichgesetzt, sonst gilt dieselbe Wertgleichheit.
    const plannerIds = new Map();
    const idKey = value => value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : value;
    for (const profile of profiles) {
        profile.hasExplicitTrancheOverride = true;
        if (onlyProfileId && profile.profileId !== onlyProfileId) profile.tranches = [];
        let profileIds = plannerIds.get(idKey(profile.profileId));
        if (!profileIds) { profileIds = new Map(); plannerIds.set(idKey(profile.profileId), profileIds); }
        profile.tranches = profile.tranches.map(lot => {
            const id = String(lot.trancheId);
            const local = id.startsWith(`${profile.profileId}:`) ? id.slice(profile.profileId.length + 1) : id;
            const key = `${profile.profileId}:${local}`;
            originalIds.set(key, lot.trancheId);
            profileIds.set(idKey(lot.trancheId), key);
            return { ...lot, trancheId: local };
        });
    }
    if (followup) for (const profile of profiles) {
        const row = book.find(row => row.profileId === profile.profileId);
        const prior = settleTaxYear(row);
        profile.inputs.sparerPauschbetrag = Math.max(0, row.sparerPauschbetrag - prior.details.spbUsedThisYear);
        profile.balanceState.lastState.taxState = prior.taxStateNext;
    }
    const plannerAction = { ...action, quellen: (action.quellen || []).map(source => ({ ...source,
        trancheId: plannerIds.get(idKey(source.sourceProfileId))?.get(idKey(source.trancheId)) || source.trancheId })) };
    const attribution = attributeHouseholdAction({ householdAction: plannerAction, profiles,
        mode: inputs.householdWithdrawalMode || 'tax_optimized', jointAssessment: inputs.jointAssessment === true });
    const result = attribution.finalAction;
    const restoreIds = source => ({ ...source, trancheId: originalIds.get(source.trancheId) ?? source.trancheId });
    result.quellen = result.quellen.map(restoreIds);
    for (const entry of attribution.profileActions) entry.action.quellen = entry.action.quellen.map(restoreIds);
    result.verwendungen = Object.fromEntries(Object.entries(result.verwendungen)
        .filter(([key, value]) => Object.hasOwn(action.verwendungen || {}, key) || value !== 0));
    const plannedEntries = threeBucket ? netActionEntriesOrOriginal(attribution.profileActions.map(entry => ({ ...entry,
        input: profiles.find(p => p.profileId === entry.profileId).inputs })), inputs.jointAssessment === true) : attribution.profileActions;
    const entries = plannedEntries.map((entry, index) => ({ ...attribution.profileActions[index], action: entry.action }));
    const final = threeBucket ? sumPersonalActions(result, entries) : result;
    final.personalPlannedActions = entries;
    return final;
}

/** Raise cash from this person's actual lots; tax is assessed in the annual book. */
function fundPersonalCash(portfolio, row, need, market = {}, bondsOnly = false, reason = 'payout', sources = null) {
    const lots = [...portfolio.depotTranchesAktien, ...portfolio.depotTranchesGold]
        .filter(lot => (lot.sourceProfileId || portfolio.simulationSourceProfileId) === row.profileId
            && lot.marketValue > 1e-9 && (!bondsOnly || lot.category === 'bonds'));
    if (!lots.length) return 0;
    // Wieder aufgefüllte Anleihen können nur aggregierte Werte besitzen.
    // Dieselbe Engineprojektion wie im Jahresaufruf; die Ausführung nutzt die Originallots.
    const detailledTranches = /** @type {(portfolio: Partial<SimulationPortfolio>) => EngineTranche[]} */ (buildDetailedTranchesFromPortfolio)({
        depotTranchesAktien: lots, simulationSourceProfileId: portfolio.simulationSourceProfileId
    });
    let sale = /** @type {(amount: number, input: Partial<NormalizedEngineInput>, context: SaleContext, market: Partial<Market>, forced: boolean) => SaleResult} */ (calculateSaleAndTax)(Math.max(2, need), { detailledTranches, sparerPauschbetrag: 0,
        kirchensteuerSatz: row.kirchensteuerSatz, goldAktiv: true }, { minGold: 0 }, market, true);
    if (sale.bruttoVerkaufGesamt > 0) {
        const action = attributeSimulatorAction(portfolio, { type: 'TRANSACTION', quellen: sale.breakdown,
            verwendungen: { liquiditaet: sale.achievedRefill } }, {}, { followup: true, onlyProfileId: row.profileId });
        sale = { ...sale, breakdown: action.quellen };
    }
    const snapshot = lots.map(lot => ({ lot, value: lot.marketValue, cost: lot.costBasis }));
    applySaleToPortfolio(portfolio, sale);
    if (sources) sources.push(...sale.breakdown.map(source => ({ ...source, sourceProfileId: row.profileId })));
    let gross = 0;
    for (const item of snapshot) {
        const sold = Math.max(0, item.value - item.lot.marketValue);
        gross += sold;
        recordPersonalDisposal(portfolio, item.lot, sold, Math.max(0, item.cost - item.lot.costBasis));
    }
    row.account.tagesgeld += gross;
    if (reason === 'tax') row.taxFundingGross = (row.taxFundingGross || 0) + gross;
    syncPersonalLiquidity(portfolio);
    return gross;
}

/** Zahlung vor Renditen/Zinsen; Verkaufsgewinne bleiben im normalen Jahressteuerbuch.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param profileId Kennung der Person.
 * @param cost
 * @returns Ergebnis der Operation.
 */
export function payPersonalCostInAdvance(portfolio, profileId, cost) {
    const row = books.get(portfolio)?.find(row => row.profileId === profileId);
    if (!row) throw new Error('SIM_PERSONAL_TAX_OWNER_MISSING');
    const sources = [];
    let paidCost = debitAccount(portfolio, row.account, cost).amount;
    if (paidCost < cost) {
        fundPersonalCash(portfolio, row, cost - paidCost, {}, false, 'payout', sources);
        paidCost += debitAccount(portfolio, row.account, cost - paidCost).amount;
    }
    syncPersonalLiquidity(portfolio);
    return { paidCost, sources, shortfall: Math.max(0, cost - paidCost) };
}

/**
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param plan
 * @param market
 * @param {boolean} [bondsOnly]
 * @returns Ergebnis der Operation.
 */
export function coverPersonalPayout(portfolio, plan, market, bondsOnly = false) {
    const book = books.get(portfolio);
    const sources = [];
    if (!book) return { raised: 0, sources };
    let raised = 0;
    // Die reguläre Aktion kann seit der Entscheidung bereits Liquidität geschaffen haben.
    // Nur die aktuelle Haushaltslücke verkaufen, niemals eine veraltete persönliche Lücke.
    const totalNeed = plan.totalNeed ?? plan.items.reduce((sum, item) => sum + item.withdrawalAmount, 0);
    const currentPlan = plan.fixedOwnership ? plan : personalWithdrawalPlan(personalProfiles(portfolio), totalNeed, plan.mode);
    for (const item of currentPlan.items) {
        const shortfall = plan.fixedOwnership ? item.withdrawalAmount : Math.max(0, totalNeed - portfolio.liquiditaet);
        if (shortfall <= 0.01) { if (plan.fixedOwnership) continue; else break; }
        const row = book.find(row => row.profileId === item.profileId);
        const need = Math.min(shortfall, Math.max(0, item.withdrawalAmount - row.account.tagesgeld - row.account.geldmarktEtf));
        if (need > 0.01) raised += fundPersonalCash(portfolio, row, need, market, bondsOnly, 'payout', sources);
    }
    return { raised, sources };
}

/** Zusätzliche Verkaufssteuer mit dem noch verfügbaren persönlichen Jahressteuerbuch.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param profileId Kennung der Person.
 * @param personalInterest
 * @param actionResult
 * @returns Ergebnis der Operation.
 */
export function personalExtraSaleTax(portfolio, profileId, personalInterest, actionResult) {
    if (!books.get(portfolio)) {
        for (const account of portfolio.personAccounts) {
            account.sparerPauschbetrag ??= 0;
            account.taxState ??= { lossCarry: 0 };
        }
        beginPersonalTaxYear(portfolio);
    }
    const row = books.get(portfolio).find(row => row.profileId === profileId);
    const priorTax = actionResult.personalAnnualTaxes?.find(entry => entry.profileId === profileId)?.taxDue || 0;
    const interest = Math.max(0, personalInterest.items.find(item => item.profileId === profileId)?.cashInterest || 0);
    return raw => Math.max(0, settleTaxYear({ ...row, rawAggregate: {
        sumRealizedGainSigned: row.rawAggregate.sumRealizedGainSigned + raw.sumRealizedGainSigned,
        sumTaxableAfterTqfSigned: row.rawAggregate.sumTaxableAfterTqfSigned + raw.sumTaxableAfterTqfSigned + interest
    } }).taxDue - priorTax);
}

/** Verkaufe ausschließlich den Depotanteil von X, bevor eigenes Geld herangezogen wird.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param profileId Kennung der Person.
 * @param lots
 * @returns Ergebnis der Operation.
 */
export function realizeInheritedTaxCash(portfolio, profileId, lots) {
    if (!lots.length) return [];
    if (!books.get(portfolio)) {
        for (const account of portfolio.personAccounts) {
            account.sparerPauschbetrag ??= 0;
            account.taxState ??= { lossCarry: 0 };
        }
        beginPersonalTaxYear(portfolio);
    }
    const account = portfolio.personAccounts.find(row => row.profileId === profileId);
    const sale = inheritanceSale(lots.map(({ lot, share }) => ({ ...lot,
        marketValue: lot.marketValue * share, costBasis: lot.costBasis * share,
        ...(Number.isFinite(lot.shares) ? { shares: lot.shares * share } : {}) })), account.kirchensteuerSatz);
    // Auch Pflegereservetranchen bleiben dieselben Objekte; nur X wird flüssig.
    const projection = { depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [] };
    for (const { lot } of lots) (lot.type === 'geldmarkt' || lot.category === 'money_market' ? projection.depotTranchesGeldmarkt
        : lot.type === 'gold' || lot.category === 'gold' ? projection.depotTranchesGold : projection.depotTranchesAktien).push(lot);
    const snapshot = lots.map(({ lot }) => ({ lot, value: lot.marketValue, cost: lot.costBasis }));
    applySaleToPortfolio(projection, sale);
    let gross = 0;
    for (const item of snapshot) {
        const sold = Math.max(0, item.value - item.lot.marketValue);
        gross += sold;
        recordPersonalDisposal(portfolio, item.lot, sold, Math.max(0, item.cost - item.lot.costBasis));
    }
    account.tagesgeld += gross;
    syncPersonalLiquidity(portfolio);
    return sale.breakdown.map(source => ({ ...source, sourceProfileId: profileId }));
}

/** Zusätzliche Sterbejahrzahlung nach dem Jahresabschluss, mit demselben Steuerbuch.
 *
 * @param portfolio Veränderlicher Portfoliozustand.
 * @param profileId Kennung der Person.
 * @param cost
 * @param personalInterest
 * @param actionResult
 * @param {object} [options]
 * @param {boolean} [options.cashAlreadyRaised]
 * @param {boolean} [options.jointAssessment]
 * @param [options.liquidityReserve]
 * @param {number} [options.inheritedTaxCash]
 * @returns Ergebnis der Operation.
 */
export function payPersonalExtraCost(portfolio, profileId, cost, personalInterest, actionResult,
    { cashAlreadyRaised = false, jointAssessment = assessmentModes.get(portfolio) === true,
        liquidityReserve = null, inheritedTaxCash = 0 } = {}) {
    let book = books.get(portfolio);
    if (!book) {
        for (const account of portfolio.personAccounts) {
            account.sparerPauschbetrag ??= 0;
            account.taxState ??= { lossCarry: 0 };
        }
        book = beginPersonalTaxYear(portfolio);
    }
    const row = book.find(row => row.profileId === profileId);
    // Das Jahresbuch enthält im Sterbejahr weiterhin beide Personen, auch wenn
    // der Nachlass ihre Konten bereits zusammengeführt hat (FR-28).
    const assessedBook = jointAssessment ? book : [row];
    const previous = assessedBook.map(entry => actionResult.personalAnnualTaxes?.find(tax => tax.profileId === entry.profileId));
    const priorTax = previous.reduce((total, entry) => total + (entry?.taxDue || 0), 0);
    const previousSaleTax = previous.reduce((total, entry) => total + (entry?.saleTaxDue || 0), 0);
    const assessAll = (withInterest = true) => settleHouseholdTaxYear(assessedBook.map(entry => ({ ...entry,
        rawAggregate: { ...entry.rawAggregate, sumTaxableAfterTqfSigned: entry.rawAggregate.sumTaxableAfterTqfSigned
            + (withInterest ? Math.max(0, personalInterest.items.find(item => item.profileId === entry.profileId)?.cashInterest || 0) : 0) }
    })), jointAssessment);
    const assess = () => assessAll().reduce((total, entry) => total + entry.taxDue, 0);
    const sources = [];
    const protectsReserve = liquidityReserve !== null;
    const initialLiquidity = row.account.tagesgeld + row.account.geldmarktEtf;
    // FR-54: Das eigens geerbte Steuergeld steht vor dem Reserveschutz bereit.
    const protectedLiquidity = Math.min(liquidityReserve, Math.max(0, initialLiquidity - inheritedTaxCash));
    const availableCash = () => protectsReserve
        ? Math.max(0, row.account.tagesgeld + row.account.geldmarktEtf - protectedLiquidity) : Infinity;
    let paidCost = debitAccount(portfolio, row.account, Math.min(cost, availableCash())).amount, paidTax = 0;
    for (let step = 0; step < 80; step++) {
        const extraTax = Math.max(0, assess() - priorTax);
        if (cashAlreadyRaised) paidTax += debitAccount(portfolio, row.account,
            Math.min(Math.max(0, extraTax - paidTax), availableCash())).amount;
        // Auch die Steuerabbuchung kann Geldmarktgewinne auslösen.
        const need = Math.max(0, cost - paidCost) + Math.max(0, assess() - priorTax - paidTax);
        if (need <= 1e-7) break;
        syncPersonalLiquidity(portfolio);
        const depotNeed = protectsReserve ? Math.max(0, need - availableCash())
            : Math.max(0, need - row.account.tagesgeld - row.account.geldmarktEtf);
        if (depotNeed > 1e-8) fundPersonalCash(portfolio, row, depotNeed, {}, false, 'inheritance', sources);
        const costPart = debitAccount(portfolio, row.account, Math.max(0, cost - paidCost)).amount;
        paidCost += costPart;
        const taxPart = debitAccount(portfolio, row.account, Math.max(0, assess() - priorTax - paidTax)).amount;
        paidTax += taxPart;
        if (costPart + taxPart <= 1e-8) break;
    }
    const finals = assessAll(), saleFinals = assessAll(false);
    const extraTax = finals.reduce((total, entry) => total + entry.taxDue, 0) - priorTax;
    // Verlustverkäufe können bereits bezahlte Jahressteuer zurückgeben.
    // Auch eine nach weiteren Verkäufen zu hohe Nachzahlung wird ausgeglichen.
    const refund = Math.max(0, paidTax - extraTax);
    row.account.tagesgeld += refund;
    paidTax -= refund;
    if (paidCost < cost) paidCost += debitAccount(portfolio, row.account, cost - paidCost).amount;
    const previousDetails = {};
    for (const entry of previous) for (const [key, value] of Object.entries(entry?.details || {})) {
        if (typeof value === 'number') previousDetails[key] = (previousDetails[key] || 0) + value;
    }
    const otherTaxDelta = finals.reduce((total, final, index) => assessedBook[index] === row ? total
        : total + final.taxDue - (previous[index]?.taxDue || 0), 0);
    finals.forEach((final, index) => {
        assessedBook[index].account.taxState = { ...final.taxStateNext };
        if (previous[index]) Object.assign(previous[index], { taxDue: final.taxDue, taxStateNext: final.taxStateNext,
            details: final.details, saleTaxDue: saleFinals[index].taxDue,
            taxCashAdjustment: previous[index].taxCashAdjustment - (assessedBook[index] === row
                ? paidTax - otherTaxDelta : final.taxDue - previous[index].taxDue) });
    });
    actionResult.steuer += extraTax;
    if (actionResult.taxSettlement) {
        actionResult.taxSettlement.taxCashAdjustment -= paidTax;
        const saleDelta = saleFinals.reduce((total, entry) => total + entry.taxDue, 0) - previousSaleTax;
        actionResult.taxSettlement.saleTaxDue += saleDelta;
        actionResult.taxSettlement.cashInterestTaxDelta += extraTax - saleDelta;
        for (const key of Object.keys(previousDetails)) {
            if (typeof actionResult.taxSettlement[key] === 'number')
                actionResult.taxSettlement[key] += finals.reduce((total, final) => total + (final.details[key] || 0), 0) - previousDetails[key];
        }
        actionResult.taxRawAggregate = { sumRealizedGainSigned: actionResult.taxSettlement.sumRealizedGainSigned,
            sumTaxableAfterTqfSigned: actionResult.taxSettlement.sumTaxableAfterTqfSigned };
        const contract = actionResult.taxSettlement.executedTaxContract;
        if (contract) Object.assign(contract, { saleTaxDue: contract.saleTaxDue + saleDelta,
            cashInterestTaxDelta: contract.cashInterestTaxDelta + extraTax - saleDelta,
            finalAnnualTax: contract.finalAnnualTax + extraTax,
            rawTaxCashAdjustment: contract.rawTaxCashAdjustment - extraTax,
            taxCashAdjustment: contract.taxCashAdjustment - paidTax });
    }
    syncPersonalLiquidity(portfolio);
    return { paidCost, extraTax, paidTax, sources, shortfall: Math.max(0, cost - paidCost) + Math.max(0, extraTax - paidTax),
        ...(protectsReserve ? { funding: { reserveTarget: liquidityReserve,
            saleGross: sources.reduce((total, source) => total + source.brutto, 0),
            liquidityUsed: initialLiquidity - row.account.tagesgeld - row.account.geldmarktEtf } } : {}) };
}

/**
 * @param {object} options
 * @param options.portfolio
 * @param options.book
 * @param options.personalInterest
 * @param options.actionResult
 * @param options.plannedActionFlow
 * @param options.regularSaleScale
 * @param options.forcedTaxReserved
 * @param options.spendingNewState
 * @param options.didForcedSale
 * @param [options.inputs]
 * @returns Ergebnis der Operation.
 */
export function settlePersonalTaxYear({ portfolio, book, personalInterest, actionResult,
    plannedActionFlow, regularSaleScale, forcedTaxReserved, spendingNewState, didForcedSale, inputs = /** @type {Partial<SimulatorInputs>} */ ({}) }) {
    assessmentModes.set(portfolio, inputs.jointAssessment === true);
    const booked = new Map(book.map(row => [row.profileId, 0]));
    const householdFunding = new Map(book.map(row => [row.profileId, new Map()]));
    const householdTaxSources = [];
    let householdDepotUsed = false;
    const cashInterestFor = row => Math.max(0, personalInterest.items.find(item => item.profileId === row.profileId)?.cashInterest || 0);
    // Zwischenspeicher je Zinsvariante: Zinsen, Pauschbeträge, Verlustvorträge und Kirchensteuer
    // sind im Jahresbuch konstant; nur die beiden Rohsummen je Zeile ändern sich zwischen den Aufrufen.
    const assessCache = [null, null];
    const assessAll = (withInterest = true) => {
        const cached = assessCache[withInterest ? 1 : 0];
        if (cached) {
            let same = true;
            for (let index = 0; index < book.length; index += 1) {
                const raw = book[index].rawAggregate;
                if (cached.raws[2 * index] !== raw.sumRealizedGainSigned || cached.raws[2 * index + 1] !== raw.sumTaxableAfterTqfSigned) { same = false; break; }
            }
            if (same) return cached.result;
        }
        const raws = [];
        for (const row of book) raws.push(row.rawAggregate.sumRealizedGainSigned, row.rawAggregate.sumTaxableAfterTqfSigned);
        const result = settleHouseholdTaxYear(book.map(row => ({ ...row,
            rawAggregate: { ...row.rawAggregate, sumTaxableAfterTqfSigned:
                row.rawAggregate.sumTaxableAfterTqfSigned + (withInterest ? cashInterestFor(row) : 0) } })), inputs.jointAssessment === true);
        assessCache[withInterest ? 1 : 0] = { raws, result };
        return result;
    };
    const assess = row => assessAll()[book.indexOf(row)];
    const deltaFor = row => row.reserved - assess(row).taxDue - booked.get(row.profileId);
    // A helper's MM disposal can change a previously settled person's tax. Revisit
    // all books before freezing any loss carry; allowances still apply just once.
    for (let pass = 0; pass < 40; pass++) {
        let progressed = false;
        for (const row of book) {
            for (let step = 0; step < 40; step++) {
                const delta = deltaFor(row);
                if (Math.abs(delta) <= 1e-8) break;
                if (delta > 0) {
                    row.account.tagesgeld += delta;
                    booked.set(row.profileId, booked.get(row.profileId) + delta);
                    progressed = true;
                } else {
                    let paid = debitAccount(portfolio, row.account, -delta).amount;
                    syncPersonalLiquidity(portfolio);
                    if (paid + 1e-8 < -delta) {
                        // FR-16: use household liquidity in Balance plan order before
                        // selling the taxpayer's own investments. Each account uses TG before MM.
                        const profiles = personalProfiles(portfolio, inputs).filter(profile => profile.profileId !== row.profileId);
                        // The planner quantizes to cents; query at least one cent for
                        // the order while keeping actual payments unrounded (FR-14).
                        const order = personalWithdrawalPlan(profiles, Math.max(0.01, -delta - paid), inputs.householdWithdrawalMode);
                        for (const item of order.items) {
                            const remaining = -delta - paid;
                            if (remaining <= 1e-8) break;
                            const account = portfolio.personAccounts.find(account => account.profileId === item.profileId);
                            const contribution = debitAccount(portfolio, account, remaining).amount;
                            const funding = householdFunding.get(row.profileId);
                            if (contribution > 0) funding.set(account.profileId, (funding.get(account.profileId) || 0) + contribution);
                            paid += contribution;
                        }
                    }
                    const need = -delta - paid;
                    if (need > 1e-8) {
                        fundPersonalCash(portfolio, row, need, {}, false, 'tax', householdTaxSources);
                        paid += debitAccount(portfolio, row.account, need).amount;
                    }
                    if (paid + 1e-8 < -delta) {
                        // Erst nach Haushaltsliquidität und eigenem Depot die übrigen
                        // Depots in Planreihenfolge nutzen. Gewinne gehören weiterhin
                        // dem Verkäufer und werden in den folgenden Durchgängen versteuert.
                        const profiles = personalProfiles(portfolio, inputs).filter(profile => profile.profileId !== row.profileId);
                        const order = personalWithdrawalPlan(profiles, Math.max(0.01, -delta - paid), inputs.householdWithdrawalMode);
                        for (const item of order.items) {
                            const remaining = -delta - paid;
                            if (remaining <= 1e-8) break;
                            const helper = book.find(candidate => candidate.profileId === item.profileId);
                            const raised = fundPersonalCash(portfolio, helper, remaining, {}, false, 'tax', householdTaxSources);
                            householdDepotUsed ||= raised > 0;
                            const contribution = debitAccount(portfolio, helper.account, remaining).amount;
                            const funding = householdFunding.get(row.profileId);
                            if (contribution > 0) funding.set(helper.profileId, (funding.get(helper.profileId) || 0) + contribution);
                            paid += contribution;
                        }
                    }
                    booked.set(row.profileId, booked.get(row.profileId) - paid);
                    syncPersonalLiquidity(portfolio);
                    if (paid <= 1e-8) break;
                    progressed = true;
                }
            }
        }
        if (book.every(row => Math.abs(deltaFor(row)) <= 1e-8) || !progressed) break;
        if (pass === 39) throw new Error('SIM_PERSONAL_TAX_SETTLEMENT_NOT_CONVERGED');
    }
    const results = book.map(row => {
        const settlement = assess(row);
        const shortfall = Math.max(0, settlement.taxDue + booked.get(row.profileId) - row.reserved);
        row.account.taxState = { ...settlement.taxStateNext };
        const result = { profileId: row.profileId, taxDue: settlement.taxDue,
            taxStateNext: settlement.taxStateNext, details: settlement.details,
            cashInterestIncomeSigned: cashInterestFor(row), saleTaxDue: inputs.jointAssessment === true ? assessAll(false)[book.indexOf(row)].taxDue : settleTaxYear(row).taxDue,
            taxFundingGross: row.taxFundingGross || 0,
            taxReserved: row.reserved, taxCashAdjustment: booked.get(row.profileId) };
        // Gleiche Schlüsselreihenfolge wie zuvor, ohne bedingte Spreads im Literal.
        const funding = householdFunding.get(row.profileId);
        if (funding.size) result.householdTaxFunding = [...funding].map(([profileId, amount]) => ({ profileId, amount }));
        if (shortfall > 1e-8) result.taxShortfall = shortfall;
        return result;
    });
    syncPersonalLiquidity(portfolio);
    const totalTax = sum(results, 'taxDue');
    const saleTax = sum(results, 'saleTaxDue');
    const reserved = sum(book, 'reserved');
    const adjustment = sum(results, 'taxCashAdjustment');
    const details = {};
    for (const key of ['sumRealizedGainSigned', 'sumTaxableAfterTqfSigned', 'lossCarryStart', 'signedAfterCarry',
        'spbUsedThisYear', 'taxBaseBeforeCarry', 'taxBaseAfterCarry', 'taxBeforeLossCarry', 'taxAfterLossCarry', 'taxSavedByLossCarry']) {
        details[key] = results.reduce((total, row) => total + row.details[key], 0);
    }
    actionResult.steuer = totalTax;
    actionResult.taxSettlement = { ...details, profilverbund: book.length > 1, profiles: results,
        cashInterestIncomeSigned: sum(results, 'cashInterestIncomeSigned'), taxableBaseIncludesCashInterest: true,
        saleTaxDue: saleTax, cashInterestTaxDelta: totalTax - saleTax, taxCashAdjustment: adjustment };
    actionResult.taxRawAggregate = { sumRealizedGainSigned: details.sumRealizedGainSigned,
        sumTaxableAfterTqfSigned: details.sumTaxableAfterTqfSigned };
    actionResult.personalAnnualTaxes = results;
    if (householdDepotUsed) actionResult.householdTaxSale = {
        gross: sum(householdTaxSources, 'brutto'), sources: householdTaxSources
    };
    // The household guardrail state never owns a personal loss carry.
    spendingNewState.taxState = book.length > 1 ? { lossCarry: 0 } : { ...results[0].taxStateNext };
    const taxShortfall = sum(results, 'taxShortfall');
    if (taxShortfall > 1e-8) {
        actionResult.taxSettlement.taxShortfall = taxShortfall;
        return { totalTaxesThisYear: totalTax, taxCashAdjustment: adjustment, taxShortfall };
    }
    attachExecutedTaxContract({ actionResult, plannedActionFlow, regularSaleScale,
        regularTaxReserved: (plannedActionFlow?.steuer || 0) * regularSaleScale, forcedTaxReserved,
        taxReservedTotal: reserved, saleTaxDue: saleTax, cashInterestTaxDelta: totalTax - saleTax,
        finalAnnualTax: totalTax, rawTaxCashAdjustment: reserved - totalTax, taxCashAdjustment: adjustment,
        recomputedWithForcedSales: didForcedSale, recomputedAfterActionTransform: true });
    return { totalTaxesThisYear: totalTax, taxCashAdjustment: adjustment };
}
