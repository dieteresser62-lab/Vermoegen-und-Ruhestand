// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { staticEntry, resolved, notApplicable } from './entry-builders.js';
import { GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT } from '../german-demography-care-survivor-contract.js';
import { GERMAN_COHORT_LIFE_TABLE } from '../german-cohort-life-table.js';

export const mortality_table = staticEntry({
        id: 'mortality_table',
        category: 'demography',
        label: 'Annual mortality probabilities by age and gender',
        evidenceClass: 'official',
        implementationLocations: [
            'app/simulator/german-demography-care-survivor-contract.js:MORTALITY_TABLE',
            'app/simulator/target-mortality.js'
        ],
        unit: 'annual_probability_ratio',
        rawDataHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.sourceFiles.mortality.sha256),
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.mortalityTableHash),
        source: resolved('Destatis Statistischer Bericht Sterbetafeln 2023/2025 (EVAS 12621), Tabellen 12613-b01 und 12613-b02'),
        seriesIdentifier: resolved('GermanDemographyCareSurvivorContractV1.mortality.table'),
        yearConvention: resolved('period_table_probability_applied_at_simulated_age'),
        transformation: resolved('Official male/female qx at attained age 18-100; legacy model tail 101-110; divers is the unweighted male/female qx mean. No cohort shift or future mortality improvement. Since FR-75 used for the FR-41 care calibration, callers without a birth year and the cohort tail above 99; runtime target is cohort_life_table.'),
        license: resolved('Data Licence Germany - attribution - version 2.0'),
        retrievedAt: resolved('2026-08-01'),
        contractValue: {
            tableType: 'period',
            officialPeriod: '2023/2025',
            officialAgeRange: { startAge: 0, endAge: 100 },
            runtimeAgeRange: { startAge: 18, endAge: 110 },
            modelTailAgeRange: { startAge: 101, endAge: 110 },
            cohortProjection: false,
            futureMortalityImprovement: false
        },
        externalValidationStatus: 'not_validated'
    });

export const cohort_life_table = staticEntry({
        id: 'cohort_life_table',
        category: 'demography',
        label: 'Cohort mortality target by birth year, age and gender (FR-75)',
        evidenceClass: 'official',
        implementationLocations: [
            'app/simulator/german-cohort-life-table.js:GERMAN_COHORT_LIFE_TABLE',
            'app/simulator/target-mortality.js'
        ],
        unit: 'annual_probability_ratio',
        rawDataHash: resolved(GERMAN_COHORT_LIFE_TABLE.source.sha256),
        embeddedValueHash: resolved(GERMAN_COHORT_LIFE_TABLE.hashes.qxTableHash),
        source: resolved(GERMAN_COHORT_LIFE_TABLE.source.sourceSeries),
        seriesIdentifier: resolved('GermanCohortLifeTableV1.qx'),
        yearConvention: resolved('cohort_table_probability_applied_at_attained_age_of_birth_year'),
        transformation: resolved('Variant V2 (mittel) qx for birth years 1926-2026 and ages 18-99, unchanged. Ages 100-109: period tail times cohort/period ratio at 99; 110 terminal; divers unweighted mean; birth years outside the range use the edge year. Base mortality without care is lowered per person by an exact Markov calculation so that total mortality equals this target.'),
        license: resolved(GERMAN_COHORT_LIFE_TABLE.source.license),
        retrievedAt: resolved(GERMAN_COHORT_LIFE_TABLE.source.retrievedAt),
        contractValue: {
            tableType: 'cohort',
            variant: 'V2',
            birthYearRange: { first: 1926, last: 2026 },
            officialAgeRange: { startAge: 18, endAge: 99 },
            modelTailAgeRange: { startAge: 100, endAge: 110 },
            cohortProjection: true
        },
        externalValidationStatus: 'not_validated'
    });

export const care_grade_taxonomy = staticEntry({
        id: 'care_grade_taxonomy',
        category: 'care',
        label: 'Supported care grades and labels',
        evidenceClass: 'official',
        implementationLocations: [
            'app/simulator/german-demography-care-survivor-contract.js:SUPPORTED_PFLEGE_GRADES',
            'app/simulator/german-demography-care-survivor-contract.js:PFLEGE_GRADE_LABELS'
        ],
        unit: 'ordinal_grade',
        rawDataHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.sourceFiles.care.sha256),
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.careTaxonomyHash),
        source: resolved('Destatis Pflegestatistik 2023, Pflegegrade 1-5'),
        seriesIdentifier: resolved('GermanDemographyCareSurvivorContractV1.care.taxonomy'),
        transformation: resolved('Official grade identifiers with simulator display labels.'),
        license: resolved('Data Licence Germany - attribution - version 2.0'),
        retrievedAt: resolved('2026-08-01'),
        externalValidationStatus: 'not_validated'
    });

export const care_observed_prevalence = staticEntry({
        id: 'care_observed_prevalence',
        category: 'care',
        label: 'Observed care prevalence by age and sex at year-end 2023',
        evidenceClass: 'official',
        implementationLocations: [
            'app/simulator/german-demography-care-survivor-contract.js:care.officialObservation'
        ],
        unit: 'percent_of_population_at_reporting_date',
        rawDataHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.sourceFiles.care.sha256),
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.careObservationHash),
        source: resolved('Destatis Pflegestatistik 2023, Tabellen 22421-01 und 22421-02'),
        seriesIdentifier: resolved('GermanDemographyCareSurvivorContractV1.care.officialObservation'),
        yearConvention: resolved('observed_stock_and_prevalence_at_2023_12_31'),
        transformation: resolved('Context evidence only; no runtime validation is performed and use as an annual entry or progression probability is explicitly prohibited.'),
        license: resolved('Data Licence Germany - attribution - version 2.0'),
        retrievedAt: resolved('2026-08-01'),
        contractValue: {
            runtimeRole: 'context_only_not_runtime_validation_or_transition_probability',
            referenceDate: '2023-12-31'
        },
        externalValidationStatus: 'not_validated'
    });

export const care_incidence_probabilities = staticEntry({
        id: 'care_incidence_probabilities',
        category: 'care',
        label: 'Age- and sex-bucketed annual care-entry probabilities by grade',
        evidenceClass: 'model_assumption',
        implementationLocations: ['app/simulator/german-demography-care-survivor-contract.js:PFLEGE_GRADE_PROBABILITIES_BY_SEX'],
        unit: 'annual_probability_ratio',
        rawDataHash: notApplicable(),
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.careEntryModelHash),
        source: resolved('Model calibration target: Destatis Pflegestatistik 2023, 22421-01/-02 (FR-41)'),
        seriesIdentifier: resolved('GermanDemographyCareSurvivorContractV1.care.entryModel'),
        yearConvention: resolved('annual_entry_probability_at_simulated_age_bucket'),
        transformation: resolved('exakt auf Destatis-Pflegestatistik 2023 abgestimmt mit der Grundsterblichkeit ohne Pflege nach FR-75 (FR-41); scripts/retune-care-model.mjs, MC-Prüfung scripts/calibrate-care-model.mjs. Separate male/female entry tables with nondecreasing PG1+PG2 totals, divers unweighted mean; initial grades 1/2. Offline cohort starts with observed stock (ages 60-64 as proxy at 65, m 4.25%, w 4.42%); simulator starts without care. No prevalence-to-incidence division; not externally validated.'),
        license: notApplicable(),
        retrievedAt: notApplicable(),
        contractValue: {
            eligibleInitialGrades: [1, 2],
            minimumEntryAge: 65,
            derivedFromObservedPrevalence: false
        },
        externalValidationStatus: 'not_validated'
    });

export const care_progression_probabilities = staticEntry({
        id: 'care_progression_probabilities',
        category: 'care',
        label: 'Annual care-grade progression probabilities',
        evidenceClass: 'model_assumption',
        implementationLocations: ['app/simulator/german-demography-care-survivor-contract.js:PFLEGE_GRADE_PROGRESSION_PROBABILITIES'],
        unit: 'annual_probability_ratio',
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.careProgressionModelHash),
        yearConvention: resolved('annual_transition_to_next_care_grade'),
        transformation: resolved('exakt auf Destatis-Pflegestatistik 2023 abgestimmt mit der Grundsterblichkeit ohne Pflege nach FR-75 (FR-41), progression x 0.75; annual one-grade progression; grade-share target uses all ages because 22421-01/-02 have no age-by-grade cross-tabulation. Current-grade mortality factors apply from year one, defaults 1.5/2/3/4/5; not externally validated.'),
        contractValue: {
            derivedFromObservedPrevalence: false
        },
        externalValidationStatus: 'not_validated'
    });

export const care_cost_presets = staticEntry({
        id: 'care_cost_presets',
        category: 'care',
        label: 'Care-cost UI presets',
        evidenceClass: 'model_assumption',
        implementationLocations: ['app/shared/care-price-fields.js:PFLEGE_COST_PRESETS'],
        unit: 'eur_per_year',
        currency: resolved('EUR'),
        source: resolved('Preset amtlich: Destatis Pflegestatistik 2023, Tabelle 22421-01 (I34:I38 / C34:C38); vdek press release 14.07.2026, https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html (reference date 01.07.2026). Other presets: scenario assumptions.'),
        seriesIdentifier: resolved('PFLEGE_COST_PRESETS.amtlich.values'),
        yearConvention: resolved('annual_user_input_at_simulation_start_prices'),
        transformation: resolved('Preset amtlich: exact nursing-home share per grade (4344/785822, 132378/2300753, 297955/1686286, 248626/669263, 114191/244252) × EUR 3364 per month in the first home year × 12, rounded to EUR 100. Home care assumes zero additional out-of-pocket cost; the result averages all care recipients, not home residents alone. FR-47: this preset remains net with care allowance already offset; no allowance income or per-grade care form. FR-72 point 7: in Monte Carlo the schedule is replaced by a drawn form; each person draws one uniform number U from its own CARE_FORM stream, lives in a home while U is below the share of the active grade (then residential costs replace the home floor share) and otherwise adds zero at home. FR-73: Backtest uses the known current form and advances residential years; at home the net addition and care allowance are zero. Balance keeps its previous calculation in package PFA-1. Other schedules use family, home-support or residential care; defaults are family for grades 1–2, home-support for grade 3 and residential for grades 4–5. The personal current form applies until the first grade change. Not an official cost statistic or an externally validated model.'),
        retrievedAt: resolved('2026-10-21'),
        embeddedValueHash: resolved('6b1a15a280413c8d2c017c3797a261aef584e920a136d0f8696540defe0d5c66'),
        externalValidationStatus: 'not_validated'
    });

export const widow_benefit_parameters = staticEntry({
        id: 'widow_benefit_parameters',
        category: 'survivor',
        label: 'Widow-benefit mode and percentage user defaults',
        evidenceClass: 'user_input',
        implementationLocations: [
            'Simulator.html:#widowPensionMode',
            'Simulator.html:#widowPensionPct',
            'Simulator.html:#survivorFloorPercent',
            'app/simulator/simulator-household-pension.js:CURRENT_PENSION_VALUE',
            'app/simulator/simulator-input-pension.js:readWidowOptions'
        ],
        unit: 'percent_of_partner_pension',
        source: resolved('Deutsche Rentenversicherung, Renten an Hinterbliebene (reference only)'),
        seriesIdentifier: resolved('GermanDemographyCareSurvivorContractV1.survivor.runtimeContract'),
        yearConvention: resolved('scenario_cash_flow_after_partner_death_subject_to configured marriage timing'),
        transformation: resolved('User-selected percentage with monthly own-pension income offset (14% deduction, 26.4 pension values exempt, 40% offset), half-year death and eligible death quarter; no full statutory eligibility assessment.'),
        license: notApplicable(),
        retrievedAt: resolved('2026-08-01'),
        rawDataHash: notApplicable(),
        embeddedValueHash: resolved(GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.hashes.survivorRuntimeContractHash),
        contractValue: GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT.survivor.runtimeContract,
        externalValidationStatus: 'not_validated'
    });
