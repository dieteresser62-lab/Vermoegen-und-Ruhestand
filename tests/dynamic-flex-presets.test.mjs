import { dynamicFlexPresetPatch, detectDynamicFlexPreset, DYNAMIC_FLEX_OPTIONS } from '../app/shared/dynamic-flex-presets.js';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';

// Fachwerte absichtlich unabhängig von der Produktquelle festgeschrieben.
const expected = {
    off: [false, 'survival_quantile', 30, .85, false, 1],
    konservativ: [true, 'survival_quantile', 35, .9, false, 1],
    ausgewogen: [true, 'survival_quantile', 30, .85, true, 1.1],
    offensiv: [true, 'mean', 25, .75, true, 1.2]
};
assertEqual(DYNAMIC_FLEX_OPTIONS.map(([, label]) => label).join(' · '), 'Aus · Konservativ · Ausgewogen · Offensiv · Benutzerdefiniert', 'Verbindliche Segmentreihenfolge');
for (const [key, [dynamicFlex, horizonMethod, horizonYears, survivalQuantile, goGoActive, goGoMultiplier]] of Object.entries(expected)) {
    const values = { dynamicFlex, horizonMethod, horizonYears, survivalQuantile, goGoActive, goGoMultiplier,
        longevityMode: 'none', longevityQuantileShift: .05, longevityRelativePct: .05, longevityBufferYears: 2 };
    assertEqual(JSON.stringify(dynamicFlexPresetPatch(key)), JSON.stringify(values), key + ': exakter vollständiger Patch');
    const plan = { ...structuredClone(PLAN_DEFAULTS), ...values }, before = JSON.stringify(plan);
    assertEqual(detectDynamicFlexPreset(plan), key, key + ': fest vorgegebener Plan erkannt');
    assertEqual(JSON.stringify(plan), before, key + ': Erkennung ist lesend');
    assertEqual(detectDynamicFlexPreset({ ...plan, longevityQuantileShift: .07, longevityRelativePct: .12, longevityBufferYears: 7 }), key, key + ': inaktive Unterwerte nicht verglichen');
}
const balanced = { ...PLAN_DEFAULTS, dynamicFlex: true, horizonMethod: 'survival_quantile', horizonYears: 30,
    survivalQuantile: .85, goGoActive: true, goGoMultiplier: 1.1, longevityMode: 'none' };
assertEqual(detectDynamicFlexPreset({ ...balanced, horizonYears: 30 + 5e-10 }), 'ausgewogen', 'Toleranz innerhalb 1e-9');
assertEqual(detectDynamicFlexPreset({ ...balanced, survivalQuantile: .85 + 2e-9 }), 'custom', 'Abweichung außerhalb Toleranz');
assertEqual(detectDynamicFlexPreset({ ...balanced, horizonYears: NaN }), 'custom', 'Ungültige Zahl ist kein Preset');
assertEqual(detectDynamicFlexPreset({ ...balanced, dynamicFlex: false, horizonYears: 43, longevityMode: 'buffer_years' }), 'off', 'Aus mit abweichenden erhaltenen Details');
assertEqual(detectDynamicFlexPreset({ ...balanced, goGoMultiplier: 1.17 }), 'custom', 'Aktive eigene Fachwerte');
assertEqual(dynamicFlexPresetPatch('custom'), undefined, 'Custom erzeugt keinen festen Wertpatch');
const patch = dynamicFlexPresetPatch('ausgewogen'); patch.horizonYears = 99;
assertEqual(dynamicFlexPresetPatch('ausgewogen').horizonYears, 30, 'Patchmutation verändert gemeinsame Quelle nicht');

assertEqual(dynamicFlexPresetPatch('toString'), undefined, 'Unbekannte Schlüssel erzeugen keinen Fachpatch');
