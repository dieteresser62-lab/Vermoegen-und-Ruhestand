import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT,
    MORTALITY_TABLE,
    PFLEGE_GRADE_LABELS,
    PFLEGE_GRADE_PROBABILITIES,
    PFLEGE_GRADE_PROBABILITIES_BY_SEX,
    PFLEGE_GRADE_PROGRESSION_PROBABILITIES,
    SUPPORTED_PFLEGE_GRADES
} from '../app/simulator/german-demography-care-survivor-contract.js';
import {
    MORTALITY_TABLE as RUNTIME_MORTALITY_TABLE,
    PFLEGE_GRADE_PROBABILITIES as RUNTIME_CARE_ENTRY_MODEL
} from '../app/simulator/simulator-data.js';
import { createDemographyCareSurvivorDiagnosticsV1 } from '../app/simulator/monte-carlo-runner.js';

console.log('--- German Demography/Care/Survivor Contract Tests ---');

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(directory, '..');
const sourceDirectory = path.join(
    projectRoot,
    'data',
    'static',
    'german-demography-care-survivor-contract',
    'originals'
);
const sha256 = value => createHash('sha256').update(value).digest('hex');

console.log('Test 1: pinned source identities and generated contract are immutable');
for (const [sourceId, source] of Object.entries(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.sourceFiles)) {
    const sourcePath = path.join(sourceDirectory, source.fileName);
    assert(fs.existsSync(sourcePath), `${sourceId} source should be pinned locally`);
    assertEqual(sha256(fs.readFileSync(sourcePath)), source.sha256, `${sourceId} source hash should match`);
}
assertEqual(
    GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.schemaVersion,
    'GermanDemographyCareSurvivorContractV1',
    'Contract schema should be versioned'
);
assert(Object.isFrozen(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT), 'Generated contract should be deeply immutable');
console.log('✓ source identity and immutability OK');

console.log('Test 2: period mortality semantics, age, sex and tail assumptions are explicit');
const mortality = GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.mortality;
assertEqual(
    GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.sourceFiles.mortality.sourceSeries,
    'Destatis Statistischer Bericht Sterbetafeln 2023/2025 (EVAS 12621), Tabellen 12613-b01 und 12613-b02',
    'Mortality source must name the pinned statistical report, not the separate Allgemeine Sterbetafel product'
);
assertEqual(mortality.tableType, 'period', 'Mortality source must stay a period table');
assertEqual(mortality.cohortProjection, false, 'Period observations must not become a cohort projection');
assertEqual(mortality.futureMortalityImprovement, false, 'No unobserved future mortality improvement should be injected');
assertEqual(mortality.period, '2023/2025', 'Official mortality period should be pinned');
assertEqual(mortality.officialAgeRange.endAge, 100, 'Official age boundary should end at 100');
assertEqual(mortality.tailAssumption.evidenceClass, 'model_assumption', 'Ages 101-110 must remain a separate model assumption');
assertEqual(MORTALITY_TABLE.m[110], 1, 'Male terminal age should remain deterministic');
assertEqual(MORTALITY_TABLE.w[110], 1, 'Female terminal age should remain deterministic');
for (const age of [18, 30, 50, 65, 80, 95, 100]) {
    assert(
        MORTALITY_TABLE.m[age] > MORTALITY_TABLE.w[age],
        `Official male qx should exceed female qx at marker age ${age}`
    );
    assertClose(
        MORTALITY_TABLE.d[age],
        (MORTALITY_TABLE.m[age] + MORTALITY_TABLE.w[age]) / 2,
        1e-15,
        `Divers marker age ${age} should be the declared model mean`
    );
}
assertClose(MORTALITY_TABLE.m[65], 0.014951194938233688, 1e-15, 'Male age-65 qx should match Destatis');
assertClose(MORTALITY_TABLE.w[65], 0.008076907733749495, 1e-15, 'Female age-65 qx should match Destatis');
// FR-75: Laufzeitziel ist die Kohortentafel V2; die Periodentafel bleibt für FR-41 und Aufrufer ohne Geburtsjahr.
assertEqual(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.revision, '2026-11-12.2', 'Contract revision for FR-75 and LE-1b (care today)');
assertEqual(mortality.target.tableType, 'cohort', 'Runtime target is the cohort table');
assertEqual(mortality.target.variant, 'V2', 'Fixed variant V2 (mittel)');
assertEqual(mortality.target.variantSelectable, false, 'No variant selection');
assertEqual(mortality.target.tailAssumption.startAge, 100, 'Cohort tail starts at 100');
assertEqual(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.care.baseMortalityAdjustment.method, 'markov_exact_per_person_R2',
    'Base mortality without care is adjusted exactly per person');
console.log('✓ mortality semantics and marker profiles OK');

console.log('Test 3: care prevalence observations never become transition probabilities');
const care = GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.care;
assertEqual(
    care.officialObservation.runtimeRole,
    'context_only_not_runtime_validation_or_transition_probability',
    'Observed care prevalence must be honest context evidence only'
);
assert(care.officialObservation.prohibitedTransformation.includes('Do not divide prevalence'), 'Prevalence-to-incidence conversion should be prohibited');
assertEqual(care.officialObservation.observedPrevalencePctBySexAndAgeBand.overall[65], 6.56, 'Age 65-69 prevalence should match Destatis');
assertEqual(care.officialObservation.observedPrevalencePctBySexAndAgeBand.overall[95], 94.75, 'Age 95+ prevalence should match Destatis');
assertEqual(care.officialObservation.observedPrevalencePctBySexAndAgeBand.m[95], 84.74, 'Male age 95+ prevalence should match Destatis');
assertEqual(care.officialObservation.observedPrevalencePctBySexAndAgeBand.w[95], 97.81, 'Female age 95+ prevalence should match Destatis');
assertEqual(care.officialObservation.totalCareRecipients, 5688473, 'Observed care-recipient stock should match Destatis');
assertEqual(care.officialObservation.countsByGrade[1], 785822, 'Observed grade-1 stock should match Destatis');
assertEqual(care.officialObservation.countsByGrade[5], 244252, 'Observed grade-5 stock should match Destatis');
assertEqual(care.entryModel.evidenceClass, 'model_assumption', 'Care entry should be a model assumption');
assertEqual(care.progressionModel.evidenceClass, 'model_assumption', 'Care progression should be a model assumption');
assertEqual(care.durationModel.officialObservationUsedAsDuration, false, 'Observed prevalence must not supply care duration');
assertEqual(JSON.stringify(SUPPORTED_PFLEGE_GRADES), JSON.stringify([1, 2, 3, 4, 5]), 'Official care taxonomy should retain grades 1-5');
assertEqual(Object.keys(PFLEGE_GRADE_LABELS).length, 5, 'All five care grades should have labels');
for (const age of [65, 70, 75, 80, 85, 90, 95]) {
    assertEqual(
        JSON.stringify(Object.keys(PFLEGE_GRADE_PROBABILITIES[age])),
        JSON.stringify(['1', '2']),
        `Initial care entry at age ${age} should only target grades 1 and 2`
    );
}
assertEqual(PFLEGE_GRADE_PROGRESSION_PROBABILITIES[5], 0, 'Care grade 5 should remain terminal for progression');
for (const [sex, table] of Object.entries(PFLEGE_GRADE_PROBABILITIES_BY_SEX)) {
    let previous = 0;
    for (const age of [65, 70, 75, 80, 85, 90, 95]) {
        assertEqual(JSON.stringify(Object.keys(table[age])), '["1","2"]', `${sex}/${age}: initial grades remain 1/2`);
        assert(table[age][1] >= 0 && table[age][2] >= 0 && table[age][1] + table[age][2] <= 1,
            `${sex}/${age}: valid annual probability sum`);
        const total = table[age][1] + table[age][2];
        assert(total >= previous, `${sex}/${age}: PG1 + PG2 must not decrease with age`);
        previous = total;
        if (sex === 'd') for (const grade of [1, 2]) assertClose(table[age][grade],
            (PFLEGE_GRADE_PROBABILITIES_BY_SEX.m[age][grade] + PFLEGE_GRADE_PROBABILITIES_BY_SEX.w[age][grade]) / 2,
            1e-15, 'Divers entry table remains the declared model mean');
    }
}
assertEqual(care.entryModel.calibration.initialStock.prevalencePctBySex.m, 4.25, '22421-02!I46');
assertEqual(care.entryModel.calibration.initialStock.prevalencePctBySex.w, 4.42, '22421-02!I68');
assertEqual(care.entryModel.calibration.initialStock.runtimeRole,
    'offline_calibration_only_simulator_starts_without_care', 'Start stock is limited to offline calibration');
assertEqual(care.mortalityModel.evidenceClass, 'model_assumption', 'Calibrated mortality factors remain model assumptions');
assertEqual(care.mortalityModel.externalValidationStatus, 'not_validated', 'Offline calibration is not external validation');
assertEqual(JSON.stringify(Object.values(care.mortalityModel.defaultFactorsByGrade)), '[1.5,2,3,4,5]', 'FR-41 mortality defaults');
assert(care.entryModel.construction.includes('(FR-41)'), 'Entry construction declares the offline calibration');
assert(care.progressionModel.construction.includes('(FR-41)'), 'Progression construction declares the offline calibration');
console.log('✓ observed care data and model transitions remain separated');

console.log('Test 4: survivor reference and simplified runtime boundary are explicit');
const survivor = GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.survivor;
assertEqual(survivor.runtimeContract.defaultMode, 'percent', 'Generated default should match the selected HTML option');
assertEqual(survivor.runtimeContract.defaultPercent, 55, 'Simplified survivor default should remain 55 percent');
assertEqual(survivor.officialReference.referenceOnly, true, 'Official survivor source should remain reference-only');
assert(survivor.modelBoundary.implemented.some(rule => rule.includes('pension income offset')), 'FR-22: income offset is included in the model boundary');
assert(survivor.modelBoundary.interpretation.includes('not a statutory entitlement calculation'), 'Survivor model must reject a statutory-calculator claim');
console.log('✓ survivor model boundary OK');

console.log('Test 5: runtime exports and Monte Carlo diagnostics retain contract identity');
assertEqual(RUNTIME_MORTALITY_TABLE, MORTALITY_TABLE, 'Runtime should re-export the generated mortality table');
assertEqual(RUNTIME_CARE_ENTRY_MODEL, PFLEGE_GRADE_PROBABILITIES, 'Runtime should re-export the explicit care-entry model');
const diagnostics = createDemographyCareSurvivorDiagnosticsV1();
assertEqual(diagnostics.contractSchemaVersion, GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.schemaVersion, 'Diagnostics should expose contract schema');
assertEqual(diagnostics.hashes.mortalityTableHash, GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.mortalityTableHash, 'Diagnostics should expose mortality hash');
assertEqual(diagnostics.mortality.tableType, 'cohort', 'LE-1b: Run evidence names the cohort target table');
assertEqual(diagnostics.mortality.variant, 'V2', 'LE-1b: Run evidence names variant V2');
assertEqual(diagnostics.mortality.cohortProjection, true, 'LE-1b: Run evidence names the cohort projection');
assertEqual(diagnostics.mortality.qxTableHash, GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.mortality.target.qxTableHash, 'LE-1b: Run evidence names the target table hash');
assertEqual(diagnostics.mortality.careCalibrationTable.tableType, 'period', 'Period table stays visible as care calibration table');
assertEqual(diagnostics.care.observedPrevalenceRuntimeRole, 'context_only_not_runtime_validation_or_transition_probability', 'Diagnostics should expose the prevalence boundary');
assertEqual(diagnostics.survivor.defaultMode, 'percent', 'Diagnostics should expose survivor default');
console.log('✓ runtime projection and diagnostics OK');

console.log('Test 6: read-only generator reconstruction is byte-identical');
const verification = spawnSync(
    process.execPath,
    ['scripts/build-german-demography-care-survivor-contract.mjs', '--verify-only'],
    { cwd: projectRoot, encoding: 'utf8', windowsHide: true }
);
assertEqual(verification.status, 0, `Demography generator verification should succeed: ${verification.stderr}`);
assert(
    verification.stdout.includes(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.mortalityTableHash),
    'Generator verification should report the mortality hash'
);
console.log('✓ byte-identical generator verification OK');

console.log('✅ German demography/care/survivor contract tests passed');
