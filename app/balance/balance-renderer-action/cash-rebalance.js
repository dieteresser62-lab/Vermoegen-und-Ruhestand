import { UIUtils } from '../balance-utils.js';
import { resolveTargetTagesgeld, splitPlayLiquidity, priceMoneyMarketTransfer, priceMoneyMarketTransfers, withProfileLiquidityTargets, liquidityInflowRouting } from '../balance-play-execution.js';
import { CONFIG as ENGINE_CONFIG } from '../../../engine/config.mjs';

export const cashRebalanceMethods = {

    _integrateProfileCashRebalance(entries, rebalance, householdTarget) {
        if (!entries?.length) return entries;
        if (entries.some(entry => !entry?.input)) return entries;
        entries = withProfileLiquidityTargets(entries, householdTarget);
        const balances = entries.map(entry => {
            const split = this._splitLiquiditySource(entry.input, entry.action, entry.spending, entry.targetLiquidity);
            const target = this._resolveZielTagesgeld(entry.spending, entry.targetLiquidity, entry.input);
            const routing = liquidityInflowRouting(entry.input, entry.action, entry.spending, entry.targetLiquidity);
            const cash = Math.max(0, (entry.input?.tagesgeld || 0) - (split?.fromTagesgeld || 0)) + (routing?.tagesgeld || 0);
            return { split, target, gap: cash - target, available: Math.max(0, (entry.input?.geldmarktEtf || 0) - (split?.fromGeldmarkt || 0)) };
        });
        const transfers = entries.map(() => null);
        const cents = value => Math.round(value * 100) / 100;
        const threshold = UIUtils.getThreshold('THRESHOLDS.STRATEGY.cashRebalanceThreshold', 2500);
        const allocate = (weights, capacities, limit = Infinity) => {
            const total = Math.min(limit, capacities.reduce((sum, value) => sum + value, 0));
            if (!(Math.min(limit, weights.reduce((sum, value) => sum + value, 0)) > threshold)) return entries.map(() => 0);
            let rest = cents(this._quantize(total, 'floor'));
            const amounts = entries.map(() => 0);
            let active = capacities.map((value, i) => value > 0 ? i : -1).filter(i => i >= 0);
            while (rest > 0 && active.length) {
                const weight = active.reduce((sum, i) => sum + weights[i], 0);
                const capped = active.filter(i => rest * weights[i] / weight > capacities[i] - amounts[i]);
                if (capped.length) {
                    for (const i of capped) { const amount = cents(capacities[i] - amounts[i]); amounts[i] += amount; rest = cents(rest - amount); }
                    active = active.filter(i => !capped.includes(i));
                } else {
                    const amount = rest;
                    for (const [index, i] of active.entries()) {
                        const share = index === active.length - 1 ? rest : Math.min(rest, cents(amount * weights[i] / weight));
                        amounts[i] = cents(amounts[i] + share); rest = cents(rest - share);
                    }
                }
            }
            return amounts;
        };
        const deficits = balances.map(row => Math.max(0, -row.gap));
        const refills = allocate(deficits, balances.map((row, i) => Math.min(deficits[i], row.available)));
        for (const [i, amount] of refills.entries()) if (amount > 0) transfers[i] = {
            from: 'Geldmarkt-ETF', to: 'Tagesgeld', amount };
        let priced;
        try {
            priced = priceMoneyMarketTransfers(entries.map((entry, i) => ({ ...entry, cashSplit: balances[i].split, amount: refills[i] })));
        } catch (error) {
            if (error.code !== 'MONEY_MARKET_BASIS_MISSING') throw error;
            // Bei Zusammenveranlagung ist auch die Steuer des Partners offen.
            priced = entries.map(() => ({ unknown: error.message }));
        }
        // Erst die Nettozuflüsse und Kaufdeckungssteuern berücksichtigen. Ein
        // ungedeckter persönlicher Fehlbetrag bleibt dadurch im Haushalt verfügbar.
        const cashAfterRefill = entries.map((entry, i) => {
            const action = this._integrateCashRebalance(entry.action, transfers[i], entry.input, entry.spending, entry.targetLiquidity, priced[i]);
            return Math.max(0, entry.input?.tagesgeld || 0) - (balances[i].split?.fromTagesgeld || 0)
                + (action.verwendungen?.liquiditaet || 0) - (action.liquidityInflowToMoneyMarket || 0) - (action.cashOutflowTax || 0);
        });
        const householdCashTarget = entries.reduce((sum, entry) => sum + this._resolveZielTagesgeld(entry.spending, entry.targetLiquidity, entry.input), 0);
        const surplus = cashAfterRefill.map((cash, i) => transfers[i] || priced[i]?.unknown ? 0 : Math.max(0, cash - this._resolveZielTagesgeld(entries[i].spending, entries[i].targetLiquidity, entries[i].input)));
        const cashAvailable = cashAfterRefill.reduce((sum, cash, i) => sum + (priced[i]?.unknown
            ? Math.max(0, entries[i].input?.tagesgeld || 0) : cash), 0);
        const joint = entries.some(entry => entry.input?.jointAssessment || entry.action.taxSettlement?.jointAssessment);
        const safeSurplus = joint && priced.some(row => row?.unknown) ? 0 : Math.max(0, cashAvailable - householdCashTarget);
        const sweeps = allocate(surplus, surplus, safeSurplus);
        for (const [i, amount] of sweeps.entries()) if (amount > 0) transfers[i] = {
            from: 'Tagesgeld', to: 'Geldmarkt-ETF', amount };
        return entries.map((entry, i) => {
            const action = this._integrateCashRebalance(entry.action, transfers[i], entry.input, entry.spending, entry.targetLiquidity, priced[i]);
            const split = balances[i].split;
            const amount = transfers[i]?.to === 'Geldmarkt-ETF' ? transfers[i].amount : 0;
            return { ...entry, action, tagesgeldTarget: balances[i].target, cashSplit: amount > 0 ? { zielTagesgeld: this._resolveZielTagesgeld(entry.spending, entry.targetLiquidity, entry.input),
                fromTagesgeld: (split?.fromTagesgeld || 0) + amount, fromGeldmarkt: split?.fromGeldmarkt || 0,
                totalOutflow: (split?.totalOutflow || 0) + amount } : split };
        });
    },

    /**
     * Integrates the internal cash rebalance into the standard action object
     * so it renders strictly as part of the transaction card (like ETFs).
     */
    _integrateCashRebalance(originalAction, rebalance, input = null, spending = {}, targetLiquidity, priced = null) {
        if (!originalAction || typeof originalAction !== 'object' || Array.isArray(originalAction)) return originalAction;
        const split = this._splitLiquiditySource(input, originalAction, spending, targetLiquidity);
        const routing = liquidityInflowRouting(input, originalAction, spending, targetLiquidity);
        if (!rebalance && !split?.fromGeldmarkt && !priced && !(routing?.geldmarkt > 0)) return originalAction;
        const action = structuredClone(originalAction);
        action.liquidityInflowToMoneyMarket = routing?.geldmarkt || 0;
        action.quellen ||= []; action.verwendungen ||= {};
        if (rebalance) {
            action.internalCashRebalance = { ...rebalance, steuer: 0, netto: rebalance.amount };
            action.type = 'TRANSACTION';
            action.title = !action.title || action.title.includes('Kein Handlungsbedarf') ? 'Liquiditäts-Management' : action.title + ' & Geldmarkt-Opt.';
        }
        if (rebalance?.to === 'Geldmarkt-ETF') {
            action.quellen.unshift({ kind: 'liquiditaet', brutto: rebalance.amount, netto: rebalance.amount, steuer: 0, internalCashRebalance: true });
            action.verwendungen.geldmarkt = (action.verwendungen.geldmarkt || 0) + rebalance.amount;
        }
        if (!priced && (rebalance?.from === 'Geldmarkt-ETF' || split?.fromGeldmarkt > 0)) {
            try { priced = priceMoneyMarketTransfer(input, originalAction, rebalance?.from === 'Geldmarkt-ETF' ? rebalance.amount : 0, split); }
            catch (error) { if (error.code !== 'MONEY_MARKET_BASIS_MISSING') throw error; priced = { unknown: error.message }; }
        }
        if (priced?.unknown) {
            action.automaticExecutionBlocked = priced.unknown;
            if (action.internalCashRebalance) action.internalCashRebalance = { ...action.internalCashRebalance, steuer: null, taxUnknown: true, notice: priced.unknown };
            if (rebalance?.from === 'Geldmarkt-ETF') {
                action.quellen.push({ kind: 'geldmarkt', brutto: rebalance.amount, netto: rebalance.amount, internalCashRebalance: true });
                action.verwendungen.liquiditaet = (action.verwendungen.liquiditaet || 0) + rebalance.amount;
            }
        } else if (priced) {
            const originalTax = Math.max(0, priced.settlement.taxDue - priced.cashOutflowTax
                - priced.sources.reduce((sum, source) => sum + source.steuer, 0));
            if (priced.joint && Math.abs(originalTax - priced.previousTax) >= .005) action.partnerMoneyMarketTaxChange = Math.round((originalTax - priced.previousTax) * 100) / 100;
            if (originalTax !== priced.previousTax) {
                const taxed = action.quellen.filter(source => source.steuer > 0 || priced.previousTax === 0
                    && !['liquiditaet', 'cash'].includes(source.kind) && !source.internalCashRebalance && source.brutto > 0);
                const weight = source => priced.previousTax > 0 ? source.steuer || 0 : Math.max(0, source.taxableAfterTqfSigned ?? source.brutto);
                const total = taxed.reduce((sum, source) => sum + weight(source), 0);
                let rest = originalTax;
                for (const [i, source] of taxed.entries()) {
                    const share = total > 0 ? weight(source) / total : 1 / taxed.length;
                    source.steuer = i === taxed.length - 1 ? rest : Math.min(rest, Math.round(share * originalTax * 100) / 100);
                    rest = Math.round((rest - source.steuer) * 100) / 100;
                    source.netto = source.brutto - source.steuer;
                }
                // Auch ein veränderter Partner-Pauschbetrag ändert den verfügbaren Erlös.
                if (action.verwendungen.liquiditaet > 0) action.verwendungen.liquiditaet = Math.max(0, action.verwendungen.liquiditaet + priced.previousTax - originalTax);
                delete action.liquidityInflowToMoneyMarket;
                action.liquidityInflowToMoneyMarket = liquidityInflowRouting(input, action, spending, targetLiquidity)?.geldmarkt || 0;
            }
            action.quellen.push(...priced.sources);
            action.cashOutflowSales = priced.cashOutflowSales;
            action.cashOutflowTax = priced.cashOutflowTax;
            action.moneyMarketTaxReduction = priced.taxReduction;
            action.moneyMarketJointAssessment = priced.joint;
            action.moneyMarketLossOwners = priced.lossOwners;
            action.taxEstimated = priced.estimated;
            action.steuer = priced.settlement.taxDue;
            action.taxSettlement = priced.settlement.details;
            if (rebalance?.from === 'Geldmarkt-ETF') {
                const steuer = priced.sources.reduce((sum, source) => sum + source.steuer, 0);
                action.internalCashRebalance = { ...rebalance, steuer, netto: Math.round((rebalance.amount - steuer) * 100) / 100 };
                action.verwendungen.liquiditaet = (action.verwendungen.liquiditaet || 0) + action.internalCashRebalance.netto;
            }
        }
        action.nettoErlös = action.quellen.reduce((sum, q) => sum + (q.netto || 0), 0);
        return action;
    },

    _resolveZielTagesgeld(spending, targetLiquidity, input) {
        return resolveTargetTagesgeld(spending, targetLiquidity, input);
    },

    _splitLiquiditySource(input, action, spending, targetLiquidity) {
        return splitPlayLiquidity(input, action, spending, targetLiquidity);
    },

    /**
     * Berechnet interne Cash-Umschichtungen nach einer Transaktion.
     *
     * @param {Object|null} input - Originale Eingabedaten des Nutzers.
     * @param {Object} action - Handlungsempfehlung, insbesondere Verwendungsströme.
     * @param {Object} spending - Entnahmedaten zur Ableitung der Jahresentnahme.
     * @param {number} [targetLiquidity] - (Optional) Ziel-Liquidität aus der Engine.
     * @returns {Object|null} Handlungsvorschlag für ein internes Rebalancing.
     */
    determineInternalCashRebalance(input, action, spending, targetLiquidity) {
        if (!input || typeof input.tagesgeld !== 'number' || typeof input.geldmarktEtf !== 'number') return null;
        const entries = this._integrateProfileCashRebalance([{ input, action, spending, targetLiquidity }], null, targetLiquidity);
        const transfer = entries[0].action.internalCashRebalance;
        return transfer ? { from: transfer.from, to: transfer.to, amount: transfer.amount } : null;
    },

    /**
     * Quantizes an amount based on the Engine's Anti-Pseudo-Accuracy rules.
     * Replicates the logic from TransactionEngine.
     * @param {number} amount
     * @param {string} [mode='ceil'] - 'ceil' or 'floor'
     * @returns {number} Quantized amount
     */
    _quantize(amount, mode = 'ceil') {
        if (amount < 0) return 0;

        // Fetch config via global API
        const config = globalThis.window?.EngineAPI?.getConfig?.()?.ANTI_PSEUDO_ACCURACY
            || ENGINE_CONFIG.ANTI_PSEUDO_ACCURACY;

        if (!config || !config.ENABLED) return Math.floor(amount);

        // Find tier
        const tiers = config.QUANTIZATION_TIERS || [];
        const tier = tiers.find(t => amount < t.limit);
        const step = tier ? tier.step : 25000; // Use 25k as default step for large amounts

        if (mode === 'floor') {
            return Math.floor(amount / step) * step;
        }
        return Math.ceil(amount / step) * step;
    }
};
