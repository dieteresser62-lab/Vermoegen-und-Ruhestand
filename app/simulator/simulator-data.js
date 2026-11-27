/** @import {AppError} from '../../typcheck/runtime-contracts.js' */
/**
 *
 * Module: Simulator Data
 * Purpose: Central repository for static simulation data.
 *          Includes historical market data (period from the Datenstand
 *          historical-datenstand.js), mortality tables, care
 *          grades/probabilities, and stress test presets.
 * Usage: Imported by various simulator modules (historical, stress, etc.).
 * Dependencies: generated global equity, German CPI, German cash/money-market,
 *               German wage, German-investor gold and US CAPE research-chain data
 */
"use strict";

import { GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS } from './global-equity-research-chain.js';
import HISTORICAL_DATENSTAND from './historical-datenstand.js';
import { HISTORICAL_DATA } from './historical-data-records.js';
export {
  GERMAN_DEMOGRAPHY_CARE_SURVIVOR_CONTRACT,
  MORTALITY_TABLE,
  PFLEGE_GRADE_LABELS,
  PFLEGE_GRADE_PROBABILITIES,
  PFLEGE_GRADE_PROBABILITIES_BY_SEX,
  PFLEGE_GRADE_PROGRESSION_PROBABILITIES,
  SUPPORTED_PFLEGE_GRADES
} from './german-demography-care-survivor-contract.js';

// --- DATA & CONFIG ---

export const ESTIMATED_HISTORY_MIN_YEAR = 1925;
export const ESTIMATED_HISTORY_MAX_YEAR = 1950;
export const ESTIMATED_HISTORY_CUTOFF_YEAR = 1951;

function deepFreezeDataMetadata(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreezeDataMetadata(child, seen);
  return Object.freeze(value);
}

/**
 * Historische Marktdaten im Zeitraum des Datenstands; erzeugt von
 * scripts/historical-data-generate.mjs aus den sechs Ketten-Ausgaben.
 *
 * Hinweis zu `global_equity_research_index`:
 * - Offene, wirtschaftsgewichtete Forschungsproxyreihe; kein Anbieterindex.
 * - 1925-1950: JST-Total-Returns als USD-Waehrungsproxy.
 * - 1951-2020: JST-Total-Returns in deutscher Anlegerwaehrung.
 * - Ab 2021: OECD-Price-Komponente plus modellierter JST-2020-
 *   Dividendenbaustein, mit EZB-Kursen in EUR umgerechnet.
 * - Quellen der Aktienlevel, Inflationsraten und Geldmarktrenditen sind
 *   ausschliesslich die jeweiligen generierten Datenmodule.
 */
export { HISTORICAL_DATENSTAND, HISTORICAL_DATA };

const ESTIMATED_HISTORY_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: ESTIMATED_HISTORY_MIN_YEAR,
    endYear: ESTIMATED_HISTORY_MAX_YEAR,
    qualityStatus: 'estimated',
    note: 'The global estimated-history exclusion follows the equity proxy through 1950; series-specific evidence segments remain authoritative.'
  })
]);
const GLOBAL_EQUITY_PROXY_SEGMENT = Object.freeze({
  startYear: 1925,
  endYear: 1950,
  qualityStatus: 'estimated',
  note: 'Open JST total-return research proxy in USD through the 1950 return; not a provider index or German-investor-currency series.'
});
/** Das modellierte OECD-Segment reicht bis zum Datenende. @param {number} endYear */
function globalEquityEstimatedSegments(endYear) {
  return Object.freeze([
    GLOBAL_EQUITY_PROXY_SEGMENT,
    Object.freeze({
      startYear: 2021,
      endYear,
      qualityStatus: 'estimated',
      note: 'Open OECD price return plus frozen country-level JST 2020 dividend return, converted with ECB reference rates.'
    })
  ]);
}
const GERMAN_CPI_ESTIMATED_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: 1925,
    endYear: 1949,
    qualityStatus: 'estimated',
    note: 'JST R6 German CPI level-change proxy before the official Destatis chain begins in 1950.'
  })
]);
const GERMAN_CASH_MONEY_MARKET_ESTIMATED_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: 1925,
    endYear: 1948,
    qualityStatus: 'estimated',
    note: 'JST short-rate proxy through 1944 plus an explicit last-observation carry-forward bridge for the unobserved market-closure years 1945-1948.'
  })
]);
const GOLD_GERMAN_INVESTOR_ESTIMATED_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: 1945,
    endYear: 1950,
    qualityStatus: 'estimated',
    note: 'Explicit zero-return bridge across the wartime/post-war market gap and German currency discontinuity; not an observed gold return.'
  })
]);
const GERMAN_GROSS_WAGE_ESTIMATED_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: 1925,
    endYear: 1946,
    qualityStatus: 'estimated',
    note: 'Annual changes derived from consecutive JST R6 DEU nominal-wage levels before the first published Destatis annual change; a macrohistory research proxy, not a statutory pension adjustment.'
  })
]);
const US_SHILLER_CAPE_ESTIMATED_SEGMENTS = Object.freeze([
  Object.freeze({
    startYear: 1925,
    endYear: 1935,
    qualityStatus: 'estimated',
    note: 'The trailing ten-year CAPE earnings basis still includes publisher-documented interpolated annual Cowles observations before 1926.'
  })
]);

function historicalSeriesManifest({
  id,
  label,
  unit,
  variant,
  currency,
  region,
  transformation,
  period,
  revision,
  source = { status: 'unresolved', value: null },
  license = { status: 'unresolved', value: null },
  estimatedSegments = /** @type {readonly {startYear: number; endYear: number; qualityStatus: string; note: string}[]} */ (ESTIMATED_HISTORY_SEGMENTS),
  discontinuities = [],
  zeroValuePolicy = 'literal_value'
}) {
  return {
    id,
    label,
    unit,
    variant,
    currency,
    region,
    frequency: { status: 'known', value: 'annual' },
    period,
    source,
    license,
    transformation,
    estimatedSegments,
    discontinuities,
    missingness: {
      required: true,
      rule: 'reject_missing_or_non_finite',
      fallbackZeroSegments: [],
      zeroValuePolicy
    },
    revision
  };
}

/**
 * Reproduzierbarer Vertrag fuer den eingebetteten historischen Datenbestand.
 * Ungeklaerte Herkunfts-, Varianten- und Lizenzangaben bleiben absichtlich
 * `unresolved`; der Hash wird vom DOM-freien Contract gegen die kanonische
 * Post-Normalisierungs-Projektion von HISTORICAL_DATA geprueft.
 * Zeitraum, Revision und Inhaltshash kommen aus dem Datenstand; Texte nennen
 * dessen Endjahr, Startjahre und quellenabhaengige Angaben bleiben fest.
 *
 * @param {typeof HISTORICAL_DATENSTAND} [stand] Datenstand; ohne Angabe der eingebettete.
 */
export function buildHistoricalDataManifest(stand = HISTORICAL_DATENSTAND) {
  const endYear = stand.endYear;
  const period = Object.freeze({ startYear: stand.startYear, endYear });
  const seriesManifest = options => historicalSeriesManifest({ ...options, period, revision: stand.revision });
  return deepFreezeDataMetadata({
    schemaVersion: 'HistoricalDataManifestV1',
    datasetId: 'ruhestandsapp-historical-data-v1',
    revision: stand.revision,
    period,
    lookback: {
      backtestYears: 4,
      reason: 'Equity return plus endeVJ, endeVJ_1, endeVJ_2 and endeVJ_3 initialization.'
    },
    contentHash: {
      algorithm: 'sha256-canonical-json-v1',
      value: stand.contentHash
    },
    documentation: 'docs/reference/DATA_SOURCES.md',
    series: {
      global_equity_research_index: seriesManifest({
        id: 'global_equity_research_index',
        label: 'Open global equity research total-return index level',
        unit: 'index_level',
        variant: { status: 'known', value: 'economically_weighted_research_total_return_proxy' },
        currency: {
          status: 'known',
          value: `USD proxy 1925-1950; German investor currency 1951-2020; EUR 2021-${endYear}`
        },
        region: { status: 'known', value: '16 advanced economies' },
        source: {
          status: 'known',
          value: 'JST Macrohistory Database R6; OECD DSD_STES@DF_FINMARK 4.0; ECB EXR'
        },
        license: {
          status: 'known',
          value: 'Derived data: CC BY-NC-SA 4.0; OECD and ESCB source terms also apply'
        },
        transformation: {
          status: 'known',
          value: `Prior-year economic weights; JST total returns in USD through 1950 and German investor currency from 1951 through 2020; OECD December price return plus frozen JST 2020 dividend return and ECB conversion for 2021-${endYear}.`
        },
        estimatedSegments: globalEquityEstimatedSegments(endYear)
      }),
      inflation_de: seriesManifest({
        id: 'inflation_de',
        label: 'German annual consumer-price inflation',
        unit: 'percent_per_year',
        variant: {
          status: 'known',
          value: 'segmented German national consumer-price chain; excludes HICP/HVPI'
        },
        currency: { status: 'not_applicable', value: null },
        region: { status: 'known', value: 'DE' },
        source: {
          status: 'known',
          value: 'JST Macrohistory Database R6 (1925-1949); Destatis consumer-price long series (1950-2024); Destatis current annual table (2025)'
        },
        license: {
          status: 'known',
          value: 'JST-derived segment CC BY-NC-SA 4.0; Destatis segments Data Licence Germany - attribution - 2.0'
        },
        transformation: {
          status: 'known',
          value: 'JST consecutive-level percentage changes through 1949; levels normalized to 1938=126 are integer-quantized for 1925-1948, 1936-1948 spans price controls/wartime freeze, and 1949 is an explicit post-currency-reform proxy splice (+7.0352% versus the -1.0526% Destatis level-derived alternative). The CPI proxy does not represent the separate 100:6.5 nominal write-down of major Reichsmark cash and bank/savings balances and must not be used as a continuous-currency monetary-asset deflator across 1948. Published Destatis annual-average changes start in 1950, with each transition calculated inside one source series.'
        },
        estimatedSegments: GERMAN_CPI_ESTIMATED_SEGMENTS
      }),
      zinssatz_de: seriesManifest({
        id: 'zinssatz_de',
        label: 'German cash and overnight money-market gross return proxy',
        unit: 'percent_per_year',
        variant: {
          status: 'known',
          value: 'segmented annual-average nominal short/overnight money-market gross return proxy'
        },
        currency: { status: 'not_applicable', value: null },
        region: { status: 'known', value: 'DE' },
        source: {
          status: 'known',
          value: `JST Macrohistory Database R6 DEU.stir (1925-1944); explicit 1944 carry-forward bridge (1945-1948); Deutsche Bundesbank overnight-money-market long series (1949-${endYear}), with Fritz Knapp/Bundesbank source chain through 1975`
        },
        license: {
          status: 'known',
          value: 'JST-derived segment CC BY-NC-SA 4.0; Bundesbank/ESCB statistics reuse terms with attribution; ECB EURSTR administrator disclaimer applies'
        },
        transformation: {
          status: 'known',
          value: 'Published annual-average nominal percentages are projected once through the existing shared cashBondReturn path to cash-like holdings and bond tranches. The latter is a maturity-mismatched model proxy, not a historical bond-index return. No additional compounding, product costs, bank margin or tax is embedded. The 1945-1948 gap explicitly carries the 1944 JST value forward and fails closed outside that declared gap; the separate 1948 monetary-balance write-down is not implemented.'
        },
        estimatedSegments: GERMAN_CASH_MONEY_MARKET_ESTIMATED_SEGMENTS
      }),
      lohn_de: seriesManifest({
        id: 'lohn_de',
        label: 'German average gross monthly earnings growth proxy without special payments',
        unit: 'percent_per_year',
        variant: {
          status: 'known',
          value: 'JST R6 DEU nominal-wage growth proxy through 1946; segmented Destatis index of average gross monthly earnings without special payments from 1947'
        },
        currency: { status: 'not_applicable', value: null },
        region: {
          status: 'known',
          value: 'JST DEU research-series territory through 1946; former Federal Republic territory through 1990; Germany under the territorial definition since 3 October 1990 thereafter'
        },
        source: {
          status: 'known',
          value: `JST Macrohistory Database R6 DEU.wage (1924-1946 levels); Destatis Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen (1947-${endYear} changes)`
        },
        license: {
          status: 'known',
          value: 'JST-derived segment CC BY-NC-SA 4.0; Destatis segment Data Licence Germany - attribution - version 2.0'
        },
        transformation: {
          status: 'known',
          value: '1925-1946 uses consecutive JST nominal-wage level changes, with 1925 as a start-boundary proxy and 1945 classified estimated across the wartime market-observation break. From 1947 the published Destatis year-t annual change is applied once in simulation year t when rentAdjMode=wage. The 1947 source seam, 1948 currency-reform context, Destatis method breaks in 2007 and 2022, the territorial break in 1990/1991 and low early source precision are explicit. The series is not the statutory German pension-adjustment series.'
        },
        estimatedSegments: GERMAN_GROSS_WAGE_ESTIMATED_SEGMENTS,
        discontinuities: [
          {
            year: 1925,
            type: 'start_boundary',
            note: 'First in-scope rate depends on the out-of-period JST 1924 level; post-hyperinflation normalization limits comparability.'
          },
          {
            year: 1945,
            type: 'wartime_market_observation_break',
            note: 'JST level-derived value is retained as estimated and is not claimed as an observed market-wage change.'
          },
          {
            year: 1947,
            type: 'source_seam',
            note: 'Switch from JST level-derived changes through 1946 to published Destatis annual changes without a cross-source level ratio.'
          },
          {
            year: 1948,
            type: 'currency_reform_context',
            note: 'Published earnings-index change does not model the separate 100:6.5 monetary-balance write-down.'
          }
        ]
      }),
      gold_eur_perf: seriesManifest({
        id: 'gold_eur_perf',
        label: 'Gold annual return proxy in German investor currency',
        unit: 'percent_per_year',
        variant: {
          status: 'known',
          value: 'segmented nominal gold-price return proxy with documented year-end and annual-average regimes'
        },
        currency: {
          status: 'known',
          value: `historical German currency through 1944; explicit bridge 1945-1950; DEM 1951-1998; EUR 1999-${endYear}`
        },
        region: { status: 'known', value: 'global' },
        source: {
          status: 'known',
          value: 'Federal Reserve statutory gold-price policy and 1933 RFC year-end purchase price; JST R6 DEU.xrusd; Deutsche Bundesbank Frankfurt gold fixing and USD/EUR; World Bank Pink Sheet Gold'
        },
        license: {
          status: 'known',
          value: 'JST-derived segment CC BY-NC-SA 4.0; World Bank segment CC BY 4.0; Bundesbank/ESCB statistical reuse terms also apply'
        },
        transformation: {
          status: 'known',
          value: 'Segment-specific level return in German investor currency. End-of-year US policy/official price times JST end-of-year FX through 1944 and 1951-1967; explicit zero-return bridge 1945-1950; Bundesbank Frankfurt DEM/kg annual-average level ratios 1969-1998 with a mixed 1967 year-end/1968 partial-year seam; World Bank USD/oz divided by Bundesbank annual-average USD/EUR from 1999, with the 1998 DEM level converted at 1.95583 DEM/EUR.'
        },
        estimatedSegments: GOLD_GERMAN_INVESTOR_ESTIMATED_SEGMENTS,
        zeroValuePolicy: 'literal_value'
      }),
      cape: seriesManifest({
        id: 'cape',
        label: 'US Shiller conventional CAPE decision signal',
        unit: 'ratio',
        variant: {
          status: 'known',
          value: 'Robert J. Shiller conventional price CAPE; not total-return CAPE'
        },
        currency: { status: 'not_applicable', value: null },
        region: { status: 'known', value: 'US stock market' },
        source: {
          status: 'known',
          value: 'Robert J. Shiller, U.S. Stock Markets 1871-Present and CAPE Ratio, conventional CAPE column'
        },
        license: {
          status: 'known',
          value: 'Publisher download is public; no explicit open redistribution licence located; publisher/Yale disclaimer applies'
        },
        transformation: {
          status: 'known',
          value: 'December observation from calendar year t-1 is embedded under return year t and consumed once as that year-t decision signal; no second lag.'
        },
        estimatedSegments: US_SHILLER_CAPE_ESTIMATED_SEGMENTS
      })
    }
  });
}

export const HISTORICAL_DATA_MANIFEST = buildHistoricalDataManifest();

/**
 * Maschinenlesbare Metadaten zu Datenherkunft und Qualität der Simulationsreihen.
 * Detaillierte Quellenangaben stehen in docs/reference/DATA_SOURCES.md.
 *
 * @param {typeof HISTORICAL_DATA_MANIFEST} [manifest] Vertrag des Datenbestands.
 */
export function buildDatasetMeta(manifest = HISTORICAL_DATA_MANIFEST) {
  const { startYear, endYear } = manifest.period;
  return Object.freeze({
    historicalData: {
      manifestId: manifest.datasetId,
      revision: manifest.revision,
      contentHash: manifest.contentHash,
      coverageYears: [startYear, endYear],
      estimatedYears: [ESTIMATED_HISTORY_MIN_YEAR, ESTIMATED_HISTORY_MAX_YEAR],
      estimatedHistoryCutoffYear: ESTIMATED_HISTORY_CUTOFF_YEAR,
      notes: [
        'Equity years 1925-1950 are an explicit USD research proxy; the German investor-currency conversion starts with the 1951 return.',
        `Equity years 2021-${endYear} use observed OECD price components and a modelled dividend component.`,
        'German inflation uses a JST proxy through 1949 and a segmented official Destatis national consumer-price chain from 1950; HICP/HVPI is excluded.',
        'German cashBondReturn uses a JST short-rate proxy through 1944, an explicit 1945-1948 carry-forward bridge, a Bundesbank-published Frankfurt-bank proxy through 1996 and official FIBOR/EONIA/EURSTR annual averages thereafter. The existing model also applies this overnight proxy to bond tranches and does not implement the separate 1948 monetary-balance write-down.',
        'Gold uses a segmented German-investor-currency chain: year-end policy/official-price/JST-FX proxy, an explicit 1945-1950 zero-return bridge, Bundesbank Frankfurt annual-average fixing in DEM and World Bank annual-average gold converted with Bundesbank annual-average USD/EUR in EUR. Product, storage, spread and tax costs are excluded.',
        'German wage escalation uses consecutive JST R6 DEU nominal-wage level changes through 1946 and the Destatis annual change in average gross monthly earnings without special payments from 1947. The 1925 start boundary, estimated 1945 wartime break, 1947 source seam, 1948 currency-reform context, 1990/1991 territorial boundary, 2007 and 2022 method breaks and 1947-1955 precision limit are explicit. It remains a pension-escalation proxy, not the statutory German pension-adjustment series.',
        'CAPE is the US Shiller conventional price CAPE observed in December t-1 and used once as the decision signal for return year t; decision years 1925-1935 are marked estimated because their trailing ten-year earnings basis includes interpolated pre-1926 Cowles observations. It is not a global or German valuation ratio.',
        'Use the Monte Carlo setting "exclude estimated history" to omit observations marked estimated.'
      ],
      series: {
        global_equity_research_index: {
          label: 'Open global equity research total-return index level',
          variantStatus: 'documented_research_proxy',
          sourceStatus: 'open_segmented_source_chain'
        },
        inflation_de: {
          label: 'German CPI inflation (annual)',
          variantStatus: 'documented_segmented_national_cpi_chain',
          sourceStatus: 'open_segmented_source_chain'
        },
        zinssatz_de: {
          label: 'German cash and overnight money-market gross return proxy (annual)',
          variantStatus: 'documented_segmented_short_overnight_proxy',
          sourceStatus: 'open_segmented_source_chain'
        },
        lohn_de: {
          label: 'German average gross monthly earnings growth proxy without special payments (annual)',
          variantStatus: 'documented_destatis_gross_earnings_proxy',
          sourceStatus: 'official_with_segmented_early_research_proxy'
        },
        gold_eur_perf: {
          label: 'Gold annual performance in German investor currency',
          variantStatus: 'documented_segmented_timing_proxy',
          sourceStatus: 'open_segmented_source_chain'
        },
        cape: {
          label: 'US Shiller conventional CAPE decision signal',
          variantStatus: 'documented_us_conventional_price_cape',
          sourceStatus: 'publisher_compiled_historical_series'
        }
      },
      documentation: 'docs/reference/DATA_SOURCES.md'
    }
  });
}

export const DATASET_META = buildDatasetMeta();

/**
 * Regimeschwellen mit der geprüften Regimezählung aus dem Datenstand.
 * Der Schlüssel `reviewedDistribution1925To2025` behält seinen alten Namen, weil er in den
 * Inventar-Hash eingeht; sein Inhalt gilt für den ganzen Zeitraum des Datenstands.
 *
 * @param {typeof HISTORICAL_DATENSTAND} [stand] Datenstand; ohne Angabe der eingebettete.
 */
export function buildRegimeClassificationThresholds(stand = HISTORICAL_DATENSTAND) {
  const distribution = stand.regimeDistribution;
  return Object.freeze({
    schemaVersion: 'HistoricalRegimeClassificationV1',
    sourceSeries: 'global_equity_research_annual_returns',
    inflationHighPct: 5,
    equityPoorRatio: 0,
    equityCrashRatio: -0.15,
    equityBoomRatio: 0.15,
    labels: Object.freeze(['BULL', 'BEAR', 'SIDEWAYS', 'STAGFLATION']),
    calibrationStatus: 'retained_after_total_return_distribution_review',
    externalValidationStatus: 'not_validated',
    reviewedDistribution1925To2025: Object.freeze({
      observationCount: distribution.observationCount,
      BULL: distribution.BULL,
      BEAR: distribution.BEAR,
      SIDEWAYS: distribution.SIDEWAYS,
      STAGFLATION: distribution.STAGFLATION
    })
  });
}

export const REGIME_CLASSIFICATION_THRESHOLDS = buildRegimeClassificationThresholds();

/**
 * @param {string} code
 * @param {string} message Anzuzeigende Meldung.
 * @returns {AppError} Ergebnis der Operation.
 */
export function simulatorDataContractError(code, message) {
  /** @type {AppError} */
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** @param {{rendite?: number; inflation?: number}} [year] @returns {string}
 *
 * @param {object} [options]
 * @param {number} options.rendite
 * @param {number} options.inflation
 */
export function classifyHistoricalRegime({ rendite, inflation } = {}) {
  if (!Number.isFinite(rendite) || !Number.isFinite(inflation)) {
    throw simulatorDataContractError(
      'SIMULATOR_REGIME_INPUT_INVALID',
      'Regime classification requires finite equity return and inflation values.'
    );
  }
  const inflHigh = inflation > REGIME_CLASSIFICATION_THRESHOLDS.inflationHighPct;
  const equityPoor = rendite < REGIME_CLASSIFICATION_THRESHOLDS.equityPoorRatio;
  if (inflHigh && equityPoor) return 'STAGFLATION';
  if (rendite < REGIME_CLASSIFICATION_THRESHOLDS.equityCrashRatio) return 'BEAR';
  if (rendite > REGIME_CLASSIFICATION_THRESHOLDS.equityBoomRatio) return 'BULL';
  return 'SIDEWAYS';
}


/**
 * Stress-Szenarien für die Simulation
 */
export const STRESS_PRESETS = deepFreezeDataMetadata({
  NONE: {
    label: "Kein Stress",
    type: "none",
    years: 0,
    provenance: { evidenceKind: 'none', sourceEvidence: 'not_applicable', claimScope: 'no_stress_override' }
  },

  STAGFLATION_70s: {
    label: "Historischer Stagflationsfilter (Proxy-Mix)",
    type: "conditional_bootstrap",
    years: 7,
    filter: { inflationMin: 6.5, equityRealMax: -2.0 },
    provenance: {
      evidenceKind: 'historical_filter',
      sourceEvidence: 'mixed_observation_proxy_and_reconstruction',
      claimScope: 'all_years_matching_filter_not_a_1970s_replay'
    }
  },

  DOUBLE_BEAR_00s: {
    label: "Jahre aus historischen Verlustclustern (mind. 2 Jahre)",
    type: "conditional_bootstrap",
    years: 6,
    filter: { equityRealMax: -8.0, minCluster: 2 },
    provenance: {
      evidenceKind: 'historical_filter',
      sourceEvidence: 'mixed_observation_proxy_and_reconstruction',
      claimScope: 'independent_draws_from_years_in_consecutive_filter_clusters_not_a_contiguous_replay'
    }
  },

  GREAT_DEPRESSION_29_33: {
    label: "Rekonstruiertes Fenster 1929-1933 (Proxy-Daten)",
    type: "conditional_bootstrap",
    years: 5,
    filter: { yearMin: 1929, yearMax: 1933 },
    provenance: {
      evidenceKind: 'reconstructed_window',
      sourceEvidence: 'research_proxy_reconstruction',
      claimScope: 'calendar_window_using_research_proxy_series'
    }
  },

  WWII_40s: {
    label: "Rekonstruiertes Fenster 1939-1945 (Proxy-Daten)",
    type: "conditional_bootstrap",
    years: 7,
    filter: { yearMin: 1939, yearMax: 1945 },
    provenance: {
      evidenceKind: 'reconstructed_window',
      sourceEvidence: 'research_proxy_reconstruction',
      claimScope: 'calendar_window_using_research_proxy_series'
    }
  },

  STAGFLATION_SUPER: {
    label: "Hybrider Stagflationsfilter (-3 %-Pkt. Aktien)",
    type: "conditional_bootstrap",
    years: 8,
    filter: { inflationMin: 6.5, equityRealMax: -2.0 },
    muShiftEq: -0.03,
    provenance: {
      evidenceKind: 'hybrid_synthetic',
      sourceEvidence: 'mixed_observation_proxy_and_reconstruction_plus_synthetic_shift',
      claimScope: 'historical_filter_plus_synthetic_equity_shift'
    }
  },

  INFLATION_SPIKE_3Y: {
    label: "Inflationsschock (3 Jahre)",
    type: "parametric",
    years: 3,
    muShiftEq: -0.05,
    volScaleEq: 1.5,
    inflationFloor: 7.0,
    muShiftAu: 0.00,
    provenance: { evidenceKind: 'synthetic_shock', sourceEvidence: 'not_applicable', claimScope: 'parametric_not_historical' }
  },

  FORCED_DRAWDOWN_3Y: {
    label: "Erzwungener Drawdown (3 Jahre)",
    type: "parametric_sequence",
    years: 3,
    seqReturnsEq: [-0.25, -0.20, -0.15],
    noiseVol: 0.04,
    reboundClamp: { years: 2, cap: 0.05 },
    provenance: { evidenceKind: 'synthetic_shock', sourceEvidence: 'not_applicable', claimScope: 'parametric_sequence_not_historical' }
  },

  LOST_DECADE_12Y: {
    label: "Verlorenes Jahrzehnt (12J Stagnation)",
    type: "parametric",
    years: 12,
    muShiftEq: -0.06,
    volScaleEq: 0.8,
    returnMaxAu: 15.0, // Cap Gold bei +15% (verhindert historische Ausreißer wie 1979 mit +117%)
    inflationFloor: 2.0,
    provenance: { evidenceKind: 'synthetic_shock', sourceEvidence: 'not_applicable', claimScope: 'parametric_not_historical' }
  },

  CORRELATION_CRASH_4Y: {
    label: "System-Krise (Korrelations-Kollaps)",
    type: "parametric",
    years: 4,
    muShiftEq: -0.15,
    muShiftAu: -0.05,
    inflationFloor: 5.0,
    provenance: { evidenceKind: 'synthetic_shock', sourceEvidence: 'not_applicable', claimScope: 'parametric_not_historical' }
  }
});

/**
 * Leitet Jahresdaten, Regimepools und Regimeübergänge aus den historischen Jahressätzen ab.
 * Die Laufzeit ruft sie einmal für HISTORICAL_DATA auf; der Datengenerator nutzt sie für die Regimezählung.
 *
 * @param {Record<string, any>} [records] Jahressätze je Jahr.
 * @param {Record<string, number>} [equityReturns] Jahresrenditen der Aktienkette je Jahr.
 * @param {typeof REGIME_CLASSIFICATION_THRESHOLDS} [thresholds] Regimeschwellen.
 */
export function deriveHistoricalAnnualData(records = HISTORICAL_DATA, equityReturns = GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS,
  thresholds = REGIME_CLASSIFICATION_THRESHOLDS) {
  /** @type {any[]} */
  const derivedAnnualData = [];
  /** @type {Record<string, any[]>} */
  const regimeData = { BULL: [], BEAR: [], SIDEWAYS: [], STAGFLATION: [] };
  /** @type {Record<string, Record<string, number>>} */
  const regimeTransitions = {};
  const years = Object.keys(records).map(Number).sort((a, b) => a - b);

  years.forEach((year, index) => {
    const raw = records[year];

    // 1925 is intentionally a real sampling observation. The retired level-
    // differencing path emitted a structural zero because no 1924 runtime
    // level existed; the generated chain owns an explicit 1924 base level.
    const rendite = equityReturns[year];
    if (!Number.isFinite(rendite)) {
      throw new Error(`Missing global equity research return for ${year}.`);
    }

    const inflation = raw.inflation_de;
    const zinssatz = raw.zinssatz_de;
    const lohn = raw.lohn_de;
    const goldPerf = raw.gold_eur_perf; // Percent
    const cape = raw.cape;

    const regime = classifyHistoricalRegime({ rendite, inflation });

    const dataPoint = {
      jahr: year,
      rendite: rendite,
      inflation: inflation,
      zinssatz: zinssatz,
      lohn: lohn,
      gold_eur_perf: goldPerf,
      capeRatio: cape,
      regime: regime
    };

    derivedAnnualData.push(dataPoint);

    if (regimeData[regime]) {
      regimeData[regime].push(dataPoint);
    }
  });

  // Initialize Transitions
  const regimes = thresholds.labels;
  regimes.forEach(r => {
    regimeTransitions[r] = { total: 0 };
    regimes.forEach(target => regimeTransitions[r][target] = 0);
  });

  // Count transitions from historical data
  for (let i = 0; i < derivedAnnualData.length - 1; i++) {
    const current = derivedAnnualData[i].regime;
    const next = derivedAnnualData[i + 1].regime;

    // Fallback if regime detection marked something weird (should not happen with logic above)
    if (regimeTransitions[current] && regimeTransitions[current][next] !== undefined) {
      regimeTransitions[current][next]++;
      regimeTransitions[current].total++;
    }
  }
  return { annualData: derivedAnnualData, regimeData, regimeTransitions };
}

/**
 * Globale Daten für die Simulation
 */
const DERIVED_HISTORICAL_DATA = deriveHistoricalAnnualData();
export let annualData = DERIVED_HISTORICAL_DATA.annualData;
export let REGIME_DATA = DERIVED_HISTORICAL_DATA.regimeData;
export let REGIME_TRANSITIONS = DERIVED_HISTORICAL_DATA.regimeTransitions;
export const BREAK_ON_RUIN = true;

/**
 * Vergleicht die Regimezählung mit dem Soll aus dem Datenstand.
 *
 * @param {{annualData?: any[]; regimeData?: Record<string, any[]>; regimeTransitions?: Record<string, Record<string, number>>;
 *   expected?: typeof REGIME_CLASSIFICATION_THRESHOLDS.reviewedDistribution1925To2025}} [state]
 *   Abgeleitete Daten und Soll; ohne Angabe die eingebetteten.
 * @returns Ergebnis der Operation.
 */
export function inspectHistoricalRegimeContract({
  annualData: observedAnnualData = annualData,
  regimeData = REGIME_DATA,
  regimeTransitions = REGIME_TRANSITIONS,
  expected = REGIME_CLASSIFICATION_THRESHOLDS.reviewedDistribution1925To2025
} = {}) {
  const regimes = REGIME_CLASSIFICATION_THRESHOLDS.labels;
  const observed = {
    observationCount: observedAnnualData.length,
    ...Object.fromEntries(regimes.map(regime => [regime, regimeData[regime]?.length || 0]))
  };
  const emptyTransitionRegimes = regimes.filter(regime => {
    const total = regimeTransitions[regime]?.total;
    return !Number.isFinite(total) || total <= 0;
  });
  const distributionMatches = expected.observationCount === observed.observationCount
    && regimes.every(regime => expected[regime] === observed[regime]);
  return deepFreezeDataMetadata({
    expected: { ...expected },
    observed,
    emptyTransitionRegimes,
    distributionMatches
  });
}

export const REGIME_CLASSIFICATION_DIAGNOSTICS = inspectHistoricalRegimeContract();

/**
 * @param {Parameters<typeof inspectHistoricalRegimeContract>[0]} [state] Abgeleitete Daten und Soll; ohne Angabe die eingebetteten.
 * @returns Ergebnis der Operation.
 */
export function assertHistoricalRegimeContract(state) {
  const diagnostics = inspectHistoricalRegimeContract(state);
  if (diagnostics.emptyTransitionRegimes.length > 0) {
    throw simulatorDataContractError(
      'SIMULATOR_REGIME_TRANSITIONS_EMPTY',
      `No observed outgoing transition exists for regimes ${diagnostics.emptyTransitionRegimes.join(', ')}.`
    );
  }
  if (!diagnostics.distributionMatches) {
    throw simulatorDataContractError(
      'SIMULATOR_REGIME_DISTRIBUTION_DRIFT',
      `Reviewed regime distribution changed; expected ${JSON.stringify(diagnostics.expected)}, observed ${JSON.stringify(diagnostics.observed)}.`
    );
  }
  return diagnostics;
}
