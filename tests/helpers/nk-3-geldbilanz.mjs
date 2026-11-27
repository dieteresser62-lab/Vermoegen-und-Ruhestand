// NK-3 (FR-84 Punkt 15): Geldbilanz je Person und Jahr aus dem Jahreskontext des Simulators (nur Tests, erfundene Beträge).
// Bilanziert wird die Liquidität L einer Person (Tagesgeld und Geldmarkt) am Anfang und am Ende des Jahresversuchs. Formel je Person p (±1 €):
//   L_Ende − L_Anfang = Einkünfte_p + Zins_p + Zufluss_p + Immobilienerlös_p + Geldmarktertrag_p
//                       + (Depot nach Markt − Depot am Ende)_p          Verkaufserlöse brutto minus Käufe (Aktien, Anleihen, Gold)
//                       − Steuer_p − Altschuld_p − Auszahlung_p − Einmalausgabe_p − Partnerhilfe_p
// Felder des Laufzustands: Einkünfte sind, was dem Konto gutgeschrieben wird: unverheiratet Rente (`rente1`/`rente2` nach
// Personenreihenfolge) und `incomeLog.sonstige_einkuenfte_personen` (verbrauchte und gesparte Einkünfte); in der gemeinsamen Kasse nur
// der gesparte Überschuss `incomeLog.einkuenfte_gespart_personen` (verbrauchte Einkünfte senken dort die Entnahme und berühren kein Konto).
// Zins = Tagesgeldzins des Jahres; KR-1c (NG-5): Er wird vor der Entscheidung im Marktschritt gebucht, also Tagesgeld nach dem
// Marktschritt mal rC/(1 + rC). Zufluss `inflowLog.zufluss_personen`; Immobilienerlös `homeSaleLog.immobilienverkauf_personen`;
// Geldmarktertrag = Geldmarkt nach dem Marktschritt minus am Anfang (enthält den Geldmarktzins des Jahres); Steuer `taxDue` aus
// `actionResult.personalAnnualTaxes`, bezahlte Altschuld `oldDebt − oldDebtRest` aus derselben Zeile; Auszahlung `personalPayout.items` (Grundbedarfsanteil, eigene Pflege und eigenes Heim, Flex);
// Einmalausgabe `floorRelief.expensePaidPersons` (nur bezahlte Posten, auch in der gemeinsamen Kasse); Partnerhilfe `floorRelief.partnerFloor`
// beim Zahler („Partner deckt Grundbedarf“: Das Geld geht für den Grundbedarf der anderen Person hinaus, nicht auf ihr Konto).
// Wertänderungen des Depots zählen nicht.
// Haushalt: Σ Auszahlung + Σ Partnerhilfe ≤ Bedarf des Jahres = Zielentnahme + verbrauchte Einkünfte − Hilfe zur Pflege (ohne Steueranteil);
// eine abgeschnittene Entnahme oder ein gekürzter Flex bleiben darunter. Σ Einmalausgabe = bezahlte geplante Ausgaben. Geld, das ohne
// Bedarf abgebucht wird (etwa eine entfallene Ausgabe), verletzt die Haushaltszeile.
// Geltungsbereich: Jedes Jahr hat für jede Person in jeder Phase ein Konto. Jeder begonnene Jahresversuch endet aufgezeichnet oder wird im
// selben Jahr wiederholt (Immobilienverkauf vor Ruin oder vor Hilfe zur Pflege); sonst muss er als erwartetes Ruinjahr angegeben sein.
// Nicht im Geltungsbereich und deshalb ein Fehlschlag: Tod und Erbe, Rückfallverkauf (nur als Summe vermerkt), Steuer für eine andere
// Person, offen bleibende Steuer oder Altschuld, Wohnrechtsteuer, Pflegerücklage. Ausnahme (KR-1c): In einem ausdrücklich genannten Jahr
// darf neue Steuer offen bleiben; dann zählt nur der bezahlte Teil `taxDue − taxShortfall`.
import { observeYearContextForTests } from '../../app/simulator/simulator-engine-direct.js';

const owner = (portfolio, lot) => lot.sourceProfileId || portfolio.simulationSourceProfileId;
const lots = (portfolio, key, id) => (portfolio[key] || []).filter(lot => owner(portfolio, lot) === id)
    .reduce((sum, lot) => sum + (Number(lot.marketValue) || 0), 0);
const snapshot = portfolio => Object.fromEntries((portfolio.personAccounts || []).map(account => [account.profileId, {
    liquidity: (account.tagesgeld || 0) + lots(portfolio, 'depotTranchesGeldmarkt', account.profileId),
    moneyMarket: lots(portfolio, 'depotTranchesGeldmarkt', account.profileId),
    depot: lots(portfolio, 'depotTranchesAktien', account.profileId) + lots(portfolio, 'depotTranchesGold', account.profileId),
    reserve: lots(portfolio, 'healthBucketTranches', account.profileId) }]));
const byPerson = (rows, id, key = 'profileId') => (rows || []).filter(row => row[key] === id).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
const PHASES = ['begin', 'market', 'payout', 'end'];

/** Zeichnet jeden Jahresversuch auf (Anfang, nach dem Markt, nach der Auszahlung, Ende). Ein Versuch ohne Ende (vorzeitiger Abbruch,
 * etwa Ruin vor einer Wiederholung) steht mit `aborted: true` in der Liste. `stop()` beendet die Aufzeichnung. */
export function recordYears() {
    const years = [];
    let current = null;
    const close = () => { if (current) years.push({ ...current, aborted: true }); current = null; };
    observeYearContextForTests((phase, context) => {
        if (phase === 'begin') { close(); current = { yearIndex: context.yearIndex, begin: snapshot(context.currentState.portfolio) }; }
        else if (current) {
            current[phase] = snapshot(context.portfolio);
            if (phase === 'end') { current.context = context; years.push(current); current = null; }
        }
    });
    return { years, stop: () => { close(); observeYearContextForTests(null); } };
}

/** Geldbilanz eines vollständigen Jahresversuchs: je Person Rest der Formel (soll 0 sein) und die Haushaltszeilen.
 * @param {any} year Eintrag aus `recordYears().years` @param {string[]} ids Personen in der Reihenfolge der Eingaben
 * @param {{openTax?: boolean}} [options] `openTax`: offene neue Steuer ist in diesem Jahr erwartet (nur der bezahlte Teil fließt ab). */
export function moneyBalance(year, ids, { openTax = false } = {}) {
    const c = year.context;
    const unknown = [];
    for (const phase of PHASES) for (const id of ids) if (!year[phase]?.[id]) unknown.push(`Konto ${id} fehlt (${phase})`);
    if (c.personalPayout?.fallback) unknown.push('Rückfallverkauf');
    if (c.inheritanceLog || c.survivorYear) unknown.push('Tod und Erbe');
    for (const row of c.actionResult?.personalAnnualTaxes || []) {
        if (row.householdTaxFunding?.length) unknown.push('Steuer für eine andere Person');
        if ((row.taxShortfall > 0 && !openTax) || row.oldDebtRest > 0 || row.residenceTaxRest > 0) unknown.push('offene Steuer');
    }
    const married = !c.unmarried;
    const persons = ids.filter(id => PHASES.every(phase => year[phase]?.[id])).map(id => {
        const index = ids.indexOf(id), b = year.begin[id], m = year.market[id], p = year.payout[id], e = year.end[id];
        if (b.reserve > 0.005 || e.reserve > 0.005) unknown.push('Pflegerücklage');
        const flows = {
            einkuenfte: married ? byPerson(c.incomeLog?.einkuenfte_gespart_personen, id)
                : (Number([c.rente1, c.rente2][index]) || 0) + byPerson(c.incomeLog?.sonstige_einkuenfte_personen, id),
            zins: (m.liquidity - m.moneyMarket) * (Number(c.rC) || 0) / (1 + (Number(c.rC) || 0)),
            zufluss: byPerson(c.inflowLog?.zufluss_personen, id),
            immobilie: byPerson(c.homeSaleLog?.immobilienverkauf_personen, id),
            geldmarktertrag: m.moneyMarket - b.moneyMarket,
            verkaufMinusKauf: m.depot - e.depot,
            steuer: -((c.actionResult?.personalAnnualTaxes?.find(row => row.profileId === id)?.taxDue || 0)
                - (openTax ? Number(c.actionResult?.personalAnnualTaxes?.find(row => row.profileId === id)?.taxShortfall) || 0 : 0)),
            altschuld: -Math.max(0, (Number(c.actionResult?.personalAnnualTaxes?.find(row => row.profileId === id)?.oldDebt) || 0)
                - (Number(c.actionResult?.personalAnnualTaxes?.find(row => row.profileId === id)?.oldDebtRest) || 0)),
            auszahlung: -byPerson(c.personalPayout?.items, id),
            einmalausgabe: -byPerson(c.floorRelief?.expensePaidPersons, id),
            partnerhilfe: -byPerson(c.floorRelief?.partnerFloor, id, 'fromProfileId')
        };
        const sum = Object.values(flows).reduce((total, value) => total + value, 0);
        return { profileId: id, start: b.liquidity, end: e.liquidity, flows, rest: e.liquidity - b.liquidity - sum };
    });
    const paidOut = persons.reduce((sum, row) => sum - row.flows.auszahlung - row.flows.partnerhilfe, 0);
    const expensePaid = persons.reduce((sum, row) => sum - row.flows.einmalausgabe, 0);
    const need = (Number(c.jahresEntnahmeTarget) || 0) + (Number(c.incomeConsumed) || 0)
        - Math.max(0, (Number(c.floorRelief?.careAid) || 0) - (Number(c.floorRelief?.taxAid) || 0));
    return { yearIndex: year.yearIndex, unknown: [...new Set(unknown)], persons, overNeed: paidOut - need,
        expenseRest: expensePaid - (Number(c.expenseLog?.geplante_ausgaben) || 0),
        dropped: c.floorRelief?.plannedExpenseCut || 0,
        droppedItems: (c.floorRelief?.droppedExpenses || []).reduce((sum, row) => sum + row.amount, 0) };
}

/** Kurzform für Meldungen. @param {ReturnType<typeof moneyBalance>} balance */
export const balanceText = balance => `Jahr ${balance.yearIndex + 1}: ${balance.persons.map(row => `${row.profileId} Rest ${row.rest.toFixed(2)}`).join(', ')}`
    + `, Auszahlung über Bedarf ${Math.max(0, balance.overNeed).toFixed(2)}, Ausgaben ${balance.expenseRest.toFixed(2)}`
    + `${balance.unknown.length ? `, unbekannt: ${balance.unknown.join(', ')}` : ''}`;

/** Prüft alle aufgezeichneten Jahresversuche. Ein abgebrochener Versuch ist nur erlaubt, wenn dasselbe Jahr danach wiederholt wird oder
 * es das angegebene Ruinjahr ist. @param {any[]} years @param {string[]} ids @param {string} label
 * @param {{ruinYearIndex?: number, openTaxYearIndex?: number}} [options] */
export function checkMoneyBalance(years, ids, label, { ruinYearIndex = -1, openTaxYearIndex = -1 } = {}) {
    assert(years.length > 0, `${label}: Jahre aufgezeichnet`);
    for (const [position, year] of years.entries()) {
        if (year.aborted) {
            const repeated = years.slice(position + 1).some(next => next.yearIndex === year.yearIndex);
            assert(repeated || year.yearIndex === ruinYearIndex, `${label}: Jahr ${year.yearIndex + 1} abgebrochen ohne Wiederholung und ohne erwartetes Ruinjahr`);
            continue;
        }
        const balance = moneyBalance(year, ids, { openTax: year.yearIndex === openTaxYearIndex });
        assert(balance.unknown.length === 0 && balance.persons.length === ids.length && balance.persons.every(row => Math.abs(row.rest) <= 1)
            && balance.overNeed <= 1 && Math.abs(balance.expenseRest) <= 1, `${label}: Geldbilanz ${balanceText(balance)}`);
        // Ganz oder gar nicht: gekürzt ist genau die Summe der entfallenen Posten, kein Teilbetrag.
        assert(Math.abs(balance.dropped - balance.droppedItems) <= 1, `${label}: Jahr ${balance.yearIndex + 1} ohne Teilkürzung (${balance.dropped} / ${balance.droppedItems})`);
    }
    if (ruinYearIndex >= 0) assert(years.some(year => year.aborted && year.yearIndex === ruinYearIndex), `${label}: erwartetes Ruinjahr ${ruinYearIndex + 1} aufgezeichnet`);
}
