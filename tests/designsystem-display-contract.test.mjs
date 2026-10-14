import { createHash } from 'node:crypto';
import { formatDiagnosisPayload } from '../app/balance/balance-diagnosis-format.js';
import { createDiagnosisHandlers } from '../app/balance/balance-binder-diagnosis.js';
import { buildBacktestColumnDefinitions, prepareRowsForExport, convertRowsToCsv } from '../app/simulator/simulator-main-helpers.js';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { exportBacktestLogData } from '../app/simulator/simulator-backtest.js';

// Vollständige synthetische UTF-8-Zeugen, vor der Anzeigeumstellung festgehalten.
const raw = {
  "general": {
    "marketSzenario": "normal",
    "alarmActive": false,
    "deckungVorher": 75,
    "deckungNachher": 100,
    "runwayMonate": 18,
    "runwayTargetMonate": 36
  },
  "keyParams": {
    "aktuelleFlexRate": 75,
    "minFlexRatePct": 65,
    "kuerzungProzent": 25,
    "jahresentnahme": 42000,
    "entnahmequoteDepot": 0.075,
    "realerDepotDrawdown": 0.25
  },
  "decisionTree": [],
  "guardrails": [
    {
      "name": "Drawdown",
      "value": 0.25,
      "threshold": 0.3,
      "type": "percent",
      "rule": "max"
    },
    {
      "name": "Runway",
      "value": 18,
      "threshold": 36,
      "type": "months",
      "rule": "min"
    },
    {
      "name": "Kennzahl",
      "value": 1.005,
      "threshold": 2.675,
      "type": "number",
      "rule": "max"
    },
    {
      "name": "Budget",
      "value": 3400,
      "threshold": 4000,
      "type": "currency",
      "rule": "min"
    }
  ]
};
const rows = [
  {
    "jahr": 2025,
    "inflationVJ": 2.675,
    "wertAktien": 3400,
    "wertGold": 0,
    "liquiditaet": 1250,
    "netA": -1500,
    "row": {
      "recordType": "financial_year",
      "financiallyEvaluable": true,
      "QuoteEndPct": 75,
      "FlexRatePct": 75,
      "NominalReturnEquityPct": 0.75,
      "NominalReturnGoldPct": -0.1,
      "RunwayCoveragePct": 0,
      "RunwayTargetSeverityPct": 75,
      "aktionUndGrund": "Test; \"Zeile\"\nFortsetzung",
      "health_bucket_real_coverage_pct": 75,
      "safety_runway_pre_months": 1.005,
      "safety_runway_post_months": 2.675
    }
  }
];
const expected = {
  "diagnosis": "===== Entscheidungsdiagnose für Ruhestand-Balancing =====\nVersion: v22.0 ES6 Modules (Engine v31)\nZeitstempel: 12.5.2026, 10:30:00\n\n--- Status-Übersicht ---\nMarktregime: normal\nAlarm-Modus: Inaktiv\nEntnahmequote: 7.50%\nRealer Drawdown aktives Gesamtvermögen: 25.0%\nLiquiditätsdeckung: 75% → 100% (Ziel: 100%)\nRunway nach Vorschlag (finanzierte Vermögensentnahme, vor Auszahlung): 18.0 Monate (Ziel: 36 Monate) -> Status: UNBEKANNT | Quelle: Unbekannt (Legacy)\nQuelle-Details: Quelle konnte nicht bestimmt werden – bitte Zielwerte prüfen.\n\n--- Entscheidungsbaum (Warum?) ---\n\n--- Guardrails ---\nDrawdown: -25.0% (Schwelle: < 30.0%) -> Status: OK\nRunway: 18 Mon. (Schwelle: > 36 Mon.) -> Status: DANGER\nKennzahl: 1.0 (Schwelle: < 2.7) -> Status: OK\nBudget: 3.400,00 € (Schwelle: > 4.000,00 €) -> Status: DANGER\n\n--- Schlüsselparameter ---\nPeak (real): N/A\nAktuell (real): N/A\nKumulierte Inflation: n/a\nEffektive Flex-Rate: 75.0%\nFlex-Min-Rate: 65.0%\nKürzung ggü. Flex-Bedarf: 25.0%\nJahresentnahme (brutto): 42.000,00 €\n\n===== Ende der Diagnose =====",
  "backtestCsv": "Jahr;Entn.;Floor;Rente1;Rente2;RenteSum;FloorDep;Flex%;MinF%;WRed%;WQ%;FlexDep€;FlexHH€;FlexHH%;MinFlex€;MinFIst€;MinFGap€;MinFSt;EntPlan;EntEff;VPW€;VPWFlex;StatFlex;VPW%;Hor;VPWSt;Safe;VPWHint;Entn_real;Adj%;CAPE;RetPol;RetSrc;CAPESt;ER(CAPE);ER(real);ERRaw;ERClamp;SafeR;SafeSrc;SafSc;RiskSt;StabSt;SafTr;MinFBlock;MinFEff;DDreal%;RunPre;RunPost;Markt;Status;Cut;Alarm;Quote%;Runway%;RunZiel;RunSev;Pf.Akt%;Pf.Gld%;Infl.;Handl.A;Handl.G;St.;Aktien;Gold;Liq.;VTopf;StSave;Liq>P;Liq<P;Liq>Z;Port>P;PortAkt;PortEnd;FlowΔ;TrAct;TrPay;TrBond;HBStart;HBUse;HBZins;HBEnd;HBZiel;HBDeck%;HBLücke;HBTrig;HBWarn;Liq@rC-;Zins€;Liq@rC+;ZielLiq;RunRaw;RunMin;RunFb;NeedLiq;GuardG;GuardA;GuardNote;Akt_vorR;Akt_nachR;Akt_nachV;Akt_nachK;Gld_vorR;Gld_nachR;Gld_nachV;Gld_nachK\n2025;—;—;—;—;—;—;75%;0%;0%;0%;—;—;0%;—;—;—;;—;—;—;—;—;;;;;;—;0.0%;;;;;;;;;;;;;;;;—;;1.0;2.7;;\"Test; \"\"Zeile\"\"\nF\";;;75.0%;0%;;75%;75.0%;-10.0%;2.7%;-2k €;—;—;3k €;0 €;1k €;—;—;—;—;—;—;—;—;—;—;—;—;—;—;—;—;—;75%;—;;;—;—;—;—;;;;—;—;—;;—;—;—;—;—;—;—;—",
  "backtestJson": "[\n  {\n    \"Jahr\": 2025,\n    \"Entn.\": \"—\",\n    \"Floor\": \"—\",\n    \"Rente1\": \"—\",\n    \"Rente2\": \"—\",\n    \"RenteSum\": \"—\",\n    \"FloorDep\": \"—\",\n    \"Flex%\": \"75%\",\n    \"MinF%\": \"0%\",\n    \"WRed%\": \"0%\",\n    \"WQ%\": \"0%\",\n    \"FlexDep€\": \"—\",\n    \"FlexHH€\": \"—\",\n    \"FlexHH%\": \"0%\",\n    \"MinFlex€\": \"—\",\n    \"MinFIst€\": \"—\",\n    \"MinFGap€\": \"—\",\n    \"MinFSt\": \"\",\n    \"EntPlan\": \"—\",\n    \"EntEff\": \"—\",\n    \"VPW€\": \"—\",\n    \"VPWFlex\": \"—\",\n    \"StatFlex\": \"—\",\n    \"VPW%\": \"\",\n    \"Hor\": \"\",\n    \"VPWSt\": \"\",\n    \"Safe\": \"\",\n    \"VPWHint\": \"\",\n    \"Entn_real\": \"—\",\n    \"Adj%\": \"0.0%\",\n    \"CAPE\": \"\",\n    \"RetPol\": \"\",\n    \"RetSrc\": \"\",\n    \"CAPESt\": \"\",\n    \"ER(CAPE)\": \"\",\n    \"ER(real)\": \"\",\n    \"ERRaw\": \"\",\n    \"ERClamp\": \"\",\n    \"SafeR\": \"\",\n    \"SafeSrc\": \"\",\n    \"SafSc\": \"\",\n    \"RiskSt\": \"\",\n    \"StabSt\": \"\",\n    \"SafTr\": \"\",\n    \"MinFBlock\": \"\",\n    \"MinFEff\": \"—\",\n    \"DDreal%\": \"\",\n    \"RunPre\": \"1.0\",\n    \"RunPost\": \"2.7\",\n    \"Markt\": \"\",\n    \"Status\": \"Test; \\\"Zeile\\\"\\nF\",\n    \"Cut\": \"\",\n    \"Alarm\": \"\",\n    \"Quote%\": \"75.0%\",\n    \"Runway%\": \"0%\",\n    \"RunZiel\": \"\",\n    \"RunSev\": \"75%\",\n    \"Pf.Akt%\": \"75.0%\",\n    \"Pf.Gld%\": \"-10.0%\",\n    \"Infl.\": \"2.7%\",\n    \"Handl.A\": \"-2k €\",\n    \"Handl.G\": \"—\",\n    \"St.\": \"—\",\n    \"Aktien\": \"3k €\",\n    \"Gold\": \"0 €\",\n    \"Liq.\": \"1k €\",\n    \"VTopf\": \"—\",\n    \"StSave\": \"—\",\n    \"Liq>P\": \"—\",\n    \"Liq<P\": \"—\",\n    \"Liq>Z\": \"—\",\n    \"Port>P\": \"—\",\n    \"PortAkt\": \"—\",\n    \"PortEnd\": \"—\",\n    \"FlowΔ\": \"—\",\n    \"TrAct\": \"—\",\n    \"TrPay\": \"—\",\n    \"TrBond\": \"—\",\n    \"HBStart\": \"—\",\n    \"HBUse\": \"—\",\n    \"HBZins\": \"—\",\n    \"HBEnd\": \"—\",\n    \"HBZiel\": \"—\",\n    \"HBDeck%\": \"75%\",\n    \"HBLücke\": \"—\",\n    \"HBTrig\": \"\",\n    \"HBWarn\": \"\",\n    \"Liq@rC-\": \"—\",\n    \"Zins€\": \"—\",\n    \"Liq@rC+\": \"—\",\n    \"ZielLiq\": \"—\",\n    \"RunRaw\": \"\",\n    \"RunMin\": \"\",\n    \"RunFb\": \"\",\n    \"NeedLiq\": \"—\",\n    \"GuardG\": \"—\",\n    \"GuardA\": \"—\",\n    \"GuardNote\": \"\",\n    \"Akt_vorR\": \"—\",\n    \"Akt_nachR\": \"—\",\n    \"Akt_nachV\": \"—\",\n    \"Akt_nachK\": \"—\",\n    \"Gld_vorR\": \"—\",\n    \"Gld_nachR\": \"—\",\n    \"Gld_nachV\": \"—\",\n    \"Gld_nachK\": \"—\"\n  }\n]",
  "scenarioJson": "{\n  \"materializationContract\": {\n    \"input\": \"already_materialized_and_request_horizon_bounded\",\n    \"scope\": \"single_selected_scenario_path\",\n    \"streaming\": false\n  },\n  \"records\": [\n    {\n      \"FlexRatePct\": 75,\n      \"RunwayCoveragePct\": 0,\n      \"RunwayTargetSeverityPct\": 75,\n      \"aktionUndGrund\": \"Test; \\\"Zeile\\\"\\nFortsetzung\",\n      \"financiallyEvaluable\": true,\n      \"health_bucket_real_coverage_pct\": 75,\n      \"jahr\": 2025,\n      \"measurementMissingness\": {\n        \"minimumFlex\": {\n          \"observationCount\": {\n            \"observations\": 0\n          },\n          \"reason\": \"source_value_unobserved\"\n        },\n        \"returnRatios\": {\n          \"observationCount\": {\n            \"observations\": 2\n          },\n          \"reason\": \"source_value_unobserved\"\n        },\n        \"withdrawalRates\": {\n          \"observationCount\": {\n            \"observations\": 1\n          },\n          \"reason\": \"source_value_unobserved\"\n        }\n      },\n      \"minimumFlexConfiguredAnnualEur\": null,\n      \"minimumFlexFulfilledAnnualEur\": null,\n      \"minimumFlexPolicyEffectiveAnnualEur\": null,\n      \"nominalReturnEquityRatio\": 0.75,\n      \"nominalReturnGoldRatio\": -0.1,\n      \"preDecisionWithdrawalRatePct\": 75,\n      \"realReturnEquityRatio\": null,\n      \"realReturnGoldRatio\": null,\n      \"realizedWithdrawalRatePct\": null,\n      \"recordType\": \"financial_year\",\n      \"safety_runway_post_months\": 2.675,\n      \"safety_runway_pre_months\": 1.005\n    }\n  ],\n  \"schemaVersion\": \"ScenarioLogExportV2\",\n  \"unitContract\": {\n    \"annualMoneyFields\": {\n      \"minimumFlexConfiguredAnnualEur\": \"nominal_eur_per_year\",\n      \"minimumFlexFulfilledAnnualEur\": \"nominal_eur_per_year_actual_fulfilment\",\n      \"minimumFlexPolicyEffectiveAnnualEur\": \"nominal_eur_per_year_after_policy\"\n    },\n    \"percentagePointFields\": {\n      \"preDecisionWithdrawalRatePct\": {\n        \"denominator\": \"equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket\",\n        \"description\": \"vorlaeufige Entnahme auf Basis der Vorjahres-Flexrate, vor Transaktions- und Auszahlungsphase; Nenner Depot ohne Liquiditaet und Health-Bucket\",\n        \"measurementTime\": \"before_transaction_and_payout\",\n        \"numerator\": \"preliminary_withdrawal_based_on_previous_year_flex_rate\"\n      },\n      \"realizedWithdrawalRatePct\": {\n        \"denominator\": \"equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket\",\n        \"measurementTime\": \"after_policy_transaction_and_actual_payout\",\n        \"numerator\": \"actual_effective_annual_withdrawal\"\n      }\n    },\n    \"ratioFields\": {\n      \"nominalReturnEquityRatio\": \"unitless_ratio\",\n      \"nominalReturnGoldRatio\": \"unitless_ratio\",\n      \"realReturnEquityRatio\": \"unitless_ratio\",\n      \"realReturnGoldRatio\": \"unitless_ratio\"\n    },\n    \"schemaVersion\": \"ScenarioLogUnitContractV2\",\n    \"terminalRecordPolicy\": \"financial_measurements_null_with_reason_and_observation_count\"\n  }\n}",
  "scenarioCsv": "FlexRatePct;RunwayCoveragePct;RunwayTargetSeverityPct;aktionUndGrund;financiallyEvaluable;health_bucket_real_coverage_pct;jahr;measurementMissingness;minimumFlexConfiguredAnnualEur;minimumFlexFulfilledAnnualEur;minimumFlexPolicyEffectiveAnnualEur;nominalReturnEquityRatio;nominalReturnGoldRatio;preDecisionWithdrawalRatePct;realReturnEquityRatio;realReturnGoldRatio;realizedWithdrawalRatePct;recordType;safety_runway_post_months;safety_runway_pre_months;scenarioLogSchemaVersion;unitContractVersion\r\n75;0;75;\"Test; \"\"Zeile\"\"\nFortsetzung\";true;75;2025;\"{\"\"minimumFlex\"\":{\"\"observationCount\"\":{\"\"observations\"\":0},\"\"reason\"\":\"\"source_value_unobserved\"\"},\"\"returnRatios\"\":{\"\"observationCount\"\":{\"\"observations\"\":2},\"\"reason\"\":\"\"source_value_unobserved\"\"},\"\"withdrawalRates\"\":{\"\"observationCount\"\":{\"\"observations\"\":1},\"\"reason\"\":\"\"source_value_unobserved\"\"}}\";;;;0.75;-0.1;75;;;;financial_year;2.675;1.005;ScenarioLogExportV2;ScenarioLogUnitContractV2"
};
const before = structuredClone({raw, rows});
const payload = formatDiagnosisPayload(raw);
const scenarioForBaseline = structuredClone(projectScenarioLogV2(rows.map(r => ({ ...r.row, jahr: r.jahr }))));
// Nur drei neue, getrennt geprüfte Metadatenfelder aus dem Altvergleich ausnehmen.
assertEqual(scenarioForBaseline.unitContract.annualMoneyFields.flex_wunsch_haushalt_nominal, 'nominal_eur_per_year_desired_household_flex', 'Neuer Wunschbetrag hat nominale Jahreseinheit');
assertEqual(scenarioForBaseline.unitContract.annualMoneyFields.flex_haushalt_erfuellt, 'nominal_eur_per_year_paid_household_flex_including_pension', 'Neuer Haushaltsbetrag berücksichtigt Rente');
assertEqual(scenarioForBaseline.unitContract.minimumFlexRestriction.comparison, 'paid_household_flex_lt_applied_positive_minimum', 'Neuer Szenariovertrag erklärt den strikten Jahresvergleich');
delete scenarioForBaseline.unitContract.annualMoneyFields.flex_wunsch_haushalt_nominal;
delete scenarioForBaseline.unitContract.annualMoneyFields.flex_haushalt_erfuellt;
delete scenarioForBaseline.unitContract.minimumFlexRestriction;
const actual = {
 diagnosis: createDiagnosisHandlers({dom:{diagnosis:{filterToggle:{checked:false}}},appState:{lastUpdateTimestamp:'2026-05-12T08:30:00.000Z'}}).generateDiagnosisText(payload),
 backtestCsv: convertRowsToCsv(rows, buildBacktestColumnDefinitions('detailed')),
 backtestJson: JSON.stringify(prepareRowsForExport(rows, buildBacktestColumnDefinitions('detailed')),null,2),
 scenarioJson: serializeScenarioLogExportV2(scenarioForBaseline),
 scenarioCsv: serializeScenarioLogCsvV2(projectScenarioLogV2(rows.map(r=>({...r.row,jahr:r.jahr}))))
};
for (const key of Object.keys(expected)) {
 assert(Buffer.from(actual[key], 'utf8').equals(Buffer.from(expected[key], 'utf8')), key + ': vollständige Export-/Kopierbytes einschließlich Zeilenenden bleiben erhalten');
}
assertEqual(JSON.stringify({raw,rows}),JSON.stringify(before),'Rohdaten bleiben unverändert');

// Zusätzliche vollständige Downloadzeugen aus dem unveränderten Basiscommit 727fde743885709e3846624f6803aaa323209745.
const canonicalBacktestResult = {
  "schemaVersion": "BacktestRunResultV1",
  "request": {
    "schemaVersion": "BacktestRequestV1",
    "startYear": 2025,
    "endYear": 2025,
    "executionMode": "single_path",
    "breakOnRuin": true,
    "temporalConventionId": "realized_t_decision_t_minus_1_v1",
    "dataset": {
      "datasetId": "synthetisch",
      "revision": "synthetisch-1",
      "contentHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    "inputs": {
      "startFloorBedarf": 3400,
      "startFlexBedarf": 1250
    },
    "engine": {
      "apiVersion": "31.0",
      "buildId": "synthetisch",
      "sourceCommit": "dddddddddddddddddddddddddddddddddddddddd",
      "sourceTreeStatus": "clean",
      "sourceProvenanceProvider": "test_fixture",
      "quantizationContract": {
        "schemaVersion": "HistoricalBacktestQuantizationContractV1",
        "enabled": true,
        "transactionAnnualTiers": [
          {
            "index": 1,
            "upperBoundExclusive": null,
            "unbounded": true,
            "step": 1000
          }
        ],
        "withdrawalMonthlyTiers": [
          {
            "index": 1,
            "upperBoundExclusive": null,
            "unbounded": true,
            "step": 50
          }
        ],
        "withdrawalRounding": {
          "phase": "after_floor_plus_flex_decision_before_final_annual_withdrawal",
          "monthlyMode": "floor",
          "annualizationFactor": 12,
          "floorProtection": "max_floor_annual"
        },
        "metricDisplayRounding": "descriptor_only_not_applied_to_raw_metric_values"
      }
    }
  },
  "outcome": {
    "kind": "completed",
    "lastCompletedYear": 2025
  },
  "requestedYears": 1,
  "completedYears": 1,
  "firstYear": 2025,
  "lastCompletedYear": 2025,
  "breakOnRuin": true,
  "dataStatus": "complete",
  "rows": [
    {
      "jahr": 2025,
      "entscheidung": {
        "jahresEntnahme": 3400,
        "kuerzungProzent": 75
      },
      "wertAktien": 3400,
      "wertGold": 0,
      "liquiditaet": 1250,
      "row": {
        "QuoteEndPct": 75,
        "NominalReturnEquityPct": 0.75,
        "aktionUndGrund": "Synthetisch; \"Zeile\"\nFortsetzung",
        "portfolio_total_start": 10000,
        "portfolio_total_end": 4650
      }
    }
  ],
  "metrics": {
    "values": {
      "wealth_start_nominal_eur": 10000,
      "wealth_end_nominal_eur": 4650
    }
  }
};
const expectedDownloads = {
  "json": {
    "filename": "backtest-2025-2025-run-fc25f99a12f5-result-b532a20f616c-2026-05-12T08-30-00.000Z.json",
    "content": "{\n  \"contracts\": {\n    \"flexReductionMaximum\": {\n      \"basis\": null,\n      \"basisConsistencyRequired\": true,\n      \"interpretation\": \"maximum_household_flex_reduction_not_person_reduction\",\n      \"metricId\": \"flex_reduction_max_pct\",\n      \"missingness\": \"null_if_flex_haushalt_basis_is_missing_or_mixed\"\n    },\n    \"inputSemantics\": {\n      \"capeRatio\": {\n        \"canonicalHistoricalSource\": \"result.historicalYearRecords[*].decisionAsOf.capeRatio\",\n        \"historicalBacktestEffect\": \"none\",\n        \"role\": \"non_historical_ui_fallback\"\n      },\n      \"depotwertNeu\": {\n        \"derivation\": \"startVermoegen_minus_depotwertAlt_minus_tagesgeld_minus_geldmarktEtf_minus_gold_target\",\n        \"detailedLotSource\": \"detailledTranches\",\n        \"missingFieldMeaning\": \"derived_or_replaced_by_detailed_lots_not_zero\",\n        \"role\": \"derived_aggregate_when_no_detailed_lots_are_supplied\"\n      },\n      \"geldmarktEtf\": {\n        \"includedIn\": [\n          \"startVermoegen\",\n          \"zielLiquiditaet\"\n        ],\n        \"role\": \"start_wealth_component_money_market\",\n        \"unit\": \"EUR\"\n      },\n      \"schemaVersion\": \"HistoricalBacktestInputSemanticsV2\",\n      \"startVermoegen\": {\n        \"role\": \"canonical_total_start_wealth\",\n        \"unit\": \"EUR\"\n      },\n      \"zielLiquiditaet\": {\n        \"not\": \"strategy_target\",\n        \"role\": \"legacy_start_liquidity_alias\",\n        \"strategyTargetSource\": \"liquidityRunwayYears_and_year_specific_post_policy_planned_annual_net_withdrawal\",\n        \"value\": \"tagesgeld_plus_geldmarktEtf_at_run_start\"\n      }\n    }\n  },\n  \"exportContract\": {\n    \"canonicalization\": \"sha256-canonical-json-v1\",\n    \"excludedInternalPortfolioFields\": [\n      \"portfolioSnapshots\"\n    ],\n    \"excludedResultFields\": [\n      \"diagnostics\"\n    ],\n    \"numericValues\": \"finite JSON numbers; no display formatting\",\n    \"privacyNotice\": \"Der Export enthaelt die vollstaendigen lokalen Simulationsannahmen und wird nur durch eine explizite Nutzeraktion erzeugt.\",\n    \"sourceResultSchemaVersion\": \"BacktestRunResultV1\"\n  },\n  \"exportedAt\": \"2026-05-12T08:30:00.000Z\",\n  \"fingerprint\": {\n    \"algorithm\": \"sha256-canonical-json-v1\",\n    \"excludes\": [\n      \"exportedAt\",\n      \"identifiers\",\n      \"exportContract\",\n      \"diagnostics\"\n    ],\n    \"value\": \"b532a20f616c15b4c094b616dcfdfb114cb3bdef35679ea0a6d767794be68a38\"\n  },\n  \"identifiers\": {\n    \"requestId\": \"btrq_400898626f6ffac2d7bafa87e7a9f8497a6facdcb71aa802357d54c053dbdb58\",\n    \"runId\": \"btrun_fc25f99a12f5cbc185e148f54cedd08a93153d02e74d298b3ba328d757d06669\"\n  },\n  \"request\": {\n    \"breakOnRuin\": true,\n    \"dataset\": {\n      \"contentHash\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n      \"datasetId\": \"synthetisch\",\n      \"revision\": \"synthetisch-1\"\n    },\n    \"endYear\": 2025,\n    \"engine\": {\n      \"apiVersion\": \"31.0\",\n      \"buildId\": \"synthetisch\",\n      \"quantizationContract\": {\n        \"enabled\": true,\n        \"metricDisplayRounding\": \"descriptor_only_not_applied_to_raw_metric_values\",\n        \"schemaVersion\": \"HistoricalBacktestQuantizationContractV1\",\n        \"transactionAnnualTiers\": [\n          {\n            \"index\": 1,\n            \"step\": 1000,\n            \"unbounded\": true,\n            \"upperBoundExclusive\": null\n          }\n        ],\n        \"withdrawalMonthlyTiers\": [\n          {\n            \"index\": 1,\n            \"step\": 50,\n            \"unbounded\": true,\n            \"upperBoundExclusive\": null\n          }\n        ],\n        \"withdrawalRounding\": {\n          \"annualizationFactor\": 12,\n          \"floorProtection\": \"max_floor_annual\",\n          \"monthlyMode\": \"floor\",\n          \"phase\": \"after_floor_plus_flex_decision_before_final_annual_withdrawal\"\n        }\n      },\n      \"sourceCommit\": \"dddddddddddddddddddddddddddddddddddddddd\",\n      \"sourceProvenanceProvider\": \"test_fixture\",\n      \"sourceTreeStatus\": \"clean\"\n    },\n    \"executionMode\": \"single_path\",\n    \"inputs\": {\n      \"startFlexBedarf\": 1250,\n      \"startFloorBedarf\": 3400\n    },\n    \"schemaVersion\": \"BacktestRequestV1\",\n    \"startYear\": 2025,\n    \"temporalConventionId\": \"realized_t_decision_t_minus_1_v1\"\n  },\n  \"result\": {\n    \"breakOnRuin\": true,\n    \"cohortInventory\": null,\n    \"completedYears\": 1,\n    \"dataStatus\": \"complete\",\n    \"error\": null,\n    \"firstYear\": 2025,\n    \"historicalYearRecords\": [],\n    \"incompleteReason\": null,\n    \"lastCompletedYear\": 2025,\n    \"metrics\": {\n      \"values\": {\n        \"wealth_end_nominal_eur\": 4650,\n        \"wealth_start_nominal_eur\": 10000\n      }\n    },\n    \"outcome\": {\n      \"kind\": \"completed\",\n      \"lastCompletedYear\": 2025\n    },\n    \"period\": {\n      \"completedYears\": 1,\n      \"emittedYearRows\": 1,\n      \"endYear\": 2025,\n      \"endpointConvention\": \"inclusive_start_and_end_calendar_years\",\n      \"inclusiveYears\": 1,\n      \"isCompleteCalendarWindow\": true,\n      \"projectionClaim\": \"observed_requested_calendar_window_not_fixed_30_year_horizon\",\n      \"requestedYears\": 1,\n      \"startYear\": 2025\n    },\n    \"portfolioBoundaries\": {\n      \"canonicalFields\": [\n        \"totalNominalEur\"\n      ],\n      \"end\": {\n        \"asOfYear\": 2025,\n        \"totalNominalEur\": 4650\n      },\n      \"omittedInternalState\": [\n        \"portfolioSnapshots.start\",\n        \"portfolioSnapshots.end\",\n        \"portfolioSnapshots.*.detailledTranches\",\n        \"simulation_lot_state\"\n      ],\n      \"restartInstruction\": \"Use a newly validated current input/profile snapshot; historical result boundaries are diagnostic aggregates only.\",\n      \"restartable\": false,\n      \"schemaVersion\": \"HistoricalBacktestPortfolioBoundariesV2\",\n      \"start\": {\n        \"asOf\": \"before_first_requested_year\",\n        \"totalNominalEur\": 10000\n      },\n      \"totalComposition\": {\n        \"healthBucketRelation\": \"included_in_total_do_not_add\",\n        \"includes\": [\n          \"active_portfolio\",\n          \"health_bucket\"\n        ]\n      }\n    },\n    \"provenance\": {\n      \"dataset\": {\n        \"contentHash\": \"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\n        \"datasetId\": \"synthetisch\",\n        \"revision\": \"synthetisch-1\"\n      },\n      \"engine\": {\n        \"apiVersion\": \"31.0\",\n        \"buildId\": \"synthetisch\",\n        \"quantizationContract\": {\n          \"enabled\": true,\n          \"metricDisplayRounding\": \"descriptor_only_not_applied_to_raw_metric_values\",\n          \"schemaVersion\": \"HistoricalBacktestQuantizationContractV1\",\n          \"transactionAnnualTiers\": [\n            {\n              \"index\": 1,\n              \"step\": 1000,\n              \"unbounded\": true,\n              \"upperBoundExclusive\": null\n            }\n          ],\n          \"withdrawalMonthlyTiers\": [\n            {\n              \"index\": 1,\n              \"step\": 50,\n              \"unbounded\": true,\n              \"upperBoundExclusive\": null\n            }\n          ],\n          \"withdrawalRounding\": {\n            \"annualizationFactor\": 12,\n            \"floorProtection\": \"max_floor_annual\",\n            \"monthlyMode\": \"floor\",\n            \"phase\": \"after_floor_plus_flex_decision_before_final_annual_withdrawal\"\n          }\n        },\n        \"sourceCommit\": \"dddddddddddddddddddddddddddddddddddddddd\",\n        \"sourceProvenanceProvider\": \"test_fixture\",\n        \"sourceTreeStatus\": \"clean\"\n      },\n      \"temporalConventionId\": \"realized_t_decision_t_minus_1_v1\"\n    },\n    \"requestedYears\": 1,\n    \"rows\": [\n      {\n        \"entscheidung\": {\n          \"jahresEntnahme\": 3400,\n          \"kuerzungProzent\": 75\n        },\n        \"jahr\": 2025,\n        \"liquiditaet\": 1250,\n        \"row\": {\n          \"NominalReturnEquityPct\": 0.75,\n          \"QuoteEndPct\": 75,\n          \"aktionUndGrund\": \"Synthetisch; \\\"Zeile\\\"\\nFortsetzung\",\n          \"portfolio_total_end\": 4650,\n          \"portfolio_total_start\": 10000\n        },\n        \"wertAktien\": 3400,\n        \"wertGold\": 0\n      }\n    ],\n    \"ruinYear\": null,\n    \"schemaVersion\": \"BacktestRunResultV1\",\n    \"summary\": null,\n    \"warnings\": []\n  },\n  \"schemaId\": \"de.ruhestandsapp.historical-backtest.raw\",\n  \"schemaVersion\": \"HistoricalBacktestExportV2\"\n}",
    "mimeType": "application/json",
    "fingerprint": {
      "algorithm": "sha256-canonical-json-v1",
      "value": "b532a20f616c15b4c094b616dcfdfb114cb3bdef35679ea0a6d767794be68a38",
      "excludes": [
        "exportedAt",
        "identifiers",
        "exportContract",
        "diagnostics"
      ]
    }
  },
  "csv": {
    "filename": "backtest-2025-2025-run-fc25f99a12f5-csv-c1c42adb6c6c-2026-05-12T08-30-00.000Z.csv",
    "content": "run_id;simulation_year_calendar_year;outcome_code;action_code;cut_reason_code;minimum_flex_status_code;equity_return_ratio;gold_return_pct;cash_bond_return_pct;inflation_pct;wage_pension_adjustment_pct;cape_ratio;withdrawal_nominal_eur;floor_required_nominal_eur;pension_total_nominal_eur;flex_fulfilled_nominal_eur;flex_household_required_nominal_eur;flex_pension_contribution_nominal_eur;flex_required_from_portfolio_nominal_eur;flex_fulfilled_from_portfolio_nominal_eur;flex_household_fulfilled_nominal_eur;flex_household_reduction_pct;minimum_flex_annual_nominal_eur;minimum_flex_effective_final_nominal_eur;minimum_flex_shortfall_nominal_eur;flex_reduction_pct;portfolio_equity_end_nominal_eur;portfolio_gold_end_nominal_eur;portfolio_cash_end_nominal_eur;health_bucket_end_nominal_eur;portfolio_total_end_nominal_eur;tax_total_nominal_eur;loss_carry_end_nominal_eur;floor_shortfall_nominal_eur\nbtrun_fc25f99a12f5cbc185e148f54cedd08a93153d02e74d298b3ba328d757d06669;2025;completed;\"Synthetisch; \"\"Zeile\"\"\nFortsetzung\";;;;;;;;;3400;;;;;;;;;;;;;75;3400;0;1250;;4650;;;",
    "mimeType": "text/csv;charset=utf-8",
    "fingerprint": {
      "algorithm": "sha256-csv-utf8-v1",
      "value": "c1c42adb6c6c26fd700993bd9e70e0884ec2a222f5b499788d09a255c11fdd2d"
    }
  }
};

// Die echte UI-Aktion bis zum Blob und Download aufrufen, keine Ersatzserialisierung.
const downloadGlobals = Object.fromEntries(['window', 'document', 'URL', 'Date'].map(key => [key, globalThis[key]]));
function legacyHistoricalCsvBytes(csv) {
    const lines = []; let quoted = false, start = 0, cuts = [];
    for (let i = 0; i <= csv.length; i++) {
        if (csv[i] === '"') {
            if (quoted && csv[i + 1] === '"') i++; else quoted = !quoted;
        } else if (!quoted && csv[i] === ';') cuts.push(i);
        else if (!quoted && (csv[i] === '\n' || i === csv.length)) {
            if (i > start) {
                assertEqual(cuts.length, 35, 'CSV-Zeuge hat ausschließlich zwei additive Spalten');
                lines.push(csv.slice(start, cuts[33]) + (csv[i] === '\n' ? '\n' : ''));
            }
            start = i + 1; cuts = [];
        }
    }
    assert(csv.split('\n')[0].endsWith(';flex_household_desired_nominal_eur;flex_below_minimum'), 'Neue CSV-Spalten stehen additiv am Ende');
    return lines.join('');
}
const downloadBefore = JSON.stringify(canonicalBacktestResult);
const downloads = [];
let pendingBlob;
try {
    const OriginalDate = downloadGlobals.Date;
    globalThis.Date = class extends OriginalDate {
        constructor(...args) { super(...(args.length ? args : ['2026-05-12T08:30:00.000Z'])); }
    };
    globalThis.window = { globalBacktestData: { result: canonicalBacktestResult } };
    globalThis.document = {
        getElementById: () => null,
        createElement: () => ({ click() { downloads.push({ blob: pendingBlob, filename: this.download }); } }),
        body: { appendChild() {}, removeChild() {} }
    };
    globalThis.URL = { createObjectURL(blob) { pendingBlob = blob; return 'blob:synthetisch'; }, revokeObjectURL() {} };
    for (const format of ['json', 'csv']) {
        const countBefore = downloads.length;
        exportBacktestLogData(format);
        assertEqual(downloads.length, countBefore + 1, `${format}: echte Exportaktion löst genau einen Download aus`);
        const downloaded = downloads.at(-1), witness = expectedDownloads[format];
        assert(Buffer.from(format === 'csv' ? legacyHistoricalCsvBytes(await downloaded.blob.text()) : await downloaded.blob.text(), 'utf8').equals(Buffer.from(witness.content, 'utf8')), `${format}: tatsächlicher Download bleibt vollständig bytegleich zum Basisstand`);
        let baselineFilename = downloaded.filename;
        if (format === 'csv') {
            const content = await downloaded.blob.text();
            const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 12);
            assert(downloaded.filename.includes(`-csv-${digest(content)}-`), 'CSV-Dateiname schützt tatsächlich erweiterte Exportbytes');
            baselineFilename = downloaded.filename.replace(`-csv-${digest(content)}-`, `-csv-${digest(legacyHistoricalCsvBytes(content))}-`);
        }
        assertEqual(baselineFilename, witness.filename, `${format}: feste synthetische Downloadmetadaten bleiben unverändert`);
        assertEqual(downloaded.blob.type, witness.mimeType, `${format}: Download-MIME bleibt unverändert`);
    }
    assertEqual(JSON.stringify(canonicalBacktestResult), downloadBefore, 'Echte Downloadaktionen verändern keine Ergebnisdaten');
} finally {
    for (const [key, value] of Object.entries(downloadGlobals)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
}
