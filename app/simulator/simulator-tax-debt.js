// @ts-check
/** NK-2 (FR-84 Punkt 17): Schuldenbuch. Offene Steuer ohne Pflegebezug bleibt als Schuld bei der Person (`openTax`, nominal) und wird
 * im Folgejahr nach Grundbedarf und Pflege und vor dem Flex bezahlt; die persönliche Steuerabrechnung zahlt sie wie Steuer des Jahres. */

/** Offene Steuer je Person im Zustand (`openTax`, nominal), dazu die in diesem Jahr zu Beginn nicht bezahlte
 * Wohnrechtsteuer (`residenceTaxOpen`). Beides wird nach dem Grundbedarf und vor dem Flex bezahlt.
 * @param {{personAccounts?: any[]}} portfolio @param {string|null} [profileId] Nur diese Person.
 * @returns {number} */
export function openTaxDebt(portfolio, profileId = null) {
    let total = 0;
    for (const account of /** @type {any[]} */ (portfolio?.personAccounts || [])) {
        if (profileId !== null && account.profileId !== profileId) continue;
        if (account.openTax > 0) total += account.openTax;
        if (account.residenceTaxOpen > 0) total += account.residenceTaxOpen;
    }
    return total;
}

/** NK-2: Altschuld und Wohnrechtsteuer des Jahres als Forderung ins Steuerbuch übernehmen. Die Abrechnung zahlt sie wie Steuer dieses
 * Jahres; danach trennt `settlePersonalTaxYear` Altschuld, Wohnrechtsteuer und neue Steuer (Gutachten NK1C2 Befunde 1 und 3).
 * @param {any[]} book @returns {{old: number, residence: number}} Summen der übernommenen Forderungen. */
export function loadTaxClaims(book) {
    let old = 0, residence = 0;
    for (const row of book || []) {
        const debt = Math.max(0, Number(row.account.openTax) || 0), open = Math.max(0, Number(row.account.residenceTaxOpen) || 0);
        delete row.account.openTax;
        delete row.account.residenceTaxOpen;
        if (!(debt + open > 0)) continue;
        row.openDebt = debt;
        row.residenceDebt = open;
        row.reserved -= debt + open;
        old += debt;
        residence += open;
    }
    return { old, residence };
}

/** NK-2: Offene Steuer je Person aus der Abrechnung als Schuld vormerken (ohne Hilfe zur Pflege, etwa in der Ansparphase).
 * @param {{personAccounts?: any[]}} portfolio @param {{profileId: string, taxShortfall?: number}[]} rows */
export function carryTaxShortfall(portfolio, rows) {
    for (const row of rows || []) {
        const account = (portfolio?.personAccounts || []).find(item => item.profileId === row.profileId);
        if (account && (row.taxShortfall || 0) > 1e-8) account.openTax = (account.openTax || 0) + /** @type {number} */ (row.taxShortfall);
    }
}

/** NK-2: Schuld und Nettovermögen im Jahresprotokoll; ohne Schuld unverändert. @param {any} log @param {{personAccounts?: any[]}} portfolio
 * @param {number} oldTaxDue Im Jahr fällige Vorjahresschuld. */
export function logTaxDebt(log, portfolio, oldTaxDue) {
    const debt = (portfolio?.personAccounts || []).reduce((sum, row) => sum + (row.openTax > 0 ? row.openTax : 0), 0);
    if (oldTaxDue > 0.005) log.steuer_schuld_vorjahr = oldTaxDue;
    if (debt > 0.005) Object.assign(log, { steuer_offen: debt, portfolio_total_brutto: log.portfolio_total_end, portfolio_total_end: Math.max(0, log.portfolio_total_end - debt) });
}

/** NK-2/NK-2b (Gutachten NK1C2 Befund 3, NK2C Befund 6): Am Jahresende bezahlte Wohnrechtsteuer einmal ins Protokoll und in den
 * Zahlungsnachweis übernehmen. @param {any} inflowLog @param {any[]|null} book @param {any[]} rows Ergebnis je Person der Abrechnung.
 * @returns {any} Protokoll (unverändert ohne Nachzahlung). */
export function withResidenceTaxPaid(inflowLog, book, rows) {
    const paid = (rows || []).reduce((sum, row) => sum + Math.max(0, ((book || []).find(item => item.profileId === row.profileId)?.residenceDebt || 0)
        - (row.residenceTaxRest || 0)), 0);
    if (!(paid > 0.005)) return inflowLog;
    const payment = inflowLog?.residenceTaxPayment;
    return { ...inflowLog, wohnrechtsteuer: (inflowLog?.wohnrechtsteuer || 0) + paid,
        ...(payment ? { residenceTaxPayment: { ...payment, paidCost: (payment.paidCost || 0) + paid, shortfall: Math.max(0, (payment.shortfall || 0) - paid) } } : {}) };
}
