// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { historicalSeries, resolved, notApplicable } from './entry-builders.js';

export const global_equity_research_index = historicalSeries({
        id: 'global_equity_research_index',
        label: 'Open global equity research total-return index level',
        unit: 'index_level',
        evidenceClass: 'proxy',
        implementationLocations: [
            'app/simulator/global-equity-research-chain.js:GLOBAL_EQUITY_RESEARCH_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.global_equity_research_index'
        ],
        source: resolved('JST Macrohistory Database R6; OECD DSD_STES@DF_FINMARK 4.0; ECB EXR'),
        seriesIdentifier: resolved('global_equity_research_index / GlobalEquityResearchChainV1'),
        currency: resolved('USD proxy 1925-1950; German investor currency 1951-2020; EUR 2021-2025'),
        yearConvention: resolved('Annual return t; JST calendar year through 2020, December-average-index ratio for OECD 2021-2025'),
        transformation: 'Prior-year JST population-times-real-GDP-per-capita weights; local-to-USD conversion through 1950 and German investor-currency conversion from 1951 through 2020; OECD December price return plus frozen JST 2020 dividend return and ECB December conversion thereafter.',
        license: resolved('Derived data CC BY-NC-SA 4.0; OECD and ESCB source terms also apply'),
        retrievedAt: resolved('2026-07-29'),
        rawDataHash: resolved('a234f57c21c3184077ce00743bbd6bc149363518939eeebb016e9fb25ab1f893'),
        embeddedValueHash: '38118b9f982ee3ff5d64a920b397451c302c34f3e46722462bac6e0732878c89',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1950,
                evidenceClass: 'proxy',
                note: 'JST nominal local equity total returns converted to a USD research proxy through the 1950 return; Germany is absent in 1945-1946 and Japan in 1946-1947 where required inputs are missing.'
            },
            {
                startYear: 1951,
                endYear: 2020,
                evidenceClass: 'backtested',
                note: 'JST provider-built national total returns are economically weighted and converted into German investor currency.'
            },
            {
                startYear: 2021,
                endYear: 2025,
                evidenceClass: 'estimated',
                note: 'Observed OECD price and ECB currency components plus a frozen country-level JST 2020 dividend-return model component.'
            }
        ]
    });

export const gold_eur_perf = historicalSeries({
        id: 'gold_eur_perf',
        label: 'Gold annual return proxy in German investor currency',
        unit: 'percent_per_year',
        evidenceClass: 'proxy',
        implementationLocations: [
            'app/simulator/gold-german-investor-chain.js:GOLD_GERMAN_INVESTOR_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.gold_eur_perf'
        ],
        source: resolved('Federal Reserve statutory gold-price policy and 1933 RFC year-end purchase price; JST Macrohistory Database R6; Deutsche Bundesbank BBEX3; World Bank Commodity Price Data (Pink Sheet)'),
        seriesIdentifier: resolved('gold_german_investor_currency_annual_return / GoldGermanInvestorChainV1'),
        currency: resolved('historical German currency through 1944; explicit bridge 1945-1950; DEM 1951-1998; EUR 1999-2025'),
        yearConvention: resolved('Segment-specific nominal return: year-end levels through 1967, mixed 1967 year-end/1968 partial-year seam, annual-average levels thereafter'),
        transformation: 'US policy/official year-end price times JST year-end German-currency/USD through 1944 and 1951-1967; 1933 uses the official 18 December RFC purchase price; explicit zero-return bridge 1945-1950; Bundesbank Frankfurt DEM/kg annual-average level ratios with a mixed 1968 seam; World Bank USD/oz divided by Bundesbank annual-average USD/EUR from 1999, with the 1998 DEM level converted at 1.95583 DEM/EUR. Product, storage, spread and tax costs are excluded.',
        license: resolved('JST-derived segment CC BY-NC-SA 4.0; World Bank segment CC BY 4.0; Bundesbank/ESCB statistical reuse terms also apply'),
        retrievedAt: resolved('2026-07-30'),
        rawDataHash: resolved('133ed7c3d79a313de4a64f94e54b4f0e06e4f7b24ab4182aa5263958cae49b7d'),
        embeddedValueHash: '068a15a99c665b48dc14a187b654033d292c9de6ed3cf712f7e789ddcec049aa',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1932,
                evidenceClass: 'proxy',
                note: 'Federal Reserve statutory USD gold-price policy multiplied by JST R6 end-of-year DEU.xrusd. This is a policy/FX research proxy, not proof of an accessible German retail gold market.'
            },
            {
                startYear: 1933,
                endYear: 1933,
                evidenceClass: 'proxy',
                note: 'Federal Reserve Bank of New York reported 18 December RFC purchase price multiplied by JST R6 end-of-year DEU.xrusd.'
            },
            {
                startYear: 1934,
                endYear: 1944,
                evidenceClass: 'proxy',
                note: 'Federal Reserve statutory USD gold-price policy multiplied by JST R6 end-of-year DEU.xrusd. This is a policy/FX research proxy, not proof of an accessible German retail gold market.'
            },
            {
                startYear: 1945,
                endYear: 1950,
                evidenceClass: 'estimated',
                note: 'Explicit zero-return bridge across the wartime/post-war market gap and German currency discontinuity; not an observed return.'
            },
            {
                startYear: 1951,
                endYear: 1967,
                evidenceClass: 'proxy',
                note: 'Federal Reserve statutory USD gold-price policy multiplied by JST R6 end-of-year DEU.xrusd before the Frankfurt fixing series begins.'
            },
            {
                startYear: 1968,
                endYear: 1968,
                evidenceClass: 'derived',
                note: 'Bundesbank Frankfurt partial-year annual average beginning 18 June compared with the 1967 parity/FX anchor.'
            },
            {
                startYear: 1969,
                endYear: 1998,
                evidenceClass: 'derived',
                note: 'Returns from consecutive official Bundesbank Frankfurt-fixing annual-average levels in DEM per kilogram.'
            },
            {
                startYear: 1999,
                endYear: 1999,
                evidenceClass: 'derived',
                note: 'Source/currency seam: World Bank Gold and Bundesbank USD/EUR compared with the 1998 Frankfurt level converted at the irrevocable DEM/EUR rate.'
            },
            {
                startYear: 2000,
                endYear: 2025,
                evidenceClass: 'derived',
                note: 'World Bank annual-average Gold in USD per troy ounce converted with Bundesbank/ECB annual-average USD per EUR.'
            }
        ]
    });

export const cape = historicalSeries({
        id: 'cape',
        label: 'US Shiller conventional CAPE decision signal',
        unit: 'ratio',
        evidenceClass: 'backtested',
        implementationLocations: [
            'app/simulator/us-shiller-cape-chain.js:US_SHILLER_CAPE_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.cape'
        ],
        source: resolved('Robert J. Shiller, U.S. Stock Markets 1871-Present and CAPE Ratio workbook'),
        seriesIdentifier: resolved('us_shiller_conventional_cape_decision_signal / UsShillerCapeDecisionChainV1'),
        currency: notApplicable(),
        yearConvention: resolved('December observation from calendar year t-1 is the decision signal for return year t'),
        transformation: 'The conventional price CAPE source observation for December t-1 is embedded under return year t and consumed once as the decision-as-of input; no second lag.',
        license: resolved('Publisher download is public; no explicit open redistribution licence located; publisher/Yale disclaimer applies'),
        retrievedAt: resolved('2026-08-01'),
        rawDataHash: resolved('0e3d716f83f51c14f40c5ab5662e767cde4f83fcb7305db24ab003df2c9ee6c5'),
        embeddedValueHash: 'd1101958fed64dadf8fba76e9e4e92c8d24e86bd3d21accc42cdb60c247a835f',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1935,
                evidenceClass: 'estimated',
                note: 'The trailing ten-year earnings basis includes interpolated annual Cowles observations before 1926.'
            },
            {
                startYear: 1936,
                endYear: 2025,
                evidenceClass: 'backtested',
                note: 'Publisher-compiled US conventional CAPE after the ten-year window no longer contains the documented pre-1926 interpolation; it is not a global or German valuation ratio.'
            }
        ]
    });
