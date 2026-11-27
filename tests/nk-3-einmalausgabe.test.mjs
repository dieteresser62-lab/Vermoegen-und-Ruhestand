// NK-3 Soll 1 (FR-84 Punkte 15, 18, 19, 21): Einmalausgabe ganz oder gar nicht, auch bei Unverheirateten mit einer Person im Heim. Das Geld der
// Person im Heim bezahlt keine Einmalausgabe des Partners; eine entfallene Ausgabe bucht nichts ab. Geldbilanz je Person siehe
// helpers/nk-3-geldbilanz.mjs (Formel im Kopf). Erfundene Beträge; Testjahr wie YEAR in helpers/nk-1b-cases.mjs (ohne Renditen und Inflation).
import { couple, lot, YEAR, A, B } from './helpers/nk-1b-cases.mjs';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { MARTIN, PETRA } from './helpers/nk-1-sollfall.mjs';
import { recordYears, checkMoneyBalance } from './helpers/nk-3-geldbilanz.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';

const close = (actual, expected, label, tolerance = 1) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const liquidity = (portfolio, id) => (portfolio.personAccounts.find(row => row.profileId === id)?.tagesgeld || 0)
    + (portfolio.depotTranchesGeldmarkt || []).filter(row => row.sourceProfileId === id).reduce((sum, row) => sum + row.marketValue, 0);
/** Eine Person trägt: A. A 300.000 € Geldmarkt ohne Kursgewinn, B seit Jahresbeginn im Heim (40.000 €/Jahr) mit 400.000 € Tagesgeld.
 * Grundbedarf zu Hause 12.000 € (Hinterbliebenenanteil 100 %, damit A den ganzen Grundbedarf trägt), Einmalausgabe im Juni. */
function sollfall(status, amount) {
    const inputs = couple({ status, mode: `one_carries:${A}`, cash: [0, 400000], lots: [lot(A, 300000, 300000)] });
    Object.assign(inputs, { survivorFloorPercent: 100, plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'umbau', monat: '2026-06', betrag: amount, bezeichnung: 'Umbau' }] });
    const household = { p1Alive: true, p2Alive: true, care: { p2: { active: true, grade: 4, heimJahr: 1, heimKosten: 40000, heimEigeneAusgaben: 0,
        zusatzFloorZiel: 0, zusatzFloorDelta: 0 } } };
    const recorder = recordYears();
    try {
        const result = simulateOneYear(initMcRunState(inputs), inputs, YEAR, 0, null, 0, household, 1, EngineAPI);
        const portfolio = result.newState.portfolio;
        return { result, log: result.logData, a: liquidity(portfolio, A), b: liquidity(portfolio, B), years: recorder.years };
    } finally { recorder.stop(); }
}
const checkBalance = checkMoneyBalance;

// Sollfall (Steuerung von Hand): unverheiratet, Ausgabe 500.000 €. Auszahlbar ist nur As Geld nach dem Grundbedarf, 288.000 €; die Ausgabe
// entfällt ganz. Ende: A 288.000 €, B 360.000 €; keine Hilfe zur Pflege, kein Ruin. (Basis f3507299: B zahlte 212.000 € der Ausgabe.)
{
    const { result, log, a, b, years } = sollfall('unmarried', 500000);
    assertEqual(`${result.kind} · ${log.geplante_ausgaben} · ${log.geplante_ausgaben_gekuerzt}`, 'success · 0 · 500000', 'Sollfall: Ausgabe entfällt ganz (500.000 €)');
    close(a, 288000, 'Sollfall: A behält 288.000 €');
    close(b, 360000, 'Sollfall: B behält 360.000 € (nur das Heim bezahlt)');
    assert(!log.hilfe_zur_pflege && !result.isRuin, 'Sollfall: keine Hilfe zur Pflege, kein Ruin');
    checkBalance(years, [A, B], 'Sollfall');
}
// Nicht bezahlbar auch mit Bs Geld (700.000 €): Die Ausgabe entfällt, nichts wird abgebucht. (Basis: A verlor 288.000 € über die Auszahlung.)
{
    const { log, a, b, years } = sollfall('unmarried', 700000);
    assertEqual(`${log.geplante_ausgaben} · ${log.geplante_ausgaben_gekuerzt}`, '0 · 700000', '700.000 €: Ausgabe entfällt ganz');
    close(a, 288000, '700.000 €: A behält 288.000 €');
    close(b, 360000, '700.000 €: B behält 360.000 €');
    checkBalance(years, [A, B], '700.000 €');
}
// Unverändert: Was A selbst bezahlen kann (250.000 €), zahlt A ganz.
{
    const { log, years } = sollfall('unmarried', 250000);
    assertEqual(`${log.geplante_ausgaben} · ${log.geplante_ausgaben_gekuerzt ?? 0}`, '250000 · 0', '250.000 €: A zahlt die Ausgabe ganz');
    checkBalance(years, [A, B], '250.000 €');
}
// Derselbe Fehler ohne Heim (Anteile nach Vermögen, wie in nk-2-ausgaben): A 16.000 €, B 4.000 €, Grundbedarf 12.000 €, Ausgabe 10.000 €
// entfällt. Es bleiben 8.000 € (A 6.400 €, B 1.600 €). (Basis: 0 €, die Auszahlung buchte die entfallene Ausgabe ab.)
{
    const inputs = Object.assign(couple({ cash: [16000, 4000], floor: 12000 }), { plannedExpensesReferenceYear: 2026,
        plannedExpenses: [{ id: 'umbau', monat: '2026-06', betrag: 10000, bezeichnung: 'Umbau' }] });
    const recorder = recordYears();
    let result;
    try { result = simulateOneYear(initMcRunState(inputs), inputs, YEAR, 0, null, 0, null, 1, EngineAPI); } finally { recorder.stop(); }
    assertEqual(`${result.logData.geplante_ausgaben} · ${result.logData.geplante_ausgaben_gekuerzt}`, '0 · 10000', 'Ohne Heim: Ausgabe entfällt ganz');
    close(liquidity(result.newState.portfolio, A), 6400, 'Ohne Heim: A behält 6.400 €');
    close(liquidity(result.newState.portfolio, B), 1600, 'Ohne Heim: B behält 1.600 €');
    checkBalance(recorder.years, [A, B], 'Ohne Heim');
}
// Gegenprobe verheiratet (gemeinsame Kasse, FR-84 Punkt 18 gilt nicht): 700.000 − 12.000 − 40.000 = 648.000 € auszahlbar. 500.000 € werden ganz
// bezahlt, 148.000 € bleiben. 700.000 € entfallen ganz, nichts wird abgebucht, 648.000 € bleiben.
{
    const paid = sollfall('married', 500000);
    assertEqual(`${paid.log.geplante_ausgaben} · ${paid.log.geplante_ausgaben_gekuerzt ?? 0}`, '500000 · 0', 'Verheiratet: 500.000 € ganz bezahlt');
    close(paid.a + paid.b, 148000, 'Verheiratet: 148.000 € bleiben');
    checkBalance(paid.years, [A, B], 'Verheiratet 500.000 €');
    const dropped = sollfall('married', 700000);
    assertEqual(`${dropped.log.geplante_ausgaben} · ${dropped.log.geplante_ausgaben_gekuerzt}`, '0 · 700000', 'Verheiratet: 700.000 € entfallen ganz');
    close(dropped.a + dropped.b, 648000, 'Verheiratet: nichts abgebucht, 648.000 € bleiben');
    checkBalance(dropped.years, [A, B], 'Verheiratet 700.000 €');
}

// Nachstellung Nutzertest 16.11.: Martin und Petra, „Martin trägt“, Petra heute Grad 4 im Heim, Tagesgeld 0, Depot gelöscht, vermietete Wohnung
// bleibt. Einmalausgabe 500.000 € im Juni 2036 (Simulationsjahr 11). Pfad: Backtest ab 1990. Basis f3507299: Die Ausgabe entfiel, Martins Plan
// enthielt sie trotzdem; die Auszahlung buchte 512.463 € statt 78.767 € ab, Martin hatte danach 0 €, der Lauf endete später im Ruin.
{
    const transform = records => {
        const registry = JSON.parse(records.rs_profiles_v1);
        Object.assign(registry.profiles[PETRA].data, { profile_tagesgeld: '0', depot_tranchen: '[]', profile_care_grade_today: '4', profile_care_form_today: 'residential' });
        records.rs_profiles_v1 = JSON.stringify(registry);
        if (records.rs_current_profile === PETRA) Object.assign(records, registry.profiles[PETRA].data);
        return records;
    };
    const inputs = await measurementInputs(0, 'martin-petra', '2026-11-16', 'traegt', transform);
    assertEqual(`${inputs.householdWithdrawalMode} · ${inputs.partner?.careToday?.grade} ${inputs.partner?.careToday?.form} · ${inputs.simulationPeople.map(p => p.tagesgeld).join('/')}`,
        `one_carries:${MARTIN} · 4 residential · 20000/0`, 'Nachstellung: Martin trägt, Petra Grad 4 im Heim ohne Tagesgeld');
    Object.assign(inputs, { plannedExpensesReferenceYear: 2026, plannedExpenses: [{ id: 'gross', monat: '2036-06', betrag: 500000, bezeichnung: 'Große Ausgabe' }] });
    const recorder = recordYears();
    let history;
    try { history = backtest(inputs, 1990, 2015); } finally { recorder.stop(); }
    const rows = history.rows.map(entry => entry.row);
    const year = rows[10];
    assert(year.geplante_ausgaben_gekuerzt > 600000 && !(year.geplante_ausgaben > 0), `Nachstellung: Ausgabe 2036 entfällt ganz (${year.geplante_ausgaben_gekuerzt})`);
    const martin = row => row.personAccounts.find(account => account.profileId === MARTIN);
    const before = martin(rows[9]), after = martin(year);
    assert(after.tagesgeld + after.geldmarktEtf > before.tagesgeld + before.geldmarktEtf,
        `Nachstellung: Martins Verkaufserlös bleibt bei ihm (${Math.round(before.tagesgeld + before.geldmarktEtf)} → ${Math.round(after.tagesgeld + after.geldmarktEtf)})`);
    const paidMartin = year.personalPayout.items.find(item => item.profileId === MARTIN).amount;
    assert(paidMartin < 100000, `Nachstellung: Martins Auszahlung ohne die entfallene Ausgabe (${Math.round(paidMartin)})`);
    assertEqual(`${history.outcome.kind} · ${rows.filter(row => (row.hilfe_zur_pflege_personen || []).some(item => item.profileId === MARTIN)).length}`, 'completed · 0',
        'Nachstellung: kein Ruin, keine Hilfe zur Pflege für Martin');
    // KR-1c (NG-5): Petra bekommt 2001 Zins auf ihr Tagesgeld vor der Entscheidung, zahlt danach alles für ihr Heim; die Zinssteuer
    // von 12,57 € bleibt offen (Hilfe zur Pflege). Beleg in fixtures/kr-1c-expectation-deltas.json.
    checkBalance(recorder.years, [MARTIN, PETRA], 'Nachstellung', { openTaxYearIndex: 11 });
}
