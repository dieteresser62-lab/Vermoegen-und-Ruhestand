/** Reine, lesende UI-Projektion der tatsächlich dargestellten Handlungsströme. */
export function hasMeaningfulFlow(action = {}) {
    if (!action || typeof action !== 'object') return false;
    return (Array.isArray(action.quellen) ? action.quellen : []).some(q => q?.brutto > 0)
        || ['liquiditaet', 'gold', 'aktien', 'geldmarkt', 'bonds'].some(key => action.verwendungen?.[key] > 0)
        || action.steuer > 0 || action.nettoErlös > 0;
}

export function materialProfileActions(entries) {
    return Array.isArray(entries) && entries.some(entry => hasMeaningfulFlow(entry?.action)) ? entries : null;
}

export function summarizeBalanceAction(action, uiAction, profileEntries = null) {
    const profiles = materialProfileActions(profileEntries);
    // Der Detailrenderer ersetzt die Gesamtaktion durch materielle Profilaktionen.
    // Der in uiAction integrierte Gesamttransfer darf dann nicht zusätzlich zählen.
    const actions = profiles ? profiles.map(entry => entry?.action || {}) : [uiAction];
    const sources = actions.flatMap(item => Array.isArray(item.quellen) ? item.quellen : []);
    const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
    const cash = q => ['liquiditaet', 'geldmarkt'].includes(q.kind) || q.source === 'Liquidität';
    const external = sources.filter(q => !cash(q) && positive(q.brutto) > 0);
    const uses = key => actions.reduce((sum, item) => sum + positive(item.verwendungen?.[key]), 0);
    const externalPurchase = uses('gold') + uses('aktien') + uses('bonds');
    // Transfers pro dargestellter Aktion zählen: Cash verschiedener Profile
    // darf nicht nachträglich zu einer erfundenen Umschichtung gepaart werden.
    const transfer = actions.reduce((sum, item) => {
        const list = Array.isArray(item.quellen) ? item.quellen : [];
        const cashSources = list.filter(cash).reduce((total, q) => total + positive(q.brutto), 0);
        const externalFlow = list.some(q => !cash(q) && positive(q.brutto) > 0)
            || ['gold', 'aktien', 'bonds'].some(key => positive(item.verwendungen?.[key]) > 0);
        const cashUses = positive(item.verwendungen?.liquiditaet) + positive(item.verwendungen?.geldmarkt);
        return sum + (externalFlow ? Math.min(cashSources, cashUses) : cashSources);
    }, 0);
    const net = list => list.every(q => Number.isFinite(q.netto))
        ? list.reduce((sum, q) => sum + q.netto, 0) : null;
    const equitySale = external.some(q => ['aktien_alt', 'aktien_neu'].includes(q.kind));
    const goldSales = external.filter(q => q.kind === 'gold');
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
    const materialCount = profiles?.filter(entry => hasMeaningfulFlow(entry?.action)).length;
    if (materialCount > 0 && verb !== 'Nichts tun') note = note.replace(/\.$/, '') + ` · aus ${materialCount === 1 ? 'einem Profil' : materialCount === 2 ? 'beiden Profilen' : `${materialCount} Profilen`}.`;
    return { verb, amount, note, purpose, goldPurchaseAmount: uses('gold'), amountUnit: ['Aktien verkaufen', 'Gold verkaufen'].includes(verb) ? '€ netto' : '€', extraTransfer: verb === 'Umschichten' ? 0 : transfer };
}

/** Derselbe Kurzplan für Diagnoseanzeige und Copy; keinerlei Handelsableitung. */
export function describeBalanceActionSummary(summary, formatCurrency) {
    if (!summary) return 'Keine geplante Aktion';
    const parts = [summary.verb];
    if (Number.isFinite(summary.amount)) {
        parts.push(formatCurrency(summary.amount) + (summary.amountUnit === '€ netto' ? ' netto' : ''));
    }
    if (summary.extraTransfer > 0) parts.push(`plus interne Umschichtung von ${formatCurrency(summary.extraTransfer)}`);
    return parts.join(' · ');
}
