// Vertragstest der Fassade sweep-runner: Die Haushaltsrisiko-Summe der Pflege folgt der Netto-Definition aus FR-72 Teil 4 (HE-4).
import { createSweepHouseholdRiskDiagnostics, recordSweepHouseholdRiskYear } from '../app/simulator/sweep-runner/household-risk.js';

// Punkt 4: Die Sweep-Summe folgt derselben Netto-Definition; ohne Heim unverändert.
{
    const record = (logData, savedHomeFloor) => {
        const diagnostics = createSweepHouseholdRiskDiagnostics();
        recordSweepHouseholdRiskYear(diagnostics, null, { runIndex: 0, simulationsJahr: 0, yearData: { jahr: 2000 },
            lifeYear: { householdContext: { p1Alive: true, p2Alive: false, care: { p1: null, p2: null }, widowBenefits: {} } },
            previousLife: { p1Alive: true, p2Alive: false }, result: { logData }, ...(savedHomeFloor === undefined ? {} : { savedHomeFloor }) });
        return diagnostics.household.totalCareFloorNominalEur;
    };
    assertEqual(record({ CareP1_Cost: 46368, pflege_zusatz_floor: 0, pflege_heimkosten: 40368, pflege_heim_eigene_ausgaben: 6000 }, [24000, 0]), 22368, 'Sweep: Sollfall C netto 46.368 − 24.000');
    assertEqual(record({ CareP1_Cost: 31332, pflege_zusatz_floor: 0, pflege_heimkosten: 25332, pflege_heim_eigene_ausgaben: 6000 }, [40000, 0]), 0, 'Sweep: Heim günstiger als Grundbedarf zählt 0');
    assertEqual(record({ pflege_zusatz_floor: 18000 }), 18000, 'Sweep: Pflege zu Hause unverändert');
}

// HE-5 B3: Nullgrenze je Person; ein negativer Wert verrechnet sich nicht mit dem Partner.
{
    const { savedHomeFloorShares } = await import('../app/simulator/simulator-survivor.js');
    const { createMonteCarloCareNeedTracker, recordMonteCarloCareNeedYear } = await import('../app/simulator/mc-run-metrics.js');
    const inputs = { partner: { aktiv: true }, survivorFloorPercent: 75 };
    const p1 = { active: true, heimJahr: 4, heimKosten: 25332, heimEigeneAusgaben: 6000 };
    const p2 = { active: true, zusatzFloorZiel: 18000, grade: 3 };
    const household = { p1Alive: true, p2Alive: true, care: { p1, p2 } };
    const saved = savedHomeFloorShares(inputs, 144000, household, false);
    assertEqual(saved.join('/'), '36000/0', 'B3: Grundbedarfsersparnis 36.000 Euro allein bei P1');
    const diagnostics = createSweepHouseholdRiskDiagnostics();
    const logData = { pflege_zusatz_floor: 18000, pflege_heimkosten: 25332, pflege_heim_eigene_ausgaben: 6000,
        CareP1_Cost: 31332, CareP2_Cost: 18000 };
    recordSweepHouseholdRiskYear(diagnostics, null, { runIndex: 0, simulationsJahr: 3, yearData: { jahr: 2000 },
        lifeYear: { ageP2: 80, householdContext: household }, previousLife: { p1Alive: true, p2Alive: true },
        result: { logData }, savedHomeFloor: saved });
    const mc = recordMonteCarloCareNeedYear(createMonteCarloCareNeedTracker(), {
        p1CareAdditionalNeedNominalEur: 31332 - saved[0], p2CareAdditionalNeedNominalEur: 18000 - saved[1] });
    assertEqual(diagnostics.household.totalCareFloorNominalEur, 18000, 'B3: Sweep 18.000 statt 13.332 Euro');
    assertEqual(diagnostics.household.totalCareFloorNominalEur, mc.totalCareAdditionalNeedNominalEur, 'B3: Sweep und MC gleiche Personenbegrenzung');
    const deathHousehold = { p1Alive: false, p2Alive: true, care: { p1, p2: { ...p1 } } };
    const deathShares = savedHomeFloorShares(inputs, 144000, deathHousehold, true);
    assertEqual(deathShares.join('/'), '42000/84000', 'B3: Ersparnis nach Heimgewichten ½:1 im Todesjahr');
    const death = createSweepHouseholdRiskDiagnostics();
    recordSweepHouseholdRiskYear(death, null, { runIndex: 0, simulationsJahr: 3, yearData: { jahr: 2000 },
        lifeYear: { ageP2: 80, householdContext: deathHousehold }, previousLife: { p1Alive: true, p2Alive: true },
        result: { logData: { ...logData, CareP1_Cost: 15666, CareP2_Cost: 120000 } }, savedHomeFloor: deathShares });
    assertEqual(death.household.totalCareFloorNominalEur, 36000, 'B3: Tod halbiert Kosten und Ersparnisgewicht, begrenzt je Person');
}
