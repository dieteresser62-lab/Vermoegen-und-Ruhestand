import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { INCOME_KEY, writeIncome } from '../app/profile/profile-income.js';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState, prepareHistoricalDataOnce, getDataVersion } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { runSweepChunk } from '../app/simulator/sweep-runner.js';
import { createStressReplayCaptureRequest, materializeStressReplayPathV1 } from '../app/simulator/stress-replay-path-materializer.js';
import { createStressReplayFingerprint } from '../app/simulator/stress-replay-contract.js';
import { runStressReplayPathV1 } from '../app/simulator/stress-replay-runner.js';
import { backtest } from './helpers/ek-1b-measurement.mjs';
import { creditFixedIncomeSurplus } from '../app/simulator/simulator-fixed-income.js';

const fixed = (patch = {}) => ({ id: 'gehalt', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 4000,
    ab: null, bis: null, anpassung: 'keine', ...patch });
const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_geschlecht: 'w',
    profile_rentenbeginn: '2026-07-01', profile_rente_monatlich: '1000', profile_rentenanpassung_art: 'fix',
    profile_rentenanpassung_pct: '0', profile_tagesgeld: '100000', sim_simStartVermoegen: '100000' };
const read = data => buildSimulatorInputsFromProfileData(data, { referenceYear: 2026, planValues: null });
const migrated = read({ ...person, profile_sonstige_einkuenfte: '750' });
assertEqual(migrated.fixedIncome[0].betragMonat, 750, 'FR-42: Übernommene sonstige Einkünfte erreichen den Simulator');
assertEqual(migrated.renteMonatlich, 1000, 'Gesetzliche Rentenbasis bleibt unverändert');
const base = combineSimulatorProfiles(['max', 'erika'].map(profileId => ({ profileId,
    inputs: read({ ...person, profile_rente_monatlich: '0' }) })), 'max').combined;
const inputs = { ...base, startVermoegen: 400000, depotwertAlt: 200000, einstandAlt: 200000,
    startFloorBedarf: 24000, startFlexBedarf: 12000, minimumFlexAnnual: 0, dynamicFlex: false,
    goldAktiv: false, pflegefallLogikAktivieren: false, healthBucket: { enabled: false }, rentAdjPct: 0,
    fixedIncome: [fixed({ profileId: 'erika' })], fixedIncomeReferenceYear: 2026 };
const empty = { ...inputs }; delete empty.fixedIncome; delete empty.fixedIncomeReferenceYear;
const same = (a, b, label) => assertEqual(JSON.stringify(a), JSON.stringify(b), label);
const close = (a, b, label) => assertClose(a, b, 1e-6, label);
const ownedWealth = (portfolio, id) => (portfolio.personAccounts.find(p => p.profileId === id)?.tagesgeld || 0)
    + [...portfolio.depotTranchesAktien, ...portfolio.depotTranchesGold, ...portfolio.depotTranchesGeldmarkt]
        .filter(lot => lot.sourceProfileId === id).reduce((sum, lot) => sum + lot.marketValue, 0);
const year = (state, input = inputs, index = 0, household = null, data = {}) => simulateOneYear(state, input,
    { jahr: 2000 + index, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0, ...data },
    index, null, 0, household, 1, EngineAPI);
prepareHistoricalDataOnce();
{
    const history = backtest(inputs, 2000, 2001);
    close(history.rows[0].row.sonstige_einkuenfte, 48000, 'Backtest verwendet dieselben kalendarischen Einkünfte im historischen Startjahr');
}
{
    // Cash-only: konstanter VPW-Zins 0,5 %, 30 Jahre; kein Verkauf oder Zinscashflow.
    // Vorab gutgeschriebene 2.800 EUR gehören bereits zur VPW-Vermögensbasis.
    const rate = .005 / (1 - Math.pow(1.005, -30));
    const cash = 9600 / rate - 2800;
    const exact = { ...inputs, startFloorBedarf: 22000, startFlexBedarf: 8000,
        dynamicFlex: true, horizonYears: 30,
        fixedIncome: [fixed({ profileId: 'erika', betragMonat: 3400 })] };
    const state = initMcRunState(exact, 0);
    Object.assign(state.portfolio, { depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [],
        tagesgeld: cash, geldmarktEtf: 0, liquiditaet: cash,
        personAccounts: state.portfolio.personAccounts.map(p => ({ ...p, tagesgeld: cash / 2, geldmarktEtf: 0 })) });
    const result = year(state, exact);
    assertEqual(result.kind, 'success', 'Überschussfall mit tatsächlich aktivem VPW läuft');
    assertEqual(result.ui.vpw.enabled, true, 'VPW bleibt beim Überschuss aktiv');
    close(result.logData.flex_haushalt_erfuellt, 9600, 'Dynamic Flex verbraucht 1,2 × Wunsch-Flex statt der pauschalen Obergrenze');
    close(result.logData.einkuenfte_gespart, 9200, '40.800 − 22.000 − 9.600 EUR werden vollständig gespart');
    close(portfolioTotal(result.newState.portfolio) - cash, 9200, 'Der vollständige VPW-Rest erhöht das Vermögen genau einmal');
    close(ownedWealth(result.newState.portfolio, 'erika') - cash / 2, 9200, 'VPW-Rest bleibt auch nach Überschusskäufen Erikas Vermögen');
    close(result.logData.portfolio_flow_delta, 0, 'VPW-Rest verursacht keinen ungeklärten Vermögensfluss');
}
{
    const pensionInputs = { ...empty, startFloorBedarf: 22000, startFlexBedarf: 8000,
        renteMonatlich: 2500, renteStartOffsetJahre: 0, renteStartMonate: 12,
        partner: { ...empty.partner, aktiv: true, monatsrente: 1500, brutto: 18000, startInJahren: 0, renteStartMonate: 12 } };
    const state = initMcRunState(pensionInputs, 0);
    const before = portfolioTotal(state.portfolio);
    const result = year(state, pensionInputs);
    close(result.logData.einkuenfte_gespart, 18000, 'Rente allein über Grundbedarf und Flex wird gespart');
    close(backtest(pensionInputs, 2000, 2001).rows[0].row.einkuenfte_gespart, 18000, 'Backtest bucht auch reine Rentenüberschüsse');
    close(portfolioTotal(result.newState.portfolio) - before, 18000, 'Rentenrest erhöht das Gesamtvermögen exakt');
    close(result.logData.einkuenfte_gespart_personen.find(p => p.profileId === 'max').amount, 11250, 'Max erhält den Rentenüberschuss anteilig zu seiner Rente');
    close(result.logData.einkuenfte_gespart_personen.find(p => p.profileId === 'erika').amount, 6750, 'Erika erhält ihren Rentenanteil');
    close(result.logData.flex_haushalt_erfuellt, 8000, 'Gesparte Rente zählt nicht zusätzlich als verbrauchter Flex');
    close(result.logData.portfolio_flow_delta, 0, 'Rentenrest verursacht keinen ungeklärten Vermögensfluss');
    const portfolio = { personAccounts: [{ profileId: 'max', tagesgeld: 0 }, { profileId: 'erika', tagesgeld: 0 }], depotTranchesGeldmarkt: [] };
    const pension = { pensionAnnual: 48000, rente1: 30000, rente2: 18000 };
    const first = creditFixedIncomeSurplus(portfolio, null, pension, 22000, 8000, false, pensionInputs);
    creditFixedIncomeSurplus(portfolio, null, pension, 22000, 8000, false, pensionInputs, first);
    close(portfolio.liquiditaet, 18000, 'Wiederholter Abgleich bucht eine bereits gutgeschriebene Rente nicht doppelt');
}
{
    const original = initMcRunState(inputs, 0), before = portfolioTotal(original.portfolio);
    const beforeMax = ownedWealth(original.portfolio, 'max');
    const result = year(original);
    assertEqual(result.kind, 'success', 'Einkünftejahr läuft mit der echten Engine');
    close(result.logData.sonstige_einkuenfte, 48000, 'Ganzjähriges Gehalt netto');
    close(result.logData.einkuenfte_gespart, 12000, 'Gehalt über Grundbedarf und Flex wird gespart');
    close(portfolioTotal(result.newState.portfolio) - before, 12000, 'Ohne Marktbewegung steigt das Vermögen exakt um Einkünfte minus Bedarf');
    const erikaAssets = result.newState.portfolio.depotTranchesAktien.filter(lot => lot.sourceProfileId === 'erika').reduce((sum, lot) => sum + lot.marketValue, 0);
    close(result.newState.portfolio.personAccounts.find(p => p.profileId === 'erika').tagesgeld + erikaAssets, 112000, 'Überschuss und daraus gekaufte Anlagen gehören Erika');
    close(ownedWealth(result.newState.portfolio, 'max'), beforeMax, 'Max erhält auch nach Überschussanlage keine fremden Einkünfte');
    close(result.logData.pension_annual, 0, 'Gehalt wird nicht als gesetzliche Rente protokolliert');
    close(result.logData.portfolio_flow_delta, 0, 'Kein ungeklärter Vermögensfluss');
    same(year(initMcRunState(empty, 0), empty), year(initMcRunState(empty, 0), { ...empty, fixedIncome: [] }), 'Ohne feste Einkünfte bleibt das gesamte Jahresresultat bytegleich');
}
{
    const transition = { ...inputs, fixedIncome: [fixed({ profileId: 'max', bis: '2026-06' })], renteMonatlich: 1000, renteStartOffsetJahre: 0, renteStartMonate: 6 };
    const first = year(initMcRunState(transition, 0), transition);
    close(first.logData.sonstige_einkuenfte, 24000, 'Gehalt endet einschließlich Juni');
    close(first.logData.rente1, 6000, 'Unveränderte Rente ab Juli');
    close(first.logData.floor_aus_depot, 0, 'Gehalt und Rente decken gemeinsam zuerst den Grundbedarf');
    close(first.logData.flex_rentenueberschuss, 6000, 'Verbleibende Einkünfte decken Flex');
    const second = year(first.newState, transition, 1);
    assert(!second.logData.sonstige_einkuenfte, 'Nach dem Endmonat entfällt das Gehalt');
    close(second.logData.rente1, 12000, 'Rente zählt im Folgejahr vollständig');
    const limited = { ...inputs, fixedIncome: [fixed({ profileId: 'erika', ab: '2026-10', bis: '2027-02' })] };
    const start = year(initMcRunState(limited, 0), limited);
    close(start.logData.sonstige_einkuenfte, 12000, 'Drei Monate im ersten Jahr');
    close(year(start.newState, limited, 1).logData.sonstige_einkuenfte, 8000, 'Zwei Monate im letzten Jahr');
}
for (const [mode, expected] of [['keine', 48000], ['inflation', 48960], ['lohn', 49920]]) {
    const indexed = { ...inputs, fixedIncome: [fixed({ profileId: 'erika', anpassung: mode })] };
    const first = year(initMcRunState(indexed, 0), indexed, 0, null, { inflation: 2, lohn: 4 });
    close(first.logData.sonstige_einkuenfte, 48000, `${mode}: keine Anpassung im ersten Jahr`);
    const second = year(first.newState, indexed, 1, null, { inflation: 3, lohn: -1 });
    close(second.logData.sonstige_einkuenfte, expected, `${mode}: Vorjahresrate gilt ab dem Folgejahr`);
    close(year(second.newState, indexed, 2).logData.sonstige_einkuenfte, expected * (mode === 'inflation' ? 1.03 : 1), `${mode}: wechselnde Raten werden verkettet, Lohnrückgänge geschützt`);
}
{
    const indexed = { ...inputs, fixedIncome: [fixed({ profileId: 'erika', anpassung: 'lohn' })] };
    const first = year(initMcRunState(indexed, 0), indexed, 0, null, { lohn: -9.7 });
    const second = year(first.newState, indexed, 1, null, { lohn: 2 });
    close(second.logData.sonstige_einkuenfte, 48000, 'FR-42: −9,7 % Vorjahreslohn senkt die Einkunft nicht');
    close(year(second.newState, indexed, 2).logData.sonstige_einkuenfte, 48960, 'FR-42: +2 % Vorjahreslohn erhöht die Einkunft ohne Nachholung');
}
for (const deceased of ['max', 'erika']) {
    const deathInputs = { ...inputs, fixedIncome: [fixed({ profileId: deceased })] };
    const household = { p1Alive: deceased !== 'max', p2Alive: deceased !== 'erika', widowBenefits: { p1FromP2: true, p2FromP1: true, p1FromP2Percent: .6, p2FromP1Percent: .6 } };
    const death = year(initMcRunState(deathInputs, 0), deathInputs, 0, household);
    close(death.logData.sonstige_einkuenfte, 24000, 'Im Sterbejahr zählen sonstige Einkünfte zur Hälfte');
    close(death.logData.renteSum, 0, 'Aus Gehalt entsteht keine Witwenrente');
    const after = year(death.newState, deathInputs, 1, household);
    assert(!after.logData.sonstige_einkuenfte, 'Ab dem Folgejahr endet das persönliche Einkommen');
    close(after.logData.renteSum, 0, 'Auch später keine Gehalts-Witwenrente');
}
{
    const high = { ...inputs, fixedIncome: [fixed({ profileId: 'erika', betragMonat: 20000 })] };
    const result = year(initMcRunState(high, 0), high);
    assert(result.logData.kaufAkt > 0, 'Die vorhandene Überschussregel legt Einkommen oberhalb des Runway-Ziels an');
    close(portfolioTotal(result.newState.portfolio), 604000, 'Anlegen verändert die Höhe des gesparten Überschusses nicht');
    const dynamicInputs = { ...inputs, dynamicFlex: true, fixedIncome: [fixed({ profileId: 'erika', betragMonat: 3500 })] };
    const dynamic = year(initMcRunState(dynamicInputs, 0), dynamicInputs);
    assert(dynamic.logData.jahresentnahme_real > 0, 'Dynamic Flex kann trotz gedecktem Wunschbedarf aus dem Depot entnehmen');
    assert(dynamic.logData.flex_haushalt_erfuellt <= 24000 + 1e-6, 'FR-26 begrenzt Einkommen plus Depotflex auf doppelten Wunsch-Flex');
    const saturatedInputs = { ...high, dynamicFlex: true };
    const saturated = year(initMcRunState(saturatedInputs, 0), saturatedInputs);
    close(saturated.logData.jahresentnahme_real, 0, 'Einkommen deckt auch die Dynamic-Flex-Obergrenze vollständig');
    close(saturated.logData.einkuenfte_gespart, 192000, 'Über der Dynamic-Flex-Obergrenze wird gespart');
    const suppressedState = initMcRunState({ ...inputs, dynamicFlex: true }, 0);
    const suppressedWealth = portfolioTotal(suppressedState.portfolio);
    Object.assign(suppressedState.lastState, { initialized: true, flexRate: 100, vpwSafetyStage: 2, vpwLastDynamicFlex: 0 });
    const suppressed = year(suppressedState, { ...inputs, dynamicFlex: true });
    close(suppressed.logData.einkuenfte_gespart, 12000, 'Unterdrücktes Dynamic Flex lässt keinen Einkommensrest verschwinden');
    close(portfolioTotal(suppressed.newState.portfolio) - suppressedWealth, 12000, 'Auch in Sicherheitsstufe 2 gilt genau Einkünfte minus Bedarf');
}
for (const patch of [{ betragMonat: -1 }, { bis: '2025-01', ab: '2026-01' }, { profileId: 'aussen' }, { anpassung: 'fremd' }]) {
    let error; try { validateSimulatorInputs({ ...inputs, fixedIncome: [fixed({ profileId: 'erika', ...patch })] }); } catch (caught) { error = caught; }
    assert(error?.name === 'SimulatorValidationError', 'Ungültige Einkünfte blockieren den Lauf');
}
for (const scenario of [inputs, { ...empty, renteMonatlich: 4000, renteStartOffsetJahre: 0, renteStartMonate: 12 }]) {
    const inputs = scenario;
    const merged = combineSimulatorProfiles(['max', 'erika'].map(profileId => ({ profileId, inputs: read({ ...person, [INCOME_KEY]: writeIncome([fixed()]) }) })), 'erika').combined;
    same(merged.fixedIncome.map(row => row.profileId), ['erika', 'max'], 'Haushaltsauswahl und Hauptperson bestimmen Einkunftseigentümer');
    const params = { anzahl: 2, maxDauer: 6, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };
    const request = { inputs, widowOptions: inputs.widowOptions, monteCarloParams: params, useCapeSampling: false };
    const source = await runMonteCarloChunk({ ...request, runRange: { start: 0, count: 2 }, logIndices: [0, 1], stressReplayCapture: createStressReplayCaptureRequest([0]), engine: EngineAPI });
    assertEqual(source.technicalInventory.technicalError, 0, 'Monte Carlo rechnet feste Einkünfte ohne technische Fehler');
    const meta = source.runMeta.find(row => row.index === 0);
    close(meta.logDataRows[0].sonstige_einkuenfte, inputs.fixedIncome ? 48000 : 0, 'Gemeinsamer MC-Jahresweg trennt Gehalt und Rente');
    close(meta.logDataRows[0].einkuenfte_gespart, 12000, 'Gemeinsamer MC-Jahresweg spart den gesamten Gehalts- oder Rentenrest');
    const path = materializeStressReplayPathV1({ capture: meta.stressReplayCapture, sourceLogRows: meta.logDataRows, sourceRequest: request,
        dataFingerprint: createStressReplayFingerprint({ dataVersion: getDataVersion() }), engineFingerprint: createStressReplayFingerprint({ engineVersion: EngineAPI.version }), scenarioKey: 'ek-1b', selectionMetric: 'nominal_terminal_wealth_eur' });
    assertEqual(runStressReplayPathV1({ path, baselineInputs: inputs, sourceScenarioLog: meta.logDataRows, engine: EngineAPI }).reconciliation.matched, true, 'Schatten-/Stress-Replay rechnet Einkommen im selben Jahrespfad');
    const boundary = [];
    const sweep = runSweepChunk({ baseInputs: inputs, paramCombinations: [{ liquidityRunwayYears: 5 }], sweepConfig: { anzahlRuns: 2, maxDauer: 6, blockSize: 3, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed' },
        engine: { ...EngineAPI, simulateSingleYear(input, ...args) { boundary.push(input); return EngineAPI.simulateSingleYear(input, ...args); } } });
    assertEqual(sweep.results[0].metrics.comparison.runCount, 2, 'Sweep rechnet beide Pfade');
    assert(boundary.some(input => input.renteMonatlich >= 4000), 'Sweep übergibt feste Einkünfte an denselben Engine-Nettovertrag');
}
