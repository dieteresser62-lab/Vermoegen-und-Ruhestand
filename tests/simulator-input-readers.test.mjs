import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { parseBoundedNumber } from '../app/simulator/simulator-input-dom.js';
import { readPartnerInputs, readPensionInputs, readWidowOptions } from '../app/simulator/simulator-input-pension.js';
import {
    normalizeDecumulationMode,
    readAccumulationInputs,
    readBasePortfolioInputs,
    readDecumulationInputs,
    readDynamicFlexInputs,
    readStrategyInputs
} from '../app/simulator/simulator-input-strategy.js';
import { SimulatorValidationError, validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { readTrancheInputs, SimulatorTrancheInputError } from '../app/simulator/simulator-input-tranches.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { STRATEGY_OPTIONS } from '../types/strategy-options.js';

console.log('--- Simulator Input Reader Tests ---');

function createDocumentMock(values = {}) {
    values = { startAlter: '67', ...values };
    return {
        getElementById(id) {
            if (!Object.prototype.hasOwnProperty.call(values, id)) return null;
            const entry = values[id];
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                return {
                    value: entry.value ?? '',
                    checked: entry.checked ?? false
                };
            }
            return { value: entry, checked: false };
        }
    };
}

console.log('Test 1: bounded parser handles comma and clamps');
{
    assertEqual(parseBoundedNumber('1,75', 0, 1, 2), 1.75, 'Comma decimal should parse');
    assertEqual(parseBoundedNumber('99', 0, 1, 2), 2, 'Value should clamp to max');
    assertEqual(parseBoundedNumber('x', 7, 1, 2), 7, 'Invalid value should fallback');
}
console.log('✓ bounded parser OK');

console.log('Test 2: pension readers preserve legacy fallbacks');
{
    const doc = createDocumentMock({
        startAlter: '66',
        geschlecht: 'm',
        startSPB: '1200',
        kirchensteuerSatz: '9',
        renteMonatlich: '1800',
        renteStartOffsetJahre: '2',
        r2Brutto: '24000',
        widowPensionMode: 'percent',
        widowPensionPct: '55',
        widowMarriageOffsetYears: '3',
        widowMinMarriageYears: '5'
    });
    const p1 = readPensionInputs(doc);
    const p2 = readPartnerInputs(doc);
    const widow = readWidowOptions(doc).widowOptions;

    assertEqual(p1.startAlter, 66, 'P1 start age should fallback to legacy startAlter');
    assertEqual(p1.geschlecht, 'm', 'P1 gender should fallback to legacy geschlecht');
    assertEqual(p1.kirchensteuerSatz, 0.09, 'Church tax should convert pct to ratio');
    assertEqual(p2.partner.monatsrente, 2000, 'P2 monthly pension should migrate from annual legacy value');
    assertEqual(p2.partner.brutto, 24000, 'P2 legacy brutto alias should remain annualized');
    assertEqual(widow.percent, 0.55, 'Widow percent should normalize to ratio');
    assertEqual(widow.marriageOffsetYears, 3, 'Widow marriage offset should parse');
    assertEqual(widow.minMarriageYears, 5, 'Widow minimum marriage years should parse');
}
console.log('✓ pension legacy fallbacks OK');

console.log('Test 2b: missing widow fields use the documented contract defaults');
{
    const widow = readWidowOptions(createDocumentMock()).widowOptions;
    assertEqual(widow.mode, 'percent', 'Missing widow mode should use the documented percent default');
    assertEqual(widow.percent, 0.55, 'Missing widow percent should use the documented 55 percent default');
}
console.log('✓ widow contract defaults OK');

console.log('Test 3: tranche reader prioritizes profile override');
{
    const override = [{ trancheId: 'override', marketValue: 1, metadata: { owner: 'profile-a' } }];
    const storage = {
        getItem() {
            return JSON.stringify([{ trancheId: 'storage', marketValue: 2 }]);
        }
    };
    const result = readTrancheInputs({
        win: { __profilverbundTranchenOverride: override, __profilverbundPreferAggregates: false },
        storage
    });
    assertEqual(result.detailledTranches[0].trancheId, 'override', 'Override should win over storage');
    result.detailledTranches[0].metadata.owner = 'mutated';
    assertEqual(override[0].metadata.owner, 'profile-a', 'Override should be deeply isolated before simulation');

    const explicitEmpty = readTrancheInputs({
        win: { __profilverbundTranchenOverride: [], __profilverbundPreferAggregates: false },
        storage
    });
    assert(Array.isArray(explicitEmpty.detailledTranches), 'Explicit empty override should remain an array');
    assertEqual(explicitEmpty.detailledTranches.length, 0, 'Explicit empty override must not fall back to storage');

    const aggregateResult = readTrancheInputs({
        win: { __profilverbundPreferAggregates: true },
        storage
    });
    assertEqual(aggregateResult.detailledTranches, null, 'Prefer aggregates should skip localStorage tranches');

    let corruptOverride = null;
    try {
        readTrancheInputs({ win: { __profilverbundTranchenOverride: { invalid: true } }, storage });
    } catch (error) {
        corruptOverride = error;
    }
    assert(corruptOverride instanceof SimulatorTrancheInputError, 'Corrupt override should fail closed');

    let corruptStorage = null;
    try {
        readTrancheInputs({ win: {}, storage: { getItem: () => '{invalid' } });
    } catch (error) {
        corruptStorage = error;
    }
    assert(corruptStorage instanceof SimulatorTrancheInputError, 'Corrupt storage should fail closed instead of using aggregates');
}
console.log('✓ tranche priority OK');

console.log('Test 4: strategy readers preserve bounds and normalization');
{
    const doc = createDocumentMock({
        dynamicFlex: { checked: true },
        horizonMethod: 'invalid',
        horizonYears: '120',
        survivalQuantile: '0.1',
        goGoActive: { checked: true },
        goGoMultiplier: '2',
        marketCapeRatio: '31.4',
        entnahmeStrategie: 'vpw',
        enableAccumulationPhase: { checked: true },
        accumulationDurationYears: '4',
        accumulationSparrate: '500',
        sparrateIndexing: 'inflation'
    });
    const dynamicFlex = readDynamicFlexInputs(doc);
    const decumulation = readDecumulationInputs(doc).decumulation;
    const accumulation = readAccumulationInputs({ startAlter: 63, doc });

    assertEqual(dynamicFlex.horizonMethod, 'survival_quantile', 'Invalid horizon method should fallback');
    assertEqual(dynamicFlex.horizonYears, 60, 'Horizon should clamp to max');
    assertEqual(dynamicFlex.survivalQuantile, 0.5, 'Quantile should clamp to min');
    assertEqual(dynamicFlex.goGoMultiplier, 1.5, 'Go-Go multiplier should clamp to max');
    assertEqual(dynamicFlex.capeRatio, 31.4, 'CAPE alias should be in sync');
    assertEqual(decumulation.mode, STRATEGY_OPTIONS.STANDARD, 'Legacy strategy mode should normalize to standard');
    assertEqual(normalizeDecumulationMode(STRATEGY_OPTIONS.THREE_BUCKET_JILGE), STRATEGY_OPTIONS.THREE_BUCKET_JILGE, '3-bucket mode should remain supported');
    assertEqual(accumulation.transitionYear, 0, 'Legacy-Ansparcontrols aktivieren keinen Simulatorrequest');
    assertEqual(accumulation.transitionAge, 63, 'Entnahme beginnt unverändert am Startalter');
    assertEqual(JSON.stringify(accumulation.accumulationPhase), JSON.stringify({ enabled: false, durationYears: 0, sparrate: 0, sparrateIndexing: 'none' }), 'Ausgeschaltete Ansparstruktur bleibt bytegleich');
}
console.log('✓ strategy readers OK');

console.log('Test 4b: strategy reader exposes only the canonical runway input');
{
    const canonical = readStrategyInputs(createDocumentMock({ liquidityRunwayYears: '6.5' }));
    assertEqual(canonical.liquidityRunwayYears, 6.5, 'Canonical runway years should be read without unit conversion');
    assert(!Object.hasOwn(canonical, 'runwayMinMonths'), 'Reader should not emit legacy runway minimum');
    assert(!Object.hasOwn(canonical, 'runwayTargetMonths'), 'Reader should not emit legacy runway target');
    assert(!Object.hasOwn(canonical, 'targetEq'), 'Reader should not emit the removed equity target');

    const migrated = readStrategyInputs(createDocumentMock({
        runwayMinMonths: '24',
        runwayTargetMonths: '42'
    }));
    assertEqual(migrated.liquidityRunwayYears, 3.5, 'Legacy target months should migrate before the legacy minimum');

    const defaults = readStrategyInputs(createDocumentMock());
    assertEqual(defaults.liquidityRunwayYears, 5, 'Missing strategy runway should use the five-year default');
}
console.log('✓ canonical runway reader OK');

console.log('Test 5: care reader tolerates missing DOM fields');
{
    const care = readCareInputs({ gender: 'w', doc: createDocumentMock() });
    assertEqual(care.pflegefallLogikAktivieren, false, 'Missing care toggle should default to false');
    assert(care.pflegeGradeConfigs && typeof care.pflegeGradeConfigs === 'object', 'Care grade config should exist');
    assertEqual(care.pflegeKostenDrift, 0.035, 'Care drift should use default ratio');
    assertEqual(
        readCareInputs({ doc: createDocumentMock({ pflegeKostenDrift: '0' }) }).pflegeKostenDrift,
        0,
        'Zero care drift percent should remain the neutral ratio'
    );
    assertEqual(
        readCareInputs({ doc: createDocumentMock({ pflegeKostenDrift: '3.5' }) }).pflegeKostenDrift,
        0.035,
        '3.5 care drift percent should normalize exactly once'
    );
    assertEqual(
        readCareInputs({ doc: createDocumentMock({ pflegeKostenDrift: '100' }) }).pflegeKostenDrift,
        1,
        '100 care drift percent should normalize to ratio 1'
    );
    assertEqual(
        readCareInputs({ doc: createDocumentMock({ pflegeKostenDrift: '-1' }) }).pflegeKostenDrift,
        0,
        'Negative UI care drift should normalize to the neutral ratio'
    );
    assertEqual(
        readCareInputs({ doc: createDocumentMock({ pflegeKostenDrift: 'invalid' }) }).pflegeKostenDrift,
        0.035,
        'Invalid UI care drift should use the documented 3.5 percent fallback'
    );
}
console.log('✓ care reader missing DOM defaults OK');

console.log('Test 6: base reader and validator handle minimum flex');
{
    const doc = createDocumentMock({
        tagesgeld: '10.000',
        geldmarktEtf: '5.000',
        simStartVermoegen: '100.000',
        depotwertAlt: '85',
        einstandAlt: '70',
        startFloorBedarf: '24000',
        startFlexBedarf: '12000',
        minimumFlexAnnual: '6000',
        goldAllokationAktiv: 'false'
    });
    const base = readBasePortfolioInputs(doc);
    assertEqual(base.minimumFlexAnnual, 6000, 'Mindest-Flex sollte aus dem Simulator-DOM gelesen werden');
    validateSimulatorInputs(base);

    let thrown = null;
    try {
        validateSimulatorInputs({ startFlexBedarf: 12000, minimumFlexAnnual: 12001 });
    } catch (error) {
        thrown = error;
    }
    assert(thrown instanceof SimulatorValidationError, 'Mindest-Flex > Flex-Bedarf sollte validieren');
    assert(thrown.errors.some(e => e.fieldId === 'minimumFlexAnnual'), 'Fehler markiert minimumFlexAnnual');
    assert(thrown.errors.some(e => e.fieldId === 'startFlexBedarf'), 'Fehler markiert startFlexBedarf');

    let negative = null;
    try {
        validateSimulatorInputs({ startFlexBedarf: 12000, minimumFlexAnnual: -1 });
    } catch (error) {
        negative = error;
    }
    assert(negative instanceof SimulatorValidationError, 'Negativer Mindest-Flex sollte validieren');
    assert(negative.errors.some(e => e.fieldId === 'minimumFlexAnnual'), 'Negativer Fehler markiert minimumFlexAnnual');
}
console.log('✓ minimum flex reader/validator OK');

console.log('Test 7: getCommonInputs preserves profilverbund minimum-flex split');
{
    const previousWindow = global.window;
    const previousDocument = global.document;
    try {
        global.window = {
            __profilverbundMinimumFlexProfiles: [
                { profileId: 'a', name: 'A', minimumFlexAnnual: 0 },
                { profileId: 'b', name: 'B', minimumFlexAnnual: 2500 }
            ],
            __profilverbundPreferAggregates: true
        };
        global.document = createDocumentMock({
            tagesgeld: '10.000',
            geldmarktEtf: '5.000',
            simStartVermoegen: '100.000',
            depotwertAlt: '85',
            einstandAlt: '70',
            startFloorBedarf: '24000',
            startFlexBedarf: '12000',
            minimumFlexAnnual: '2500',
            goldAllokationAktiv: 'false',
            p1StartAlter: '65',
            p1Geschlecht: 'm'
        });
        const inputs = getCommonInputs();
        assertEqual(inputs.minimumFlexAnnual, 2500, 'Aggregierter Mindest-Flex sollte im DOM-Wert bleiben');
        assertEqual(inputs.minimumFlexProfiles.length, 2, 'Profilgenaue Mindest-Flex-Aufteilung sollte erhalten bleiben');
        assertEqual(inputs.minimumFlexProfiles[1].minimumFlexAnnual, 2500, 'Profil B Mindest-Flex sollte erhalten bleiben');
        inputs.minimumFlexProfiles[1].minimumFlexAnnual = 1;
        assertEqual(global.window.__profilverbundMinimumFlexProfiles[1].minimumFlexAnnual, 2500, 'getCommonInputs sollte den Profil-Split kopieren');
    } finally {
        if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
        if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    }
}
console.log('✓ profilverbund minimum-flex split preserved OK');

console.log('Test 8: getCommonInputs and validator enforce tail-risk UI contract');
{
    const previousWindow = global.window;
    const previousDocument = global.document;
    try {
        global.window = { __profilverbundPreferAggregates: true };
        global.document = createDocumentMock({
            tagesgeld: '10.000',
            geldmarktEtf: '5.000',
            simStartVermoegen: '100.000',
            depotwertAlt: '85',
            einstandAlt: '70',
            startFloorBedarf: '24000',
            startFlexBedarf: '12000',
            minimumFlexAnnual: '0',
            goldAllokationAktiv: 'false',
            p1StartAlter: '65',
            p1Geschlecht: 'm',
            mcDauer: '35',
            tailRiskEnabled: { checked: true },
            tailRiskAnnualProbabilityPct: '1.5',
            tailRiskReturnShockPct: '-35',
            tailRiskInflationShockPct: '6',
            tailRiskDurationYears: '3',
            tailRiskCooldownYears: '10'
        });
        const inputs = getCommonInputs();
        assertEqual(inputs.tailRiskEnabled, true, 'Tail-risk opt-in should be read from checkbox');
        assertEqual(inputs.tailRiskAnnualProbabilityPct, 1.5, 'Tail-risk probability should parse as number');
        assertEqual(inputs.tailRiskDurationYears, 3, 'Tail-risk duration should parse as integer');
        assertEqual(inputs.tailRiskConfigValid, true, 'Valid tail-risk UI config should remain valid');
        validateSimulatorInputs(inputs);

        global.document = createDocumentMock({
            startFlexBedarf: '12000',
            minimumFlexAnnual: '0',
            mcDauer: '2',
            tailRiskEnabled: { checked: true },
            tailRiskAnnualProbabilityPct: '9',
            tailRiskReturnShockPct: '-35',
            tailRiskInflationShockPct: '6',
            tailRiskDurationYears: '3',
            tailRiskCooldownYears: '10'
        });
        const invalidInputs = getCommonInputs();
        let thrown = null;
        try {
            validateSimulatorInputs(invalidInputs);
        } catch (error) {
            thrown = error;
        }
        assert(thrown instanceof SimulatorValidationError, 'Invalid tail-risk config should block validation');
        assert(thrown.errors.some(e => e.fieldId === 'tailRiskAnnualProbabilityPct'), 'Probability range error should be reported');

        global.document = createDocumentMock({
            startFlexBedarf: '12000',
            minimumFlexAnnual: '0',
            mcDauer: '2',
            tailRiskEnabled: { checked: true },
            tailRiskAnnualProbabilityPct: '1',
            tailRiskReturnShockPct: '-35',
            tailRiskInflationShockPct: '6',
            tailRiskDurationYears: '3',
            tailRiskCooldownYears: '10'
        });
        const invalidHorizonInputs = getCommonInputs();
        let horizonError = null;
        try {
            validateSimulatorInputs(invalidHorizonInputs);
        } catch (error) {
            horizonError = error;
        }
        assert(horizonError instanceof SimulatorValidationError, 'Tail-risk duration beyond horizon should block validation');
        assert(horizonError.errors.some(e => e.fieldId === 'tailRiskDurationYears'), 'Duration horizon error should be reported');
    } finally {
        if (previousWindow === undefined) delete global.window; else global.window = previousWindow;
        if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
    }
}
console.log('✓ tail-risk UI contract validation OK');

console.log('✅ Simulator input reader tests passed');

// Optierung ausschließlich über den gemeinsamen Planadapter; Leser erhalten Kanonik.
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { bindHouseholdPlanField } = await import('../app/shared/household-plan-fields.js');
    const { readNumber, readBoundedNumber, readInt } = await import('../app/simulator/simulator-input-dom.js');
    const doc = createSelectionDocument(), bindings = new Map();
    for (const [id, path, value] of [
        ['startFloorBedarf', 'floorBedarf', 30000.254987], ['startFlexBedarf', 'flexBedarf', 33000],
        ['survivalQuantile', 'survivalQuantile', .853456789], ['goGoMultiplier', 'goGoMultiplier', 1.123456789],
        ['longevityRelativePct', 'longevityRelativePct', .07], ['maxSkimPctOfEq', 'maxSkimPctOfEq', 10],
        ['bondTargetFactor', 'decumulation.bondTargetFactor', 5], ['drawdownTrigger', 'decumulation.drawdownTrigger', 15],
        ['bondRefillThreshold', 'decumulation.bondRefillThreshold', null], ['horizonYears', 'horizonYears', 30]
    ]) {
        const field = addField(doc, id), binding = bindHouseholdPlanField({ doc, field, path });
        binding.project(value); bindings.set(id, binding);
        const before = readNumber(id, 0, doc);
        field.dispatchEvent({ type: 'focus' });
        binding.project(value);
        field.dispatchEvent({ type: 'blur' });
        assertEqual(readNumber(id, 0, doc), before, id + ': Fokus/Blur und Projektion erhalten kanonische Lesereingabe');
    }
    assertEqual(readBasePortfolioInputs(doc).startFloorBedarf, 30000.254987, 'Portfolio-Leser bewahrt ungerundeten Planbetrag');
    const flex = readDynamicFlexInputs(doc);
    assertEqual(flex.survivalQuantile, .853456789, 'Dynamikleser skaliert Quantil genau einmal');
    assertEqual(flex.longevityRelativePct, .07, 'Dynamikleser skaliert relativen Anteil genau einmal');
    assertEqual(flex.goGoMultiplier, 1.123456789, 'Dynamikleser bewahrt Faktorpräzision');
    assertEqual(JSON.stringify(readDecumulationInputs(doc).decumulation), JSON.stringify({ mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }), '3-Töpfe-Leser versteht formatierte Prozent/Jahre und nullable Schwelle');
    const quantile = doc.getElementById('survivalQuantile'); quantile.value = '120 %';
    assertEqual(readBoundedNumber('survivalQuantile', .85, .5, .99, doc), 1.2, 'Optiertes Quantil wird zur fachlichen Validierung gegeben, nicht gekappt');
    quantile.value = '';
    assert(Number.isNaN(readBoundedNumber('survivalQuantile', .85, .5, .99, doc)), 'Leeres optiertes Quantil wird weder Null noch Default');
    doc.getElementById('horizonYears').value = '3,5 Jahre';
    assert(Number.isNaN(readInt('horizonYears', 30, doc)), 'Optierter ungültiger Ganzzahlwert bleibt ungültig');
    const legacy = addField(doc, 'unrelated', '99');
    assertEqual(readBoundedNumber('unrelated', 1, 1, 10, doc), 10, 'Nichtplanfeld behält bisherigen begrenzenden Leser');
    legacy.value = '';
    assertEqual(readNumber('unrelated', 7, doc), 7, 'Ungebundenes Altformular behält Leerwertdefault');
    bindings.forEach(binding => binding.dispose());
}

// Alle numerischen Planfelder durchlaufen den gemeinsamen Adapter und echte Reader.
import { bindHouseholdPlanField, HOUSEHOLD_PLAN_FIELDS } from '../app/shared/household-plan-fields.js';
import { PLAN_DEFAULTS, projectPlanToSimulator, SIMULATOR_PLAN_FIELD_MAP } from '../app/profile/household-plan.js';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { readNumber } from '../app/simulator/simulator-input-dom.js';
{
    const doc = createSelectionDocument(), bindings = [];
    const values = { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30600.254987, flexBedarf: 20000.123456,
        minimumFlexAnnual: 1000.123456, goGoMultiplier: 1.23456789, survivalQuantile: .873456789,
        maxSkimPctOfEq: 11.23456789, decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5.123456789,
            drawdownTrigger: 17.23456789, bondRefillThreshold: 2.123456789 } };
    const projected = projectPlanToSimulator(values);
    for (const [id, path] of Object.entries(SIMULATOR_PLAN_FIELD_MAP)) {
        const field = addField(doc, id, projected[id]);
        if (typeof projected[id] === 'boolean') { field.type = 'checkbox'; field.checked = projected[id]; }
        const spec = HOUSEHOLD_PLAN_FIELDS.find(spec => spec.path === path);
        if (!spec || spec.options || spec.checkbox) continue;
        const binding = bindHouseholdPlanField({ doc, field, row: field.parentNode, path });
        binding.project(projected[id]); bindings.push(binding);
        assertEqual(readNumber(id, NaN, doc), projected[id], id + ': formatierter Reader erhält kanonische Präzision');
        field.selectionStart = field.selectionEnd = 0;
        field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
        field.dispatchEvent({ type: 'focus' });
        assertEqual(readNumber(id, NaN, doc), projected[id], id + ': fokussierter Reader erhält kanonische Präzision');
        field.dispatchEvent({ type: 'blur' });
    }
    const input = { ...readBasePortfolioInputs(doc), ...readDynamicFlexInputs(doc), ...readStrategyInputs(doc),
        ...readDecumulationInputs(doc) };
    for (const [id, expected] of Object.entries(projected)) {
        if (typeof expected === 'number' && Object.hasOwn(input, id)) assertEqual(input[id], expected, id + ': Fachreader liest gebundene Anzeige');
    }
    for (const key of ['bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']) assertEqual(input.decumulation[key], values.decumulation[key], 'Strategiereader: ' + key);
    bindings.forEach(binding => binding.dispose());
}
