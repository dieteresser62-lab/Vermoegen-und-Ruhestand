// @ts-check
/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
"use strict";

import { historicalSeries, resolved, notApplicable } from './entry-builders.js';

export const inflation_de = historicalSeries({
        id: 'inflation_de',
        label: 'German annual consumer-price inflation',
        unit: 'percent_per_year',
        evidenceClass: 'proxy',
        implementationLocations: [
            'app/simulator/german-cpi-chain.js:GERMAN_CPI_RESEARCH_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.inflation_de'
        ],
        source: resolved('JST Macrohistory Database R6 (1925-1949); Destatis consumer-price long series (1950-2024); Destatis current annual table (2025)'),
        seriesIdentifier: resolved('german_consumer_price_inflation / GermanCpiResearchChainV1'),
        currency: notApplicable(),
        yearConvention: resolved('Annual-average consumer-price change in simulation year t versus annual average t-1'),
        transformation: 'JST consecutive German CPI level changes through 1949; normalized 1925-1948 source levels are integer-quantized and 1949 is an explicit post-currency-reform splice. The price proxy excludes the separate 100:6.5 nominal write-down of major Reichsmark cash and bank/savings balances and is not a continuous-currency monetary-asset deflator across 1948. Published Destatis national consumer-price annual changes start in 1950; every seam rate stays inside one source series and HICP/HVPI is excluded.',
        license: resolved('JST-derived segment CC BY-NC-SA 4.0; Destatis segments Data Licence Germany - attribution - 2.0'),
        retrievedAt: resolved('2026-07-10'),
        rawDataHash: resolved('83841d2c11df3a5e193aa07db3bdfe815cbbeea7f9f81c3526b197702a46bdb4'),
        embeddedValueHash: '9ec87b5052d5e086517142c34213a4063e2be6ccdd8a5babf6d5722ffb76ae3a',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1949,
                evidenceClass: 'proxy',
                note: 'Annual changes from JST R6 German CPI levels. Levels normalized to 1938=126 are exact integers for 1925-1948; 1936-1948 reflects price controls/wartime freeze, and 1949 is a non-integer post-currency-reform splice whose +7.0352% differs by 8.0878 pp from the -1.0526% Destatis level-derived alternative. The roughly 36.9% CPI-implied purchasing-power loss is not the separate 93.5% nominal write-down of major monetary balances under the 100:6.5 conversion.'
            },
            {
                startYear: 1950,
                endYear: 1962,
                evidenceClass: 'official',
                note: 'Destatis former West Germany four-person worker/employee household with medium income; official series with proxy_population qualifier.'
            },
            {
                startYear: 1963,
                endYear: 1991,
                evidenceClass: 'official',
                note: 'Destatis former West Germany price index for all private households.'
            },
            {
                startYear: 1992,
                endYear: 2024,
                evidenceClass: 'official',
                note: 'Destatis Verbraucherpreisindex for Germany from the pinned long-series workbook.'
            },
            {
                startYear: 2025,
                endYear: 2025,
                evidenceClass: 'official',
                note: 'Destatis Verbraucherpreisindex for Germany from the pinned current annual table.'
            }
        ]
    });

export const zinssatz_de = historicalSeries({
        id: 'zinssatz_de',
        label: 'German cash and overnight money-market gross return proxy',
        unit: 'percent_per_year',
        evidenceClass: 'proxy',
        implementationLocations: [
            'app/simulator/german-cash-money-market-chain.js:GERMAN_CASH_MONEY_MARKET_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.zinssatz_de'
        ],
        source: resolved('JST Macrohistory Database R6 DEU.stir (1925-1944); explicit 1944 carry-forward bridge (1945-1948); Deutsche Bundesbank overnight-money-market long series (1949-2025), with Fritz Knapp/Bundesbank source chain through 1975'),
        seriesIdentifier: resolved('german_cash_money_market_proxy / GermanCashMoneyMarketChainV1'),
        currency: resolved('Historical German regimes/DEM through 1998; EUR from 1999; return percentages do not perform currency conversion, and the 1948 monetary-balance write-down is not implemented'),
        yearConvention: resolved('Published annual-average nominal rate in simulation year t, applied once through the existing shared cashBondReturn path to cash-like holdings and bond tranches'),
        transformation: 'JST DEU.stir is used directly through 1944; 1945-1948 carries the 1944 value forward as an explicit estimated bridge; Bundesbank annual-average reported Frankfurt overnight, FIBOR O/N, EONIA and EURSTR values are used directly from 1949. The shared bond application is a maturity-mismatched model proxy. No extra compounding, product cost, bank margin or tax is embedded.',
        license: resolved('JST-derived segment CC BY-NC-SA 4.0; Bundesbank/ESCB statistics reuse terms with attribution; ECB EURSTR administrator disclaimer applies'),
        retrievedAt: resolved('2026-07-29'),
        rawDataHash: resolved('ea1608b5dee7e00ae7bf24bb651cb01cd3f0d5423b54cdf21b9f975cced30722'),
        embeddedValueHash: 'cf5471a345234984ac3ff8de57bffdb3128c1046e01ec998198721325ede9b69',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1944,
                evidenceClass: 'proxy',
                note: 'JST nominal German short-term interest-rate proxy; the instrument is not homogeneous enough to claim a continuous investable overnight return.'
            },
            {
                startYear: 1945,
                endYear: 1948,
                evidenceClass: 'estimated',
                note: 'Explicit last-observation carry-forward at 2.13 percent for unobserved market-closure and post-war years; not an observed investable return.'
            },
            {
                startYear: 1949,
                endYear: 1996,
                evidenceClass: 'proxy',
                note: 'Bundesbank-published unweighted monthly averages of rates reported by Frankfurt banks; the source states they were not officially set or quoted. Survey-group and day-count breaks occur in 1970 and 1990.'
            },
            {
                startYear: 1997,
                endYear: 1998,
                evidenceClass: 'official',
                note: 'Bundesbank annual averages of daily FIBOR overnight rates.'
            },
            {
                startYear: 1999,
                endYear: 2018,
                evidenceClass: 'official',
                note: 'EONIA annual averages as published by Deutsche Bundesbank.'
            },
            {
                startYear: 2019,
                endYear: 2019,
                evidenceClass: 'official',
                note: 'Published transition-year average: EONIA through September and EURSTR from October.'
            },
            {
                startYear: 2020,
                endYear: 2025,
                evidenceClass: 'official',
                note: 'EURSTR annual averages as published by Deutsche Bundesbank.'
            }
        ]
    });

export const lohn_de = historicalSeries({
        id: 'lohn_de',
        label: 'German average gross monthly earnings growth proxy without special payments',
        unit: 'percent_per_year',
        evidenceClass: 'proxy',
        implementationLocations: [
            'app/simulator/german-gross-wage-growth-chain.js:GERMAN_GROSS_WAGE_GROWTH_CHAIN',
            'app/simulator/simulator-data.js:HISTORICAL_DATA.*.lohn_de'
        ],
        source: resolved('JST Macrohistory Database R6 DEU.wage; Destatis Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen through 2025'),
        seriesIdentifier: resolved('german_average_gross_monthly_earnings_growth_proxy / GermanGrossWageGrowthChainV2'),
        currency: notApplicable(),
        yearConvention: resolved('Published year-over-year change for reporting year t is applied once in simulation year t'),
        transformation: '1925-1946 changes are derived from consecutive JST R6 nominal-wage levels. The 1925 start boundary and 1945 wartime break are separately classified; from 1947 the published Destatis annual change adjusts pension inputs once when rentAdjMode=wage. The 1947 source seam, 1948 currency-reform context, 1990/1991 territorial boundary, 2007 and 2022 method breaks and 1947-1955 precision limit are explicit. This remains a proxy, not the statutory German pension-adjustment series.',
        license: resolved('JST-derived segment CC BY-NC-SA 4.0; Destatis segment Data Licence Germany - attribution - version 2.0'),
        retrievedAt: resolved('2026-08-01'),
        rawDataHash: resolved('cfd5c598a8bc846a96966fa8ff7388d80c30f3ada39edbfe90d39f234eef9d9b'),
        embeddedValueHash: 'e10e581f6994e07ed0a943b3716dd8fd5dea7b8b272d47a546466af8701a3057',
        externalValidationStatus: 'not_validated',
        qualitySegments: [
            {
                startYear: 1925,
                endYear: 1925,
                evidenceClass: 'proxy',
                note: 'First in-scope JST level-derived rate; depends on the 1924 out-of-period level and carries a post-hyperinflation normalization boundary.'
            },
            {
                startYear: 1926,
                endYear: 1944,
                evidenceClass: 'proxy',
                note: 'Annual changes derived from consecutive JST R6 DEU nominal-wage levels; a macrohistory research proxy, not a statutory pension adjustment.'
            },
            {
                startYear: 1945,
                endYear: 1945,
                evidenceClass: 'estimated',
                note: 'JST level-derived wartime/post-war break value retained for continuity; not claimed as an observed market-wage change.'
            },
            {
                startYear: 1946,
                endYear: 1946,
                evidenceClass: 'proxy',
                note: 'Final JST level-derived transition year immediately before the source seam to published Destatis annual changes.'
            },
            {
                startYear: 1947,
                endYear: 1955,
                evidenceClass: 'official',
                note: 'Published Destatis annual changes for the former federal territory. In-segment current levels are 1.9-4.5; the 1947 change also uses the prior 1946 level 1.8, so one-decimal publication imposes a material precision limit.'
            },
            {
                startYear: 1956,
                endYear: 1990,
                evidenceClass: 'official',
                note: 'Published Destatis annual changes for the former federal territory before reunification.'
            },
            {
                startYear: 1991,
                endYear: 2006,
                evidenceClass: 'official',
                note: 'Published Destatis annual changes for Germany under the territorial definition since 3 October 1990, before the 2007 method break.'
            },
            {
                startYear: 2007,
                endYear: 2021,
                evidenceClass: 'official',
                note: 'Published Destatis annual changes after the documented scope change to producing industry and services.'
            },
            {
                startYear: 2022,
                endYear: 2025,
                evidenceClass: 'official',
                note: 'Published Destatis annual changes from the earnings survey introduced in 2022.'
            }
        ],
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
    });
