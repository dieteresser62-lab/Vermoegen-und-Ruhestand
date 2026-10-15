import { createHash } from 'node:crypto';
import { buildMonteCarloYearLogRow } from '../app/simulator/mc-log-builder.js';
import { calculateHouseholdPensionForYear, pensionPaymentFactor } from '../app/simulator/simulator-household-pension.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { simulateOneYear, initMcRunState } from '../app/simulator/simulator-engine-direct.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { extractP2Invariants, areP2InvariantsEqual } from '../app/simulator/simulator-sweep-utils.js';
import { EngineAPI } from '../engine/index.mjs';
const close = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8, label);
const personData = (monthly, date) => ({ profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
    profile_rente_monatlich: String(monthly), profile_rentenbeginn: date,
    profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '2',
    profile_tagesgeld: '100000', sim_simStartVermoegen: '100000' });
const entries = [1000, 2000].map((amount, index) => ({ profileId: String(index),
    inputs: buildSimulatorInputsFromProfileData(personData(amount, '2028-07-01'), { referenceYear: 2026 }) }));
const inputs = combineSimulatorProfiles(entries, '0').combined;
for (const primary of ['0', '1']) {
    const withLegacyQuotes = entries.map(entry => ({ ...entry, inputs: { ...entry.inputs, steuerquotePct: 80 } }));
    const combined = combineSimulatorProfiles(withLegacyQuotes, primary).combined;
    const totals = calculateHouseholdPensionForYear({ inputs: combined, yearIndex: 3,
        currentAnnualPension: combined.renteMonatlich * 12, currentAnnualPension2: combined.partner.monatsrente * 12 });
    close(totals.pensionAnnual, 36000, 'FR-11: Profilverbund zahlt beide Nettorenten in beiden Hauptprofilrollen');
}
assertEqual(inputs.renteStartMonate, 6, 'Produktiver P1-Adapter erhält Juli');
assertEqual(inputs.partner.renteStartMonate, 6, 'Produktiver Partnermerge erhält Juli');
let p1 = 12000, p2 = 24000;
for (let index = 0; index < 4; index++) {
    const result = calculateHouseholdPensionForYear({ inputs, yearIndex: index, currentAnnualPension: p1, currentAnnualPension2: p2 });
    const factor = index < 2 ? 0 : index === 2 ? .5 : 1;
    close(result.rente1, 12000 * 1.02 ** index * factor, 'P1 mit Anpassung ab Index 0 und Startjahresanteil');
    close(result.rente2, 24000 * 1.02 ** index * factor, 'Partner mit Anpassung ab Index 0 und Startjahresanteil');
    p1 = result.nextAnnualPension; p2 = result.nextAnnualPension2;
}
const taxCase = calculateHouseholdPensionForYear({ inputs: { ...inputs, partner: { ...inputs.partner, steuerquotePct: 20, startInJahren: 1, renteStartMonate: 1 } }, yearIndex: 1, currentAnnualPension: 12000, currentAnnualPension2: 24000 });
close(taxCase.rente1, 0, 'Unterschiedlicher P1-Beginn bleibt zukünftig');
close(taxCase.rente2, 24000 / 12, 'FR-11: Monatsanteil der Nettorente ohne weiteren Abschlag');
for (const [date, expected] of [['2026-07-15', 6000], ['2024-07-01', 12000], ['', 12000], ['2026-01-01', 12000]]) {
    const input = buildSimulatorInputsFromProfileData(personData(1000, date), { referenceYear: 2026 });
    close(calculateHouseholdPensionForYear({ inputs: input, yearIndex: 0, currentAnnualPension: 12000 }).rente1, expected, 'Offset 0 berücksichtigt nur einen aktuellen Teiljahresbeginn');
}
const widow = calculateHouseholdPensionForYear({ inputs, yearIndex: 2, currentAnnualPension: 12000, currentAnnualPension2: 24000,
    p2Alive: false, widowBenefits: { p1FromP2: true, p1FromP2Percent: .6 } });
close(widow.widowBenefitP1ThisYear, 14400, 'Hinterbliebenenregel verwendet weiterhin volle Basis');
close(widow.rente1, 20400, 'Nur eigene Rente erhält neuen Zeitanteil');
for (const quote of [0, 20, 80, 100]) {
    const netInputs = { ...inputs, steuerquotePct: quote, partner: { ...inputs.partner, steuerquotePct: quote } };
    const survivor = calculateHouseholdPensionForYear({ inputs: netInputs, yearIndex: 2, currentAnnualPension: 12000,
        currentAnnualPension2: 24000, p1Alive: false, widowBenefits: { p2FromP1: true, p2FromP1Percent: .6 } });
    close(survivor.rente1, 0, 'Verstorbene Person erhält keine eigene Rente');
    close(survivor.rente2, 12000 + 7200, 'FR-11: Eigene Teiljahresrente und Hinterbliebenenrente bleiben netto');
    close(survivor.nextAnnualPension2, 24480, 'Anpassung schreibt die volle Nettobasis fort');
    close(survivor.nextWidowPensionP2, 7344, 'Anpassung der Hinterbliebenenrente bleibt erhalten');
    const carried = calculateHouseholdPensionForYear({ inputs: netInputs, yearIndex: 3, currentAnnualPension2: 24480,
        widowPensionP2: survivor.nextWidowPensionP2, p1Alive: false,
        widowBenefits: { p2FromP1: true, p2FromP1Percent: .6 } });
    close(carried.rente2, 24480 + 7344, 'Fortgeführte Hinterbliebenenrente ohne zweiten Abzug');
    const survivorP1 = calculateHouseholdPensionForYear({ inputs: netInputs, yearIndex: 2, currentAnnualPension: 12000,
        currentAnnualPension2: 24000, p2Alive: false, widowBenefits: { p1FromP2: true, p1FromP2Percent: .6 } });
    close(survivorP1.rente1, 6000 + 14400, 'FR-11: Auch P1 erhält eigene Teiljahresrente und Hinterbliebenenrente ohne Abschlag');
}
assert(!areP2InvariantsEqual(extractP2Invariants(inputs), extractP2Invariants({ ...inputs, partner: { ...inputs.partner, renteStartMonate: 12 } })), 'Partnerinvariante schützt wirksame Rentenmonate');
for (const months of [0, 13, 6.5, '6']) { let error; try { pensionPaymentFactor(0, 0, months); } catch (cause) { error = cause; } assert(error, 'Ungültiger Monatszusatz wird abgewiesen'); }

// Echter DOM-freier Jahreslauf: fortgeschriebene Basis und vollständiger Übergang.
prepareHistoricalDataOnce();
const runInputs = { ...inputs, startVermoegen: 900000, depotwertAlt: 500000, einstandAlt: 350000,
    tagesgeld: 100000, simulationPeople: inputs.simulationPeople.map(person => ({ ...person, tagesgeld: 50000 })),
    geldmarktEtf: 0, startFloorBedarf: 24000, startFlexBedarf: 12000,
    minimumFlexAnnual: 0, goldAktiv: false, dynamicFlex: false, healthBucket: { enabled: false } };
function runYears(input, annualReturns = .03, engine = EngineAPI, initialYearsSince = 0) {
    let state = { portfolio: initMcRunState(input), baseFloor: 24000, baseFlex: 12000,
        currentAnnualPension: 12000, currentAnnualPension2: 24000, marketDataHist: { endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: initialYearsSince, capeRatio: 20 }, lastState: null };
    const results = [];
    for (let index = 0; index < 4; index++) {
        const result = simulateOneYear(state, input, { jahr: 2026 + index, rendite: annualReturns, gold_eur_perf: 0, zinssatz: 1, inflation: 0, lohn: 2 }, index, null, 0, null, 1, engine);
        assertEqual(result.kind, 'success', 'Produktiver Jahreslauf erfolgreich');
        state = result.newState; results.push(result);
    }
    return results;
}
const before = JSON.stringify(runInputs), years = runYears(runInputs);
for (let index = 0; index < 4; index++) {
    const factor = index < 2 ? 0 : index === 2 ? .5 : 1;
    close(years[index].logData.rente1, 12000 * 1.02 ** index * factor, 'Jahresresultat P1 ist anteilig, danach voll');
    close(years[index].logData.rente2, 24000 * 1.02 ** index * factor, 'Jahresresultat Partner ist anteilig, danach voll');
    close(years[index].logData.pension_annual, years[index].logData.renteSum, 'Jahresresultat verwendet eine gemeinsame Rentensumme');
}
assertEqual(JSON.stringify(runInputs), before, 'Jahreslauf verändert keine Eingaben');
for (const annualReturn of [.1, 0, -.1]) {
    const captured = [];
    const results = runYears(runInputs, annualReturn, { ...EngineAPI, simulateSingleYear(input, state) {
        captured.push(structuredClone(input)); return EngineAPI.simulateSingleYear(input, state);
    } }, 2);
    for (let index = 0; index < results.length; index++) {
        const expectedYears = annualReturn >= 0 ? 0 : 3 + index;
        close(captured[index].ath, annualReturn > 0 ? 100 * 1.1 ** (index + 1) : 100, 'FR-15: Aktuelles Hoch erreicht die echte Jahresentscheidung');
        assertEqual(captured[index].jahreSeitAth, expectedYears, 'FR-15: Abstand erreicht die Engine, auch bei neuem Nullwert');
        assertEqual(results[index].newState.marketDataHist.jahreSeitAth, expectedYears, 'Fortschreibung zählt jedes Jahr genau einmal');
    }
}
const accumulation = runYears({ ...runInputs, accumulationPhase: { enabled: true, sparrate: 500, sparrateIndexing: 'none' }, transitionYear: 3 });
const pensionFields = ['rente1', 'rente2', 'renteSum', 'pension_annual'];
for (const result of accumulation.slice(0, 3)) for (const field of pensionFields) {
    assertEqual(result.logData[field], 0, `Ansparjahr ${result.logData.jahr}: ${field} ist exakt null`);
}
close(accumulation[3].logData.renteSum, 36000 * 1.02 ** 3, 'Übergang erhält volle fortgeschriebene Basis');
assert(accumulation.every(result => Math.abs(result.logData.portfolio_flow_delta) < .05), 'Anspar-/Übergangspfad erhält FlowDelta-Vertrag');

// Kontrollierte Renditen: externe Flüsse unabhängig von Rentenspalten prüfen.
const taxInputs = { ...runInputs, partner: { ...runInputs.partner, steuerquotePct: 20 } };
const accumulationInputs = { ...taxInputs, goldAktiv: true, goldZielProzent: 2,
    liquidityRunwayYears: 5, minCashBufferMonths: 2,
    accumulationPhase: { enabled: true, sparrate: 500, sparrateIndexing: 'none' }, transitionYear: 3 };
const controlled = runYears(accumulationInputs, 0);
const euroClose = (actual, expected, label) => assert(Math.abs(actual - expected) < .05, label);
for (let index = 0; index < 3; index++) {
    const { logData: row, newState } = controlled[index];
    for (const field of pensionFields) assertEqual(row[field], 0, `Kontrolliertes Ansparjahr ${index}: ${field} ist null`);
    close(row.cashInterestEarned, row.liqStart * .01, 'Cashzins entspricht genau einem Prozent des Anfangscashs');
    euroClose(row.liquiditaet, row.liqStart + row.cashInterestEarned + 6000 - row.kaufAkt - row.kaufGld - row.steuern_gesamt + row.tax_funding_sale_gross,
        'Cashende enthält Zins und Sparrate abzüglich Käufen und persönlicher Steuer');
    close(row.steuern_gesamt, row.cashInterestEarned * .26375, 'PA-A7: Cashzinssteuer ohne Freibetrag unabhängig nachgerechnet');
    const initialPortfolio = initMcRunState(accumulationInputs);
    const previousTotal = index === 0
        ? initialPortfolio.liquiditaet + initialPortfolio.depotTranchesAktien.reduce((sum, t) => sum + t.marketValue, 0)
            + initialPortfolio.depotTranchesGold.reduce((sum, t) => sum + t.marketValue, 0)
        : controlled[index - 1].logData.portfolio_total_end;
    euroClose(row.portfolio_total_before_accumulation, previousTotal, 'Ohne Anlagerendite bleibt die unabhängige Anfangssumme erhalten');
    euroClose(row.wertAktien + row.wertGold + row.liquiditaet, previousTotal + row.liqStart * .01 + 6000 - row.cashInterestEarned * .26375,
        'Gesamtvermögen steigt um Sparrate und versteuerten Cashzins');
    assert(Math.abs(row.portfolio_flow_delta) < .05, 'Zusätzlicher FlowDelta-Beleg bleibt unter fünf Cent');
    close(newState.currentAnnualPension, 12000 * 1.02 ** (index + 1), 'Volle P1-Basis wird trotz Nullspalten fortgeschrieben');
    close(newState.currentAnnualPension2, 24000 * 1.02 ** (index + 1), 'Volle Partnerbasis wird trotz Nullspalten fortgeschrieben');
}
// Zielorakel aus Fixturebeträgen, fünf Jahren Netto-Runway und zwei Monaten Bruttopuffer.
const targetFor = annualPension => Math.ceil(Math.max((36000 - annualPension) * 5, 6000) / 100) * 100;
const halfGross = (12000 + 24000) * 1.02 ** 2 / 2;
const halfNet = (12000 + 24000 * .8) * 1.02 ** 2 / 2;
const grossTarget = targetFor(halfGross), netTarget = targetFor(halfNet);
assertEqual(grossTarget, 86400, 'Halbe fortgeschriebene Bruttobasen ergeben das unabhängige Juliziel');
assertEqual(netTarget, 98900, 'Frühere Nettogegenrechnung ist numerisch unterscheidbar');
const july = controlled[2].logData;
close(july.liquiditaet + july.steuern_gesamt, grossTarget, 'Juli-Ansparcash erreicht das Ziel vor Partnersteuerquote');
assert(july.kaufAkt > 0 && july.kaufGld > 0, 'Fixture prüft Aktien- und Goldkäufe tatsächlich');
euroClose(july.kaufAkt + july.kaufGld, july.liqStart * 1.01 + 6000 - grossTarget, 'Julikäufe entsprechen ausschließlich dem Zielüberschuss');
// Vor der Korrektur: Cash 98900, Aktien 3886.486, Gold 18424.214.
euroClose(july.kaufGld, (controlled[1].logData.portfolio_total_end + july.cashInterestEarned + 6000) * .02 - controlled[1].logData.wertGold, 'PA-A7: Goldziel folgt dem nach Steuern fortgeschriebenen Vermögen');
euroClose(july.kaufAkt, july.liqStart + july.cashInterestEarned + 6000 - grossTarget - july.kaufGld, 'PA-A7: Aktienkauf erhält den verbleibenden Überschuss');
close(controlled[3].logData.rente1, 12000 * 1.02 ** 3, 'Erstes Entnahmejahr zahlt volle P1-Basis');
close(controlled[3].logData.rente2, 24000 * 1.02 ** 3, 'FR-11: Erstes Entnahmejahr zahlt volle Nettorente');
close(controlled[3].logData.pension_annual, controlled[3].logData.renteSum, 'Entnahmejahr protokolliert tatsächliche Rentensumme');
assert(Math.abs(controlled[3].logData.portfolio_flow_delta) < .05, 'Kontrollierter Übergang erhält FlowDelta');

const legacyInputs = { ...accumulationInputs, renteKalenderbeginn: false,
    partner: { ...accumulationInputs.partner, renteKalenderbeginn: false } };
const legacy = runYears(legacyInputs, 0);
const fullCalendar = runYears({ ...accumulationInputs, renteStartOffsetJahre: 0, renteStartMonate: 12,
    partner: { ...accumulationInputs.partner, startInJahren: 0, renteStartMonate: 12 } }, 0);
for (let index = 0; index < 3; index++) {
    for (const field of ['liquiditaet', 'kaufAkt', 'kaufGld', 'RunwayCoveragePct']) {
        close(fullCalendar[index].logData[field], legacy[index].logData[field], 'Voller Kalenderfaktor erhält Altpfad-Ziel und Kauf-/Cashverteilung');
    }
    euroClose(fullCalendar[index].logData.liquiditaet + fullCalendar[index].logData.steuern_gesamt - fullCalendar[index].logData.tax_funding_sale_gross, targetFor(36000 * 1.02 ** index), 'Volles Kalenderziel verwendet beide Bruttobasen');
}
// Vollständige Belege; FR-11 ändert Zahlbeträge, FR-15 die aktuelle Marktentscheidung.
function projectLegacyFinancialBytes(value) {
    const projection = structuredClone(value);
    // Additive Mindest-Flex-Felder und die FR-12-Planevidenz ausnehmen;
    // sämtliche Finanzwerte und Enginezustände bleiben im gepinnten Vergleich.
    for (const year of Array.isArray(projection) ? projection : [projection]) {
        const state = year.newState || year;
        delete state.guardrailPlanInputs;
        if (state.portfolio) {
            delete state.portfolio.personAccounts;
            delete state.portfolio.healthBucketCashOwners;
            // FR-10 ersetzt diese frueher konstanten Felder; deren Summen prueft der Kontentest.
            state.portfolio.tagesgeld = runInputs.tagesgeld;
            state.portfolio.geldmarktEtf = runInputs.geldmarktEtf;
        }
        if (!year.logData) continue;
        delete year.logData.personalPayout;
        delete year.logData.personAccounts;
        delete year.logData.personalTaxModel;
        delete year.logData.flex_wunsch_haushalt_nominal;
        delete year.logData.flex_unter_mindestflex;
    }
    return projection;
}
const hash = value => createHash('sha256').update(JSON.stringify(projectLegacyFinancialBytes(value))).digest('hex');
// FR-16: In the first legacy accumulation year, person 1 has no cash left.
// Person 0 pays both interest taxes instead of selling 131.875 of person 1's gold.
assertEqual(legacy[0].logData.tax_funding_sale_gross, 0, 'FR-16: Partner-Tagesgeld ersetzt den Gold-Notverkauf im Ansparjahr');
close(legacy[0].logData.liquiditaet, targetFor(36000) - 1000 * .26375,
    'FR-16: Haushaltscash trägt beide persönlichen Zinssteuern');
close(legacy[0].logData.wertGold,
    (legacy[0].logData.portfolio_total_before_accumulation + legacy[0].logData.cashInterestEarned + 6000) * .02,
    'FR-16: Ohne Notverkauf bleibt das gekaufte Goldziel erhalten');
assertEqual(hash(legacy), '2778cf16b7a5605d2806b3f53a6897574d5a4e266aaa0491fd11562faf8b309b', 'FR-16: Alt-Kalenderpfad nutzt Partner-Liquidität für persönliche Ansparsteuer');
const zeroTax = runYears({ ...accumulationInputs, partner: { ...accumulationInputs.partner, steuerquotePct: 0 } }, 0);
assertEqual(JSON.stringify(controlled), JSON.stringify(zeroTax), 'FR-11: Altquote 20 und Nullquote ergeben identische Jahresläufe');
assertEqual(hash(zeroTax), '9eda27c515e6ef5c75dee4f11f043b965013a9a0d68f203ea92aab198b906000', 'PA-A7: Kontrollierter Lauf enthält persönliche Ansparsteuer');
const incoming = runYears(taxInputs)[2].newState;
assertEqual(hash(incoming), 'aa05a3d51cef5e9be55b389a22c6e59bca0a17d949d0ea88e6774dc99aa90704', 'FR-11: Höhere Nettorente senkt die vorherige Vermögensentnahme');
const withdrawal = simulateOneYear(structuredClone(incoming), taxInputs,
    { jahr: 2029, rendite: .03, gold_eur_perf: 0, zinssatz: 1, inflation: 0, lohn: 2 }, 3, null, 0, null, 1, EngineAPI);
assertEqual(hash(withdrawal), '2388d04cec0a3545425162c5843f3580d176fa1928abffc4026547b49267777a', 'PA-A7: Entnahmebeleg enthält persönliche Steuerdiagnose');
const mc = await runMonteCarloChunk({ inputs: runInputs, engine: EngineAPI, useCapeSampling: false,
    widowOptions: { mode: 'none', percent: 0 }, monteCarloParams: { anzahl: 1, maxDauer: 4, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed' } });
assertEqual(mc.totals.failCount, 0, 'Kleiner Monte-Carlo-Lauf transportiert neue Renteneingaben');
const serialized = JSON.stringify(mc);
assert(serialized.includes(String(12000 * 1.02 ** 2 * .5)), 'Monte-Carlo-Beleg enthält anteilige fortgeschriebene P1-Rente');
{
    const { projectScenarioLogV2, serializeScenarioLogCsvV2, serializeScenarioLogExportV2 } = await import('../app/simulator/monte-carlo-export.js');
    const { createPersonOverrides } = await import('../app/simulator/simulator-person-overrides.js');
    const controller = createPersonOverrides(entries.map((entry, index) => ({ ...entry, data: personData((index + 1) * 1000, '2028-07-01') })), '0', 2026);
    controller.activate(true); controller.set('0', 'profile_rentenbeginn', '2026-07-15');
    const alternate = { ...runInputs, ...controller.read().combined, startFloorBedarf: 24000, startFlexBedarf: 12000 };
    const alternativeYears = runYears(alternate);
    close(alternativeYears[0].logData.rente1, 6000, 'Aktive Personenalternative erreicht DOM-freien Jahreslauf');
    const projected = projectScenarioLogV2(mc.worstRun.logDataRows);
    const json = serializeScenarioLogExportV2(projected), csv = serializeScenarioLogCsvV2(projected);
    const records = JSON.parse(json).records;
    for (const index of [2, 3]) for (const field of ['rente1', 'rente2', 'renteSum']) close(records[index][field], years[index].logData[field], 'MC-JSON erhält reale Start-/Folgejahresrente');
    const cells = csv.trim().split(/\r?\n/).map(line => line.split(';'));
    for (const index of [2, 3]) for (const field of ['rente1', 'rente2', 'renteSum']) close(Number(cells[index + 1][cells[0].indexOf(field)]), years[index].logData[field], 'MC-CSV enthält reale Rentenwerte');
    const accumulationRows = controlled.map((result, simulationsJahr) => buildMonteCarloYearLogRow({
        simulationsJahr, result, yearData: { jahr: 2026 + simulationsJahr, inflation: 0 },
        lifeLogContext: { hasPartner: true, p1Alive: true, p2Alive: true }
    }));
    const accumulationSource = JSON.stringify(accumulationRows);
    const accumulationExport = projectScenarioLogV2(accumulationRows);
    const accumulationJson = serializeScenarioLogExportV2(accumulationExport);
    const accumulationCsv = serializeScenarioLogCsvV2(accumulationExport);
    const accumulationRecords = JSON.parse(accumulationJson).records;
    const accumulationCells = accumulationCsv.trim().split(/\r?\n/).map(line => line.split(';'));
    assertEqual(accumulationRecords.length, 4, 'JSON enthält alle drei Ansparjahre und das erste Entnahmejahr');
    assertEqual(accumulationCells.length, 5, 'CSV behält Kopfzeile und vier echte Jahreszeilen');
    for (const field of pensionFields) assert(accumulationCells[0].includes(field), `CSV erhält Feldname ${field}`);
    for (let index = 0; index < 4; index++) {
        assertEqual(accumulationRecords[index].jahr, accumulationRows[index].jahr, 'Export bleibt an die tatsächliche Jahreszeile gebunden');
        for (const field of pensionFields) {
            close(accumulationRecords[index][field], accumulationRows[index][field], 'Anspar-/Übergangs-JSON übernimmt tatsächliche Rentenspalten');
            close(Number(accumulationCells[index + 1][accumulationCells[0].indexOf(field)]), accumulationRows[index][field], 'Anspar-/Übergangs-CSV übernimmt tatsächliche Rentenspalten');
            if (index < 3) assertEqual(accumulationRecords[index][field], 0, 'Anspar-JSON enthält exakt null ohne Exportsonderregel');
        }
    }
    assertEqual(JSON.stringify(accumulationRows), accumulationSource, 'Export verändert keine tatsächlichen Ansparzeilen');
    controller.set('0', 'profile_rentenbeginn', '2029-01-01');
    assertEqual(serializeScenarioLogExportV2(projected), json, 'Neuer Entwurf verändert abgeschlossenen MC-Export nicht');
    assertEqual(serializeScenarioLogExportV2(accumulationExport), accumulationJson, 'Neuer Personenentwurf verändert fertigen Anspar-JSON-Beleg nicht');
    assertEqual(serializeScenarioLogCsvV2(accumulationExport), accumulationCsv, 'Neuer Personenentwurf verändert fertigen Anspar-CSV-Beleg nicht');
}
