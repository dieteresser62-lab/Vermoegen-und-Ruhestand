import { LONGEVITY_DEFAULTS } from '../simulator/dynamic-flex-longevity-contract.js';

export const DYNAMIC_FLEX_PRESETS = {
    off: {
        dynamicFlex: false,
        horizonMethod: 'survival_quantile',
        horizonYears: 30,
        survivalQuantile: 0.85,
        goGoActive: false,
        goGoMultiplier: 1.0,
        longevityMode: 'none'
    },
    konservativ: {
        dynamicFlex: true,
        horizonMethod: 'survival_quantile',
        horizonYears: 35,
        survivalQuantile: 0.9,
        goGoActive: false,
        goGoMultiplier: 1.0,
        longevityMode: 'none'
    },
    ausgewogen: {
        dynamicFlex: true,
        horizonMethod: 'survival_quantile',
        horizonYears: 30,
        survivalQuantile: 0.85,
        goGoActive: true,
        goGoMultiplier: 1.1,
        longevityMode: 'none'
    },
    offensiv: {
        dynamicFlex: true,
        horizonMethod: 'mean',
        horizonYears: 25,
        survivalQuantile: 0.75,
        goGoActive: true,
        goGoMultiplier: 1.2,
        longevityMode: 'none'
    }
};

export const DYNAMIC_FLEX_OPTIONS = Object.freeze([
    ['off', 'Aus'], ['konservativ', 'Konservativ'], ['ausgewogen', 'Ausgewogen'],
    ['offensiv', 'Offensiv'], ['custom', 'Benutzerdefiniert']
].map(option => Object.freeze(option)));
for (const preset of Object.values(DYNAMIC_FLEX_PRESETS)) Object.freeze(preset);
Object.freeze(DYNAMIC_FLEX_PRESETS);

/** Neuer Patch, ausschließlich bestehende Dynamikfelder; keine Presetkennung. */
export function dynamicFlexPresetPatch(key) {
    if (!Object.hasOwn(DYNAMIC_FLEX_PRESETS, key)) return undefined;
    const preset = DYNAMIC_FLEX_PRESETS[key];
    return { ...preset, longevityQuantileShift: LONGEVITY_DEFAULTS.quantileShift,
        longevityRelativePct: LONGEVITY_DEFAULTS.relativePct, longevityBufferYears: LONGEVITY_DEFAULTS.bufferYears };
}

/** Erkennung ist lesend; inaktive Langlebigkeitsdetails zählen wie bisher nicht. */
export function detectDynamicFlexPreset(values) {
    if (values?.dynamicFlex === false) return 'off';
    return Object.entries(DYNAMIC_FLEX_PRESETS).find(([, preset]) =>
        Object.entries(preset).every(([path, expected]) => typeof expected === 'number'
            ? Number.isFinite(values?.[path]) && Math.abs(values[path] - expected) < 1e-9
            : values?.[path] === expected))?.[0] || 'custom';
}
