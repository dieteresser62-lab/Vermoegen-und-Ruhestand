// NK-3 Nachträge 2 und 3 (Gutachten Codex und Fable zu NK-3): Einmalausgaben bei Unverheirateten. Grundbedarf samt verbrauchter Einkünfte
// geht vor (FR-84 Punkte 13 und 14), das Geld einer Person im Heim zahlt nur ihren eigenen Anteil (Punkt 21, auch wenn beide im Heim sind),
// der Partner zahlt aus seinem Geld nach Steuer und Schuld. Jeder Fall prüft die Geldbilanz je Person (helpers/nk-3-geldbilanz.mjs).
// Erfundene Beträge; Testjahr ohne Renditen, Inflation und Zinsen (YEAR in helpers/nk-1b-cases.mjs). Ausgangswerte in Klammern: Stand
// 8fdea73b (NK-3 Runde 1); „Basis“ ist f3507299.
import { couple, lot, YEAR, A, B } from './helpers/nk-1b-cases.mjs';
import { recordYears, checkMoneyBalance } from './helpers/nk-3-geldbilanz.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { floorReliefText } from '../app/simulator/protocol-renderer.js';
import { EngineAPI } from '../engine/index.mjs';

const close = (actual, expected, label, tolerance = 1) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const money = (portfolio, id) => (portfolio.personAccounts.find(row => row.profileId === id)?.tagesgeld || 0)
    + (portfolio.depotTranchesGeldmarkt || []).filter(row => row.sourceProfileId === id).reduce((sum, row) => sum + row.marketValue, 0);
const heim = costs => ({ active: true, grade: 4, heimJahr: 1, heimKosten: costs, heimEigeneAusgaben: 0, zusatzFloorZiel: 0, zusatzFloorDelta: 0 });
/** Ein Jahr. Grundbedarf zu Hause ganz bei der Person zu Hause (Hinterbliebenenanteil 100 %).
 * @param {{status?: string, mode?: string, cash?: number[], lots?: any[], pensionA?: number, pensionB?: number, floor?: number, flex?: number,
 *   expense: number, heimA?: number, heimB?: number, debtB?: number}} o */
function year(o) {
    const inputs = couple({ status: o.status || 'unmarried', mode: o.mode || `one_carries:${A}`, cash: o.cash || [0, 0], lots: o.lots || [],
        floor: o.floor ?? 12000, flex: o.flex || 0, pensionA: o.pensionA || 0 });
    if (o.pensionB) Object.assign(inputs.partner, { monatsrente: o.pensionB / 12, brutto: o.pensionB });
    Object.assign(inputs, { survivorFloorPercent: 100, plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'ausgabe', monat: '2026-06', betrag: o.expense, bezeichnung: 'Ausgabe' }] });
    const care = { ...(o.heimA ? { p1: heim(o.heimA) } : {}), ...(o.heimB ? { p2: heim(o.heimB) } : {}) };
    const household = Object.keys(care).length ? { p1Alive: true, p2Alive: true, care } : null;
    const state = initMcRunState(inputs);
    if (o.debtB) state.portfolio.personAccounts.find(row => row.profileId === B).openTax = o.debtB;
    const recorder = recordYears();
    try {
        const result = simulateOneYear(state, inputs, YEAR, 0, null, 0, household, 1, EngineAPI);
        const portfolio = (result.newState || result).portfolio;
        return { result, log: result.logData || {}, a: money(portfolio, A), b: money(portfolio, B), years: recorder.years };
    } finally { recorder.stop(); }
}

// HL-4: Bei getrennten Kassen muss der zu große Posten vor der Finanzierung ausscheiden.
{
    const settings = { cash: [3e17, 2 ** 57], heimB: 40000 };
    const baseline = year({ ...settings, expense: 0 });
    const rejected = year({ ...settings, expense: settings.cash[0] - 12000 });
    assertEqual(rejected.result.kind, 'success', 'Unrechenbare Einmalausgabe beendet das Jahr nicht');
    assertEqual(rejected.log.geplante_ausgaben_abgelehnt?.[0]?.label, 'Ausgabe', 'Diagnose nennt den abgelehnten Posten');
    assert(floorReliefText(rejected.log, String).includes('wegen zu hohem Betrag abgelehnt (Ausgabe)'),
        'Der Protokollhinweis nennt Grund und Posten');
    assertEqual(rejected.a, baseline.a, 'Die Ablehnung belastet das Tagesgeld von A nicht');
    assertEqual(rejected.b, baseline.b, 'Die Ablehnung belastet das Tagesgeld von B nicht');
}
const outcome = ({ result, log }) => `${result.kind} · ${log.geplante_ausgaben} · ${log.geplante_ausgaben_gekuerzt ?? 0} · ${log.hilfe_zur_pflege ?? 0}`;

// Codex P1 (vorbestehend): A 300.000 €, B 10.000 € und 30.000 € Rente, B im Heim 40.000 €, Grundbedarf 12.000 €, Ausgabe 300.000 €. Für die
// Ausgabe bleiben 340.000 − 52.000 = 288.000 €: Sie entfällt ganz, A 288.000 €, B 0 €, kein Ruin, keine Hilfe. (Vorher in allen drei
// Zahlungsmodi Ruin „Entnahme (10000) < Floor (22000)“.)
for (const mode of [`one_carries:${A}`, 'proportional', 'tax_optimized']) {
    const run = year({ mode, cash: [300000, 10000], pensionB: 30000, heimB: 40000, expense: 300000 });
    assertEqual(outcome(run), 'success · 0 · 300000 · 0', `Codex P1 (${mode}): Ausgabe entfällt ganz, kein Ruin, keine Hilfe`);
    close(run.a, 288000, `Codex P1 (${mode}): A 288.000 €`);
    close(run.b, 0, `Codex P1 (${mode}): B 0 €`);
    checkMoneyBalance(run.years, [A, B], `Codex P1 (${mode})`);
}
// Fable 3 (derselbe Fehler ohne Heim): A 100.000 € und 10.000 € Rente, Grundbedarf 30.000 €, Ausgabe 85.000 €. Nach dem Grundbedarf
// bleiben 80.000 €: Die Ausgabe entfällt ganz, kein Ruin. (Vorher Ruin „Entnahme (15000) < Floor (20000)“; verheiratet schon richtig.)
for (const status of ['unmarried', 'married']) for (const mode of [`one_carries:${A}`, 'proportional']) {
    const run = year({ status, mode, cash: [100000, 0], pensionA: 10000, floor: 30000, expense: 85000 });
    assertEqual(outcome(run), 'success · 0 · 85000 · 0', `Fable 3 (${status}, ${mode}): Ausgabe entfällt ganz, kein Ruin`);
    close(run.a, 80000, `Fable 3 (${status}, ${mode}): A behält 80.000 €`);
    checkMoneyBalance(run.years, [A, B], `Fable 3 (${status}, ${mode})`);
}

// Codex P2: beide im Heim (je 40.000 €), A trägt, A/B 300.000/400.000 €. Die Ausgabe von 500.000 € kann A nach dem eigenen Heim nicht zahlen
// (260.000 €), Bs Geld zählt nicht: Sie entfällt ganz, A/B 260.000/360.000 €. (Vorher zahlte A 260.000 € und B 240.000 €.) 200.000 € zahlt
// A allein.
{
    const dropped = year({ cash: [300000, 400000], heimA: 40000, heimB: 40000, expense: 500000 });
    assertEqual(outcome(dropped), 'success · 0 · 500000 · 0', 'Codex P2: beide im Heim, Ausgabe entfällt ganz');
    close(dropped.a, 260000, 'Codex P2: A 260.000 €');
    close(dropped.b, 360000, 'Codex P2: B 360.000 €');
    checkMoneyBalance(dropped.years, [A, B], 'Codex P2 500.000 €');
    const paid = year({ cash: [300000, 400000], heimA: 40000, heimB: 40000, expense: 200000 });
    assertEqual(outcome(paid), 'success · 200000 · 0 · 0', 'Codex P2: 200.000 € zahlt A');
    close(paid.a, 60000, 'Codex P2: A 60.000 €');
    close(paid.b, 360000, 'Codex P2: B unverändert 360.000 €');
    checkMoneyBalance(paid.years, [A, B], 'Codex P2 200.000 €');
}

// Fable A: A 300.000 €, B im Heim 400.000 €, Flex 20.000 €, Ausgabe 280.000 € (zwischen 268.001 und 288.000 €). Wie ohne Heim gilt Grundbedarf,
// Pflege, Ausgabe, Flex: A zahlt die Ausgabe, der Flex wird gekürzt; B zahlt nur ihr Heim. (Vorher entfiel die Ausgabe, A zahlte den Flex.)
{
    const withHome = year({ cash: [300000, 400000], heimB: 40000, flex: 20000, expense: 280000 });
    const without = year({ cash: [300000, 0], flex: 20000, expense: 280000 });
    assertEqual(`${outcome(withHome)} | ${outcome(without)}`, 'success · 280000 · 0 · 0 | success · 280000 · 0 · 0', 'Fable A: Ausgabe bezahlt, mit und ohne Heim');
    close(withHome.log.entnahme_effektiv, 60000, 'Fable A: Entnahme 12.000 € Grundbedarf + 40.000 € Heim + 8.000 € Flex');
    close(withHome.a, 0, 'Fable A: A hat nach Grundbedarf, Ausgabe und Flex nichts mehr');
    close(withHome.b + withHome.result.newState.portfolio.depotTranchesAktien.filter(row => row.sourceProfileId === B)
        .reduce((sum, row) => sum + row.marketValue, 0), 360000, 'Fable A: B behält nach dem Heim 360.000 € (Tagesgeld und angelegt)');
    checkMoneyBalance(withHome.years, [A, B], 'Fable A');
}

// Fable B: A 300.000 € Aktien (Einstand 100.000 €), B im Heim 400.000 €. Nach Steuer hat A nach dem Grundbedarf nur 235.514 €; die Ausgabe von
// 255.000 € entfällt, B zahlt keine Steuer für A. (Vorher bezahlt, 19.486 € Steuer aus Bs Geld.) 230.000 € zahlt A samt Steuer selbst.
{
    const dropped = year({ cash: [0, 400000], lots: [lot(A, 300000, 100000, 'equity')], heimB: 40000, expense: 255000 });
    assertEqual(outcome(dropped), 'success · 0 · 255000 · 0', 'Fable B: Ausgabe entfällt nach Steuer');
    close(dropped.a, 235514, 'Fable B: A behält 235.514 €');
    close(dropped.b, 360000, 'Fable B: B zahlt nur ihr Heim');
    checkMoneyBalance(dropped.years, [A, B], 'Fable B 255.000 €');
    const paid = year({ cash: [0, 400000], lots: [lot(A, 300000, 100000, 'equity')], heimB: 40000, expense: 230000 });
    assertEqual(outcome(paid), 'success · 230000 · 0 · 0', 'Fable B: 230.000 € zahlt A');
    close(paid.b, 360000, 'Fable B: B zahlt auch hier keine Steuer für A');
    checkMoneyBalance(paid.years, [A, B], 'Fable B 230.000 €');
}

// Fable D: Eine Altschuld der Person im Heim (50.000 €) zahlt sie selbst; sie mindert nicht das Budget von A. A zahlt 280.000 €.
// (Vorher entfiel die Ausgabe.)
{
    const run = year({ cash: [300000, 400000], heimB: 40000, expense: 280000, debtB: 50000 });
    assertEqual(outcome(run), 'success · 280000 · 0 · 0', 'Fable D: Altschuld der Person im Heim mindert nicht das Budget von A');
    checkMoneyBalance(run.years, [A, B], 'Fable D');
}
