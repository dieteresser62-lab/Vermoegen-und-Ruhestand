import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createParityCase, replayParityCase, sealParityCase, validateParityCase } from '../../app/balance/parity-case.js';
import { compareParityYear, parityPrePayoutEvidence, parityLegacyTqfOptions, parityTaxSourcePriceTie } from '../../app/balance/parity-year-comparison.js';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { sealParityReplayLog, restoreParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { canonicalParityAction, canonicalParityLots, compareParityField, compareParityTree, parityMeasurement,
    PARITY_PHASES, summarizeParityFields } from '../../app/shared/parity-compare.js';
import { EngineAPI } from '../../engine/index.mjs';
import { inputs, records, source, recordBytes, runFixture } from './parity-replay-fixture.mjs';

export function testParityComparison() {
    let checks = 0;
    const equal = (a, b, message) => { assert.deepStrictEqual(a, b, message); checks++; };
    const ok = (a, message) => { assert.ok(a, message); checks++; };
    const compare = (a, b, tolerance = 'EUR', options = {}) => compareParityField({ id: 'probe', phase: 'VOR_TRANSAKTION', tolerance,
        simulator: parityMeasurement(a, { phase: 'VOR_TRANSAKTION', path: 'simulator.probe', zeroWithdrawal: options.zeroWithdrawal }),
        balance: parityMeasurement(b, { phase: 'VOR_TRANSAKTION', path: 'balance.probe', zeroWithdrawal: options.zeroWithdrawal }), ...options });
    const tieLots = [{ sourceProfileId: 'a', trancheId: 'a:lot', category: 'equity', marketValue: 1000, costBasis: 500, tqf: 0 },
        { sourceProfileId: 'b', trancheId: 'b:lot', category: 'equity', marketValue: 1000, costBasis: 500, tqf: 0 }];
    const tieInput = { householdWithdrawalMode: 'tax_optimized', detailledTranches: tieLots };
    const priceInput = structuredClone(tieInput); priceInput.detailledTranches[1].costBasis += 1e-13;
    const tieAction = { quellen: [{ sourceProfileId: 'a', trancheId: 'a:lot', brutto: 100, netto: 100, steuer: 0 }] };
    const priceAction = { quellen: [{ sourceProfileId: 'b', trancheId: 'b:lot', brutto: 100, netto: 100, steuer: 0 }] };
    equal(parityTaxSourcePriceTie(tieInput, priceInput, tieAction, priceAction), true, 'Preisumrechnung kann eine gleiche Steuerquote umordnen');
    const wrongTaxAction = structuredClone(priceAction); wrongTaxAction.quellen[0].steuer = 1;
    equal(parityTaxSourcePriceTie(tieInput, priceInput, tieAction, wrongTaxAction), false, 'Haushaltssteuerabweichung erhält keine Ausnahme');
    const wrongCostInput = structuredClone(priceInput); wrongCostInput.detailledTranches[1].costBasis += .01;
    equal(parityTaxSourcePriceTie(tieInput, wrongCostInput, tieAction, priceAction), false, 'Echte Kostenabweichung erhält keine Ausnahme');
    equal(parityTaxSourcePriceTie(tieInput, tieInput, tieAction, priceAction), false, 'Ohne geänderte Quote bleiben Quellenabweichungen Fehler');
    equal(parityLegacyTqfOptions('tqfAlt', {}, {}), {}, 'Ohne Einzeltranchen bleibt Legacy-TQF vergleichsrelevant');
    equal(parityLegacyTqfOptions('tqfAlt', { detailledTranches: [] }, {}), {}, 'Einseitige Lotliste genügt nicht');
    equal(parityLegacyTqfOptions('tqfAlt', { detailledTranches: [] }, { detailledTranches: [] }).status,
        'NICHT_ANWENDBAR', 'Bei zwei Lotlisten gelten die Steuermetadaten je Lot');
    const changedTqf = compareParityTree({ id: 'input.lots', simulator: [{ tqf: .3 }], balance: [{ tqf: 0 }],
        category: 'EINGABE', phase: 'VOR_TRANSAKTION' });
    equal(changedTqf[0].status, 'TECHNISCHER_FEHLER', 'Eine veränderte Teilfreistellung im Lot bleibt ein Fehler');
    equal(compare(0, 0.01).status, 'GLEICH');
    equal(compare(0, 0.010001).status, 'TECHNISCHER_FEHLER');
    equal(compare(0, 1e-9, 'RATE').status, 'GLEICH');
    equal(compare(0, 1.001e-9, 'RATE').status, 'TECHNISCHER_FEHLER');
    equal(compare(30, 31, 'EXACT', { question: 3 }).classification, 'offene Fachfrage 3');
    equal(compare(undefined, 0).status, 'FEHLT_LOG');
    equal(compare(undefined, false, 'EXACT').status, 'FEHLT_LOG');
    equal(compare(null, 0).status, 'TECHNISCHER_FEHLER');
    equal(compare(false, false, 'EXACT').status, 'GLEICH');
    equal(compare(NaN, 0, 'EUR', { status: 'FEHLT_MODELL' }).status, 'TECHNISCHER_FEHLER');
    equal(compare(Infinity, Infinity, 'RATE').status, 'TECHNISCHER_FEHLER');
    equal(compare(Infinity, Infinity, 'RATE', { zeroWithdrawal: true }).simulator.value,
        { status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' });
    equal(compare({ status: 'UNBEGRENZT', value: null, reason: 'zero_withdrawal' }, 0, 'RATE').status, 'TECHNISCHER_FEHLER');
    const rounding = compare(51534.972 / 12, 51535 / 12, 'EUR', { rounding: true, question: 7 });
    equal(rounding.withinTolerance, true);
    equal(rounding.classification, 'Rundungsursache');
    equal(compare(51534.972, 51535, 'EUR', { rounding: true, question: 7 }).status, 'FACHLICH_OFFEN');
    equal(summarizeParityFields([rounding]).complete, false);
    const tree = compareParityTree({ id: 'state', phase: 'VOR_TRANSAKTION', category: 'VORZUSTAND',
        simulator: { flexRate: 5, lastTotalBudget: 20, vpwSafetyStage: 1 },
        balance: { flexRate: 5 + 1e-8, lastTotalBudget: 20.005, vpwSafetyStage: 2 } });
    equal(tree.map(row => [row.id, row.status]), [['state.flexRate', 'TECHNISCHER_FEHLER'],
        ['state.lastTotalBudget', 'GLEICH'], ['state.vpwSafetyStage', 'TECHNISCHER_FEHLER']]);
    const sources = [{ sourceProfileId: 'a', trancheId: 'lot', kind: 'aktien_neu', brutto: 100, netto: 90, steuer: 10 },
        { sourceProfileId: 'b', trancheId: 'lot', kind: 'aktien_neu', brutto: 100, netto: 90, steuer: 10 }];
    const action = { type: 'TRANSACTION', quellen: sources, verwendungen: { liquiditaet: 180, gold: 0, bonds: 0 }, steuer: 20 };
    equal(canonicalParityAction(action), canonicalParityAction({ ...action, verwendungen: { liquiditaet: 180 } }), 'Nullverwendungen entfallen');
    const reordered = { ...action, quellen: [...sources].reverse() };
    ok(JSON.stringify(canonicalParityAction(action)) !== JSON.stringify(canonicalParityAction(reordered)), 'Entnahmereihenfolge bleibt erhalten');
    const amounts = structuredClone(action);
    amounts.quellen[0].brutto += 1; amounts.quellen[1].brutto -= 1;
    const sourceRows = compareParityTree({ id: 'sources', simulator: canonicalParityAction(action).sources,
        balance: canonicalParityAction(amounts).sources, phase: 'NACH_TRANSAKTION', category: 'AUSFUEHRUNG' });
    equal(sourceRows.filter(row => row.id.endsWith('.brutto') && row.status === 'TECHNISCHER_FEHLER').length, 2,
        'Ausgleichende Summen verdecken keine Einzelbeträge');
    const lots = [{ sourceProfileId: 'b', trancheId: 'same', marketValue: 10 }, { sourceProfileId: 'a', trancheId: 'same', marketValue: 20 }];
    equal(canonicalParityLots(lots), canonicalParityLots([...lots].reverse()), 'Inventarreihenfolge ist bedeutungslos');
    equal(canonicalParityLots(lots).length, 2, 'Besitzer bleiben getrennt');

    const collector = createParityReplayCollector({ source, initialRecords: records });
    runFixture({ collector });
    const log = JSON.parse(JSON.stringify(collector.toLog())), logBytes = JSON.stringify(log), inputBytes = JSON.stringify(inputs);
    const schema = JSON.parse(readFileSync(new URL('../../types/parity-case-v1.schema.json', import.meta.url), 'utf8'));
    const cases = [];
    // Catch any attempt to use ambient storage or network, including annual projection.
    const ambient = ['localStorage', 'indexedDB', 'fetch', 'window', 'document'];
    const descriptors = Object.fromEntries(ambient.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        for (const key of ambient) Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error(`AMBIENT:${key}`); } });
        for (const year of log.years) {
            const value = createParityCase(log, year.yearIndex, { engineApi: EngineAPI, expectedSource: source });
            cases.push(value);
            for (const key of schema.required) ok(Object.hasOwn(value, key), `ParityCase schema ${key}`);
            for (const row of value.fields) {
                for (const key of schema.$defs.field.required) assert.ok(Object.hasOwn(row, key), `${row.id}: ${key}`);
                assert.ok(schema.$defs.field.properties.classification.enum.includes(row.classification), row.classification);
                for (const side of ['simulator', 'balance']) for (const key of schema.$defs.measurement.required) assert.ok(Object.hasOwn(row[side], key));
            }
            checks++;
            equal(value.replay.log.years.length, 1, 'Einzelfall ohne Gesamtjahresfolge');
            equal(value.logicalPlanningYear, 2026 + year.yearIndex);
            equal(value.historicalYear, 2000 + year.yearIndex);
            equal(value.summary.complete, false);
            equal(value.fields.filter(row => row.status === 'TECHNISCHER_FEHLER').map(row => row.id).sort(),
                [], 'Keine technischen Abweichungen; Legacy-TQF wird bei Einzeltranchen nicht verwendet');
            equal(value.fields.find(row => row.id === 'input.horizonYears').status, 'GLEICH', 'FR-13: jährliche Restdauer ist gleich');
            ok(!value.fields.some(row => row.question === 6), 'Fachfrage 6 ist entschieden');
            const wrongHorizon = structuredClone(value.measured.balance);
            wrongHorizon.engineInput.horizonYears += 1;
            equal(compareParityYear(year, null, wrongHorizon).find(row => row.id === 'input.horizonYears').status,
                'TECHNISCHER_FEHLER', 'Eine falsche Restdauer erhält keine Fachfragenausnahme mehr');
            for (const key of ['tqfAlt', 'tqfNeu']) equal(value.fields.find(row => row.id === `input.${key}`).status,
                'NICHT_ANWENDBAR', 'TQF je Lot wird unabhängig weiter verglichen');
            equal(value.fields.filter(row => row.id.startsWith('control.') && row.status !== 'GLEICH'), [], 'Originalargumente und frühe Entscheidung reproduziert');
            equal([...value.fields].sort((a, b) => PARITY_PHASES.indexOf(a.phase) - PARITY_PHASES.indexOf(b.phase)).map(row => row.id),
                value.fields.map(row => row.id), 'Phasenfolge');
            equal(replayParityCase(JSON.parse(JSON.stringify(value)), { engineApi: EngineAPI, expectedSource: source }).reproduced, true);
            ok(!value.fields.some(row => row.reason?.includes('personal_tax_state_unavailable')), 'Persönlicher Steuerstand hat keine Modellausnahme');
            ok(value.fields.some(row => row.status === 'PHASE_NICHT_VERGLEICHBAR'));
            ok(!value.fields.some(row => row.question === 3), 'FR-10: keine offene Kontenfrage');
            ok(!value.fields.some(row => [1, 2, 4, 5, 7, 8].includes(row.question)), 'FR-8/FR-9/FR-11/FR-12/FR-14/FR-15 haben keine offene Fachfrage mehr');
        }
    } finally {
        for (const key of ambient) {
            if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else delete globalThis[key];
        }
    }
    const corrupted = JSON.parse(logBytes);
    ok(!log.limitations.some(issue => issue.reason === 'complete_post_transaction_bond_refill_plan_unavailable'),
        'FR-9: vollständiger Plan liegt vor, keine überholte pauschale Loglücke');
    const year = restoreParityReplayValue(log.years[0]);
    const simulator = structuredClone(cases[0].measured.simulator);
    const balance = structuredClone(cases[0].measured.balance);
    const liquidityStatus = currentBalance => compareParityYear(year, simulator, currentBalance)
        .find(row => row.id === 'liquidity.cashBeforePayout').status;
    balance.finalAction.quellen[0].brutto += 1e-10;
    equal(liquidityStatus(balance), 'GLEICH', 'Quellen innerhalb der EUR-Toleranz bleiben phasengleich');
    balance.finalAction.quellen[0].brutto += 1;
    equal(liquidityStatus(balance), 'PHASE_NICHT_VERGLEICHBAR', 'Echte Quellenabweichung sperrt den Reichweitenvergleich');
    const diagnosticsYear = structuredClone(year), diagnosticsBalance = structuredClone(cases[0].measured.balance);
    for (const result of [diagnosticsYear.expectedDecision, diagnosticsBalance.decision]) {
        result.ui.vpw.enabled = false;
        delete result.ui.vpw.expectedRealReturn; delete result.ui.vpw.dynamicFlex;
        for (const key of Object.keys(result.diagnosis.keyParams)) if (key.startsWith('minimumFlexEmergency')) delete result.diagnosis.keyParams[key];
    }
    const diagnosticRows = () => compareParityYear(diagnosticsYear, simulator, diagnosticsBalance);
    equal(diagnosticRows().find(row => row.id === 'decision.ui.vpw.dynamicFlex').status, 'NICHT_ANWENDBAR',
        'Beidseits inaktive Dynamik hat keinen berechneten Flexdiagnosewert');
    equal(diagnosticRows().find(row => row.id === 'liquidity.minimumMonths').status, 'NICHT_ANWENDBAR',
        'Ohne Notfallprüfung gibt es keine Notfallreichweite');
    diagnosticsBalance.decision.ui.vpw.enabled = true;
    equal(diagnosticRows().find(row => row.id === 'decision.ui.vpw.dynamicFlex').status, 'FEHLT_LOG',
        'Einseitig aktive Dynamik erhält keine Ausnahme');
    diagnosticsBalance.decision.diagnosis.keyParams.minimumFlexEmergencyTotalWealth = 1;
    equal(diagnosticRows().find(row => row.id === 'liquidity.minimumMonths').status, 'FEHLT_LOG',
        'Vorhandene Notfallprüfung verlangt ihre Reichweite');
    const executed = structuredClone(cases[0].measured.simulator.result);
    equal(parityPrePayoutEvidence(executed).complete, true);
    executed.logData.balance_trace.find(item => item.phase === 'after_forced_sales').liquiditaetDelta = 10;
    equal(parityPrePayoutEvidence(executed).status, 'PHASE_NICHT_VERGLEICHBAR', 'Zusätzliche Verkäufe verhindern gleiche Transaktionsphase');
    executed.logData.balance_trace = [];
    equal(parityPrePayoutEvidence(executed).status, 'FEHLT_LOG');
    corrupted.years[2].expectedDecision.ui.spending.monatlicheEntnahme += 1;
    const counterprobe = createParityCase(sealParityReplayLog(corrupted), 2, { engineApi: EngineAPI, id: 'intentional-withdrawal-difference' });
    const found = counterprobe.fields.find(row => row.id === 'control.decision.ui.spending.monatlicheEntnahme');
    equal(found?.status, 'TECHNISCHER_FEHLER', 'Absichtliche Abweichung muss trotz offener Fachfragen auffallen');
    equal(found?.delta, -1);
    equal(replayParityCase(JSON.parse(JSON.stringify(counterprobe)), { engineApi: EngineAPI }).reproduced, true, 'Gegenprobe einzeln reproduzierbar');
    cases.push(counterprobe);
    const tampered = structuredClone(cases[0]); tampered.measured.balance.annualMonthlyBudget++;
    equal(validateParityCase(tampered).valid, false, 'Ausgabemanipulation erkannt');
    const alteredTolerance = sealParityCase({ ...cases[0], tolerances: { EUR: 10, RATE: 1e-9, EXACT: 0 } });
    equal(validateParityCase(alteredTolerance).valid, false, 'Toleranz nicht importierbar erweiterbar');
    const changedObservation = sealParityCase(tampered);
    equal(replayParityCase(changedObservation, { engineApi: EngineAPI }).reproduced, false, 'Keine stille Neubasierung eines anderen Messwerts');
    equal(validateParityCase(cases[0], { expectedSource: { datasetHash: 'f'.repeat(64) } }).valid, false);
    const changedVersion = createParityCase(log, 0, { engineApi: { ...EngineAPI, getVersion: () => ({ api: 'synthetic-other', build: 'other' }) } });
    ok(changedVersion.fields.some(row => row.reason === 'engine_version_mismatch'));
    equal(changedVersion.summary.status, 'TECHNISCHER_FEHLER');
    const stale = JSON.parse(logBytes); stale.years[0].engineInput.floorBedarf++;
    const staleCase = createParityCase(stale, 0, { engineApi: EngineAPI });
    equal(staleCase.summary.status, 'TECHNISCHER_FEHLER');
    equal(staleCase.replay.log.logHash, stale.logHash, 'Ungültiger Herkunftshash wird nicht repariert');
    equal(replayParityCase(staleCase, { engineApi: EngineAPI }).reproduced, true, 'Auch beschädigte Quellen als Diagnose reproduzierbar');
    const missing = JSON.parse(logBytes); delete missing.years[0].cashAndLots.lots[0].sourceProfileId;
    const missingCase = createParityCase(sealParityReplayLog(missing), 0, { engineApi: EngineAPI });
    ok(missingCase.fields.some(row => row.status === 'FEHLT_LOG'));
    equal(missingCase.summary.complete, false);
    equal(replayParityCase(missingCase, { engineApi: EngineAPI }).reproduced, true);
    const missingCash = JSON.parse(logBytes); delete missingCash.years[0].cashAndLots.componentCash;
    const missingCashCase = createParityCase(sealParityReplayLog(missingCash), 0, { engineApi: EngineAPI });
    equal(missingCashCase.fields.find(row => row.id === 'input.cashComponents.tagesgeld').status, 'FEHLT_LOG');
    equal(replayParityCase(missingCashCase, { engineApi: EngineAPI }).reproduced, true);
    const legacy = createParityCase({ rows: [] }, 0, { engineApi: EngineAPI });
    equal(legacy.summary.status, 'UNVOLLSTAENDIG');
    equal(legacy.source.sourceHash, null, 'Altexport erhält keine erfundene Herkunft');
    equal(replayParityCase(legacy, { engineApi: EngineAPI }).reproduced, true);
    const extraIncome = JSON.parse(logBytes); extraIncome.initialRecords.profile_sonstige_einkuenfte = '7';
    const fr7Case = createParityCase(sealParityReplayLog(extraIncome), 0, { engineApi: EngineAPI });
    equal(fr7Case.fields.find(row => row.id === 'input.annualPension').status, 'AUSGEKLAMMERT');
    equal(fr7Case.fields.find(row => row.id === 'decision.monthlyBudget').status, 'AUSGEKLAMMERT');
    equal(fr7Case.fields.filter(row => row.status === 'TECHNISCHER_FEHLER').map(row => row.id).sort(), []);
    const zero = createParityReplayCollector({ source, initialRecords: records });
    runFixture({ collector: zero, input: { ...inputs, startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0 } });
    const zeroCase = createParityCase(zero.toLog(), 0, { engineApi: EngineAPI });
    equal(zeroCase.fields.find(row => row.id === 'liquidity.runwayMonths').simulator.value.status, 'UNBEGRENZT');
    equal(zeroCase.fields.filter(row => row.id.startsWith('control.') && row.status !== 'GLEICH'), []);
    equal(replayParityCase(JSON.parse(JSON.stringify(zeroCase)), { engineApi: EngineAPI }).reproduced, true);
    equal(JSON.stringify(log), logBytes, 'Quellbeleg unverändert');
    equal(JSON.stringify(records), recordBytes, 'Musterrecords unverändert');
    equal(JSON.stringify(inputs), inputBytes, 'Simulatoreingaben unverändert');
    console.log(`Paritätsvergleich: ${checks} Prüfungen erfolgreich; Gegenprobe als technischer Fehler gefunden.`);
    return cases;
}
