import { readFileSync } from 'node:fs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { createBalanceExportDocument, normalizeBalanceImportDocument } from '../app/balance/balance-binder-imports.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope, stripBalancePlanInputs } from '../app/profile/household-plan.js';
import { CONFIG } from '../app/balance/balance-config.js';

const fixture = JSON.parse(readFileSync(new URL('./extended/fixtures/parity-d23/3-horizont.json', import.meta.url)));
const json = JSON.stringify;
const storage = records => ({ getItem: key => records[key] ?? null,
    setItem() { throw Error('READ_ONLY'); }, removeItem() { throw Error('READ_ONLY'); } });
const withSettings = (variant, settings) => {
    const records = structuredClone(variant.records);
    const plan = JSON.parse(records[HOUSEHOLD_PLAN_KEY]);
    Object.assign(Object.values(plan.entries)[0].values, settings);
    records[HOUSEHOLD_PLAN_KEY] = json(plan);
    return records;
};

// Historische Messwerte sind ein unabhängiger Anker; keine Neubasierung der Belege.
for (const [index, variant] of fixture.variants.entries()) {
    const calc = buildBalanceEngineInputFromStorage({ storage: storage(variant.records), referenceYear: 2026 });
    assertEqual(calc.engineInput.horizonYears, [33, 31, 25][index], variant.preset + ': beschlossene Restdauer');
    assertEqual(calc.householdPlan.entry.values.horizonYears, [35, 30, 25][index], 'Gespeicherte Jahresvorgabe bleibt erhalten');
}

// Dieselben Personen im selben Planungsjahr, mit jeder Vorsichtsoption.
for (const variant of fixture.variants) for (const yearIndex of [0, 1, 10]) {
    for (const settings of [{ longevityMode: 'none' },
        { longevityMode: 'quantile_shift', longevityQuantileShift: 0.05 },
        { longevityMode: 'relative_horizon_buffer', longevityRelativePct: 0.1 },
        { longevityMode: 'buffer_years', longevityBufferYears: 2 }]) {
        const records = withSettings(variant, settings), before = json(records);
        const calc = buildBalanceEngineInputFromStorage({ storage: storage(records), referenceYear: 2026 + yearIndex });
        const sim = resolveDynamicFlexRunnerHorizon({ ...variant.runnerInput, ...settings }, { yearIndex });
        const label = `${variant.preset}/${yearIndex}/${settings.longevityMode}`;
        assertEqual(calc.engineInput.horizonYears, sim.horizonYears, label + ': gleiche jährliche Personenprojektion');
        assertEqual(calc.engineInput.guardrailPlanHorizonYears, variant.runnerInput.horizonYears, 'Resetvergleich verwendet Planjahre');
        if (settings.longevityMode !== 'none') assertEqual(json(calc.engineInput.longevityHorizonDiagnostics), json(sim.diagnostics),
            label + ': gleiche Rohdauer und einmaliger Aufschlag');
        assertEqual(json(records), before, 'Lesender Altbestands- und Jahresbelegpfad');
        const payload = { ...calc.persistentState, inputs: stripBalancePlanInputs(calc.inputData) };
        const exported = createBalanceExportDocument(payload, { householdPlan: calc.householdPlan });
        assertEqual(exported.validationWarnings, undefined, label + ': bestehender Dateivertrag bleibt gültig');
        assertEqual(normalizeBalanceImportDocument(exported).payload.inputs.horizonYears, variant.runnerInput.horizonYears,
            'Export und Wiederherstellung behalten die konfigurierte Planvorgabe');
    }
}

{
    const variant = fixture.variants[0], records = structuredClone(variant.records);
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles.muster_a.meta.belongsToHousehold = false;
    records.rs_profiles_v1 = json(registry);
    const values = Object.values(JSON.parse(records[HOUSEHOLD_PLAN_KEY]).entries)[0].values;
    records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope: planScope('household', ['muster_b']), values }]).raw;
    const before = json(records);
    const single = buildBalanceEngineInputFromStorage({ storage: storage(records), referenceYear: 2027 });
    const survivor = resolveDynamicFlexRunnerHorizon(variant.runnerInput, { yearIndex: 1, p1Alive: false, p2Alive: true });
    assertEqual(single.engineInput.horizonYears, survivor.horizonYears, 'Allein ausgewählte Erika entspricht dem überlebenden Partner');
    assertEqual(single.inputData.aktuellesAlter, 65, 'Geöffneter Außen-Max bestimmt weder Alter noch Horizont');
    assertEqual(json(records), before, 'Auswahlwechsel schreibt keine Altbestände');
}

{
    const variant = fixture.variants[0], records = structuredClone(variant.records);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(registry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        state.profilverbundHouseholdLastState = { marker: 'Historie', taxState: { lossCarry: 1234 } };
        profile.data[CONFIG.STORAGE.LS_KEY] = json(state);
    }
    records.rs_profiles_v1 = json(registry);
    Object.assign(records, registry.profiles.muster_a.data);
    const younger = buildBalanceEngineInputFromStorage({ storage: storage(records), referenceYear: 2026 });
    const older = buildBalanceEngineInputFromStorage({ storage: storage(records), referenceYear: 2036 });
    assert(older.engineInput.horizonYears < younger.engineInput.horizonYears, 'Ein neues Planungsjahr verkürzt die Personenrestdauer');
    assertEqual(older.engineLastState.marker, 'Historie', 'Jährlich abgeleitete Restdauer erhält die vorhandenen Leitplanken');
    for (const [id, profile] of Object.entries(registry.profiles)) {
        profile.data.profile_geburtsdatum = '';
        profile.data.profile_aktuelles_alter = id === 'muster_a' ? '67' : '64';
    }
    records.rs_profiles_v1 = json(registry);
    Object.assign(records, registry.profiles.muster_a.data);
    const bytes = json(records);
    for (const year of [2026, 2036]) {
        const calc = buildBalanceEngineInputFromStorage({ storage: storage(records), referenceYear: year });
        assertEqual(calc.engineInput.horizonYears, 33, 'Altbestand mit festgehaltenem Altalter bleibt lesbar');
        assertEqual(calc.engineLastState.marker, 'Historie', 'Altersableitung setzt die Leitplanken nicht zurück');
        assertEqual(calc.engineLastState.taxState.lossCarry, 1234, 'Steuerstand bleibt erhalten');
    }
    assertEqual(json(records), bytes, 'Keine zusätzliche Migration für Altalter oder Planjahre');
    const changed = withSettings({ records }, { survivalQuantile: 0.85 });
    const calc = buildBalanceEngineInputFromStorage({ storage: storage(changed), referenceYear: 2026 });
    assertEqual(calc.engineLastState.marker, undefined, 'Bewusste Quantiländerung setzt die Historie weiter zurück');
    assertEqual(calc.engineLastState.taxState.lossCarry, 1234, 'Planwechsel erhält Verlustvortrag');
}
