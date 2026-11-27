// Gemeinsame Vorbereitung der Vergleichstests (VG-1 und ZW-1b): Max und Erika, gezählte Assertions, Laufparameter und Suchziele.
// Aufgeteilt auf decision-comparison.test.mjs (Vergleich), decision-comparison-zielsuche.test.mjs (Zielwertsuche) und
// decision-comparison-abwaerts.test.mjs (Suche nach unten mit 2.000 Läufen), damit keine Datei den Testlauf allein bestimmt.
import nodeAssert from 'node:assert/strict';
import { measurementInputs, parameters } from './ek-1b-measurement.mjs';
import { EngineAPI } from '../../engine/index.mjs';

export const assert = globalThis.__wrapExternalAssert?.(nodeAssert) ?? nodeAssert;
export const inputs = await measurementInputs(0, 'max-erika');
export const monteCarloParams = { ...parameters, anzahl: 50 };
export const options = { inputs, monteCarloParams, useCapeSampling: false, engine: EngineAPI, diagnosticRuns: 50, captureLogs: true };
// Grundbedarf über den Renten für die Ausgangsruin-Proben (KL-1, FR-84; Begründung in decision-comparison.test.mjs).
export const strainedFloor = 60000;
export const searchOptions = { ...options, diagnosticRuns: 0, captureLogs: false,
    monteCarloParams: { ...monteCarloParams, anzahl: 128 } };
// LE-1 (FR-75): Längere Lebensläufe; der heutige Plan erfüllt 99 % / 10 % nicht mehr (97,7 % / 14,8 %).
export const searchGoals = { coveragePct: 97, affectedPct: 20 };
export const goals = { coveragePct: 99, affectedPct: 10 };
