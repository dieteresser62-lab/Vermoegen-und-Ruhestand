// NK-2 Punkt 4 (FR-84 Punkt 17): Schuldenbuch. Offene Steuer ohne Pflegebezug bleibt als Schuld bei der Person, wird im Folgejahr nach
// Grundbedarf und Pflege und vor dem Flex bezahlt, mindert das Nettovermögen und den Nachlass. Notverkauf erst, wenn im Folgejahr Grundbedarf
// plus Schuld nicht gedeckt sind, und nur aus einer Immobilie der Schuldnerin oder des Schuldners. Nur erfundene Beträge.
import { couple, single, lot, yearWithCare, A, B, YEAR } from './helpers/nk-1b-cases.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { floorReliefText } from '../app/simulator/protocol-renderer.js';
import { EngineAPI } from '../engine/index.mjs';
import { unpaidBasicNeed } from './helpers/nk-1-invariant.mjs';

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
/** Persönliche Sparer-Pauschbeträge null, damit die Verkaufssteuer sichtbar ist. @param {any} inputs */
const noAllowance = inputs => { inputs.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; }); inputs.startSPB = 0; return inputs; };
const house = (profileId, wert = 1000000) => ({ id: `haus-${profileId}`, profileId, wert, nutzung: 'selbst', stand: '2026-01' });
const debtOf = (result, id) => result.newState.portfolio.personAccounts.find(row => row.profileId === id)?.openTax || 0;

// Sollfall S1: 1.000 € Geldmarkt ohne Einstand, Grundbedarf 1.000 €, Haus 1 Mio. €. 263,75 € Steuer bleiben offen; kein Notverkauf.
{
    const inputs = noAllowance(single({ floor: 1000, lots: [lot(A, 1000, 0.01)] }));
    Object.assign(inputs, { home: [house(A)], homeReferenceYear: 2026 });
    const year = (state, index) => simulateOneYear(state, inputs, YEAR, index, null, 0, null, 1, EngineAPI);
    const first = year(initMcRunState(inputs), 0);
    assertEqual(`${first.kind} · ${first.logData.immobilien_notverkauf ?? false}`, 'success · false', 'S1: Erfolg, kein Notverkauf im ersten Jahr');
    close(first.logData.steuer_offen, 263.75, 'S1: 263,75 € Steuer bleiben als Schuld', 0.01);
    close(debtOf(first, A), 263.75, 'S1: Schuld im Zustand der Person', 0.01);
    assertEqual(first.logData.portfolio_total_end, 0, 'S1: Nettovermögen am Jahresende null (brutto 0 €, Schuld 263,75 €)');
    assert(unpaidBasicNeed(first.logData) === null, 'S1: Grundbedarf bezahlt');
    const withCash = cash => {
        const state = structuredClone(first.newState);
        state.portfolio.personAccounts[0].tagesgeld += cash;
        state.portfolio.liquiditaet += cash;
        return year(state, 1);
    };
    // Gegenprobe 1: Im Folgejahr reicht der Zufluss für Grundbedarf und Schuld. Bezahlt, kein Notverkauf.
    const enough = withCash(5000);
    assertEqual(`${enough.kind} · ${enough.logData.immobilien_notverkauf ?? false} · ${debtOf(enough, A)}`, 'success · false · 0', 'S1 Gegenprobe 1: Schuld bezahlt, kein Notverkauf');
    close(enough.logData.steuer_schuld_vorjahr, 263.75, 'S1 Gegenprobe 1: Vorjahresschuld fällig');
    close(enough.logData.portfolio_total_end, 5000 - 1000 - 263.75, 'S1 Gegenprobe 1: Nettovermögen nach Grundbedarf und Schuld');
    // Gegenprobe 2: Der Zufluss deckt den Grundbedarf, die Schuld nicht ganz. Notverkauf im Folgejahr aus dem Haus der Person.
    const short = withCash(1100);
    assertEqual(`${short.kind} · ${short.logData.immobilien_notverkauf}`, 'success · true', 'S1 Gegenprobe 2: Notverkauf im Folgejahr');
    assertEqual(short.logData.immobilienverkauf_personen?.map(row => row.profileId).join(), A, 'S1 Gegenprobe 2: Haus der Schuldnerin');
    assertEqual(debtOf(short, A), 0, 'S1 Gegenprobe 2: Schuld nach dem Verkauf bezahlt');
}

// Nur die Immobilie der Person, deren Altschuld offen ist (Fable P2-8): B schuldet, das Haus gehört A. Kein Verkauf, die Schuld läuft weiter.
{
    const inputs = noAllowance(couple({ floor: 1000, cash: [1000, 100], home: [house(A)] }));
    const state = initMcRunState(inputs);
    state.portfolio.personAccounts.find(row => row.profileId === B).openTax = 500;
    const result = yearWithCare(inputs, 0, state);
    assertEqual(`${result.kind} · ${result.logData.immobilien_notverkauf ?? false}`, 'success · false', 'Fremde Immobilie: kein Notverkauf für Bs Schuld');
    assert(debtOf(result, B) > 0 && debtOf(result, A) === 0, `Fremde Immobilie: Bs Schuld läuft weiter (${debtOf(result, B)})`);
}

// Gutachten NK1C2 Befund 1: Bezahlte Altschuld (5.000 € bei B, A zahlt) ist von neuer Pflegeverkaufssteuer getrennt. B zahlt 30.000 € Pflege
// aus voll gewinnhaltigem Geldmarkt; die neue Steuer 7.912,50 € ist ganz Hilfe, keine Schuld bleibt; netto 93.000 €.
{
    const run = debt => {
        const inputs = noAllowance(couple({ mode: `one_carries:${A}`, cash: [50000, 0], pensionA: 60000, lots: [lot(B, 30000, 0.01)] }));
        const state = initMcRunState(inputs);
        if (debt) state.portfolio.personAccounts.find(row => row.profileId === B).openTax = debt;
        return yearWithCare(inputs, 30000, state);
    };
    const without = run(0), withDebt = run(5000);
    close(withDebt.logData.hilfe_zur_pflege_steuer, without.logData.hilfe_zur_pflege_steuer, 'Befund 1: dieselbe Steuerhilfe mit und ohne Altschuld');
    close(withDebt.logData.hilfe_zur_pflege_steuer, 7912.5, 'Befund 1: ganze neue Pflegeverkaufssteuer ist Hilfe', 0.05);
    assertEqual(`${debtOf(withDebt, A)} · ${debtOf(withDebt, B)} · ${'steuer_offen' in withDebt.logData}`, '0 · 0 · false', 'Befund 1: keine Schuld bleibt');
    close(withDebt.logData.portfolio_total_end, 93000, 'Befund 1: Nettovermögen 93.000 €', 0.05);
    assert(/Steuerschuld aus dem Vorjahr: 5\.000/.test(floorReliefText({ ...withDebt.logData }, value => value.toLocaleString('de-DE', { maximumFractionDigits: 0 }))),
        'Befund 1: Protokoll nennt die Vorjahresschuld');
}

// Gutachten NK1C2 Befund 2: A stirbt mit 100.000 € gesperrter Pflegerücklage und 50.000 € Schuld, B erbt 100 %. Die Schuld mindert den
// Erwerb vor der Erbschaftsteuer: 9.000 € statt 24.000 €, netto 41.000 €.
{
    const inputs = noAllowance(couple({ floor: 0, cash: [100000, 0], healthBucket: { initialAmount: 100000, assetSource: 'cash', enabled: true } }));
    inputs.partnership.inheritance = { [A]: 100, [B]: 100 };
    const state = initMcRunState(inputs);
    state.portfolio.personAccounts.find(row => row.profileId === A).openTax = 50000;
    const death = simulateOneYear(state, inputs, YEAR, 0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    assertEqual(death.kind, 'success', 'Befund 2: Todesjahr ohne Ruin');
    close(death.logData.erbschaftsteuer, 9000, 'Befund 2: Erbschaftsteuer auf den Nettoerwerb 50.000 €');
    close(death.logData.portfolio_total_end, 41000, 'Befund 2: Nettovermögen 41.000 €');
    close(death.logData.portfolio_total_brutto, 100000, 'Befund 2: Bruttovermögen getrennt benannt');
    close(debtOf(death, B), 59000, 'Befund 2: B übernimmt Schuld und offene Erbschaftsteuer');
}

// Gutachten NK1C2 Befund 5: Jahresprotokoll und Nettovermögen verwenden denselben Begriff. 100.000 € gesperrte Rücklage, 10.000 € Schuld.
{
    const inputs = single({ floor: 0, reserve: 100000 });
    const state = initMcRunState(inputs);
    state.portfolio.personAccounts[0].openTax = 10000;
    const result = simulateOneYear(state, inputs, YEAR, 0, null, 0, null, 1, EngineAPI);
    close(result.logData.portfolio_total_end, portfolioTotal(result.newState.portfolio), 'Befund 5: Jahresendfeld = Nettovermögen');
    close(result.logData.portfolio_total_end, 90000, 'Befund 5: netto 90.000 €');
    close(result.logData.portfolio_total_brutto, 100000, 'Befund 5: brutto 100.000 €');
}
