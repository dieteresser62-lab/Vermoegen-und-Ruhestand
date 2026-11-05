/** Reine, lesende UI-Projektion der tatsächlich dargestellten Handlungsströme. */
/** @param {import('../../typcheck/balance-ui.js').Action} [action] @returns {boolean} */
export function hasMeaningfulFlow(action = {}) {
    if (!action || typeof action !== 'object') return false;
    return (Array.isArray(action.quellen) ? action.quellen : []).some(q => q?.brutto > 0)
        || ['liquiditaet', 'gold', 'aktien', 'geldmarkt', 'bonds'].some(key => action.verwendungen?.[key] > 0)
        || action.steuer > 0 || action.nettoErlös > 0;
}

/** @template {import('../../typcheck/balance-ui.js').ActionEntry[]} T @param {T} entries @returns {T|null} */
export function materialProfileActions(entries) {
    return Array.isArray(entries) && entries.some(entry => hasMeaningfulFlow(entry?.action)) ? entries : null;
}

/** @param {import('../../typcheck/balance-ui.js').Action} action @param {import('../../typcheck/balance-ui.js').Action} uiAction @param {import('../../typcheck/balance-ui.js').ActionEntry[]} [profileEntries] @returns {import('../../typcheck/balance-ui.js').Summary} */
export function summarizeBalanceAction(action, uiAction, profileEntries = null) {
    const profiles = materialProfileActions(profileEntries);
    // Der Detailrenderer ersetzt die Gesamtaktion durch materielle Profilaktionen.
    // Der in uiAction integrierte Gesamttransfer darf dann nicht zusätzlich zählen.
    const actions = profiles ? profiles.map(entry => entry?.action || {}) : [uiAction];
    const sources = actions.flatMap(item => Array.isArray(item.quellen) ? item.quellen : []);
    const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
    const cash = q => ['liquiditaet', 'geldmarkt'].includes(q.kind) || q.source === 'Liquidität';
    const external = sources.filter(q => !cash(q) && positive(q.brutto) > 0);
    const uses = key => actions.reduce((sum, item) => {
        const transfer = item.internalCashRebalance;
        const internal = key === 'liquiditaet' && transfer?.to === 'Tagesgeld' ? transfer.netto
            : key === 'geldmarkt' && transfer?.to === 'Geldmarkt-ETF' ? transfer.amount : 0;
        return sum + positive((item.verwendungen?.[key] || 0) - internal);
    }, 0);
    const externalPurchase = uses('gold') + uses('aktien') + uses('bonds');
    // Transfers pro dargestellter Aktion zählen: Cash verschiedener Profile
    // darf nicht nachträglich zu einer erfundenen Umschichtung gepaart werden.
    const transfer = actions.reduce((sum, item) => {
        if (item.internalCashRebalance) return sum + item.internalCashRebalance.amount;
        const list = Array.isArray(item.quellen) ? item.quellen : [];
        const fromCash = list.filter(q => q.kind === 'liquiditaet' || q.source === 'Liquidität').reduce((total, q) => total + positive(q.brutto), 0);
        const fromMoneyMarket = list.filter(q => q.kind === 'geldmarkt').reduce((total, q) => total + positive(q.brutto), 0);
        return sum + Math.min(fromCash, positive(item.verwendungen?.geldmarkt))
            + Math.min(fromMoneyMarket, positive(item.verwendungen?.liquiditaet));
    }, 0);
    const net = list => list.every(q => Number.isFinite(q.netto))
        ? list.reduce((sum, q) => sum + q.netto, 0) : null;
    const equitySale = external.some(q => ['aktien_alt', 'aktien_neu'].includes(q.kind));
    const goldSales = external.filter(q => q.kind === 'gold');
    const transferDetails = (profiles || []).filter(entry => entry.action?.internalCashRebalance).map(entry => ({
        name: entry.name || entry.profileId || 'Profil', ...entry.action.internalCashRebalance }));
    const opposingTransfers = new Set(transferDetails.map(row => row.from)).size > 1;
    let verb, amount = null;
    if (equitySale) { verb = 'Aktien verkaufen'; amount = net(external); }
    else if (goldSales.length) { verb = 'Gold verkaufen'; amount = net(goldSales); }
    else if (uses('gold') > 0) { verb = 'Gold kaufen'; amount = uses('gold'); }
    else if (uses('aktien') > 0) { verb = 'Aktien kaufen'; amount = uses('aktien'); }
    else if (!external.length && !externalPurchase && transfer > 0) { verb = 'Umschichten'; amount = transfer; }
    else if (actions.some(item => hasMeaningfulFlow(item))) { verb = 'Handlung prüfen'; }
    else { verb = 'Nichts tun'; }

    const purposes = [];
    if (uses('liquiditaet') > 0) purposes.push('Liquidität auffüllen');
    if (uses('gold') > 0 || goldSales.length) purposes.push('Goldbestand anpassen');
    if (uses('aktien') > 0) purposes.push('Aktienbestand anpassen');
    if (uses('bonds') > 0) purposes.push('Anleihenbestand anpassen');
    const purpose = purposes.join(' und ');
    const infinitives = purposes.map(text => ({ 'Liquidität auffüllen': 'die Liquidität aufzufüllen', 'Goldbestand anpassen': 'den Goldbestand anzupassen', 'Aktienbestand anpassen': 'den Aktienbestand anzupassen', 'Anleihenbestand anpassen': 'den Anleihenbestand anzupassen' })[text]);
    let note = purposes.length ? `Um ${infinitives.join(' und ')}.` : 'Bitte den vorhandenen Plan in den Details prüfen.';
    if (verb === 'Umschichten') note = 'Du schichtest zwischen Tagesgeld und Geldmarkt um.';
    if (verb === 'Nichts tun') {
        const reasons = (profiles ? actions : [action]).map(item => item.transactionDiagnostics?.blockReason);
        note = reasons.includes('liquidity_sufficient') ? 'Die vorhandene Liquidität reicht aus.'
            : reasons.includes('min_trade') ? 'Der mögliche Handel liegt unter der Mindestgröße.'
                : 'Keine Transaktion empfohlen.';
    }
    const material = profiles?.filter(entry => hasMeaningfulFlow(entry?.action));
    if (material?.length > 0 && verb !== 'Nichts tun') {
        const names = material.map(entry => entry.name || entry.action?.quellen?.find(source => source.sourceProfileName)?.sourceProfileName || 'unbenannter Person');
        const people = names.length > 1 ? `${names.slice(0, -1).join(', ')} und ${names.at(-1)}` : names[0];
        note = note.replace(/\.$/, '') + ` · von ${people}.`;
    }
    return { verb, amount: opposingTransfers && verb === 'Umschichten' ? null : amount, note, purpose,
        ...(opposingTransfers ? { transferDetails } : {}),
        goldPurchaseAmount: uses('gold'), amountUnit: ['Aktien verkaufen', 'Gold verkaufen'].includes(verb) ? '€ netto' : '€', extraTransfer: opposingTransfers || verb === 'Umschichten' ? 0 : transfer };
}

/** Derselbe Kurzplan für Diagnoseanzeige und Copy; keinerlei Handelsableitung. */
/** @param {import('../../typcheck/balance-ui.js').Summary} summary @param {(amount: number)=>string} formatCurrency @returns {string} */
export function describeBalanceActionSummary(summary, formatCurrency) {
    if (!summary) return 'Keine geplante Aktion';
    const parts = [summary.verb];
    if (Number.isFinite(summary.amount)) {
        parts.push(formatCurrency(summary.amount) + (summary.amountUnit === '€ netto' ? ' netto' : ''));
    }
    if (summary.extraTransfer > 0) parts.push(`plus interne Umschichtung von ${formatCurrency(summary.extraTransfer)}`);
    for (const row of summary.transferDetails || []) parts.push(`${row.name}: ${row.from} → ${row.to} ${formatCurrency(row.amount)}`);
    return parts.join(' · ');
}

/** FR-63: Aufträge nur innerhalb derselben Person und Anlageklasse saldieren. */
export { threeBucketActionTrades } from '../../engine/transactions/net-action.mjs';

/** @param {ReturnType<typeof import("../../engine/transactions/net-action.mjs").threeBucketActionTrades>} trades @param {Partial<import('../../typcheck/balance-ui.js').Summary>} [base] @returns {import('../../typcheck/balance-ui.js').Summary} */
export function summarizeThreeBucketAction(trades, base = {}) {
    const transfer = base.verb === 'Umschichten' ? base.amount : base.extraTransfer;
    if (!trades.length && transfer > 0) return { ...base, verb: 'Umschichten', amount: transfer, extraTransfer: 0, purpose: '', note: 'Du schichtest zwischen Tagesgeld und Geldmarkt um.' };
    const first = trades[0];
    const verb = trades.length === 1 ? `${first.label} ${first.net > 0 ? 'verkaufen' : 'kaufen'}`
        : trades.length ? 'Handel ausführen' : 'Nichts tun';
    return { verb, amount: trades.length === 1 ? Math.abs(first.net) : null, amountUnit: '€',
        purpose: trades.length ? 'Saldo je Anlageklasse' : '', note: trades.length
            ? 'Verkauf und Kauf sind je Person und Anlageklasse verrechnet.' : 'Kein Handel nach Verrechnung von Verkauf und Kauf.',
        extraTransfer: transfer || 0, goldPurchaseAmount: trades.filter(row => row.key === 'gold' && row.net < 0).reduce((sum, row) => sum - row.net, 0) };
}
