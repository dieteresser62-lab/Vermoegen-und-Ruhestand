import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';

const evidence = JSON.parse(readFileSync(new URL('./fixtures/an-1b-surplus-controls.json', import.meta.url)));
for (const control of evidence.controls) {
    const inputs = structuredClone(control.inputs);
    const result = simulateOneYear(initMcRunState(inputs, 0), inputs, evidence.yearData,
        0, null, 0, null, 1, EngineAPI);
    const label = `${inputs.liquidityRunwayYears} Jahre, geplante Ausgabe ${inputs.plannedExpenses[0]?.betrag || 0} €`;
    assertEqual(result.kind, 'success', `${label}: vollständiges Simulatorjahr`);
    assertEqual(result.ui.action.details.source, 'surplus', `${label}: Überschussanlage über den gemeinsamen Enginepfad`);
    assert(result.logData.kaufAkt > 0, `${label}: vorhandener Überschuss wird weiter angelegt`);
    const coverage = result.logData.balance_trace.find(entry => entry.phase === 'after_forced_sales');
    assertEqual(coverage.forcedShortfall, 0, `${label}: kein Fehlbetrag vor der Auszahlung`);
    assertEqual(coverage.liquiditaetDelta, 0, `${label}: kein nachträglicher Deckungsverkauf`);
    assertEqual(result.logData.vk.vkGes, 0, `${label}: keine Verkäufe im Kaufjahr`);
    assert(result.ui.liquiditaet.nachAuszahlung >= inputs.startFloorBedarf / 12,
        `${label}: ein Netto-Grundbedarfsmonat bleibt nach Auszahlung erhalten`);
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    if (inputs.liquidityRunwayYears === 2) {
        assertEqual(hash, readQSCReferences(control.beforeHash), `${label}: vollständiges Ergebnis bytegleich zum Ausgangsstand`);
    } else {
        assertEqual(control.beforeForcedSale, 5000, `${label}: Ausgangsstand benötigte einen Notverkauf`);
        assert(result.logData.kaufAkt < control.beforeEquityBuy, `${label}: kleinerer Kauf lässt den Auszahlungspuffer stehen`);
    }
}
