// B8: Die Kaufkraft-Anhebung schließt den Zielabstand mit dem Vermögensfaktor w (Anhebung × w).
// Die Richtung ist gewollt (Nutzer 19.11.2026, KR-1b); die Umkehr (FR-86) entfällt.
import { applyGuardrails } from '../engine/planners/spending-guardrails.mjs';

// Ziel 60.000 €, aktuell 50.000 € (40.000 € Grundbedarf + 50 % von 20.000 € Flex), keine Rente, keine Inflation.
// Das Depot ist so groß, dass der 4,5-%-Deckel (FR-60) nicht greift.
function budget(wealthFactor) {
    const keyParams = { entnahmequoteDepot: 0.005 };
    if (wealthFactor !== undefined) keyParams.wealthReductionFactor = wealthFactor;
    const params = { market: { sKey: 'hot_neutral' }, inflatedBedarf: { floor: 40000, flex: 20000 },
        renteJahr: 0, depotwertGesamt: 10000000, runwayMonate: 60,
        input: { inflation: 0, endeVJ: 100, endeVJ_1: 95, endeVJ_2: 90 } };
    const result = applyGuardrails(50, { keyParams }, params, () => {});
    return params.inflatedBedarf.floor + params.inflatedBedarf.flex * result.rate / 100;
}

// aktuell + (Ziel − aktuell) × w
assertClose(budget(0.25), 52500, 1e-6, 'w = 0,25 hebt ein Viertel des Zielabstands an');
assertClose(budget(0), 50000, 1e-6, 'w = 0 hebt nicht an');
assertClose(budget(1), 60000, 1e-6, 'w = 1 hebt bis zum Ziel an');
assertClose(budget(undefined), 60000, 1e-6, 'Ohne w gilt w = 1');
console.log('B8: Anhebung × w geprüft.');
