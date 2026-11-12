import { installRealClock } from './helpers/fixed-real-clock.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE, DEFAULT_MUSTER_HAUSHALT } from '../app/demo/muster-haushalte.js';
import { incomeFromRecord } from '../app/profile/profile-income.js';
import { PLANNED_EXPENSES_KEY, readPlannedExpenses } from '../app/profile/household-planned-expenses.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { buildPlanOverview } from '../app/simulator/simulator-plan-overview.js';
import { readDocumentPersonInputs } from '../app/simulator/simulator-person-overrides.js';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { createAnnualActionResult } from '../app/shared/annual-close-result.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';

const restoreRealClock = installRealClock('2031-06-15');
const saved = { document: globalThis.document, window: globalThis.window };
try {
    assertEqual(DEFAULT_MUSTER_HAUSHALT, 'max-erika', 'Die bisherige Voreinstellung bleibt erhalten');
    assert(MUSTER_HAUSHALTE.some(item => item.id === 'sophie' && item.title === 'Die letzten Berufsjahre bewusst gestalten'), 'Sophie steht in der Spielbereich-Auswahl');
    for (const date of ['2026-01-01', '2026-10-21', '2031-06-15']) {
        setAppTestDate(date);
        const records = createMusterHaushaltRecords(date, 'sophie'), year = Number(date.slice(0, 4));
        const registry = JSON.parse(records.rs_profiles_v1), person = registry.profiles.muster_sophie.data;
        assertEqual(Object.keys(registry.profiles).join(), 'muster_sophie', 'Sophie hat genau ein eigenes Profil');
        assertEqual(records.rs_active_profile, 'muster_sophie', 'Sophie ist aktiv');
        assertEqual(person.profile_geburtsdatum, `${year - 55}-01-01`, 'Geburtsjahr folgt der relativen Musterzeitachse');
        assertEqual(person.profile_rentenbeginn, `${year + 12}-01-01`, 'Rente beginnt zwölf Jahre nach dem Start');
        assertEqual(person.profile_rente_monatlich, '1500', 'Nettorente beträgt 1.500 Euro');
        assertEqual(person.profile_tagesgeld, '15000', 'Tagesgeld beträgt 15.000 Euro');
        const lots = JSON.parse(person.depot_tranchen);
        assertEqual(lots.length, 1, 'Genau ein Aktien-ETF ohne Altbestand oder weitere Anlagen');
        assertEqual(lots[0].type, 'aktien_neu', 'ETF ist steuerlicher Neubestand');
        assertClose(lots[0].shares * lots[0].currentPrice, 90000, 1e-8, 'Depotwert beträgt 90.000 Euro');
        const [salary] = incomeFromRecord(person);
        assertEqual(salary.betragMonat, 3400, 'Nettogehalt beträgt 3.400 Euro');
        assertEqual(salary.bis, `${year + 11}-12`, 'Gehalt endet im Monat vor der Rente');
        assertEqual(salary.anpassung, 'lohn', 'Gehalt folgt den Löhnen');
        assertEqual(records.profile_einkuenfte_v1, person.profile_einkuenfte_v1, 'Liveprofil und Registry enthalten dieselben Einkünfte');
        const [plan] = Object.values(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries);
        assertEqual(plan.scope.kind, 'single', 'Plan und Ausgaben gehören zum Einzelhaushalt');
        assertEqual(plan.values.floorBedarf, 22000, 'Grundbedarf beträgt 22.000 Euro');
        assertEqual(plan.values.flexBedarf, 8000, 'Wunsch-Flex beträgt 8.000 Euro');
        assertEqual(plan.values.minimumFlexAnnual, 2000, 'Mindest-Flex beträgt 2.000 Euro');
        assertEqual(plan.values.maxSkimPctOfEq, 10, 'Sophie verwendet die App-Vorgabe 10 % Abschöpfen');
        assertEqual(plan.values.maxBearRefillPctOfEq, 5, 'Sophie verwendet die App-Vorgabe 5 % Bärenauffüllung');
        const [receipt] = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries);
        const cash = receipt.adopted.action.quellen.find(source => source.kind === 'liquiditaet');
        assertEqual(cash.sourceProfileId, 'muster_sophie', 'Musterbeleg hält die einzige Person an der Quelle fest');
        assertEqual(cash.sourceProfileName, 'Sophie', 'Musterbeleg hält den Namen fest');
        const storage = { getItem: key => records[key] ?? null };
        const comparison = projectHouseholdPlanComparison({ year, scope: plan.scope, storage });
        const origin = projectBalanceActionOrigin({ comparison, year, scope: plan.scope });
        const { doc } = createDialogFixture();
        const rendered = createAnnualActionResult({ doc, result: origin.confirmed });
        assert(dialogElements(rendered).some(node => node.textContent.replaceAll('\u00a0', ' ') === 'Sophie: 9.400,00 € netto'), 'Balance-Handlungsanweisung zeigt Sophie und den Nettobetrag nach dem Ratenkredit im Grundbedarf (GA-2)');
        const [auto] = readPlannedExpenses({ scope: plan.scope, storage: { getItem: key => records[key] ?? null } });
        assertEqual(auto.monat, `${year + 3}-04`, 'Auto wird in drei Jahren geplant');
        assertEqual(auto.betrag, 25000, 'Auto kostet 25.000 Euro in heutigen Preisen');
        assertEqual(auto.bezeichnung, 'Auto', 'Geplante Ausgabe ist verständlich benannt');
        assert(!Object.hasOwn(person, PLANNED_EXPENSES_KEY), 'Ausgaben liegen nur im gemeinsamen Planbestand');
    }

    const inputs = await measurementInputs(0, 'sophie');
    const people = readDocumentPersonInputs(document);
    const view = buildPlanOverview({ inputs, entries: people.entries, referenceYear: 2026, inflationPct: 2 });
    const salary = view.groups.findIndex(group => !group.pension), pension = view.groups.findIndex(group => group.pension);
    assertEqual(view.rows.length, 14, 'Übersicht umfasst Ansparphase, Rentenbeginn und Folgejahr innerhalb von 15 Zeilen');
    assertEqual(view.rows[0].incomes[salary], 40800, 'Simulator übernimmt das volle Jahresgehalt');
    assertEqual(view.rows[0].result, 7200, 'Erstes Jahr spart 7.200 Euro nach Grundbedarf mit Ratenkredit und Wunsch-Flex (GA-2)');
    assertClose(view.rows[3].expenses, 25000 * 1.02 ** 3, 1e-6, 'Übersicht schreibt den Autokauf mit Inflation fort');
    assert(view.rows[3].result < 0, 'Das Auto benötigt im Zahlungsjahr Vermögen');
    assert(view.rows.filter(row => row.year < 2038 && row.year !== 2029).every(row => row.result > 0), 'Alle übrigen Gehaltsjahre sind Ansparjahre');
    assertEqual(view.rows[11].incomes[pension], 0, 'Vor 2038 gibt es keine Rente');
    assertEqual(view.rows[12].incomes[salary], 0, 'Ab 2038 entfällt das Gehalt');
    // GU-1 (FR-74): Beispielhaushalte passen die Rente „wie Inflation“ an.
    assertClose(view.rows[12].incomes[pension], 18000 * 1.02 ** 12, 1e-6, 'Ab 2038 gilt die volle mit der Inflation fortgeschriebene Jahresrente');
    assert(view.rows.slice(12).every(row => row.result < 0), 'Rentenjahre zeigen Entnahmen aus dem Vermögen');

    // Derselbe Haushaltsdatensatz läuft ohne Marktbewegung und ohne Fondskosten (FR-76) durch die produktive Jahresrechnung.
    const flowInputs = { ...inputs, equityCostPct: 0 };
    let state = initMcRunState(flowInputs, 0);
    for (let index = 0; index < 14; index++) {
        const before = portfolioTotal(state.portfolio);
        const result = simulateOneYear(state, flowInputs,
            { jahr: 2000 + index, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 },
            index, null, 0, null, 1, EngineAPI);
        assertEqual(result.kind, 'success', `Sophie: Finanzjahr ${2026 + index} rechnet ohne Abbruch`);
        if (index === 0) assertClose(portfolioTotal(result.newState.portfolio) - before, 7200, 1e-6, 'Gehaltüberschuss nach Ratenkredit im Grundbedarf erreicht das Vermögen genau einmal (GA-2)');
        if (index === 0) assertClose(result.logData.floor_brutto, 22000 + 3600, 1e-6, 'Ratenkredit zählt zum Grundbedarf (GA-2)');
        if (index === 3) assertClose(result.logData.geplante_ausgaben, 25000, 1e-6, 'Jahresrechnung bezahlt den Autokauf');
        if (index >= 12) {
            assertEqual(result.logData.sonstige_einkuenfte ?? 0, 0, 'Rentenjahr zählt kein Gehalt mehr');
            assert(portfolioTotal(result.newState.portfolio) < before, 'Rentenjahr entnimmt tatsächlich aus dem Vermögen');
        }
        state = result.newState;
    }
} finally {
    Object.assign(globalThis, saved);
    setAppTestDate(null);
    P.resetPersistenceForTests();
}
restoreRealClock();
