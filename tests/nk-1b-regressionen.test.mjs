// NK-1b/NK-1c: Nachstellungen der Gutachten NK1C, NK1C2 (Codex) und NK1C-Fable als Regressionstests. Nur erfundene Beträge, ein Jahr mit 0 % Rendite
// und Inflation. Jedes Erfolgsjahr prüft zusätzlich unabhängig aus den Zahlungen der Jahreszeile, ob der Grundbedarf bezahlt ist.
import { couple, single, yearWithCare, plainYear, lot, A, B } from './helpers/nk-1b-cases.mjs';
import { unpaidBasicNeed } from './helpers/nk-1-invariant.mjs';
import { settlePersonalTaxYear, beginPersonalTaxYear, careSaleTaxAid } from '../app/simulator/simulator-personal-tax.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { protocolCareNotes } from '../app/simulator/protocol-cashflows.js';
import { protocolResidentialEntry } from '../app/simulator/protocol-columns.js';

const account = (result, id) => result.newState.portfolio.personAccounts.find(row => row.profileId === id);
const aidOf = (result, id) => (result.logData.hilfe_zur_pflege_personen || []).filter(row => row.profileId === id).reduce((sum, row) => sum + row.amount, 0);
const paidCheck = (result, label) => assertEqual(unpaidBasicNeed(result.logData), null, `${label}: Grundbedarf nach den Zahlungen der Jahreszeile bezahlt`);

// Punkte 1 und 6 (Codex 1, Fable P1-1/P2-6): A 20.000 € Tagesgeld, B nichts, Grundbedarf 12.000 €, Pflege B 30.000 €, kein Flex.
for (const mode of ['one_carries:muster_a', 'proportional']) {
    const result = yearWithCare(couple({ mode, cash: [20000, 0] }), 30000);
    assertEqual(result.kind, 'success', `Codex 1 ${mode}: Erfolgsjahr`);
    assertClose(result.logData.entnahme_effektiv, 12000, 0.01, `Codex 1 ${mode}: 12.000 € Auszahlung für den Grundbedarf`);
    assertClose(account(result, A).tagesgeld, 8000, 0.01, `Codex 1 ${mode}: 8.000 € bleiben bei A`);
    assertClose(aidOf(result, B), 30000, 0.01, `Codex 1 ${mode}: 30.000 € Hilfe zur Pflege für B`);
    assert(!result.logData.grundbedarf_rest, `Codex 1 ${mode}: kein offener Grundbedarf`);
    paidCheck(result, `Codex 1 ${mode}`);
}

// Punkt 7 (Fable P1-2): Jahr mit Hilfe und voll bezahltem Plan der tragenden Person zeigt keine Kürzung.
{
    const result = yearWithCare(couple({ mode: 'one_carries:muster_a', cash: [300000, 0], flex: 6000 }), 30000);
    assertClose(result.logData.hilfe_zur_pflege, 30000, 0.01, 'P1-2: Hilfe zur Pflege für B');
    assertEqual(result.logData.entscheidung.kuerzungProzent, 0, 'P1-2: keine Flex-Kürzung wegen der Hilfe');
    assertClose(result.logData.flex_haushalt_erfuellt, 6000, 0.01, 'P1-2: Flex voll bezahlt');
    assertClose(result.newState.lastState.lastEntnahmeReal ?? result.newState.lastEntnahmeReal ?? 48000, 48000, 0.01,
        'P1-2: Engine-Anker ohne Abzug der Hilfe (Grundbedarf, Flex und Pflege)');
    paidCheck(result, 'P1-2');
}

// Punkte 2 und 8 (Codex 2, Fable P1-3): Gesperrte Pflegerücklage deckt keinen Grundbedarf; ungezahlter Grundbedarf ist kein Erfolgsjahr.
{
    const locked = plainYear(single({ reserve: 100000 }));
    assertEqual(locked.kind, 'ruin', 'Codex 2: 100.000 € nur in der Rücklage, keine Pflege: Ruin statt Erfolg mit offenem Grundbedarf');
    const partly = plainYear(single({ cash: 45000, reserve: 40000, floor: 60000 }));
    assertEqual(partly.kind, 'ruin', 'Fable P1-3: 45.000 € frei, 40.000 € gesperrt, Grundbedarf 60.000 €: Ruin im ersten Jahr');
    const free = plainYear(single({ cash: 100000 }));
    assertEqual(`${free.kind} · ${free.logData.grundbedarf_rest ?? 0}`, 'success · 0', 'Gegenprobe ohne Rücklage: bezahlt, kein Rest');
}

// Punkt 3 (Codex 5, Fall des Nutzers): B zahlt 30.000 € Pflege aus gewinnhaltigem Geldmarkt, A trägt mit Einkünften. Die Steuer aus Bs
// Verkauf ist Hilfe zur Pflege; kein offener Rest, kein Notverkauf, auch mit Haus.
for (const owner of [null, A, B]) for (const mode of ['one_carries:muster_a', 'proportional']) {
    const home = owner ? [{ id: 'haus', profileId: owner, wert: 400000, nutzung: 'selbst', stand: '2026-01' }] : [];
    const result = yearWithCare(couple({ mode, cash: [50000, 0], pensionA: 60000, lots: [lot(B, 30000, 1)], home }), 30000);
    const label = `Codex 5 ${mode}${owner ? ` Haus ${owner}` : ''}`;
    assertEqual(result.kind, 'success', `${label}: Erfolgsjahr`);
    // Proportional zahlt B auch ihren Grundbedarfsanteil; den Steueranteil dafür trägt der Haushalt (Punkt 11), der Pflegeanteil ist Hilfe.
    assert(result.logData.hilfe_zur_pflege_steuer > 5000 && result.kind === 'success', `${label}: Steuer aus Pflegeverkäufen ist Hilfe zur Pflege`);
    assertClose(aidOf(result, B), result.logData.hilfe_zur_pflege, 0.01, `${label}: Hilfe je Person ergibt den Jahresbetrag`);
    assert(!result.logData.immobilien_notverkauf && !result.logData.partner_grundbedarf, `${label}: kein Notverkauf, A zahlt nichts dazu`);
    paidCheck(result, label);
}

// NK-1c (Gutachten NK1C2 Befund 4): Steuer aus Pflegeverkäufen ist Hilfe nur mit dem Pflegeanteil der Zahlung. B zahlt 13.000 € aus voll
// gewinnhaltigem Geldmarkt (12.000 € Grundbedarf, 1.000 € Pflege), Pflegequote 1/13. Die übrige Steuer hat keinen Pflegebezug. NK-2
// (FR-84 Punkt 17): Sie bleibt als Schuld stehen, mit und ohne Immobilie; im Entstehungsjahr kein Notverkauf. Trägt B und hat A Geld,
// zahlt A sie (Rückgriff wie bisher), und nur der Pflegeanteil ist Hilfe.
{
    const quota = careSaleTaxAid([{ profileId: B, taxDue: 3428.75, taxShortfall: 3428.75 }], { [B]: 1 / 13 });
    assertClose(quota.total, 263.75, 0.01, 'R2 Befund 4: Hilfe nur 263,75 € (Pflegeanteil 1/13 der Steuer)');
    const caseB = (cash, home = [], mode = 'proportional') => {
        const inputs = couple({ mode, cash: [cash, 0], lots: [lot(B, 13000, 0.01)], home });
        inputs.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; });
        return yearWithCare(inputs, 1000);
    };
    const poor = caseB(0);
    assertEqual(poor.kind, 'success', 'NK-2: ohne Immobilie kein Ruin wegen Steuer ohne Pflegebezug');
    assertClose(poor.logData.hilfe_zur_pflege_steuer, 263.75, 0.05, 'NK-2: Hilfe nur für den Pflegeanteil');
    assertClose(poor.logData.steuer_offen, 3165, 0.05, 'NK-2: der Rest bleibt als Schuld (3.165 €)');
    const sold = caseB(0, [{ id: 'haus', profileId: A, wert: 200000, nutzung: 'vermietet', stand: '2026-01' }]);
    assert(sold.kind === 'success' && !sold.logData.immobilien_notverkauf && !sold.logData.immobilienverkauf && sold.logData.steuer_offen > 3164,
        'NK-2: mit Immobilie im Entstehungsjahr kein Notverkauf, die Schuld läuft weiter');
    // NK-2 (FR-84 Punkt 20): Gehört die vermietete Immobilie B, verkauft B sie vor der Hilfe zur Pflege; dann zahlt B alles selbst.
    const own = caseB(0, [{ id: 'haus', profileId: B, wert: 200000, nutzung: 'vermietet', stand: '2026-01' }]);
    assertEqual(`${own.kind} · ${own.logData.immobilien_verkauf_pflege} · ${own.logData.hilfe_zur_pflege ?? 0} · ${own.logData.steuer_offen ?? 0}`, 'success · 1 · 0 · 0',
        'NK-2: Bs vermietete Immobilie vor der Hilfe verkauft, keine Hilfe, keine Schuld');
    const helped = caseB(20000, [], 'one_carries:muster_b');
    assertEqual(helped.kind, 'success', 'R2 Befund 4: A zahlt die Steuer ohne Pflegebezug');
    assertClose(helped.logData.hilfe_zur_pflege_steuer, 263.75, 0.05, 'R2 Befund 4: Hilfe zur Pflege nur für den Pflegeanteil der Steuer');
    assert(!('steuer_offen' in helped.logData) && !('steuer_schuld_vorjahr' in helped.logData), 'NK-1c: keine Steuerschuld im Protokoll');
    paidCheck(helped, 'R2 Befund 4');
}

// NK-1c (Gutachten NK1C2 Befund 3): Wohnrechtsteuer. Reicht das Geld bei Fälligkeit, wird sie einmal bezahlt und protokolliert, ohne
// Notverkauf und ohne offene Steuer. NK-2 (Nachtrag 10): Reicht es zu Beginn nicht, bleibt sie Forderung und wird am Jahresende aus den
// Einkünften bezahlt, einmal protokolliert, ohne Notverkauf.
{
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    base.partnership.testament.muster_martin.residenceTax = 'annual';
    Object.assign(base, { startFloorBedarf: 1000, startFlexBedarf: 0, minimumFlexAnnual: 0 });
    const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0 }, alive = { p1Alive: false, p2Alive: true };
    const death = simulateOneYear(initMcRunState(base), base, year, 0, null, 0, alive, 1, EngineAPI);
    const nextWith = cash => {
        const state = structuredClone(death.newState);
        for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt']) state.portfolio[key] = [];
        state.portfolio.personAccounts.forEach(account => { account.tagesgeld = cash; account.geldmarktEtf = 0; });
        state.portfolio.liquiditaet = cash * state.portfolio.personAccounts.length;
        return simulateOneYear(state, base, year, 1, null, 0, alive, 1, EngineAPI);
    };
    const due = death.logData.inheritance.residenceTax.annualTax;
    const paid = nextWith(due + 50000);
    assertEqual(`${paid.kind} · ${paid.logData.immobilien_notverkauf ?? false}`, 'success · false', 'Wohnrecht: bezahlt, kein Notverkauf');
    assertClose(paid.logData.wohnrechtsteuer, due, 0.01, 'Wohnrecht: einmal protokolliert');
    assert(!('steuer_offen' in paid.logData) && !('steuer_schuld_vorjahr' in paid.logData), 'Wohnrecht: keine offene Steuer, keine Vorjahresschuld');
    const empty = nextWith(0);
    assertEqual(`${empty.kind} · ${empty.logData.immobilien_notverkauf ?? false}`, 'success · false', 'NK-2 Wohnrecht ohne Geld bei Fälligkeit: kein Notverkauf');
    assertClose(empty.logData.wohnrechtsteuer, due, 0.01, 'NK-2 Wohnrecht: am Jahresende aus den Einkünften bezahlt, einmal protokolliert');
    assert(!('steuer_offen' in empty.logData) && !('steuer_schuld_vorjahr' in empty.logData), 'NK-2 Wohnrecht: keine offene Steuer, keine Vorjahresschuld');
}

// NK-1c (Gutachten NK1C2 Befund 6): Der Prüfer verlangt Zahlungsnachweise. Genullte Buchungen bei unveränderter Entnahme und eine
// leere Zeile gelten nicht als bezahlt.
{
    const result = yearWithCare(couple({ mode: 'one_carries:muster_a', cash: [20000, 0] }), 30000);
    paidCheck(result, 'Befund 6: Ausgangsfall');
    const mutated = structuredClone(result.logData);
    for (const item of mutated.personalPayout.items) Object.assign(item, { amount: 0, tagesgeldUsed: 0, geldmarktUsed: 0 });
    mutated.personalPayout.total = 0;
    assert(unpaidBasicNeed(mutated) !== null, `Befund 6: genullte Buchungen fallen auf (${unpaidBasicNeed(mutated)})`);
    assert(unpaidBasicNeed({}) !== null, 'Befund 6: leere Zeile ist kein Erfolg');
    // NK-2 (Gutachten NK1C3 Befund 2): fehlende oder ungültige Kontenangaben bei unveränderten Beträgen fallen auf.
    for (const [label, change] of [['fehlend', item => { delete item.tagesgeldUsed; delete item.geldmarktUsed; }],
        ['NaN', item => Object.assign(item, { tagesgeldUsed: NaN, geldmarktUsed: NaN })], ['negativ', item => Object.assign(item, { tagesgeldUsed: item.amount + 5, geldmarktUsed: -5 })]]) {
        const row = structuredClone(result.logData);
        for (const item of row.personalPayout.items) change(item);
        assert(unpaidBasicNeed(row) !== null, `NK1C3 Befund 2: Kontenangabe ${label} fällt auf (${unpaidBasicNeed(row)})`);
    }
}

// Punkt 5: Sollfall B durch den vollständigen Jahrespfad. Martin (A) trägt 48.000 €, Petra (B) soll 31.400 € Heimkosten zahlen; ihr
// gewinnhaltiger Geldmarkt bringt 31.397,65 €. Fehlende 2,35 € und ihre Verkaufssteuer zahlt der Staat; kein Ruin, kein Notverkauf.
{
    const inputs = couple({ mode: 'one_carries:muster_a', floor: 48000, cash: [100000, 0], lots: [lot(B, 31397.65, 20000)],
        home: [{ id: 'haus', profileId: A, wert: 300000, nutzung: 'selbst', stand: '2026-01' }] });
    const result = yearWithCare(inputs, 31400);
    assertEqual(result.kind, 'success', 'Sollfall B (Jahrespfad): Erfolgsjahr');
    assertClose(aidOf(result, B) - result.logData.hilfe_zur_pflege_steuer, 2.35, 0.01, 'Sollfall B (Jahrespfad): 2,35 € Hilfe für die Heimkosten');
    assert(result.logData.hilfe_zur_pflege_steuer > 0, 'Sollfall B (Jahrespfad): Verkaufssteuer ist Hilfe zur Pflege');
    assertClose(account(result, A).tagesgeld, 52000, 0.01, 'Sollfall B (Jahrespfad): Martin zahlt nur seine 48.000 €');
    assert(!result.logData.immobilien_notverkauf && !result.logData.partner_grundbedarf, 'Sollfall B (Jahrespfad): kein Notverkauf');
    paidCheck(result, 'Sollfall B (Jahrespfad)');
}

// Punkt 10 (Fable P2-4 Punkt 4): Die bezahlbare Ausgabe der zahlenden Person entfällt nicht wegen der Pflege der anderen.
{
    const inputs = couple({ mode: 'one_carries:muster_a', cash: [100000, 0], floor: 20000 });
    inputs.plannedExpenses = [{ id: 'auto', bezeichnung: 'Auto', art: 'einmalig', betrag: 30000, monat: '2026-03' }];
    inputs.plannedExpensesReferenceYear = 2026;
    const result = yearWithCare(inputs, 60000);
    assertEqual(`${result.logData.geplante_ausgaben} · ${result.logData.geplante_ausgaben_gekuerzt ?? 0}`, '30000 · 0', 'P2-4: Ausgabe von A bezahlt');
    assertClose(account(result, A).tagesgeld, 50000, 0.01, 'P2-4: A zahlt Grundbedarf und Ausgabe, B 60.000 € Hilfe');
}

// Punkt 11 (Fable P2-8): Den Steueranteil aus Pflegeverkäufen zahlt der Haushalt nicht, den übrigen schon.
{
    const portfolio = initMcRunState(single({ cash: 0 })).portfolio;
    portfolio.personAccounts = [{ profileId: 'a', tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } },
        { profileId: 'b', tagesgeld: 5000, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } }];
    portfolio.liquiditaet = 5000;
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 1000;
    const result = settlePersonalTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: {}, inputs: { householdWithdrawalMode: 'proportional' },
        plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false, ownTaxShare: { a: 0.25 } });
    assertClose(result.taxShortfall, 263.75 * 0.25, 0.01, 'P2-8: offen bleibt nur der Pflegeanteil (ein Viertel)');
    assertClose(portfolio.personAccounts[1].tagesgeld, 5000 - 263.75 * 0.75, 0.01, 'P2-8: Rückgriff für den übrigen Teil bleibt');
    // NK-1c: Eine Steuerlücke ohne Pflegebezug verkauft wie im Produktivstand jede verfügbare Immobilie (Regel folgt mit NK-2).
}

// Punkt 12 (Fable P2-7): Partner deckt Grundbedarf im Jahreslauf. A hat ihr Geld in der Pflegerücklage (keine Pflege, gesperrt), B verkauft.
{
    const inputs = couple({ mode: 'proportional', cash: [50000, 0], lots: [lot(B, 50000, 40000, 'equity')],
        healthBucket: { enabled: true, initialAmount: 50000, assetSource: 'cash' } });
    const result = yearWithCare(inputs, 0);
    assertEqual(result.kind, 'success', 'P2-7: Erfolgsjahr');
    assertEqual(JSON.stringify(result.logData.partner_grundbedarf), JSON.stringify([{ profileId: A, fromProfileId: B, amount: 6000 }]),
        'P2-7: B deckt den Grundbedarfsanteil von A (6.000 €)');
    assert(result.newState.portfolio.depotTranchesAktien.find(row => row.sourceProfileId === B).marketValue < 50000, 'P2-7: B verkauft dafür eigene Wertpapiere');
    assert(/Partner deckt Grundbedarf: 6\.000\s€/.test(protocolActionExplanation(result.logData, { source: 'mc', inputs })), 'P2-7: Protokolltext');
    paidCheck(result, 'P2-7');
}

// NK-1c (Abnahme Gemini): Der Grund des Heimeintritts steht im Jahr des Wechsels auch im Ausgaben-ⓘ der Person.
{
    const inputs = { partner: { aktiv: false }, simulationPeople: [{ profileId: A, name: 'Werner' }], pflegeKostenStaffelPreset: 'eigene' };
    const before = { jahr: 1, CareP1_Active: true, CareP1_Grade: 4, CareP1_Form: 'home-support' };
    const entered = { jahr: 2, CareP1_Active: true, CareP1_Grade: 4, CareP1_Form: 'residential', CareP1_HeimJahr: 1, CareP1_HeimZuschuss: 0 };
    const options = { source: 'mc', inputs, rows: [before, entered] };
    const notes = protocolCareNotes(entered, { ...options, residentialEntry: (row, index) => protocolResidentialEntry(row, index, options) });
    assert(notes[0]?.startsWith('Werner: Grad 4, im Heim (laut Staffel), Heimjahr 1'), `Warum Heim im Ausgaben-ⓘ (${notes[0]})`);
    const later = protocolCareNotes({ ...entered, jahr: 3, CareP1_HeimJahr: 2 }, { ...options, rows: [entered, { ...entered, jahr: 3, CareP1_HeimJahr: 2 }],
        residentialEntry: (row, index) => protocolResidentialEntry(row, index, { ...options, rows: [entered, row] }) });
    assert(later[0]?.startsWith('Werner: Grad 4, im Heim, Heimjahr 2'), `Folgejahr ohne Grund (${later[0]})`);
}
