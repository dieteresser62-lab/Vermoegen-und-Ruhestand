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
close(taxCase.rente2, 24000 / 12 * .8, 'Partnerquote wirkt nach eigenem Monatsanteil');
for (const [date, expected] of [['2026-07-15', 6000], ['2024-07-01', 12000], ['', 12000], ['2026-01-01', 12000]]) {
    const input = buildSimulatorInputsFromProfileData(personData(1000, date), { referenceYear: 2026 });
    close(calculateHouseholdPensionForYear({ inputs: input, yearIndex: 0, currentAnnualPension: 12000 }).rente1, expected, 'Offset 0 berücksichtigt nur einen aktuellen Teiljahresbeginn');
}
const widow = calculateHouseholdPensionForYear({ inputs, yearIndex: 2, currentAnnualPension: 12000, currentAnnualPension2: 24000,
    p2Alive: false, widowBenefits: { p1FromP2: true, p1FromP2Percent: .6 } });
close(widow.widowBenefitP1ThisYear, 14400, 'Hinterbliebenenregel verwendet weiterhin volle Basis');
close(widow.rente1, 20400, 'Nur eigene Rente erhält neuen Zeitanteil');
assert(!areP2InvariantsEqual(extractP2Invariants(inputs), extractP2Invariants({ ...inputs, partner: { ...inputs.partner, renteStartMonate: 12 } })), 'Partnerinvariante schützt wirksame Rentenmonate');
for (const months of [0, 13, 6.5, '6']) { let error; try { pensionPaymentFactor(0, 0, months); } catch (cause) { error = cause; } assert(error, 'Ungültiger Monatszusatz wird abgewiesen'); }

// Echter DOM-freier Jahreslauf: fortgeschriebene Basis und vollständiger Übergang.
prepareHistoricalDataOnce();
const runInputs = { ...inputs, startVermoegen: 900000, depotwertAlt: 500000, einstandAlt: 350000,
    tagesgeld: 100000, geldmarktEtf: 0, startFloorBedarf: 24000, startFlexBedarf: 12000,
    minimumFlexAnnual: 0, goldAktiv: false, dynamicFlex: false, healthBucket: { enabled: false } };
function runYears(input, annualReturns = .03) {
    let state = { portfolio: initMcRunState(input), baseFloor: 24000, baseFlex: 12000,
        currentAnnualPension: 12000, currentAnnualPension2: 24000, marketDataHist: { endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: 0, capeRatio: 20 }, lastState: null };
    const results = [];
    for (let index = 0; index < 4; index++) {
        const result = simulateOneYear(state, input, { jahr: 2026 + index, rendite: annualReturns, gold_eur_perf: 0, zinssatz: 1, inflation: 0, lohn: 2 }, index, null, 0, null, 1, EngineAPI);
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
    euroClose(row.liquiditaet, row.liqStart + row.cashInterestEarned + 6000 - row.kaufAkt - row.kaufGld,
        'Cashende enthält ausschließlich Zins und Sparrate abzüglich beider Käufe');
    const initialPortfolio = initMcRunState(accumulationInputs);
    const previousTotal = index === 0
        ? initialPortfolio.liquiditaet + initialPortfolio.depotTranchesAktien.reduce((sum, t) => sum + t.marketValue, 0)
            + initialPortfolio.depotTranchesGold.reduce((sum, t) => sum + t.marketValue, 0)
        : controlled[index - 1].logData.portfolio_total_end;
    euroClose(row.portfolio_total_before_accumulation, previousTotal, 'Ohne Anlagerendite bleibt die unabhängige Anfangssumme erhalten');
    euroClose(row.wertAktien + row.wertGold + row.liquiditaet, previousTotal + row.liqStart * .01 + 6000,
        'Gesamtvermögen steigt nur um bekannten Cashzins und Sparrate');
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
assertEqual(july.liquiditaet, grossTarget, 'Juli-Ansparcash erreicht das Ziel vor Partnersteuerquote');
assert(july.kaufAkt > 0 && july.kaufGld > 0, 'Fixture prüft Aktien- und Goldkäufe tatsächlich');
euroClose(july.kaufAkt + july.kaufGld, july.liqStart * 1.01 + 6000 - grossTarget, 'Julikäufe entsprechen ausschließlich dem Zielüberschuss');
// Vor der Korrektur: Cash 98900, Aktien 3886.486, Gold 18424.214.
euroClose(july.kaufGld, 18424.214, 'Goldkauf bleibt bei unveränderter Goldzielbasis erhalten');
euroClose(july.kaufAkt, 3886.486 + netTarget - grossTarget, 'Zusätzlicher Aktienkauf entspricht genau der Zielkorrektur');
close(controlled[3].logData.rente1, 12000 * 1.02 ** 3, 'Erstes Entnahmejahr zahlt volle P1-Basis');
close(controlled[3].logData.rente2, 24000 * 1.02 ** 3 * .8, 'Erstes Entnahmejahr behält die Partnersteuerquote');
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
    assertEqual(fullCalendar[index].logData.liquiditaet, targetFor(36000 * 1.02 ** index), 'Volles Kalenderziel verwendet beide Bruttobasen');
}
// Auf HEAD 721fa5f1 vor der Produktänderung gesichert; vollständige Belege, keine Fremdbaseline.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assertEqual(hash(legacy), '671c34ba8c7130b510b80288de1096bcb83d1eccc05a6a6fc24d6a3c996b855f', 'Vollständiger Altpfad bleibt bytegleich');
const zeroTax = runYears({ ...accumulationInputs, partner: { ...accumulationInputs.partner, steuerquotePct: 0 } }, 0);
assertEqual(hash(zeroTax), 'e7dcbc508aca94dd90322dc4744f1287a89d22a8d9d380867d81fe0b5de3668c', 'Nullquote erhält vollständigen Lauf bis auf ausdrücklich korrigierte Rentenspalten');
const incoming = runYears(taxInputs)[2].newState;
assertEqual(hash(incoming), '028c08cc0bf813e2dac53af2ac163691cf5d6824385c734a2749c21a51db587c', 'Gesicherter eingehender Entnahmezustand ist identisch');
const withdrawal = simulateOneYear(structuredClone(incoming), taxInputs,
    { jahr: 2029, rendite: .03, gold_eur_perf: 0, zinssatz: 1, inflation: 0, lohn: 2 }, 3, null, 0, null, 1, EngineAPI);
assertEqual(hash(withdrawal), 'b8bf92bbb31751360357423e97d4779bfb1212bab3c4c779d5ebcbe9d7f741ee', 'Vollständiger Entnahmejahresbeleg bleibt für gleichen eingehenden Zustand unverändert');
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
