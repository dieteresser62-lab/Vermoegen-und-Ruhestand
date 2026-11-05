/** @import {EngineInput, NormalizedEngineInput, Market, RunwayProfile, Needs, SaleContext, SaleLot, SaleResult, Action, ActionSource, ActionUses, ActionDetails, TransactionDiagnostics, TransactionParameters, TransactionHelpers, ActionEntry} from '../../typcheck/rechenkern' */
import { settleHouseholdTaxYear } from '../tax-settlement.mjs';

/** FR-63: gegenläufige Aufträge einer Person vor jeder Buchung verrechnen. */
export const actionAssetKey = /** @param {Pick<ActionSource,"kind"|"category">} source */
source => /bond|anleihe/i.test(source.category || source.kind) ? 'bonds'
    : source.category === 'gold' || source.kind === 'gold' ? 'gold'
        : source.category === 'equity' || /^aktien/.test(source.kind) ? 'aktien' : null;

/** @param {Action} action
 * @returns {Action} */
export function netPersonalAction(action) {
    const uses = { ...action.verwendungen }, sources = (action.quellen || []).map(q => ({ ...q }));
    let changed = false, savedTax = 0;
    for (const key of ['aktien', 'bonds', 'gold']) {
        let cancel = Math.min(uses[key] || 0, sources.filter(q => actionAssetKey(q) === key).reduce((s, q) => s + q.brutto, 0));
        if (!(cancel > .005)) continue;
        changed = true; uses[key] -= cancel;
        for (const q of sources.filter(q => actionAssetKey(q) === key)) {
            const take = Math.min(q.brutto, cancel), scale = q.brutto > 0 ? (q.brutto - take) / q.brutto : 0;
            savedTax += (q.steuer || 0) * (1 - scale);
            for (const field of ['brutto', 'netto', 'steuer', 'spbUsed', 'realizedGainSigned', 'taxableAfterTqfSigned']) if (Number.isFinite(q[field])) q[field] *= scale;
            cancel -= take;
        }
    }
    if (!changed) return action;
    let refund = savedTax;
    for (const q of sources.filter(q => q.kind === 'liquiditaet')) {
        const reduction = Math.min(q.brutto, refund);
        q.brutto -= reduction; q.netto = q.brutto; refund -= reduction;
    }
    if (refund > 0) uses.liquiditaet = (uses.liquiditaet || 0) + refund;
    const quellen = sources.filter(q => q.brutto > 1e-8);
    const steuer = quellen.reduce((sum, q) => sum + (q.steuer || 0), 0);
    const result = { ...action, quellen, verwendungen: uses, steuer, nettoErlös: quellen.reduce((s, q) => s + (q.netto ?? q.brutto - (q.steuer || 0)), 0),
        bruttoVerkaufGesamt: quellen.filter(q => actionAssetKey(q)).reduce((s, q) => s + q.brutto, 0),
        taxRawAggregate: { sumRealizedGainSigned: quellen.reduce((s, q) => s + (q.realizedGainSigned || 0), 0),
            sumTaxableAfterTqfSigned: quellen.reduce((s, q) => s + (q.taxableAfterTqfSigned || 0), 0) },
        taxSettlement: undefined };
    if (result.bondPayoutProtection && !quellen.some(q => actionAssetKey(q) === 'bonds' && q.brutto > .005)) delete result.bondPayoutProtection;
    return result;
}

/** @param {Action} base
 * @param {ActionEntry[]} entries
 * @returns {Action} */
export function sumPersonalActions(base, entries) {
    const actions = entries.map(entry => entry.action);
    const result = { ...base, quellen: actions.flatMap(a => a.quellen || []),
        verwendungen: Object.fromEntries(['liquiditaet', 'geldmarkt', 'aktien', 'gold', 'bonds'].map(key => [key, actions.reduce((s, a) => s + (a.verwendungen?.[key] || 0), 0)]).filter(([key, amount]) => amount !== 0 || Object.hasOwn(base.verwendungen || {}, key))),
        nettoErlös: actions.reduce((s, a) => s + (a.nettoErlös || 0), 0), steuer: actions.reduce((s, a) => s + (a.steuer || 0), 0),
        taxRawAggregate: { sumRealizedGainSigned: actions.reduce((s, a) => s + (a.taxRawAggregate?.sumRealizedGainSigned || 0), 0),
            sumTaxableAfterTqfSigned: actions.reduce((s, a) => s + (a.taxRawAggregate?.sumTaxableAfterTqfSigned || 0), 0) } };
    if (result.bondPayoutProtection && !result.quellen.some(q => actionAssetKey(q) === 'bonds' && q.brutto > .005)) delete result.bondPayoutProtection;
    return result;
}

/** @param {{name?:string;action:Partial<Action>}[]} entries */
export function threeBucketActionTrades(entries) {
    return entries.flatMap(entry => {
        const action = entry.action || {}, uses = action.verwendungen || {};
        const classes = [['Aktien', 'aktien'], ['Anleihen', 'bonds'], ['Gold', 'gold']];
        return classes.map(([label, key]) => {
            const sales = (action.quellen || []).filter(source => {
                const category = String(source.category || source.kind || '').toLowerCase();
                const kind = String(source.kind || '').toLowerCase();
                return key === 'bonds' ? /bond|anleihe/.test(category) || /bond|anleihe/.test(kind)
                    : key === 'gold' ? category === 'gold' || kind === 'gold'
                        : category === 'equity' || kind.startsWith('aktien');
            }).reduce((sum, source) => sum + (Number(source.brutto) || 0), 0);
            const net = sales - (Number(uses[key]) || 0);
            return { profile: entry.name || '', label, key, net };
        }).filter(row => Math.abs(row.net) > .005);
    });
}


/** Nach der Verrechnung gelten Pauschbetrag und Verlustvortrag für die Restverkäufe. */
/** @param {ActionEntry[]} entries */
export function netActionEntries(entries, jointAssessment = false) {
    const net = entries.map(entry => ({ ...entry, action: netPersonalAction(entry.action) }));
    if (!net.some((entry, index) => entry.action !== entries[index].action)) return entries;
    if (!net.every(entry => Number.isFinite(entry.input?.sparerPauschbetrag))) return net;
    const settlements = settleHouseholdTaxYear(net.map((entry, index) => ({
        rawAggregate: entry.action.taxRawAggregate,
        sparerPauschbetrag: entry.input.sparerPauschbetrag,
        kirchensteuerSatz: entry.input.kirchensteuerSatz,
        taxStatePrev: { lossCarry: entries[index].action.taxSettlement?.lossCarryStart ?? entries[index].input.taxStatePrev?.lossCarry ?? 0 }
    })), jointAssessment);
    return net.map((entry, index) => {
        const action = { ...entry.action, quellen: (entry.action.quellen || []).map(q => ({ ...q })), verwendungen: { ...entry.action.verwendungen } };
        const settlement = settlements[index], assetSources = action.quellen.filter(q => actionAssetKey(q));
        const taxable = /** @param {ActionSource} q */
        q => Math.max(0, Number(q.taxableAfterTqfSigned) || 0);
        const total = assetSources.reduce((sum, q) => sum + taxable(q), 0);
        const previousTax = Number(action.steuer) || 0;
        for (const q of assetSources) {
            q.steuer = total > 0 ? settlement.taxDue * taxable(q) / total : 0;
            q.netto = q.brutto - q.steuer;
        }
        let refund = previousTax - settlement.taxDue;
        if (refund >= 0) {
            for (const q of action.quellen.filter(q => q.kind === 'liquiditaet')) {
                const reduction = Math.min(q.brutto, refund);
                q.brutto -= reduction; q.netto = q.brutto; refund -= reduction;
            }
            if (refund > 0) action.verwendungen.liquiditaet = (action.verwendungen.liquiditaet || 0) + refund;
        } else {
            let remaining = -refund;
            for (const key of ['liquiditaet', 'bonds', 'aktien', 'gold', 'geldmarkt']) {
                const reduction = Math.min(action.verwendungen[key] || 0, remaining);
                if (reduction > 0) action.verwendungen[key] -= reduction;
                remaining -= reduction;
            }
            if (remaining > 1e-7) throw Object.assign(new Error('Verrechneter Auftrag kann die Verkaufssteuer nicht decken.'), { code: 'NET_ACTION_TAX_SHORTFALL' });
        }
        action.quellen = action.quellen.filter(q => q.brutto > 1e-8);
        action.steuer = settlement.taxDue;
        action.taxSettlement = settlement.details;
        action.nettoErlös = action.quellen.reduce((sum, q) => sum + (q.netto ?? q.brutto), 0);
        return { ...entry, action, taxStateNext: settlement.taxStateNext, cashSplit: null };
    });
}

/** Kompatibler Einstieg: Ein ungedeckter Restauftrag darf nicht gebucht werden. */
/** @param {ActionEntry[]} entries */
export function netActionEntriesOrOriginal(entries, jointAssessment = false) {
    return netActionEntries(entries, jointAssessment);
}
