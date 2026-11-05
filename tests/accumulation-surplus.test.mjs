import { readVF2DReferences } from './helpers/vf-2d-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { trySurplusRebalance } from '../engine/transactions/transaction-surplus.mjs';
import { quantizeAmount } from '../engine/transactions/transaction-utils.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';
import { decidedFixedIncomeSurplus } from '../engine/planners/fixed-income-budget.mjs';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { resolveTargetTagesgeld, splitPlayLiquidity } from '../app/balance/balance-play-execution.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

// GL-1 / AS1: gekürzte Anzeigeobjekte und ungültige Einkünfte bleiben endlich.
const surplusInput = { renteAktiv: true, renteMonatlich: 4000, floorBedarf: 24000, flexBedarf: 12000 };
assertEqual(decidedFixedIncomeSurplus({ input: surplusInput, vpw: { enabled: true, dynamicFlex: 12000 } }),
    decidedFixedIncomeSurplus({ input: surplusInput, spending: { monatlicheEntnahme: 0 }, vpw: { enabled: true, dynamicFlex: 12000 } }),
    'Fehlendes spending entspricht einer Entnahme von null');
for (const renteMonatlich of [undefined, NaN, Infinity, -Infinity]) {
    assertEqual(decidedFixedIncomeSurplus({ input: { ...surplusInput, renteMonatlich } }), 0,
        'Aktive nicht finite Einkünfte werden als null behandelt');
}

const invest = (excess, isSavingsYear, patch = {}) => trySurplusRebalance({
    aktuelleLiquiditaet: 5000 + excess, zielLiquiditaet: 5000, depotwertGesamt: 100000,
    investiertesKapital: 100000, input: { goldAktiv: false, ...patch },
    market: { sKey: 'bear_deep', abstandVomAthProzent: 50 }, isSavingsYear,
    quantizeAmount, transactionDiagnostics: {} });
assertEqual(invest(10000, true).verwendungen.aktien, 10000, 'AS-1: Ansparjahr kauft im tiefen Bärenmarkt 10.000 Euro Aktien');
assertEqual(invest(400, true), null, 'AS-1: 400 Euro bleiben unter der Sparplangrenze');
assertEqual(invest(500, true).verwendungen.aktien, 500, 'AS-1: Genau 500 Euro werden ohne grobe Handelsrundung angelegt');
assertEqual(invest(10000, false), null, 'AS-1: Entnahmejahr behält Marktsperre und Mindesthandel');
assertEqual(invest(100000, false), null, 'AS-1: Entnahmejahr behält die Bärensperre auch über der Handelsschwelle');
const gold = invest(10000, true, { goldAktiv: true, goldZielProzent: 5, goldWert: 1000 });
assertEqual(gold.verwendungen.gold, 4750, 'AS-1: Gold wird weiterhin zuerst bis zum Ziel aufgefüllt');
assertEqual(gold.verwendungen.aktien, 5250, 'AS-1: Aktien erhalten den Rest des Überschusses');

const saved = { document: globalThis.document, window: globalThis.window };
try {
    const records = createMusterHaushaltRecords('2026-10-16', 'sophie');
    const balance = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
    const input = { ...balance.engineInput, kursAktuell: 50, kursVJ: 50, kursATH: 100, kursMA: 80 };
    const result = EngineAPI.simulateSingleYear(input, balance.engineLastState);
    assert(!result.error, 'AS-1: Balance-Sophie kann gerechnet werden');
    assert(decidedFixedIncomeSurplus({ ...result.ui, input }) > 0, 'AS-1: FR-52 kennzeichnet das Ansparjahr');
    assertEqual(result.ui.action.verwendungen.aktien, 10000, 'AS-1: Balance empfiehlt den Kauf des verfügbaren Überschusses');
    const renderer = new ActionRenderer({ outputs: {} });
    const split = splitPlayLiquidity(input, result.ui.action, result.ui.spending, result.ui.zielLiquiditaet);
    assertEqual(resolveTargetTagesgeld(result.ui.spending, result.ui.zielLiquiditaet), 1000, 'FR-66: zwölf Tagesgeldmonate entsprechen einem Fünftel der Reserve');
    assertEqual(input.tagesgeld - split.fromTagesgeld, 5000, 'AS-1: Nach dem Kauf verbleiben 5.000 Euro Tagesgeld');
    assertEqual(renderer.determineInternalCashRebalance(input, result.ui.action, result.ui.spending, result.ui.zielLiquiditaet), null,
        'AS-1: Aktienkauf wird nicht durch Geldmarktumschichtung ersetzt');
    assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 1000 }, 5000), 2000, 'FR-66: Die eiserne Reserve begrenzt den Tagesgeldanteil nach unten');
    assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 1000 }), 12000, 'FR-66: Ohne übergebenes Ziel gilt dieselbe Engine-Zielrechnung');
    assertEqual(resolveTargetTagesgeld({ monatlicheEntnahme: 1000 }, 20000), 4000, 'FR-66: Tagesgeld bleibt Anteil des höheren Reserveziels');

    // Produktiver Simulatorpfad: dieselbe Engineentscheidung und tatsächlich gebuchte Käufe.
    for (const dynamicFlex of [false, true]) for (const strategy of ['two', 'three']) {
        const inputs = await measurementInputs(0, 'sophie');
        inputs.dynamicFlex = dynamicFlex;
        if (strategy === 'three') inputs.decumulation = { ...inputs.decumulation, mode: STRATEGY_OPTIONS.THREE_BUCKET_JILGE };
        let sameYear;
        const engine = { ...EngineAPI, simulateSingleYear(yearInput, state, ...options) {
            const actual = EngineAPI.simulateSingleYear(yearInput, state, ...options);
            sameYear = EngineAPI.simulateSingleYear(structuredClone(yearInput), structuredClone(state), ...options);
            assertEqual(JSON.stringify(actual), JSON.stringify(sameYear), 'AS-1: Balance und Simulator rechnen denselben Jahreszustand bytegleich');
            return actual;
        } };
        const simulation = simulateOneYear(initMcRunState(inputs, 4), inputs,
            { jahr: 2003, rendite: -.2, gold_eur_perf: 0, bond_return: 0, inflation: 0, zinssatz: 0, lohn: 0 },
            0, null, 0, null, 1, engine);
        assertEqual(simulation.kind, 'success', 'AS-1: Ansparjahr im Simulator abgeschlossen');
        assert(simulation.logData.einkuenfte_gespart > 0, 'AS-1: Simulator verwendet dieselbe FR-52-Grenze');
        if (strategy === 'three') assert(sameYear.ui.threeBucket.is3Bucket, 'AS-1: Drei-Töpfe-Finalisierung ist tatsächlich aktiv');
        assert(sameYear.ui.action.details.kaufAkt > 0, 'AS-1: Gemeinsame Engine liefert einen Aktienkauf');
        assertClose(simulation.logData.kaufAkt, sameYear.ui.action.verwendungen.aktien, 1e-7, 'AS-1: Simulator bucht den gemeinsamen Aktienkauf nach der Finalisierung');
        assertClose(simulation.logData.kaufGld, sameYear.ui.action.verwendungen.gold, 1e-7, 'AS-1: Goldverteilung bleibt gleich');
    }

    const dom = createPresentationTestDocument(); globalThis.document = dom;
    const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceActionCoverage', 'balanceReserveCoverage', 'balanceReserveValues', 'balanceReserveBar', 'liquiditaetBalken']
        .map(id => [id, dom.createElement('div')]));
    const summary = new SummaryRenderer({ outputs });
    outputs.liquiditaetBalken.classList = { add() {} };
    const ui = { ...result.ui, input, liquiditaet: { ...result.ui.liquiditaet, deckungVorher: 300, deckungNachher: 300 } };
    summary.renderPlanCards(ui); summary.renderReserves({ ...ui, zielLiquiditaet: (input.tagesgeld + input.geldmarktEtf) / 3 });
    assert(/Danach 300\s% des Ziels/.test(outputs.balanceActionCoverage.textContent), 'AS-1: Nachherdeckung über 100 Prozent ohne Nachkommastelle');
    const text = node => [node.textContent, ...(node.children || []).map(text)].join(' ');
    const comparison = text(outputs.balanceReserveCoverage);
    assert(/300\s%/.test(comparison) && !comparison.includes('300,0'), 'AS-1: Deckungsvergleich zeigt keine Nachkommastelle über 100 Prozent');
    assert(/300\s%/.test(outputs.balanceReserveBar.getAttribute('aria-label')), 'AS-1: Reservebalken nennt ganze Prozent');
} finally { Object.assign(globalThis, saved); setAppTestDate(null); P.resetPersistenceRuntimeForTests(); }

const controls = JSON.parse(readFileSync(new URL('./fixtures/as-1-withdrawal-controls.json', import.meta.url)));
for (const control of controls.probes) {
    const result = EngineAPI.simulateSingleYear(control.input, control.lastState);
    assert(!result.error, `${control.label}: Entnahmejahr gerechnet`);
    assertEqual(decidedFixedIncomeSurplus({ ...result.ui, input: control.input }), 0, `${control.label}: kein FR-52-Überschuss`);
    const actual = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    assertEqual(actual, readVF2DReferences(readGL1References(control.beforeSha256)), `${control.label}: Entnahmejahr bei gleichem Vorjahreszustand vollständig bytegleich`);
}
