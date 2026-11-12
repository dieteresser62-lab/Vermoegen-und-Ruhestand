// HE-5 B1/B4/B5: ausschließlich synthetische Gegenrechnungen aus dem Gutachten.
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, makeDefaultCareMeta, updateCareMeta, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { priceMonteCarloCareForYear } from '../app/simulator/mc-life-events.js';
import { nextYearResidentialNeed } from '../app/simulator/simulator-residential-care.js';
import { survivorLiquidityTarget } from '../app/simulator/simulator-survivor.js';
import { buildCareLogFields } from '../app/simulator/simulator-care-log.js';
import { protocolCareState, protocolCareNotes, protocolResidentialCostChange } from '../app/simulator/protocol-cashflows.js';
import { PROTOCOL_COLUMNS, readProtocolValue } from '../app/simulator/protocol-columns.js';

const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const inputs = { ...structuredClone(fixtureInputs), startFloorBedarf: 36000, survivorFloorPercent: 75,
    home: [], fixedIncome: [], plannedExpenses: [], renteMonatlich: 0, rentAdjMode: 'fix', rentAdjPct: 0,
    partner: { ...fixtureInputs.partner, monatsrente: 0, brutto: 0 },
    pflegefallLogikAktivieren: true, pflegeModellTyp: 'akut', pflegeKostenDrift: 0, pflegeRegionalZuschlag: 0 };
const meta = (grade, extra = {}) => Object.assign(makeDefaultCareMeta(true, 'm'), {
    active: true, triggered: true, grade, gradeLabel: `Pflegegrad ${grade}`, currentYearInCare: 3 }, extra);

// B1: drittes und letztes akutes Pflegejahr, aber erst das erste Heimjahr.
{
    const p2 = meta(4, { durationYears: 3, heimZufall: .3 });
    const state = { ...initMcRunState(inputs), baseFloor: 36000, baseFlex: 0 };
    priceMonteCarloCareForYear(inputs, null, p2, state, 2, false, true, false);
    const household = { p1Alive: false, p2Alive: true, care: { p1: null, p2 } };
    const before = JSON.stringify({ state, household });
    assertEqual(p2.heimJahr, 1, 'B1: Ausgangslage erstes Heimjahr');
    assertEqual(nextYearResidentialNeed(household.care, inputs, 1, 3), 0, 'B1: akutes Ende, keine Heimposten im Folgejahr');
    const target = survivorLiquidityTarget({ state, portfolio: state.portfolio,
        transition: { survivor: { deathYearIndex: 2 } }, inputs: { ...inputs, liquidityRunwayYears: 1 }, household,
        yearIndex: 2, inflationFactor: 1, marketData: {}, pension: {
            nextAnnualPension: 0, nextAnnualPension2: 0, nextWidowPensionP1: 0, nextWidowPensionP2: 0 } });
    assertEqual(target, 27000, 'B1: Folgejahresziel 27.000 statt 42.700 Euro');
    assertEqual(JSON.stringify({ state, household }), before, 'B1: Vorschau verändert weder Zustand noch U/Heimzähler');
    const actual = structuredClone(p2);
    updateCareMeta(actual, inputs, 80, year, () => { throw new Error('Keine Ziehung beim sicheren Pflegeende'); }, state, 3);
    assertEqual(actual.active, false, 'B1: tatsächliches Folgejahr beendet denselben Fall');
    const ongoing = { ...p2, currentYearInCare: 2 };
    assertEqual(nextYearResidentialNeed({ p2: ongoing }, inputs, 1, 3), 42612, 'B1: vor dem Ende nächste Zuschussstufe');
    assertEqual(nextYearResidentialNeed({ p2: { ...p2, initialGrade: 4 } }, inputs, 1, 3), 42612,
        'B1: heutige Pflege bleibt unabhängig von akuter Dauer bestehen');
}

// B4: bekannte heutige Form hat Vorrang vor der gezogenen Standardform.
for (const [grade, form] of [[2, 'home-support'], [3, 'family']]) {
    const official = { ...inputs, pflegeModellTyp: 'chronisch', pflegeKostenStaffelPreset: 'amtlich',
        careToday: { grade, form, progression: 'usual' } };
    const p1 = meta(grade, { initialGrade: grade, heimZufall: .9 });
    const state = initMcRunState(official);
    priceMonteCarloCareForYear(official, p1, null, state, 0, true, false, false);
    const saved = JSON.parse(JSON.stringify(p1));
    assertEqual(saved.careForm, form, `B4 Grad ${grade}: tatsächliche Form im Personenzustand`);
    const row = buildCareLogFields({ hasPartner: false, p1Alive: true, p2Alive: false, careMetaP1: saved, careMetaP2: null });
    assertEqual(row.CareP1_Form, form, `B4 Grad ${grade}: Protokoll übernimmt heutige Form`);
    assertEqual(row.pflege_zusatz_floor, 0, `B4 Grad ${grade}: weiterhin kein Zusatz bei Amtlich`);
    const options = { inputs: { ...official, careToday: { grade, form: 'residential' } } };
    assertEqual(protocolCareState(row, 0, options).form, form, `B4 Grad ${grade}: Hinweis liest gespeicherte Form`);
    assert(protocolCareNotes(row, options)[0].includes(form === 'family' ? 'Angehörige' : 'externe'),
        `B4 Grad ${grade}: Formhinweis passt zur Jahresrechnung`);
    saved.heimZufall = 0;
    const repeated = buildCareLogFields({ hasPartner: false, p1Alive: true, p2Alive: false, careMetaP1: saved, careMetaP2: null });
    assertEqual(repeated.CareP1_Form, form, `B4 Grad ${grade}: Protokoll rekonstruiert nicht aus U`);
}

// B5: Rohspalte bleibt nichtnegativ; die negative Heimkostenänderung steht im Ausgaben-ⓘ.
{
    const p1 = meta(4), state = initMcRunState(inputs), rows = [];
    for (const index of [0, 1]) {
        priceMonteCarloCareForYear(inputs, p1, null, state, index, true, false, false);
        const result = simulateOneYear(state, inputs, year, index, p1, 0,
            { p1Alive: true, p2Alive: false, care: { p1, p2: null } }, 1, EngineAPI);
        rows.push({ ...result.logData, jahr: index + 1 });
    }
    const column = PROTOCOL_COLUMNS.find(item => item.id === 'pflege-zusatz-floor-delta');
    assertEqual(readProtocolValue(column, rows[1], { source: 'mc' }), 0, 'B5: Änderung Pflegebedarf bleibt Rohfeld 0');
    assertEqual(protocolResidentialCostChange(rows[1], 0, { rows }), -3756, 'B5: Ausgaben-ⓘ zeigt −3.756 Euro');
    const contract = readFileSync(new URL('../docs/reference/DATENVERTRAEGE.md', import.meta.url), 'utf8');
    assert(contract.includes('„Änderung Pflegebedarf“ zeigt das Rohfeld `pflege_zusatz_floor_delta`'),
        'B5: Datenvertrag beschreibt die tatsächlich exportierte Rohspalte');
}
