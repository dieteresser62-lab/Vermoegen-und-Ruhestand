# Balance-App – Modulübersicht

Die Balance-App besteht aus 52 ES6-Modulen unter `app/balance/`. Das folgende Dokument fasst Verantwortung, Exporte und wichtige Abhängigkeiten zusammen.
Dateinamen werden unten kurz ohne Präfix genannt; tatsächlicher Pfad ist in der Regel `app/balance/<datei>.js`.
Ausnahmen: Profilverbund-Module liegen unter `app/profile/`, Shared-Formatter unter `app/shared/`.

**Stand:** 2026-10-10

## Vollstaendige Datei-Inventur

Die folgende Inventur ist gegen den fertigen Stand von `app/balance/` abgeglichen; gruppierte Detailbeschreibungen folgen darunter.

| Datei | Primaere Verantwortung |
|---|---|
| `balance-action-postprocessor.js` | Exponiert die bereits in der Engine finalisierte Single-/Profilverbund-Aktion ohne steuerrelevante Nachbearbeitung |
| `balance-action-summary.js` | Reine lesende Kurzprojektion der dargestellten Gesamt-/Profilaktionen, einschließlich Aktienkauf |
| `balance-annual-inflation.js` | Schreibfreier Vorabruf, gemeinsame Bedarfsrundung und getrennte Anwendung |
| `balance-annual-marketdata.js` | ETF-, ATH- und CAPE-Schritte im Jahresabschluss; kein separater Nachrückenknopf |
| `balance-annual-modal.js` | Jahresadapter der gemeinsamen nativen Abschlusskomponente (Schritte 1–7, Monat gesperrt) |
| `balance-annual-preview.js` | Schreibfreie Januar-/Rentenprojektion und gerundete Bedarfsanzeige |
| `balance-close-coordinator.js` | Flüchtiger Entwurf, Kontextinvalidierung, Abrufpaket, Importwartepunkt und bestätigte Monatsphase |
| `balance-annual-orchestrator.js` | Dünner Balanceadapter des gemeinsamen Jahreslebenszyklus |
| `balance-annual-storage.js` | Reiner Jahresentwurf aus Rohrecords und vorbereiteten Marktdaten |
| `balance-annual-storage-commit.js` | Isolierte Jahresrechnung, Belegbildung und ein gemeinsamer fachlicher Abschlusswrite |
| `balance-annual-period.js` | DOM-freier Jahresperioden-, Legacy- und Recovery-Contract |
| `balance-binder-annual.js` | Fassade fuer Annual-Handler |
| `balance-binder-diagnosis.js` | Diagnose-Export und Copytext |
| `balance-binder-imports.js` | Versionierter Balance-JSON-Import/Export mit Dry-Run/Recovery sowie kompatible historische Markt-CSV-Parser |
| `balance-binder-snapshots.js` | Seitenanschlüsse für gemeinsamen Jahreskoordinator, Recovery und Snapshot-Aktionen |
| `balance-binder.js` | zentraler UI-Event-Hub |
| `balance-chart-axis.js` | Gemeinsame Eurobeschriftung über `formatChartEuro` und DOM-freie Achsenaufbereitung mit Grenzen, Tickabständen und normierten Positionen durch `prepareChartAxis` |
| `balance-config.js` | App-Konfiguration, Engine-Versionsanforderung und Fehlertypen |
| `balance-diagnosis-chips.js` | Diagnose-Chips |
| `balance-diagnosis-decision-tree.js` | Entscheidungsbaum-Darstellung |
| `balance-diagnosis-format.js` | Normalisierung des Diagnose-Payloads |
| `balance-diagnosis-guardrails.js` | Guardrail-Diagnosekarten |
| `balance-diagnosis-keyparams.js` | Schluesselparameter und VPW-/Mindest-Flex-Diagnose |
| `balance-diagnosis-transaction.js` | Transaktionsdiagnostik und Blockgruende |
| `balance-expenses-csv.js` | Parser fuer kategorisierte Ausgaben-CSV |
| `balance-expenses-history-renderer.js` | Lesende Jahresauswertung mit SVG, zugänglicher Datentabelle sowie Leer- und Korruptionshinweis |
| `balance-expenses-import.js` | Gemeinsamer bestätigter Ausgabenimport mit Vorschau, Warteschlange, Kontextschutz und Schreibkoordination |
| `balance-expenses-metrics.js` | DOM-freie Ausgabenkennzahlen und Forecasts |
| `balance-expenses-renderer.js` | Monatstabelle, Summary und Detaildialog auf `Ausgaben.html` |
| `balance-expenses-storage.js` | Ausgabenstore und Jahres-/Monatscontainer |
| `balance-expenses-wealth-capture.js` | Importkoordination, Preiszeit-/Bewertungsnachweis und exaktes Sieben-Tage-Gate |
| `balance-expenses.js` | Controller/Fassade des Ausgaben-Checks |
| `balance-file-service.js` | Gemeinsamer Balance-Dateiaustausch mit Rechenpfad, Importvorschau, Recovery-/Rollbackprüfung und Legacy-Ordnerverbindung |
| `balance-guardrail-reset.js` | Reset-Entscheidung bei relevanten Inputaenderungen |
| `balance-health-bucket.js` | DOM-freie Pflegebucket-Diagnose |
| `balance-input-storage.js` | DOM-freier Eingabebau aus injiziertem Speicher mit Haushaltsprojektion, historischen States und Quellenfingerprints |
| `balance-main-profile-sync.js` | Profilwerte in Balance-DOM synchronisieren |
| `balance-main-profilverbund.js` | Haushalts-Engine-Lauf, einmalige 3-Bucket-Verarbeitung, Profilattribution und UI-Anbindung |
| `balance-main.js` | Bootstrap und zentrale Update-Pipeline |
| `balance-next-steps.js` | Lesende Projektion offener Pflichtschritte für Jahresabschluss, Monatsbereitstellung, Ausgaben und Cashstatus |
| `balance-presentation-controls.js` | Darstellungsadapter für native Bedarfs-/Strategiecontrols, Jahresauswahl und Warum-Knopf, Inhaltsbreitenbeobachtung und Tabellenüberlaufhinweise |
| `balance-reader.js` | DOM-Eingaben und profil-/tranchenbezogene Overrides lesen |
| `balance-renderer-action.js` | Handlungsempfehlung und Profilquellen rendern; Kurzfassung nach Cashintegration zurückgeben |
| `balance-renderer-diagnosis.js` | Diagnose-Teilrenderer koordinieren |
| `balance-flex-trace.js` | Lesende Netto-Monatsprojektion und strukturelle Kürzungsgründe für die Budgettreppe |
| `balance-renderer-summary.js` | Summary, Budgettreppe, Liquiditaet, Marktstatus und Bedarf rendern |
| `balance-renderer.js` | Renderer-Fassade, Berechnungs-/Aktionsfehler und Toasts |
| `balance-storage.js` | Balance-State, Migration, Snapshot-Archiv, Import-Recovery und Restore |
| `balance-update-pipeline.js` | Validierung, Last-State, Diagnose und Persistenzentscheidung |
| `balance-utils.js` | Zahlen-/Waehrungsformatierung und UI-Hilfen |
| `balance-wealth-history-metrics.js` | Unverändernde Verlaufssortierung, drei Stapelgruppen, Anlass und Teildepotwerte |
| `balance-wealth-history-renderer.js` | Flüchtige Anzeigensteuerung, Anzahl, SVG, zugängliche Datentabelle sowie vollständiger Leer-/Fehler-Replace |
| `balance-wealth-history.js` | Gemeinsame unterjährige und jährliche Erfassung mit Profil-Recheck, gemeinsamer Schreibkoordination und bestätigtem State-/Registry-Replace |

**Inventurergebnis:** 52 von 52 Dateien erfasst. Der DOM-freie Datenvertrag liegt zusätzlich unter `types/wealth-history-contract.js`.

---

## Vollständiger Export- und Importabgleich (10.10.2026)

Alle 52 Dateien sind gegen ihre Quelltexte geprüft. Die Verantwortungstabelle oben
und die gruppierten Detailbeschreibungen ergänzen diese vollständige Liste benannter
Modulexporte und statischer Imports; Importpfade sind relativ zum jeweiligen Modul.
Objekt-/Klassenmethoden sind keine zusätzlichen Modulexporte. Historische Markt-CSV-
und Resetmethoden bleiben technische Kompatibilität, ohne aktuelle Balance-Bedienung.

| Datei | Benannte Modulexporte | Imports |
|---|---|---|
| `balance-action-postprocessor.js` | `postprocessBalanceAction` | — |
| `balance-action-summary.js` | `hasMeaningfulFlow`, `materialProfileActions`, `summarizeBalanceAction`, `describeBalanceActionSummary` | — |
| `balance-annual-inflation.js` | `INFLATION_RESULT_METRIC`, `validateInflationResult`, `prepareAnnualNeeds`, `createInflationHandlers`, `createInflationReaders` | `../shared/app-clock.js`, `../shared/market-price-adapter.js`, `../profile/profile-person-data.js`, `../shared/shared-formatting.js`, `./balance-config.js`, `./balance-utils.js`, `./balance-renderer.js`, `./balance-storage.js`, `./balance-annual-period.js`, `./balance-update-pipeline.js`, `./balance-annual-orchestrator.js` |
| `balance-annual-marketdata.js` | `createMarketdataHandlers`, `ANNUAL_MARKET_DATA_META_KEY`, `ANNUAL_MARKET_DATA_SCHEMA_VERSION`, `isPlausibleAnnualClosePrice`, `createAnnualMarketDataRequest`, `createManualAnnualQuote`, `validatePreparedAnnualQuote`, `selectAnnualCloseQuote` | `../shared/market-price-adapter.js`, `../shared/app-clock.js`, `../shared/probelauf-prices.js`, `./balance-config.js`, `../profile/profile-state.js`, `./balance-renderer.js`, `./balance-storage.js`, `./balance-annual-period.js`, `../shared/persistence-facade.js`, `./balance-annual-orchestrator.js`, `../shared/annual-marketdata.js` |
| `balance-annual-modal.js` | `createAnnualModalHandlers`, `reportAnnualActionError`, `clearAnnualActionError`, `finishAnnualPreflight` | `../shared/annual-close-dialog.js`, `./balance-annual-preview.js`, `./balance-renderer.js` |
| `balance-annual-preview.js` | `projectAnnualPreview` | `../profile/household-plan.js`, `./balance-annual-inflation.js`, `./balance-utils.js`, `../profile/profile-person-data.js`, `../shared/person-data-status.js`, `../profile/profile-state.js`, `../shared/persistence-facade.js` |
| `balance-close-coordinator.js` | `createBalanceCloseCoordinator`, `createAnnualMonthSession` | `../shared/annual-close-session.js` |
| `balance-annual-orchestrator.js` | `createAnnualNavigationLifecycle` | `../shared/navigation-guard-dialog.js`, `../shared/persistence-facade.js`, `./balance-renderer.js`, `../shared/annual-coordinator.js` |
| `balance-annual-storage.js` | `annualRecordStorage`, `captureAnnualRecords`, `assertPreparedAnnualCape`, `applyAdoptedPlanPatch`, `computeAnnualPlanUpdate` | `./balance-config.js`, `./balance-input-storage.js`, `./balance-annual-inflation.js`, `./balance-annual-marketdata.js`, `./balance-utils.js`, `../shared/person-data-status.js`, `../profile/household-plan.js`, `../profile/annual-plan-record.js`, `../profile/profile-person-data.js`, `../profile/profile-storage.js`, `../profile/profile-live-storage.js`, `../profile/profile-state.js` |
| `balance-annual-storage-commit.js` | `evaluateAnnualDraft`, `prepareAnnualCommitRecords`, `commitAnnualPlanUpdate` | `../shared/app-clock.js`, `../shared/persistence-facade.js`, `./balance-config.js`, `./balance-annual-storage.js`, `./balance-input-storage.js`, `./balance-main-profilverbund.js`, `./balance-update-pipeline.js`, `./balance-annual-period.js`, `../profile/household-plan.js`, `../profile/annual-plan-record.js`, `../profile/profile-person-data.js`, `../../types/cumulative-inflation-contract.js`, `../../types/wealth-history-contract.js`, `../profile/profile-storage.js`, `./balance-expenses-storage.js`, `../profile/profile-cash-update.js`, `../tranches/tranchen-history-store.js`, `../overview/overview-model.js`, `../overview/overview-storage.js`, `../overview/overview-simulation-summary.js` |
| `balance-annual-period.js` | `ANNUAL_PERIOD_SCHEMA_VERSION`, `ANNUAL_PERIOD_STATUS`, `LEGACY_PERIOD_DECISION`, `createAnnualPeriodId`, `deriveCompletedCalendarYear`, `createAnnualPeriodMetadata`, `preflightAnnualPeriod`, `createAnnualPeriodPlan`, `checkAnnualPeriodCommit`, `startAnnualPeriodCommit`, `completeAnnualPeriodCommit`, `resolveLegacyAnnualPeriod` | `../profile/profile-person-data.js` |
| `balance-binder-annual.js` | `createAnnualHandlers` | `../shared/annual-plan-editor.js`, `../shared/annual-marketdata.js`, `./balance-annual-inflation.js`, `./balance-annual-marketdata.js`, `./balance-annual-modal.js`, `./balance-annual-orchestrator.js`, `../shared/persistence-facade.js` |
| `balance-binder-diagnosis.js` | `createDiagnosisHandlers` | `./balance-config.js`, `./balance-utils.js`, `./balance-renderer.js`, `./balance-action-summary.js`, `./balance-diagnosis-transaction.js` |
| `balance-binder-imports.js` | `BALANCE_EXPORT_APP_ID`, `BALANCE_EXPORT_SCHEMA`, `BALANCE_EXPORT_SCHEMA_VERSION`, `BALANCE_IMPORT_INPUT_SCHEMA_VERSION`, `MANUAL_WINDOW_HIGH_ENGINE_POLICY`, `BALANCE_IMPORT_INPUT_SCHEMA_V2`, `BalanceImportError`, `MarketCsvImportError`, `parseMarketDataCsv`, `createBalanceExportDocument`, `normalizeBalanceImportDocument`, `resolveCurrentMarketCsvTargetYear`, `createManualMarketCsvImportPlan`, `createImportExportHandlers` | `../shared/navigation-guard.js`, `../shared/navigation-guard-dialog.js`, `../shared/persistence-facade.js`, `./balance-config.js`, `./balance-reader.js`, `./balance-renderer.js`, `./balance-utils.js`, `./balance-update-pipeline.js`, `./balance-annual-marketdata.js`, `./balance-annual-period.js`, `../../types/tranche-contract.js`, `../../types/cumulative-inflation-contract.js`, `../../types/wealth-history-contract.js`, `../../types/liquidity-runway-contract.js`, `./balance-file-service.js`, `../profile/household-plan.js`, `../shared/app-clock.js` |
| `balance-binder-snapshots.js` | `ANNUAL_PERIOD_METADATA_KEY`, `createSnapshotHandlers`, `ANNUAL_RETRY_SESSION_KEY`, `consumeAnnualRetry`, `validateAnnualRetry` | `./balance-annual-storage.js`, `../shared/page-dialog.js`, `../shared/navigation-guard.js`, `../shared/navigation-guard-dialog.js`, `../overview/overview-model.js`, `../profile/profile-registry.js`, `./balance-annual-modal.js`, `../shared/app-clock.js`, `./balance-config.js`, `./balance-renderer.js`, `./balance-storage.js`, `../shared/persistence-facade.js`, `../shared/snapshot-archive.js`, `./balance-wealth-history.js`, `./balance-annual-orchestrator.js`, `./balance-annual-period.js`, `../profile/profile-storage.js`, `../shared/annual-coordinator.js` |
| `balance-binder.js` | `openBalanceDataTarget`, `preserveUIBinderStateForTests`, `initUIBinder`, `UIBinder` | `../shared/annual-operation-lock.js`, `../shared/annual-engine-loader.js`, `./balance-annual-storage-commit.js`, `./balance-expenses.js`, `./balance-annual-modal.js`, `../profile/profile-state.js`, `./balance-config.js`, `./balance-close-coordinator.js`, `../overview/overview-example-expenses.js`, `../profile/profile-cash-update.js`, `../shared/person-data-status.js`, `../shared/market-price-adapter.js`, `../shared/app-clock.js`, `./balance-diagnosis-transaction.js`, `./balance-utils.js`, `./balance-reader.js`, `./balance-renderer.js`, `./balance-storage.js`, `./balance-binder-annual.js`, `./balance-binder-imports.js`, `./balance-binder-diagnosis.js`, `./balance-renderer-diagnosis.js`, `./balance-binder-snapshots.js`, `../shared/persistence-facade.js`, `./balance-annual-marketdata.js`, `./balance-update-pipeline.js`, `./balance-wealth-history.js`, `./balance-expenses-history-renderer.js`, `./balance-wealth-history-renderer.js`, `./balance-expenses-wealth-capture.js`, `../shared/navigation-guard-dialog.js`, `./balance-presentation-controls.js`, `../simulator/simulator-main-dynamic-flex.js`, `../profile/profile-registry.js`, `../overview/overview-model.js`, `../overview/overview-storage.js`, `./balance-expenses-storage.js` |
| `balance-chart-axis.js` | `formatChartEuro`, `prepareChartAxis` | `./balance-utils.js` |
| `balance-config.js` | `REQUIRED_ENGINE_API_VERSION_PREFIX`, `BALANCE_UPDATE_DEBOUNCE_MS`, `BALANCE_PRESENTATION_OUTPUT_IDS`, `CONFIG`, `AppError`, `ValidationError`, `FinancialCalculationError`, `StorageError` | — |
| `balance-diagnosis-chips.js` | `formatChipValue`, `getChipColor`, `createChip`, `buildDiagnosisChips` | `../shared/shared-formatting.js`, `./balance-utils.js`, `./balance-diagnosis-transaction.js`, `./balance-diagnosis-guardrails.js` |
| `balance-diagnosis-decision-tree.js` | `buildDecisionTree` | `./balance-diagnosis-transaction.js` |
| `balance-diagnosis-format.js` | `formatDiagnosisPayload` | `./balance-utils.js` |
| `balance-diagnosis-guardrails.js` | `withGuardrailCardValues`, `createDiagnosisInfo`, `buildGuardrails` | `./balance-utils.js`, `./balance-diagnosis-transaction.js`, `../shared/shared-formatting.js` |
| `balance-diagnosis-keyparams.js` | `buildKeyParams` | `../shared/designsystem-number-format.js`, `../shared/shared-formatting.js`, `./balance-diagnosis-transaction.js`, `./balance-utils.js` |
| `balance-diagnosis-transaction.js` | `buildTransactionDiagnostics`, `formatThresholdLabel`, `transactionDetailRows`, `displayDiagnosisText` | `../shared/shared-formatting.js`, `./balance-utils.js`, `./balance-action-summary.js` |
| `balance-expenses-csv.js` | `EXPENSE_CSV_IMPORT_SUMMARY`, `ExpenseCsvImportError`, `splitCsvLine`, `detectCsvDelimiter`, `parseExpenseAmount`, `parseCategoryCsv` | `./balance-utils.js` |
| `balance-expenses-history-renderer.js` | `renderBalanceExpensesHistory`, `refreshBalanceExpensesHistory` | `./balance-presentation-controls.js`, `./balance-utils.js`, `../shared/persistence-facade.js`, `./balance-expenses-storage.js`, `./balance-expenses-metrics.js`, `../shared/app-clock.js` |
| `balance-expenses-import.js` | `EXPENSES_WAIT_MS`, `expensesImportHint`, `isExpensesImportHint`, `importExpenses`, `requestExpensesPreview` | `../shared/shared-formatting.js`, `./balance-expenses-metrics.js`, `./balance-expenses-csv.js`, `./balance-expenses-storage.js`, `../shared/persistence-facade.js`, `../shared/app-clock.js`, `../shared/probelauf-state.js`, `../demo/beispielausgaben.js` |
| `balance-expenses-metrics.js` | `computeSpent`, `computeMedian`, `sumMonthProfiles`, `computeYearStats`, `prepareExpensesHistoryMetrics`, `sortExpenseEntries` | — |
| `balance-expenses-renderer.js` | `EXPENSE_MONTHS`, `renderExpensesYearSelect`, `renderExpensesSummary`, `renderExpensesTableStructure`, `refreshExpensesTableValues`, `renderExpensesDetails` | `./balance-utils.js`, `./balance-presentation-controls.js`, `./balance-expenses-metrics.js` |
| `balance-expenses-storage.js` | `EXPENSES_STORAGE_KEY`, `EXPENSES_STORE_STATUS`, `ExpensesStoreCorruptionError`, `createEmptyExpensesStore`, `loadExpensesStoreResult`, `loadExpensesStore`, `saveExpensesStore`, `createExpensesCorruptionRecoveryDocument`, `resetCorruptExpensesStore`, `getExpensesYearData`, `getExpensesMonthData`, `setExpensesActiveYear`, `resolveExpensesInitialYear`, `listExpensesYears` | `../shared/persistence-facade.js`, `../shared/app-clock.js` |
| `balance-expenses-wealth-capture.js` | `EXPENSES_WEALTH_QUOTE_MAX_AGE_MS`, `readExpensesWealthQuoteEvidence`, `evaluateExpensesWealthQuoteFreshness`, `createExpensesWealthCaptureController` | `../../types/tranche-contract.js`, `../../types/wealth-history-contract.js`, `./balance-wealth-history.js`, `../shared/app-clock.js` |
| `balance-expenses.js` | `initExpensesTab`, `updateExpensesBudget`, `rollExpensesYear`, `projectCommittedExpensesYear` | `../shared/page-dialog.js`, `../shared/app-clock.js`, `./balance-utils.js`, `./balance-renderer.js`, `../profile/profilverbund-balance.js`, `../shared/persistence-backup.js`, `../shared/persistence-facade.js`, `./balance-expenses-import.js`, `../demo/beispielausgaben.js`, `../shared/probelauf-state.js`, `../shared/navigation-guard-dialog.js`, `../profile/profile-registry.js`, `./balance-expenses-metrics.js`, `./balance-presentation-controls.js`, `./balance-expenses-storage.js`, `./balance-expenses-renderer.js` |
| `balance-file-service.js` | `evaluateBalanceFileInputs`, `exportBalanceFile`, `importBalanceFile`, `connectLegacySnapshotFolder` | `./balance-binder-imports.js`, `./balance-storage.js`, `../shared/persistence-facade.js`, `../profile/household-plan.js`, `./balance-update-pipeline.js` |
| `balance-guardrail-reset.js` | `shouldResetGuardrailState` | — |
| `balance-health-bucket.js` | `resolveBalanceHealthBucketDefinition`, `buildBalanceHealthBucketDiagnostics` | `../profile/profile-state.js` |
| `balance-input-storage.js` | `BALANCE_STORAGE_FIELD_IDS`, `projectStoredHouseholdInputs`, `buildBalanceEngineInputFromStorage`, `buildStoredProfileEngineInput` | `../shared/person-data-status.js`, `../profile/household-plan.js`, `./balance-reader.js`, `./balance-utils.js`, `./balance-config.js`, `../tranches/depot-tranchen-status.js`, `../tranches/tranchen-manager-state.js`, `../../types/tranche-contract.js`, `../profile/profile-state.js`, `../profile/profile-storage.js`, `../profile/profilverbund-balance.js`, `../../types/liquidity-runway-contract.js`, `../simulator/dynamic-flex-longevity-contract.js`, `./balance-update-pipeline.js` |
| `balance-main-profile-sync.js` | `renderProfileInputOrigins`, `createProfileSyncHandlers` | `./balance-reader.js`, `./balance-utils.js`, `../profile/profilverbund-balance.js`, `../profile/profile-state.js`, `../shared/persistence-facade.js`, `../shared/field-state.js`, `../shared/person-data-status.js` |
| `balance-main-profilverbund.js` | `createProfilverbundHandlers`, `evaluateStoredAnnualHousehold` | `../profile/household-plan.js`, `../shared/person-data-status.js`, `./balance-config.js`, `./balance-reader.js`, `../profile/profile-storage.js`, `../profile/profilverbund-balance.js`, `../profile/profilverbund-balance-ui.js`, `../profile/profilverbund-action-attribution.js`, `../shared/persistence-facade.js`, `./balance-storage.js`, `../shared/suite-frame.js` |
| `balance-main.js` | `update`, `initVersionHandshake`, `renderPersistenceStartupWarning`, `init` | `./balance-input-storage.js`, `../profile/household-plan.js`, `../profile/household-plan-dialog.js`, `../profile/household-plan-migration.js`, `./balance-file-service.js`, `../shared/person-data-status.js`, `../overview/overview-model.js`, `../overview/overview-storage.js`, `../profile/profile-registry.js`, `../profile/profile-navigation.js`, `./balance-config.js`, `./balance-storage.js`, `./balance-reader.js`, `./balance-diagnosis-transaction.js`, `./balance-diagnosis-guardrails.js`, `./balance-renderer.js`, `./balance-binder-snapshots.js`, `./balance-binder.js`, `../tranches/depot-tranchen-status.js`, `../profile/profilverbund-balance.js`, `./balance-main-profilverbund.js`, `./balance-main-profile-sync.js`, `./balance-utils.js`, `./balance-expenses.js`, `../simulator/simulator-main-dynamic-flex.js`, `../shared/persistence-facade.js`, `../profile/profile-state.js`, `./balance-action-postprocessor.js`, `./balance-annual-marketdata.js`, `./balance-expenses-history-renderer.js`, `./balance-wealth-history-renderer.js`, `./balance-update-pipeline.js` |
| `balance-next-steps.js` | `deriveBalanceNextSteps` | `../shared/designsystem-number-format.js` |
| `balance-presentation-controls.js` | `bindBalanceBudgetWhy`, `bindBalanceDisplaySize`, `bindBalanceTableOverflow`, `bindBalanceYearSegments`, `bindBalancePresentationControls` | `../simulator/simulator-main-dynamic-flex.js`, `../shared/dynamic-flex-presets.js` |
| `balance-reader.js` | `parseBalanceCurrencyInput`, `initUIReader`, `getMarketDataProvenanceViewModel`, `UIReader` | `./balance-input-storage.js`, `../shared/person-data-status.js`, `../profile/household-plan.js`, `./balance-update-pipeline.js`, `./balance-utils.js`, `../tranches/depot-tranchen-status.js`, `./balance-config.js`, `../../types/liquidity-runway-contract.js`, `../profile/profile-state.js`, `../profile/profile-storage.js`, `../shared/persistence-facade.js`, `../simulator/dynamic-flex-longevity-contract.js` |
| `balance-renderer-action.js` | `ActionRenderer` | `./balance-utils.js`, `./balance-diagnosis-transaction.js`, `./balance-action-summary.js` |
| `balance-renderer-diagnosis.js` | `bindBalanceInfoPopups`, `DiagnosisRenderer` | `./balance-diagnosis-format.js`, `./balance-diagnosis-chips.js`, `./balance-diagnosis-decision-tree.js`, `./balance-diagnosis-guardrails.js`, `./balance-diagnosis-transaction.js`, `./balance-diagnosis-keyparams.js`, `../shared/designsystem-info-popover.js` |
| `balance-flex-trace.js` | `projectBalanceFlexTrace` | keine |
| `balance-renderer-summary.js` | `formatCurrency`, `calculateTotals`, `renderSummary`, `SummaryRenderer` | `./balance-flex-trace.js`, `./balance-presentation-controls.js`, `./balance-utils.js`, `./balance-config.js`, `./balance-annual-period.js`, `./balance-reader.js`, `../shared/designsystem-number-format.js`, `../shared/app-clock.js`, `./balance-next-steps.js`, `./balance-action-summary.js`, `../overview/overview-model.js`, `../shared/persistence-facade.js`, `../profile/profile-registry.js`, `../profile/profile-person-data.js`, `../shared/person-data-status.js` |
| `balance-renderer.js` | `createBalanceValidationHint`, `initUIRenderer`, `UIRenderer` | `./balance-config.js`, `./balance-renderer-summary.js`, `./balance-renderer-action.js`, `./balance-renderer-diagnosis.js`, `./balance-diagnosis-transaction.js` |
| `balance-storage.js` | `BALANCE_IMPORT_RECOVERY_KIND`, `initStorageManager`, `StorageManager` | `../shared/navigation-guard.js`, `../shared/navigation-guard-dialog.js`, `./balance-config.js`, `../../types/wealth-history-contract.js`, `../shared/persistence-facade.js`, `../shared/snapshot-archive.js`, `../profile/profile-state.js`, `../profile/profile-storage.js`, `../../types/cumulative-inflation-contract.js`, `../profile/profile-person-data.js`, `../shared/snapshot-restore.js` |
| `balance-update-pipeline.js` | `BALANCE_UPDATE_STATUS`, `BALANCE_UPDATE_MODE`, `BALANCE_STATE_LIFECYCLE_KEY`, `EngineGateError`, `BalanceStateLifecycleError`, `createBalanceFingerprint`, `createBalanceCommitBaseFingerprint`, `cloneBalanceState`, `resolveBalanceUpdateRequest`, `assertBalanceCandidateFresh`, `assertBalancePeriodCommit`, `assertBalanceCommitStillCurrent`, `createEngineHandshake`, `assertActiveEngineHandshake`, `createUpdateSuccessResult`, `createBlockedUpdateResult`, `createUpdateFailureResult`, `validateBalanceInputs`, `prepareEngineLastState`, `createBalanceDisplayEngineApi`, `buildBalanceRendererPayload`, `enrichBalanceDiagnosisPayload`, `persistBalanceUpdate`, `projectBalancePlanHistory`, `calculateExpensesBudget` | `./balance-guardrail-reset.js`, `./balance-health-bucket.js`, `./balance-config.js`, `../profile/household-plan.js` |
| `balance-utils.js` | `NUMBER_PARSE_ERROR_CODES`, `parseLocalizedNumber`, `UIUtils` | `../shared/designsystem-number-format.js`, `../shared/shared-formatting.js` |
| `balance-wealth-history-metrics.js` | `prepareWealthHistoryMetrics`, `prepareWealthHistorySummary`, `prepareWealthHistoryChart` | `../../types/wealth-history-contract.js`, `./balance-chart-axis.js` |
| `balance-wealth-history-renderer.js` | `initializeBalanceWealthHistory`, `renderBalanceWealthHistory`, `refreshBalanceWealthHistory` | `./balance-utils.js`, `./balance-chart-axis.js`, `./balance-presentation-controls.js`, `./balance-storage.js`, `../../types/wealth-history-contract.js`, `./balance-wealth-history-metrics.js` |
| `balance-wealth-history.js` | `createBalanceWealthHistoryService`, `previewWealthHistory`, `createManualWealthHistoryController` | `./balance-config.js`, `./balance-storage.js`, `../shared/persistence-facade.js`, `../profile/profile-state.js`, `../profile/profile-registry.js`, `./balance-update-pipeline.js`, `../shared/navigation-guard-dialog.js`, `../../types/wealth-history-contract.js`, `../shared/app-clock.js`, `../profile/profile-cash-update.js`, `../tranches/tranchen-history-store.js` |

---

## 1. `balance-config.js`
Konfiguration, Fehlertypen und Debug-Utilities.

**Exports:**
- `REQUIRED_ENGINE_API_VERSION_PREFIX`
- `CONFIG`
- `AppError`
- `ValidationError`
- `FinancialCalculationError`
- `StorageError`


---

## 2. `balance-utils.js`
Formatierungs- und Hilfsfunktionen für die UI.

**Exports:**
- `NUMBER_PARSE_ERROR_CODES` – `number_required`, `number_invalid_format`, `number_ambiguous_separator`, `number_non_finite`
- `parseLocalizedNumber(rawValue, options)` – strukturiertes Resultat mit `valid`, `value`, `error`; Null und fehlend bleiben getrennt
- `UIUtils`
  - `EUR_FORMATTER` / `NUM_FORMATTER`
  - `formatCurrency(val)` – centgenaue Kopier-/Detailpräzision
  - `formatBalanceCurrency(val)` – reguläre sichtbare Beträge und Handlungsdruck in ganzen Euro
  - `formatNumber(num)`
  - `formatPercent(value, options)`
  - `formatPercentValue(value, options)`
  - `formatPercentRatio(value, options)`
  - `formatMonths(value, options)`
  - `parseCurrencyResult(str, options)` – strukturierter Parservertrag
  - `parseCurrency(str)` – kompatibler Zahlenpfad mit bestehendem 0-Fallback
  - `describeRunwayTargetSource(sourceKey)` / `describeRunwayTargetSmoothing(smoothing)` – bestehende Zielherkunft und Glättung beschreiben
  - `getThreshold(path, defaultValue)` – greift sicher auf Engine-Konfigurationen zu

**Dependencies:** `app/shared/shared-formatting.js`, `app/shared/designsystem-number-format.js`

---

## 3. `balance-storage.js`
Persistenzschicht fuer Balance-State ueber `app/shared/persistence-facade.js` und das interne Snapshot-Archiv. Im Browser nutzt die Facade IndexedDB als lokale Source of Truth und migriert erlaubte Legacy-Keys automatisch aus `localStorage`; in Tauri nutzt sie JSON-Dateien im App-Datenverzeichnis und migriert erlaubte Legacy-Keys aus der WebView-`localStorage`-Ablage. Feature-Code nutzt weiter die synchrone Storage-like API.

**Exports:**
- `initStorageManager(domRefs, state, renderer)` – initialisiert Abhängigkeiten
- `StorageManager`
  - `loadState()` / `saveState(state)` / `resetState()`
  - `replaceStateFromImport(state)` – ersetzt nur den schema-validierten Balance-State nach bestaetigtem Import-Recovery-Snapshot
  - `rollbackImportReplace(receipt)` – stellt bei einem spaeten Importfehler alle im Recovery-Snapshot erfassten erlaubten Live-Daten wieder her
  - `initSnapshots()` / `renderSnapshots(listEl, statusEl, handle)`
  - `createSnapshot(handle)` / `restoreSnapshot(key, handle)` / `deleteSnapshot(key, handle)`
  - `connectFolder()` – Kompatibilitaets-/UI-Pfad fuer aeltere Ordnerbindung; neue Snapshots liegen im internen Archiv

**Dependencies:** `balance-config.js` (Konfiguration & Fehlerklassen), `app/shared/persistence-facade.js`, `app/shared/snapshot-archive.js`

**Snapshot-Archiv:** Jahresabschluss- und Import-Recovery-Snapshots werden als `persistence-records-v1` gespeichert. Import-Recovery-Punkte tragen den Kind-Wert `balance-import-recovery` und werden vor dem ersten Balance-Replace geschrieben und zurueckgelesen. Browser nutzt die IndexedDB-Datenbank `ruhestand-suite` Version 2 mit separatem Store `snapshots`; Tauri nutzt neben `ruhestand_suite_data.json` die separate Datei `ruhestand_suite_snapshots.json`. Ein optionales File-System-Verzeichnis-Handle liegt getrennt in `ruhestand-suite-snapshot-handles`; ein vorhandenes Handle aus der historischen `snapshotDB` wird uebernommen und die Legacy-Verbindung danach geschlossen. Blockiert ein anderer Tab deren Cleanup, setzt der Adapter keinen falschen Marker und setzt die Bereinigung bei einem spaeteren Lauf fort, ohne die Snapshot-Liste aufzuhalten. `listSnapshots()` zeigt nur Indexdaten ohne Vollpayload. Standard-Restore erhaelt die Snapshot-Historie, bewahrt die Profil-Registry und setzt nur das aktive Profil zurueck, wenn `snapshot.activeProfileId` in der aktuellen Registry existiert.

**Navigationsbesitzer bei Import und Archiv:** JSON-Importhandler halten
`createNavigationOperationLifecycle` von Dateilesen/PREVIEW bis zu abschließender
Bestätigung oder Rollback samt UI-Cleanup. Vorflush, Reader-Migrationswrites und
Recovery-Snapshot sind Teil der kündigbaren Vorbereitung; nach bestätigter
Kündigung beginnt kein Bestandsreplace. Der erste Livewrite wechselt zu `commit`,
dessen Schutz Readback, Postvalidierung, letzten Flush und verzögerten Rollback
umfasst. Die Dateiauswahl wird zurückgesetzt; bei Abbruch werden ursprüngliche
Eingaben und PREVIEW wiederhergestellt. Neue Importe starten nicht während fremdem
Commit oder reservierter Navigation. Fehlgeschlagene Importsicherung bleibt als
Aktionsfehler; neue Recoverypunkte werden auch im Fehlerfall in der aktuellen
Snapshotliste angezeigt und bleiben zur Wiederholung erreichbar.

`replaceStateFromImport(state, options)` und `rollbackImportReplace(receipt, options)`
sowie Archivaufrufe können den äußeren `navigationOperation` übernehmen.
`createSnapshot(handle, label, options)` erhält beim Jahresabschluss denselben
Jahresbesitzer; ein inneres Snapshotende gibt ihn niemals frei. Archivcreate/-delete
ohne äußeren Besitzer sperren selbst bis zum bestätigten Adapterende.
`restoreSnapshot(key, handle, options)` liest kündigbar und reserviert anschließend
den gemeinsamen `guard.reload`-Pfad: verifizierte transaktionale Übernahme,
Flush, Schlussprüfung, genau ein Reload ohne Bundleexport. Auch Standardrestore
wird gegen Backend und Cache bestätigt; Profil-/Key-Scope und archivierte Records
bleiben erhalten. Neue Eingaben oder fremde Commits nach Zustimmung verhindern
Reload; Schreib-/Readback-/Postvalidierungsfehler laden nicht neu.

**Gespeicherter Restore ohne Reload:** `restoreSnapshot` liefert `restored`,
`cancelled` oder `reload_required` als `status`. Bei `reload_required` zeigt der
Snapshotbinder im Aktionsort `snapshots`: Der Snapshot ist gespeichert, die Seite
wurde nicht neu geladen und muss jetzt neu geladen werden. Ab Restorewrite sperrt
`PersistenceFacade.blockSyncWrites` synchrone Änderungen des Balance-State-Keys
und von `rs_profiles_v1`, einschließlich `PERSIST_INPUTS` und veralteter
Profilverbundkopien. Ein solcher Write wirft `PERSISTENCE_RELOAD_REQUIRED`, bevor
Cache oder Backend verändert werden. Bleibt der Reload aus oder scheitert der
letzte Flush nach bestätigtem Replace, hält die flüchtige Sperre bis zum Neuladen;
PREVIEW und Archivlesen bleiben möglich. Beim Archivrestore bleibt auch nach einem
Reloadcallback die alte Dokumentgeneration gesperrt; erst die neu geladene Seite
startet mit frischem Cache. Erfolgreicher Rollback gibt den eigenen Sperrbesitzer frei. Eine neue Seite startet ohne
diese Sperre. Bei fehlgeschlagenem Rollback bleibt sie ebenfalls erhalten.

**Entfallene Altbedienung:** Balance-Reset und Markt-CSV-Import sind aus der Oberfläche und ihren Bindern entfernt. Der Simulator behält seinen Reset. Abgewiesene JSON-Importe melden eine laufende andere Aktion in `balance-import`; Vollimport und Archiv verwenden ihre bestehenden Statusbereiche und Schutzwege.

Gezielte Nodeprüfungen: `balance-import-navigation`, `persistence-write-navigation`,
`balance-storage-contract`, `balance-ui-orchestration`, `balance-annual-navigation`.
Browserfälle `Navigation guard imports`, `Navigation guard imports native` und
`Navigation guard snapshot restore` sind registriert; die externe Ausführung mit
echten nativen Nachfragen und Backendreadback bleibt erforderlich.

**Hinweis Steuerzustand:** `lastState.taxState.lossCarry` wird migriert/defaulted und bei Guardrail-Resets erhalten.

---

## 4. `balance-reader.js`
Liest UI-Eingaben und kümmert sich um UI-Side-Effects.

**Exports:**
- `initUIReader(domRefs)`
- `UIReader`
  - `readAllInputs()` – unverändertes DOM-Vergleichsorakel
  - `captureStorageDraft(metadata, { includePreviewBase })` – validiert Rohwerte und Planpatch, liefert isolierten Speicheradapter und Eingabebau ohne Fachwrite; nur Vorschauen lesen zusätzlich die unveränderte Speicherbasis
  - `applyHouseholdPlanInputs()` – befüllt Bedarf und Strategie aus dem bestätigten gemeinsamen Bereich
  - `readHouseholdPlanPatch()` – liest ausschließlich ausdrücklich geänderte Planfelder, validiert ohne Clamping
  - `applyStoredInputs(storedInputs)`
  - `renderMarketDataProvenance(meta)` – zeigt persistierte Quelle, Periode,
    Stichtag, Instrument und Hoch-Scope und exponiert sie als `data-*`
  - `applySideEffectsFromInputs()` – zeigt/verbirgt Panels (z. B. Gold, zweite Rente)
- `getMarketDataProvenanceViewModel(meta)` – DOM-freie Projektion fuer
  Reload-, Diagnose- und Browservertraege

**Import-Booleans:** Persistierte Checkboxen und `renteAktiv` werden nur durch
echtes Boolean `true` aktiviert. Stringwerte werden nicht per Truthiness
interpretiert.

**Pflegebucket:** Liest die Profildefinition `profile_health_bucket` als optionalen Haushaltsbaustein. Die eigentliche Diagnose wird nicht im Reader berechnet, sondern an `balance-health-bucket.js` delegiert.

**Mindest-Flex:** Liest `minimumFlexAnnual` aus dem Feld `Mindest-Flex p.a. (EUR)` und gibt den Wert unverändert an die Engine weiter. Das Feld wird wie Floor, Flex und Flex-Budget inflationiert.

**Dependencies:** `balance-utils.js`, `balance-health-bucket.js`

### Gemeinsamer aktueller Plan (H1, Slice 2)

Nach bestätigter Umstellung ist `household_plan_v1` die Quelle für Bedarf,
Flex-Budget, Reichweite, Entnahmestrategie, Dynamic Flex, Haushaltsentnahmemodus
und CAPE. Mitglieder lesen denselben Haushaltsbereich; ohne ausgewählte Mitglieder
nutzt Balance den Einzelbereich der geöffneten Außenperson. Eine geöffnete
Außenperson darf den ausgewählten Haushaltsplan nicht ändern: Ein ausdrücklicher
Planpatch wird vor Plan-, Fach- und Zusammenfassungswrite abgewiesen. Ein leerer
Planpatch sperrt weder personenbezogene Eingabewrites noch Periodenwrites.
Reader, Rechnung und Zusammenfassung bleiben dabei auf dem ausgewählten
Haushaltsbereich. Ohne Mitglieder kann die Außenperson ihren eigenen Einzelbereich
über denselben Main-Pfad bearbeiten. Ohne bestätigten
Plan, insbesondere nach „Später“, liest der Speicherleser dieselben Altwerte; das Formular bleibt bedienbar.

`balance-main.js:init()` übergibt dem Umstellungsdialog einen Migrationswrapper.
Nach erfolgreicher Wiederöffnung (`status === 'migrated'`) befüllt er über
`UIReader.applyHouseholdPlanInputs()` Formular und `planFormSource` für denselben
Bereich und ruft ausschließlich `update({ mode: BALANCE_UPDATE_MODE.PREVIEW })`
auf. Die Bereitschaft gilt erst nach erfolgreicher regulärer Befüllung, Bindung
und Erstvorschau; diese Schritte laufen synchron. Die unmittelbare oder stille
Erstmigration verwendet deshalb nur die reguläre Initialbefüllung. Frühe
Startabbrüche, erneutes „Später“, Escape und Migrationsfehler erzeugen keinen
Erfolgsrefresh. Anzeigeprobleme machen einen bestätigten Migrationswrite nicht
nachträglich unbestätigt. Der erste anschließende Flexwrite nutzt die neue
Baseline und bleibt auch nach erneuter Planbefüllung erhalten.

Die bestehende Formularentprellung führt validierte Patches über
`stageBalancePlanPatch` aus. Gleichwertige Werte erhalten Rohbytes und `updatedAt`;
Recovery sperrt Writes. Die CAPE-Checkboxentscheidung bleibt auch bei CAPE 0 im
Plan erhalten; nur die Engineprojektion verwendet das bisherige CAPE-Gate.
Bestätigte Jahres-CAPE-Metadaten werden mit der bestehenden Anzeigepräzision und
vorhandener Provenienz übernommen. Veraltete Simulator-CAPE-Kopien sind keine Quelle.
Manuelle Simulator-CAPE-Eingaben über `input` und `change` setzen dagegen Datum
und Quelle ausdrücklich auf null; andere Planwrites und reine Leser erhalten
die vorhandene Herkunft.

`projectBalancePlanHistory` projiziert den historischen Bedarfsvergleich für den
unveränderten Guardrailreset. Die erste Rechnung verwendet den bisherigen
Hauptprofilweg; spätere Rechnungen verwenden die haushaltsweite
`balanceStateLifecycle.planInputEvidence`. Das ist historische Resetevidenz,
kein aktueller Personenplan. Beide Profilverbundschreiber entfernen neue
Planwertkopien aus `inputs` und `profilverbundHouseholdInputs`; Vermögen,
Einkommen, Goldregeln, Verlustvorträge und Actions bleiben personenbezogen.
Der Kandidatenfingerabdruck erfasst den verwendeten Plan und ignoriert alte Kopien.

Der Balance-Dateiexport projiziert bestätigte Planwerte in den bestehenden
vollständigen Dateivertrag. Der Import verwendet weiterhin Vorschau, Recovery und
Replace; bei fehlgeschlagener Abschlussprüfung werden zusätzlich die vorherigen
Planrohbytes transaktional zurückgenommen. Ein unbestätigter Rollback sperrt
weitere Planwrites. Auf Daten & Sicherung aktualisiert der Austauschbinder nach
Importfehlern die bestätigte Archivliste vor der ursprünglichen Fehlerausgabe,
auch bei bestätigter Rücknahme; ein Refreshfehler ersetzt den Importfehler nicht.
`annual_plan_record_v1` bleibt in H1 bei Vorschau,
unterjährigem Update und Jahresabschluss unbeschrieben; sein Schreiber folgt in H3.

`tests/balance-household-plan.test.mjs` vergleicht zwölf Fälle für Muster,
synthetische Echtform und Außenperson mit Standard-/Drei-Töpfe-Strategie, Budget
und CAPE 0/>0. Verglichen werden vollständige Reader-/Enginebytes,
Personenstates/Attribution und Jahreszusammenfassungen bei derselben Uhr und Basis.
Die Browserfälle „Balance annual commit“ und „Household annual source“ prüfen
die gemeinsame Quelle; ihre Ausführung bleibt ein Gate der gesteuerten Sitzung.
Die zusätzliche Nodeprobe startet den produktiven `init()` mit Floor-Konflikt,
vertagt und bestätigt über den echten Hinweis-/Dialogweg. Sie prüft Floor 31000,
Bereichsbaseline, produktive Vorschau und den ersten Flexwrite bis zum Backend
sowie Erstmigration, Startfehler, Später/Escape, Quellenwechsel und Belegbyteerhalt.
„Balance Planübernahme nach Später ohne Reload“ ist als eigener Browserfall
registriert: Kernfolge und Flexspeicherung werden vor dem ergänzenden Reload
geprüft. Seine tatsächliche Browserabnahme bleibt extern offen.

---

## 5. `balance-renderer.js`
Fassade für KPIs, Guardrails, Diagnose und getrennte Meldungsbereiche.

**Exports:**
- `initUIRenderer(domRefs, storageManager)`
- `UIRenderer`
  - `render(ui)` – Hauptdarstellung
  - `renderBedarfAnpassungUI(inputData, persistentState)`
  - `renderDiagnosis(diagnosis)` / `formatDiagnosisPayload(raw)`
  - `toast(msg, isSuccess = true)` – Standard/`true`: Erfolg; `'info'`: neutraler Hinweis; `false`: Fehler
  - `handleError(error)` / `clearError()`
  - `getActionSummary()` / `getActionCopyText()` / `renderContext(input)`
  - `handleActionError(error, scope, action = null)` / `clearActionError(scope)`

**Dependencies:** `balance-config.js`, `balance-renderer-summary.js`, `balance-renderer-action.js`, `balance-renderer-diagnosis.js`

**Anzeigevertrag:** Die benachbarten Container in `Balance.html` trennen drei Zuständigkeiten:

- `#error-container` (`dom.containers.error`) bleibt für Berechnungs-/Validierungs-, Engine-/Update- und Initialisierungsfehler zuständig. `handleError()` formatiert auch Validierungslisten und markiert Berechnungsfelder; `clearError()` entfernt nur diesen Fehler samt Feldmarkierungen.
- `#toast-container` (`dom.containers.toast`, `role="status"`, `aria-live="polite"`, `aria-atomic="true"`) zeigt sechssekündige Kurzmeldungen. `.toast-text` enthält den unveränderten Originaltext. Symbol/Form und zugängliche Typkennzeichnung unterscheiden Erfolg (✓ / „Erfolg: “), Hinweis (i / „Hinweis: “) und Fehler (! / „Fehler: “) zusätzlich zur Farbe. Fortschritt, lokale CAPE-Warnungen, Vorgänge ohne neue Änderung und Export-Validierungswarnungen verwenden explizit `'info'`, ohne Textheuristik. Ein neuer Toast ersetzt den bisherigen, storniert seinen Timer und erhält auch bei identischem Text eine neue 6000-ms-Frist. Identität und Containerreferenz schützen vor veralteten Callbacks; ein fehlender Toastcontainer hat keinen Fallback auf den Fehlerkanal. Die Jahresabschlussmeldung bleibt mindestens 3000 ms sichtbar.
- `#action-error-container` (`dom.containers.actionError`, `role="alert"`, `aria-live="assertive"`, `aria-relevant="additions text"`) hält je `scope` einen Eintrag mit `.action-error-text` und zugänglich benanntem `type="button"`-Schließenknopf. Verschiedene Bereiche bleiben gleichzeitig sichtbar; `clearError()`, Updates und Toastablauf entfernen sie nicht. Die gemeinsame Fehlerformatierung erhält Präfixe, Listen, Codes und Recoverytexte. Die Aufrufherkunft entscheidet über den Kanal; Aktionsvalidierung markiert keine Berechnungsfelder.

**Bereichszuständigkeiten:** `balance-import` gehört dem JSON-Importhandler, `balance-export` dem JSON-Export; neue Importe setzen ihren Bereich erst mit Datei zurück. Nutzerpfade für `annual` sind die Jahreszugänge (zwei im Kopf, Bedarf & Strategie, Überblick) sowie Alt+J; angenommene Aktionen setzen ihn nach erforderlicher Bestätigung zurück, ein bereits abgeschlossener Jahres-No-op ebenfalls. Direkte Jahres-/Inflations-/ETF-/CAPE-Aufrufe sind intern; verschachtelte Schritte (`nested`) bereinigen nicht nochmals. `snapshots` umfasst die erfolgreich bestätigte Ordnerverbindung nach Auswahl, Berechtigung und Speicherung des Handles sowie bestätigtes Restore/Löschen. Während des Ordnerdialogs und bei `AbortError` bleibt der bisherige Fehler erhalten; ein Verbindungsfehler ersetzt ihn. `expenses-import` beginnt nur mit Datei und gültigem Monats-/Profilziel ohne Korruptionssperre; `expenses-recovery` mit ausführbarem Recovery-Export oder nach Export bestätigtem Reset. Die detaillierten Grenzen stehen in [TECHNICAL.md](TECHNICAL.md#balance-meldungen-anzeige--und-aktionsgrenzen).

**Fokus und Darstellung:** Der Schließenknopf heißt zugänglich „Fehlermeldung schließen“ und verweist mit `aria-describedby` auf die eindeutige ID des Fehlertexts. Manuelles Schließen fokussiert den nächsten verbleibenden Schließenknopf, am Listenende den vorherigen Nachbarn, beim letzten Fehler `#openDiagnosisBtn`. Automatische Bereinigung und veraltete Knöpfe verschieben keinen Fokus. Die Liste scrollt vertikal bei höchstens `min(16rem, 30vh)` Höhe; ein Rahmen je Eintrag, vollständige Texte und erreichbare Knöpfe bleiben erhalten. `tabindex="0"` und `aria-label="Aktionsfehler"` gelten am Listencontainer nur bei vorhandenen Einträgen. Lokale Toast-Hintergründe sichern für alle drei Typen mindestens 4,5:1 Textkontrast.

Dateiauswahl ohne Importdatei, abgebrochene Bestätigung, irrelevanter Snapshotlistenklick oder abgewiesene Reentranz löschen keinen Fehler. Schließen entfernt nur seinen Eintrag ohne Speicherzugriff, Berechnung oder Recovery; veraltete Knöpfe entfernen keine neueren Fehler. Meldungen sind reiner Text, lange Texte umbrechen mobil, Toasts und Aktionsfehler sind im Druck ausgeblendet. Timer, Toastidentität und Aktionsfehler-Map sind flüchtig; `initUIRenderer()` storniert Timer und leert alte/neue Meldungscontainer sowie die Map. Kein Meldungszustand wird gespeichert oder exportiert. Profil-Recovery in `balance-expenses.js` bleibt im bisherigen Fehlerkanal; `#wealthHistoryStatus` bleibt eine eigene Verlaufsmeldung.

**Dateievent-Guard:** `UIBinder.handleFormInput()` und `handleFormChange()` in `balance-binder.js` ignorieren `target.type === 'file'` vor Metadaten, Eingabe-Side-Effects und `debouncedUpdate()`. Importhandler behalten ihre bestehenden Import-/Registry-/Rollbackwirkungen; normale Eingaben bleiben entprellt. Es entsteht kein neues Fachmodul, und Engine, Datenmodell sowie andere Seiten ändern sich dadurch nicht.

**Import-Wiederherstellung:** Beide Catch-Pfade in `balance-binder-imports.js` versuchen den bestehenden Rollback, stellen die Eingabefelder und bei CSV die vorherige Provenienzanzeige wieder her und warten vor dem ursprünglichen Aktionsfehler eine neue `BALANCE_UPDATE_MODE.PREVIEW` ab. Diese Vorschau erneuert KPIs und Handlungsschritte ohne zusätzlichen Speicherwrite oder Ersatz-Commit. Berechnungsfehler verworfener Importdaten samt Feldmarkierungen werden zuvor bereinigt; echte Fehler des wiederhergestellten Standes können erscheinen, fremde Aktionsfehler bleiben erhalten. Eine werfende Vorschau unterdrückt weder Import-/Recoveryfehler noch Dateifeldleerung. `post_replace_validation_failed` und `rollback_failed` bleiben unverändert; bei fehlgeschlagenem Rollback beweist die Vorschau keine Speicherreparatur. Recovery-Snapshot und Wiederherstellungsaufforderung bleiben auch nach Schließen oder Reload maßgeblich.

**Helper-Module (ausgelagert):**
- `balance-renderer-summary.js` – KPIs, Marktstatus, Liquiditätsbalken
  - zeigt bei aktivem Pflegebucket Brutto-Liquidität, gesperrte Pflege-Zweckbindung, operative Liquidität, reale Zieldeckung und Ziel-Lücke
- `balance-renderer-action.js` – Handlungsempfehlungen & Cash-Rebalancing
  - gruppiert Transaktionen zusätzlich nach Zweck (`Liquidität`, `Gold`, `Aktien`, `Geldmarkt`, `Bonds`, `Steuer`, `Rest/Puffer`)
  - zeigt finale Settlement-Steuer (`action.steuer`) inkl. optionaler Aufschlüsselung
    (`taxBeforeLossCarry`, `taxAfterLossCarry`, `taxSavedByLossCarry`)
- `balance-renderer-diagnosis.js` – Diagnose-Chips, Guardrails, Kennzahlen
- `balance-diagnosis-format.js` – Diagnose-Payload normalisieren, inklusive Grenzfalltexten wie `Exakt auf Mindestniveau`
- `balance-diagnosis-chips.js` – Diagnose-Chips (Runway, Quote, Drawdown)
- `balance-diagnosis-decision-tree.js` – Entscheidungsbaum
- `balance-diagnosis-guardrails.js` – Guardrail-Karten mit Schwellenwert- und Grenzfallhinweisen
- `balance-diagnosis-transaction.js` – Transaktionsdiagnostik (kuratierte Zeilen, vollständige technische Klappe, deutsche Schlüssel-/Regelbeschriftungen und `Warum kein Goldkauf?`)
- `balance-diagnosis-keyparams.js` – Schlüsselkennzahlen, inklusive VPW-Trennung in Rahmen, freigegebenen Flex und nicht genutzten Spielraum
  - ergänzt Pflegebucket-Diagnose und weist `diagnostic_only` aus, wenn keine automatische Freigabe erfolgt
  - zeigt Mindest-Flex-Betrag, Status, Blockiergrund, erforderliche Rate, Policy-Effekt und den finalen Betrag samt Fehlbetrag nach Budget, Glaettung und Monatsquantisierung

---

## 5a. `balance-health-bucket.js`
DOM-freie Diagnose des Pflegebuckets in der Balance-App.

**Hauptfunktionen / Contract:**
- Liest eine normalisierte `healthBucket`-Definition aus den Profil-/Reader-Daten.
- Berechnet Brutto-Liquidität, gesperrten Betrag, operative Liquidität, Zieldeckung und Ziellücke.
- Unterscheidet Herkunft aus Geldmarkt und Cash, soweit diese Werte im Profil-/Balance-Kontext verfügbar sind.
- Setzt die V1-Policy explizit auf `releasePolicy: 'diagnostic_only'`, `releaseAllowed: false` und `releasedAmount: 0`.
- Liefert Warnungen/Hinweise für Kappung, fehlende Zieldeckung und fehlende operative Freigabe.

**Abgrenzung:**
Balance entsperrt den Pflegebucket derzeit nicht automatisch. Dafür fehlt ein belastbarer aktueller Pflegegrad-Ist-Zustand in der Jahresplanung. Reale Pflegeausgaben werden weiterhin über Bedarf/Jahresplanung eingegeben; der Bucket wird transparent als Zweckbindung neben der freien Liquidität gezeigt.

**Dependencies:** Keine DOM-Abhängigkeit; nutzt nur übergebene Input-/Profilwerte.

---

## 6. `balance-binder.js`
Event-Hub der Anwendung.

**Exports:**
- `initUIBinder(domRefs, state, updateFn, debouncedUpdateFn)`
- `UIBinder`
  - `bindUI()` – registriert alle Event-Listener
  - `handleKeyboardShortcuts(e)` – u. a. Jahresdialog (Alt+J), JSON-Import/Export (Alt+I/E)
  - `handleFormInput(e)` / `handleFormChange()` – triggert Debounce-Updates
  - `handleTabClick(e)` – Tab-Navigation
  - `handleBedarfAnpassungClick(e)` – inflationsbedingte Anpassung
  - `handleJahresUpdate()` – startet denselben fail-safe, periodengebundenen Coordinator wie der Jahresabschluss-Button; Online-Abrufe, Writes und Abschluss teilen dadurch Snapshot, In-Flight-Sperre und Perioden-ID.
  - `handleExport()` / `handleImport(e)` – Datenimporte/-exporte
  - `handleJahresabschluss()` – Snapshot & Jahreswechsel
  - `handleSnapshotActions(e)` – Snapshot verwalten (restore/delete)
  - `handleCopyDiagnosis()` – Diagnose in Zwischenablage

**Dependencies:** `balance-config.js`, `balance-utils.js`, `balance-reader.js`, `balance-renderer.js`, `balance-storage.js`

**Helper-Module (ausgelagert):**
- `balance-binder-annual.js` – Jahres-Update, Inflation, ETF-Nachrücken, Modal-Logik
- `balance-binder-imports.js` – erzeugt `balance-state`-Exports mit stabiler App-ID, `schemaVersion: 2` und `inputSchemaVersion: 2`; `BALANCE_IMPORT_INPUT_SCHEMA_V2` validiert alle importierbaren Felder, Bounds und Enums und akzeptiert im aktuellen Format nur echte Booleans. Der aktuelle Runway-Vertrag kennt nur `liquidityRunwayYears` (1 bis 10 in 0,5er-Schritten) und das Goldband `rebalancingBand` (0 bis 100). `balance-state` V1 und die expliziten v21.1-/v22.0-Legacy-Envelopes besitzen benannte Migratoren: Fehlt der kanonische Runway, gilt zuerst `runwayTargetMonths`, danach `runwayMinMonths`, sonst Default 5. Ganzzahlige Altwerte der frueheren UI-Domains werden auf das naechste Sechsmonatsraster aufgerundet und anschliessend in Jahre umgerechnet, sodass die Migration den Puffer nie verkuerzt; `targetEq` und `rebalBand` werden entfernt. Domainabweichungen blockieren den Recovery-Export nicht, sondern werden feldgenau unter `validationWarnings` inventarisiert. Alle Migrierpfade durchlaufen danach denselben vollstaendigen V2-Vertrag. Der JSON-Pfad führt zuerst `PREVIEW`, dann Recovery/Replace und abschliessend `PERSIST_INPUTS` aus; spaete Fehler rollen Storage und sichtbare Eingaben zurueck. Historische CSV-Parser und gespeicherte Provenienz bleiben kompatibel, ohne neuen UI-Importpfad. File-Inputs werden nie auf einen nichtleeren Wert restauriert, weil Browser nur das programmgesteuerte Leeren erlauben.
- `balance-binder-snapshots.js` – Snapshot-Handling und Jahresprozess-Coordinator; validiert den Live-State, flusht, bestaetigt den Snapshot vor fachlichen Writes und persistiert bei Teilfehlern Snapshot-ID sowie Recovery-Phase
- `balance-binder-diagnosis.js` – Diagnose-Export

---

## 6a. Vermögensverlauf in Balance und Jahresauswertung auf Ausgaben

**Module und Exporte:**
- `balance-expenses-metrics.js`: `prepareExpensesHistoryMetrics(store, currentYear)` projiziert die Jahresausgaben DOM-/storagefrei und ohne Mutation; `computeYearStats()` liefert dieselben Istkennzahlen wie im Ausgaben-Check.
- `balance-expenses-history-renderer.js`: `renderBalanceExpensesHistory()` und `refreshBalanceExpensesHistory()` verbinden die Projektion mit den eigenen aktiven SVG-/Tabellenregionen; `loadExpensesStoreResult()` aus `balance-expenses-storage.js` liefert den geprüften Ladezustand.
- `balance-wealth-history.js`: `createBalanceWealthHistoryService()` mit `captureContext()`, `assertContext()`, `assertManualReady()`, `runAnnual()`, `finalizeAnnual()` und `captureManual()`; `previewWealthHistory()` liefert die gemeinsame PREVIEW. `createManualWealthHistoryController()` bietet `capture()` und `withAnnual()`.
- `balance-wealth-history-metrics.js`: `prepareWealthHistoryMetrics()` validiert und sortiert ohne Mutation; Alt-/Neu-Depot bilden eine einzige Aktiengruppe. `prepareWealthHistoryChart()` projiziert reale Datumsabstände und eine glatte 1/2/5-Euroachse. `prepareWealthHistorySummary()` liefert letzten Stand, Höchststand und Differenz erster/letzter Erfassung im letzten erfassten Kalenderjahr (ohne zweiten Stand kein Vergleich).
- `balance-wealth-history-renderer.js`: `initializeBalanceWealthHistory()`, `renderBalanceWealthHistory()` und `refreshBalanceWealthHistory()` validieren, zählen und datieren die aktuelle Historie. Ausschließlich `dom.panel.classList.contains('active')` erlaubt SVG-/Tabellenaufbereitung. Inaktive Refreshs und Deaktivierung leeren dynamische Inhalte; aktive Refreshs ersetzen sie auch bei leerem/fehlerhaftem State vollständig. Das Datum stammt aus dem größten validierten `asOf`: „Zuletzt erfasst am TT.MM.JJJJ“, fehlend/leer exakt „Noch keine Stände erfasst“, beschädigt ohne alten Datumstext. Nominale Gesamtlinie und Fläche verbinden gespeicherte Summen mit realen Datumsabständen, glatter Euroachse und echten Kalenderjahres-/Abschlussmarken. Quadrat benennt Jahresabschluss, Raute unterjährigen Stand. Drei Istkennzahlen im `wealthHistory.metrics`-Host werden bei inaktiven, leeren oder fehlerhaften Ansichten entfernt. Die vollständige Tabelle bewahrt alle Gruppen, Summe und beide Teildepots. Einzel- und Nullstände bleiben gültig; datenabhängige Grafikbreite scrollt intern. Keine Zwischenprognose. Bestandsänderung enthält Entnahmen und ist keine Rendite; Realwertslot und Realwertlinie des Entwurfs entfallen wegen fehlender Inflationsreihe/Kaufkraftbasis.

**Bedienung:** Balance besitzt drei Reiter: Überblick, Bedarf & Strategie und Diagnose. Verlaufhosts und Captureknopf liegen in Personen & Vermögen. Alte Verlaufanker leitet `wealth-history-navigation.js` geschützt vor der initialen Engineberechnung weiter; spätere Hashwechsel lösen ebenfalls keine Engineaktion aus. Ausgaben bleiben auf `Ausgaben.html`. Jahresabschluss, Historienvertrag und Import-Nacherfassung funktionieren ohne Verlauf-DOM.

**Ausgabenimport, Jahreswahl und Recovery auf `Ausgaben.html`:** `expenses.yearSegments` spiegelt über `bindBalanceYearSegments()` das verborgene `yearSelect`, einschließlich aller Jahre, aktivem Wert und Korruptionssperre. Nur ein Klick löst den bestehenden `change`-/`setYear`-Pfad aus; Refresh und Rollover schreiben keine zusätzlichen Finanzdaten. Die Importkarte mit `expensesImportCard`, `expensesImportTitle`, `expensesImportMonth`, `expensesImportProfiles` und ihrem Renderer entfällt zugunsten der erhaltenen Profil-/Monatszellen. Zellaktionen verwenden `handleTableClick()`, `pendingImport`, CSV-Input und `handleFileChange()`: Monat/Profil beim Klick, Jahr/Optionen beim Dateihandler, danach keine Zieländerung durch asynchrones Lesen. Vier unveränderte Kennzahlen stehen als Leiste; Matrixbudget und Abweichung nutzen die vorhandenen Summen der gewählten Profile. Recovery ersetzt die Matrix, sperrt Jahressegmente und entfernt alte Kennzahlen. Der Umfangstext lautet „Nach Export und Bestätigung wird der gesamte Ausgabenbereich geleert.“ Das betrifft alle Jahre und Profile; Rohdatenexport, Bestätigung, Abbruch und Fehlerrollback bleiben im bestehenden Pfad.

**Auswertungsflächen:** Die Managerkarte verbindet die unveränderte Tagesprojektion mit gespeicherten ◆/◇-Ständen, vollständiger Tabelle und drei bisherigen Kennzahlen. `summaryMarkup()` und `tableMarkup()` werden wiederverwendet. `balance-wealth-history-preview.js` enthält den lesenden Vermögensadapter; die bestehende Overview-Factory bleibt kompatibel. Managerknopf und Import-Nacherfassung verwenden dasselbe Sieben-Tage-Gate und den bisherigen Schreibdienst. Anzeige und Resize schreiben nichts.

**Automatische Importerfassung:** `balance-expenses-wealth-capture.js` exportiert `EXPENSES_WEALTH_QUOTE_MAX_AGE_MS` (604800000), `readExpensesWealthQuoteEvidence()`, `evaluateExpensesWealthQuoteFreshness()` und `createExpensesWealthCaptureController()`. Ein separater `onImportSuccess`-Rückruf startet erst nach Storewrite und bestätigtem Flush; „CSV importiert.“ bleibt vor Erfolg/Hinweis/Fehler nachweisbar. Lokaler Importtag und Profilkontext werden vor jedem weiteren Warten fixiert. Jeder gültige Vorgang wird seriell einmal verarbeitet. Automatik und manuelle Taste teilen `previewWealthHistory()` und die `captureManual()`-Transaktion, einschließlich State-/Registry-Readback und Tagesersetzung. Gespeichert bleibt `manual` beim aktiven Profil; alle PREVIEW-Bestände der Verbundprofile werden geprüft. Der Import wird bei optionalem Fehler nicht zurückgenommen.

Das Gate verwendet nur das am bewerteten Tranchenkurs gespeicherte `asOf` (UTC-Sekunden), verlangt vollständige Bewertungszuordnung und akzeptiert exakt sieben Tage. Fehlende/ungültige/zukünftige Zeit oder positive Aggregate ohne Nachweis bleiben unbekannt; ein alter beitragender Kurs genügt zum Blockieren. „Kurse aktualisieren“ in `app/tranches/tranchen-manager-page.js` speichert exakt `quote.asOf` aus `tranchen-price-service.js` zusammen mit Preis und Ticker. Erst bestätigter Flush von Livebestand und Registrykopie gibt den Zeitnachweis für Rückkehr zur Balance und Reload frei. Altdaten ohne Datum und manuell geänderte Preise bleiben unbekannt; nur vollständig frische beitragende Aktien-/Geldmarkt-ETFs erlauben die Automatik. Kaufdatum, Profiländerung und `annualMarketDataMeta` genügen nicht. Tagesgeld wird nicht auf Aktualität geprüft, Gold/separate Anleihen sind kein ETF-Frischegate. Ohne kursabhängige Bestände wird direkt gesichert. Hinweise verwenden `'info'`, Erfolg `true`; echte Fehler bleiben in `expenses-wealth`. Pending-/laufender Jahresabschluss, Profil- und Vorschauquellenwechsel blockieren ohne fremde Writes. Nach jedem Ergebnis aktualisiert die Ausgabenseite ihre Anzeige aus bestätigten Daten, ohne Navigation; der Vermögensverlauf wird beim Öffnen in Personen & Vermögen gelesen.

**Jahresausgaben:** `balance-expenses-history-renderer.js` exportiert `renderBalanceExpensesHistory()` und `refreshBalanceExpensesHistory()`. Der Loader `loadExpensesStoreResult()` und eine injizierbare lokale Uhr liefern die Datenbasis. Untercontainer werden lesend geprüft; Fehler nennen Datenbereich/Backend und Recovery im Ausgaben-Check ohne Rohdaten, Reset oder Seitenabbruch. Erst im sichtbaren Ausgabencontroller entstehen SVG und Tabelle aus `prepareExpensesHistoryMetrics()`. Diese reine Projektion umfasst alle gespeicherten Profile unabhängig von der Verbundauswahl; nur importierte Jahre erscheinen, einschließlich Nullimportjahren. Jahressumme, Monate mit positiven Ausgaben und Ø pro Monat entsprechen dem Ausgaben-Check. Jeder Kalendermonat zählt einmal, auch bei mehreren Profilimporten; Ø pro Monat ist die Jahressumme geteilt durch diese Monatszahl, bei null Datenmonaten 0. Nur das aktuelle Kalenderjahr mit weniger als zwölf Datenmonaten wird als „laufendes Teiljahr“ markiert, Ø pro Monat dient dem Vergleich ohne Hochrechnung. Der reine Jahresvergleich zeigt keine Budget- oder Abweichungsspalten; die Jahresansicht auf Ausgaben liest passende Belege oder Zusammenfassungen. Eigene eindeutige SVG-Titel-/Beschreibungs-IDs und zwei zusätzliche fokussierbare Scrollregionen ergänzen die beiden Vermögensregionen. `initExpensesTab({ ... }, { onChange })` benachrichtigt nach Import, Jahresauswahl/Wechsel, Löschung und bestätigtem geflushtem Reset; die lesende Reaktion erfasst keinen Vermögensstand. Der sichtbare Vermögensanlass heißt „Unterjährig“, gespeichert weiterhin `manual` mit Raute und gestricheltem Rautenmarker.

**Bestätigung:** „Stand gesichert“ folgt manueller Speicherung bzw. neuer jährlicher Finalisierung erst nach Readback von Balance-State und aktiver Registrykopie. Im Snapshothandler wird das pro Aufruf zunächst falsche Flag `annualWealthSaved` ausschließlich unmittelbar nach erfolgreichem `await commitAnnualPlanUpdate(...)` gesetzt. Nach `completedResult` folgt zuerst die Kurzmeldung, bei gesetztem Flag exakt `Ausgaben-Check auf ${nextYear} umgestellt. Vermögensstand gesichert.`, sonst unverändert ohne Zusatz. Erst danach folgt bei gesetztem Flag `onAnnualWealthSaved` (wirkungsloser Standard), ohne erneute Jahresschwellenprüfung. Dies gilt auch ohne Balance-Verlaufhosts. Wiederholungs-No-op, fehlgeschlagene Finalisierung und Jahre vor 2026 bestätigen keinen neuen Stand. Fehler in Rückruf, Toast oder Snapshot-Rendering lassen den bestätigten Abschluss und leeren Pendingmarker bestehen und erlauben keinen zweiten Commit; bei defektem Toast ist keine sichtbare Ausgabe garantiert.

**Datenvertrag:** Optionales Top-Level-Feld `wealthHistory: { schemaVersion: 1, entries: [...] }` außerhalb von `inputs`/`lastState`, validiert durch `types/wealth-history-contract.js`. Records enthalten `id`, `asOf`, `reason`, `periodId`, `tagesgeld`, `geldmarktEtf`, `depotwertAlt`, `depotwertNeu`, `aktienEtf` und `total`. Nominale Euro-Werte bleiben ungerundet, nichtnegativ und endlich; Summen und Identitäten werden geprüft. `aktienEtf = depotwertAlt + depotwertNeu`, `total = tagesgeld + geldmarktEtf + aktienEtf`. Gold und separate Anleihen gehören nicht dazu; die Pflegezweckbindung wird weder addiert noch pauschal abgezogen. Fehlendes Feld ist leer; ein beschädigtes vorhandenes Feld wird sichtbar abgelehnt und nicht durch Erfassung überschrieben.

**Quelle und Stichtag:** `result.inputData` nach Profil-/Tranchenaggregation, keine DOM-Anzeigetexte oder simulierten `newState`-Bestände. „Stand jetzt erfassen“ hält den lokalen Klicktag fest und führt synchron frisches `PREVIEW` aus; `manual:YYYY-MM-DD` (`reason: manual`, `periodId: null`) ersetzt ausschließlich den manuellen Tagesstand. Andere Tage und ein Jahresrecord am selben Datum bleiben separat. Jahreswerte stammen nach den Jahresdatenupdates aus dem erfolgreichen `commitLiveState()` für `planning.plan.targetYear`: `annual:YYYY`, `YYYY-12-31`, `annual_close`, `calendar-year:YYYY`, ohne zusätzliche historische Neubewertung. Beginn 2026, erster automatischer Stand für 2026 beim Abschluss 2027; kein Nachtragen alter Perioden. Normale Vorschauen erzeugen keine Stände, manuell entsteht kein zusätzlicher Engine-Periodencommit.

**Persistenz und Recovery:** Gemeinsame Warteschlange, Flush sowie Profil-/State-Rechecks verhindern fremde oder veraltete Writes. Der transaktionale Replace umfasst ausschließlich den vorhandenen Balance-State-Key und `rs_profiles_v1`; Readback bestätigt Live-State und aktive Registrykopie. Jahresrecord und `annualPeriodMetadata.lastCommittedPeriod` werden gemeinsam finalisiert, Wiederholung ist ein No-op. Fehler bewahren vorherigen Verlauf und Pending-/Recoveryzustand; `incomplete_recovery` blockiert weitere Jahresläufe und manuelle Zwischenstände bis zum Snapshot-Restore, ohne direkten Resume. Der Verlauf gehört ausschließlich zum aktiven Profil, auch bei angezeigtem Verbund; andere Profile erhalten keine Kopie und spätere Verbundänderungen ändern frühere Stände nicht.

**Navigationsschutz der Verlaufsschreibung:** Der `WeakMap`-Koordinator registriert mit `bindNavigation` genau einen gemeinsamen Provider je Persistenz. Eine Queuegeneration bleibt vom Einreihen bis zum letzten Handler geschützt; mehrere Dienstinstanzen quittieren nur ihre eigenen Jobs. Manuelle Queue-/Vorflushvorbereitung ist nach Zustimmung kündigbar: alle vorbereitenden Jobs erhalten Abbruch, anschließend werden ihre Enden abgewartet. Kontext, Source und Kündigung werden nach Wartezeiten und unmittelbar vor Replace erneut geprüft. Ab erster Transaktionsmutation hält derselbe Besitzer die Sperre durch Backendwrite, Readback, Postvalidierung und kompensierenden Rollback samt Fehlerabschluss. `runManual` umfasst beim Captureknopf auch Status, Refresh und Wiederbedienbarkeit. Neue Erfassung während reservierter Navigation oder fremder Schreibaktion wird am ausführenden Dienst abgewiesen. Der bestehende Ausgabenimport verwendet denselben geschützten Capturepfad und dieselben Records.

Bei einem neuen Dokument beziehungsweise injizierten Seitenguard wird ein bestehender Verlaufprovider ausschließlich bei leerer Queue vom alten Guard abgemeldet und am aktuellen Guard registriert. Wiederholte Dienstinitialisierung am selben Guard bleibt idempotent. Während laufender Jobs weist `WEALTH_HISTORY_NAVIGATION_GUARD_CHANGED` eine Neubindung ab, damit deren Besitzer und Abbruchschutz erhalten bleiben. Der Regressionstest verwendet dieselbe Persistenz mit mehreren Dokumenten und prüft den tatsächlich gesperrten Jahresstart sowie Kündigung ohne Write und erneute Erfassung.

`runAnnual(execute, { navigationOperation })` übernimmt den äußeren Jahresbesitzer aus dem Snapshot-Handler. Der produktive Speichercommit verwendet ihn für seinen gemeinsamen Replace; das kompatible `finalizeAnnual({ ..., navigationOperation })` bleibt nur für direkte technische Aufrufer erhalten. Diese Anschlüsse sie registrieren keinen zweiten Jahresprovider und entsperren dessen abschließenden Flush nicht. `annualPhase: finalizing` bleibt beim inneren Replace erhalten. Ein terminaler Fehler hinterlässt keinen aktiven Queuejob; der bestehende Retry beziehungsweise Snapshot-Recovery bleibt erreichbar. Datenformat, Tagesersetzung, Export und Zahl der Enginecommits bleiben unverändert.

`tests/wealth-history-navigation.test.mjs` prüft echte Service-/Adapterbarrieren und Handlercleanup, gemeinsame Providerregistrierung, Queuefortsetzung ohne Freigabelücke, native Gründe, Rollback und äußeren Jahresflush. Die registrierten Browserfälle `Navigation guard wealth writes` und `Navigation guard annual finalization` halten reale manuelle beziehungsweise jährliche IndexedDB-Replace-/Readback-/Rollbackpfade an, prüfen App-Enter und beide nativen Entscheidungen sowie erneut bedienbare Erfassung nach Fehler. Der Jahresfall prüft zusätzlich übernommenes EXE-Schließen im finalen Readback mit dem vorhandenen IPC-Doppel. Ihre externe Browserausführung und die reale EXE-Abnahme bleiben Aufgaben der Steuerung; native Zustimmung kann den Browser weiterhin verlassen und ersetzt keine Recovery.

**Layout und Druck:** Monatsbudget und vollständige Handlung bleiben bei etwa 1280 px Inhaltsbreite im 7/5-Raster. Kartenpadding und Bereichsabstände verwenden 12–16 px; die Reiter stehen unmittelbar nach dem Titelkopf. Jahresbeschluss, heutige Vorschau, Betrag/Zweck, Aktionsdetails und „Warum?“ bleiben vollständig erreichbar. Der Hilfe-Symbolzugang behält `Handbuch.html` und den Profilhandoff. Der äußere `balance-page`-Container misst die nutzbare Breite außerhalb des begrenzten Wrappers. Ab 2300 px wächst der Wrapper bis 2700 px: Überblick 5/4/3, danach Markt/Bedarf/Reserven je 4 und das Vergleichsband über die volle Breite. Schmaler umbrechen Karten und vollständige Reitertitel. Der lokale Schriften-/Tokensatz bleibt bestehen. `actionDetailsDialog` ist ein nativer modaler Dialog mit Fokusfalle, Escape, Schließen und Außenklick samt Rückfokus zum Auslöser. Kopier-/Druckknöpfe liegen außerhalb des ersetzbaren `handlungsanweisung`-Hosts. Druck zeigt den vollständigen Quellen-/Verwendungsplan einschließlich Haushalt und interner Cashumschichtung, den Empfehlungshinweis und den Kontextfuß mit vorhandenem Planungsjahr, Profil-/Haushaltsnamen und Marktdatenstand. Die Engineversion steht optional klein am Ende. Navigation, Eingaben, andere Dialoge und Meldungen werden ausgeblendet.

**Transport:** Balance-JSON, Profilbundle, Komplettbackup und Standard-Snapshots erhalten das Feld ohne neue Keys oder äußere Schema-Version. Ein unterstützter Replace ohne Feld leert den Verlauf; Restore stellt den damaligen Verlauf wieder her, ohne append-only-Garantie über Restore/Replace hinweg. Die State-/Import-/Profil-/Backupgrenzen prüfen auch inaktive Profilverläufe. Einzelheiten und Summen-Toleranz stehen in `TECHNICAL.md`, gezielte Tests und separates Browsergate in `tests/README.md`.

**Testbeobachtung:** Produkt und Tests teilen die DOM-freie Konstante `BALANCE_UPDATE_DEBOUNCE_MS = 250` aus `balance-config.js`. `tests/wealth-browser-update-observer.mjs` kapselt den unabhängig importierbaren Init-Hook; Browser und VM übergeben die Entprellzeit ausdrücklich, sodass die serialisierte Funktion ohne Modul-Closure läuft. Accessors erhalten die Beobachtung bei nachträglicher Timerzuweisung durch `page.clock`. Die Tabprüfung vergleicht nach beobachtetem Idle sortierte Schlüssel und vollständige Schlüssel/Wert-Paare von `localStorage` und `sessionStorage`, zählt deren `setItem`-/`removeItem`-/`clear`-Aufrufe mit Sollwert null und baut alle Hooks im `finally` zurück. Die volle Node-Suite fährt im orchestrierten Lauf der Orchestrator; die gesteuerte Sitzung fährt das Browsergate vor dem Merge.

**Dependencies:** `balance-storage.js`, `balance-update-pipeline.js`, `balance-utils.js`, `app/shared/persistence-facade.js`, Profilregistry/-state und `types/wealth-history-contract.js`. Integration durch `balance-binder.js`/`balance-main.js`; Jahresfinalisierung durch `balance-binder-snapshots.js`.

**Prüfzuordnung:** `tests/balance-expenses-history.test.mjs` sichert unveränderliche Projektion, Profil-/Monatszählung, Nulljahre, Budgetabwesenheit und aktive/inaktive Darstellung. `tests/balance-expenses-wealth-capture.test.mjs` prüft synthetisch Frischegrenzen und Koordinationsfehler; `tests/balance-expenses.test.mjs` durchläuft dagegen den echten Managerkurslistener, Backend-/Registry-Readback, Reload, CSV-Dateilistener und Engine-PREVIEW mit kontrollierter Quote. Die Meldungen bleiben auf den bestehenden APIs `UIRenderer.toast(text, true | 'info')`, `UIRenderer.handleActionError(error, 'expenses-wealth')` und `UIRenderer.clearActionError('expenses-wealth')`; `tests/balance-messages.test.mjs` und `tests/balance-ui-orchestration.test.mjs` sichern Darstellung und Binderkoordination zusätzlich ab. Die Ausgaben-/Verlaufsformate bleiben unverändert.

Das Slice-Gate `npm test` führt der Orchestrator aus. Extern offen sind Entwurfsvergleich bei 1920/2560 px, Erreichbarkeit bei 1366 px, Popupdruck, Seitenwechsel, Handoff und Navigationsschutz. Die vorhandenen Fälle `Balance.html` und `Balance annual commit` einschließlich 2025-Variante enthalten die neuen Reiter- und Dialogprüfungen. Ihre externe Durchführung und Grundbedienung 10/10 bleiben offen; statische Registrierungen sind kein Browserergebnis.

---

## 7. `balance-main.js`
Einstiegspunkt und Orchestrator.

**Aufgaben:**
- Initialisiert DOM-Referenzen, Module und Anwendungszustand.
- Nutzt für `debouncedUpdate()` die gemeinsame Konstante `BALANCE_UPDATE_DEBOUNCE_MS` (weiterhin 250 ms).
- Bindet einen kompatiblen Engine-Vertrag (`initVersionHandshake`) und blockiert fehlende, inkompatible oder nachtraeglich ausgetauschte Engines.
- Definiert `update()` / `debouncedUpdate()`, liefert `success`, `validation_error`, `engine_error` oder `blocked` und reicht Eingaben nur nach erfolgreichem Gate an `EngineAPI.simulateSingleYear()` weiter.
- Übergibt erfolgreiche Engine-Ergebnisse an Renderer und Storage; blockierte und fehlerhafte Ergebnisse werden nicht persistiert.
- Erhält bei Guardrail-Resets den steuerlichen Zustand (`lastState.taxState`) explizit.

**Dependencies:** alle oben genannten Module sowie die globale `EngineAPI`.

**Helper-Module (ausgelagert):**
- `balance-main-profile-sync.js` – Profilwerte in Balance-Inputs spiegeln
- `balance-main-profilverbund.js` – einmalige Haushalts-Simulation mit Engine-Final-Action, Profilattribution & UI-Handling
- `balance-update-pipeline.js` – Engine-Handshake/-Gate, Update-Ergebnisvertrag, Mindest-Flex-Validierung, Engine-Last-State, Renderer-/Diagnose-Payload, Persistenzentscheidung und Ausgabenbudget.
- `balance-action-postprocessor.js` – uebernimmt Diagnose und bereits finalisierte 3-Bucket-Aktion aus dem Engine-Ergebnis; Single Profile und Profilverbund veraendern danach keine Quelle oder Menge mehr.

**Pflegebucket:** Der Update-Zyklus reicht die im Reader erzeugte Pflegebucket-Diagnose an Summary, Key-Parameter und Diagnose-Copytext weiter. Die Engine-Eingaben und die Handlungsempfehlung werden dadurch nicht operativ verändert.

---

## 8. `balance-expenses*.js`
Gemeinsam genutzte Ausgabendienste; der produktive UI-Besitzer ist seit AU1 `app/expenses/expenses-controller.js` auf `Ausgaben.html`. Balance initialisiert diese DOM-Dienste nicht mehr.

**Exports:**
- `balance-expenses.js`
  - `initExpensesTab(domRefs, options?)` – initialisiert Tabellenaufbau, Detaildialog und Jahr-Selector; gibt beim Start den Store-Status zurueck und rendert Korruption als gesperrten Recovery-Zustand
  - `updateExpensesBudget({ monthlyBudget, annualBudget })` – übernimmt Budgetwerte aus der Balance-Berechnung
  - `rollExpensesYear()` – schaltet auf das nächste Ausgabenjahr (Historie bleibt erhalten)

**Module:**
- `balance-expenses.js` – Controller/Fassade fuer Initialisierung, Event-Wiring, Import-/Delete-Flows, Recovery-Export und bestaetigten Korruptions-Reset.
- `balance-expenses-storage.js` – Persistenzschema `balance_expenses_v1`, expliziter `ok`-/`empty`-/`corrupt`-Ladevertrag, schreibgesperrter Korruptionspfad, Recovery-Dokument und Jahr-/Monat-Container.
- `balance-expenses-csv.js` – CSV-Parser mit Delimiter-Erkennung (`;`, `,`, `Tab`) und Betragsnormalisierung.
- `balance-expenses-metrics.js` – Monats-, Jahres-, Median-, Forecast- und Soll/Ist-Kennzahlen ohne DOM/localStorage.
- `balance-expenses-renderer.js` – Year-Select, Tabelle, Summary-Karten und Detaildialog.
- `balance-expenses-history-renderer.js` – lesende Jahresauswertung mit eigener SVG-/Tabellenausgabe, Leer- und Korruptionshinweis, auf `Ausgaben.html`.

**Funktionen:**
- Monatliche Ablage pro Profil und Jahr ueber die Persistenz-Facade (`balance_expenses_v1`).
- Budgetmonitoring:
  - Monatsampel (`ok/warn/bad`) mit 5%-Warnschwelle
  - Jahresverbrauch, Restbudget
  - Jahreshochrechnung (ab 2 Datenmonaten Median statt Mittelwert)
  - Soll/Ist auf Basis importierter Monate
- Die Kennzahl `spent` summiert die vorzeichenbehafteten Kategorien eines
  Monats und bildet danach den Betrag. Positive Gegenbuchungen/Erstattungen
  saldieren negative Ausgaben. Der aktuelle Vertrag beschreibt daher einen
  **Netto-Cash-Abfluss**, keine Bruttoausgabe. Eine getrennte
  Bruttoausgabenmetrik ist die offene Fachentscheidung D-12 und wird nicht
  still aus demselben Feld abgeleitet.
- Detaildialog mit sortierter Kategorieliste und „Top 3 Kategorien“.
- Ein JSON-/Shape-Fehler liefert ueber `loadExpensesStoreResult()` einen strukturierten `corrupt`-Status samt unveraendertem Rohinhalt. Der kompatible `loadExpensesStore()` wirft in diesem Fall, statt einen Leerzustand zu erfinden.
- Die Recovery-UI nennt Ausgabenbereich und Backend. Ein Reset bleibt bis zum erfolgreichen Rohdatenexport gesperrt, verlangt danach eine explizite Bestaetigung und gilt erst nach erfolgreichem Facade-Flush als abgeschlossen; Abbruch und Flush-Fehler lassen den Store im gesperrten Recovery-Zustand.

**Dependencies:** `balance-utils.js`, `balance-renderer.js`, `app/profile/profilverbund-balance.js`, `balance-expenses-*.js`

---

## 9. Jahres-Update Module (balance-annual-*.js)

**Bedienweg und interne Absicherung:** „Marktdaten aktualisieren“ (`#balanceMarketUpdate`), „Jahresabschluss“ (`#jahresabschlussBtn`), der Strategiebutton (`#btnJahresUpdate`) und der Überblickszugang (`#balanceNextAnnual`) starten denselben `createSnapshotHandlers().handleJahresabschluss()`-Coordinator mit `annualCloseInFlight` und periodengebundenem Doppel-Commit-Schutz. `Balance.html` enthält keine separaten Inflations-, ETF- oder CAPE-Abrufknöpfe. Der produktive Abschluss verwendet schreibfreie Vorbereiter, Speicherentwurf und gemeinsamen Fachwrite. Die unten beschriebenen schreibenden Abrufhandler und der alte Annual-Orchestrator bleiben interne Kompatibilitätswege und Orakelanschlüsse. `inFlight`, `fetchInFlight` und `etfInFlight` sichern direkte interne Aufrufe ab und ändern weder deren Rückgaben noch die `nested`-Fehlergrenzen.

### 9.1 `balance-annual-inflation.js`
Inflation-bezogene Operationen für das jährliche Update.

**Exports:**
- `createInflationHandlers({ dom, update, debouncedUpdate })`
  - `applyInflationToBedarfe()` – Wendet Inflationsrate auf Floor/Flex-Bedarfe an
  - `applyAnnualInflation()` – Fortschreibung der kumulierten Inflation
  - `handleFetchInflation()` – Holt Inflationsdaten via API-Kette (ECB → World Bank → OECD)

**Dependencies:** `balance-config.js`, `balance-utils.js`, `balance-reader.js`, `balance-renderer.js`, `balance-storage.js`

---

### 9.2 `balance-annual-marketdata.js`
Periodengebundene ETF-Jahresenddaten und CAPE-Schritte im gemeinsamen Jahresabschluss; `handleNachrueckenMitETF` ist ein interner Handler, kein eigener Bedienweg. Der ETF-Pfad liest `calendar-year:<YYYY>` aus dem laufenden Commit, fragt Yahoo im UTC-Jahresendfenster ab und persistiert den akzeptierten Stichtagscontract unter `annualMarketDataMeta`. Derselbe Metadaten-Schluessel kann eine strikt gekennzeichnete manuelle CSV-Provenienz tragen; deren `windowHigh` ist kein Online-/Vollhistorien-ATH.

**Exports:**
- `ANNUAL_MARKET_DATA_META_KEY` / `ANNUAL_MARKET_DATA_SCHEMA_VERSION` – stabiler Persistenzschlüssel und Schema-Version
- `createAnnualMarketDataRequest(periodId)` – bildet Zieljahr sowie `period1`/exklusives `period2` ohne Systemdatumsableitung
- `selectAnnualCloseQuote(data, context)` – wählt aus Yahoo-Daten unabhängig von deren Reihenfolge den letzten VWCE.DE-Schlusskurs von 0,50 bis 100.000 EUR vom 27.12. bis 31.12. des Zieljahres
- `createMarketdataHandlers({ dom, appState, debouncedUpdate, applyAnnualInflation })`
  - `handleNachrueckenMitETF({ manualPrice })` – verwendet optional den periodengebundenen Handkurs oder holt den VWCE.DE-Jahresendkurs via Yahoo-Proxy, prüft den vollständigen laufenden Commit-Kontext vor Fetch und Mutation, führt das Nachrücken durch und speichert Marktdateninputs gemeinsam mit Preis, ISO-Stichtag, Ticker, Quelle, Zieljahr, Perioden-ID sowie der stichtagsgleichen ATH-Auswertung; Fehler nach begonnener Mutation stellen den vorherigen DOM-/State-Stand wieder her
  - `handleFetchCapeAuto()` – Holt US-Shiller-CAPE via Yale/Mirror/r.jina.ai mit lokalem Fallback und persistiert `capeMeta`

**Dependencies:** `balance-config.js`, `balance-renderer.js`, `balance-storage.js`, `balance-annual-period.js`, `persistence-facade.js`

---

### 9.3 `balance-annual-modal.js`

Seit H4 ist dieses Modul der dünne Balanceadapter. `../shared/annual-close-dialog.js` erzeugt den Dialog auf beiden Seiten; der Adapter liefert Vorschau und die bestehenden Balance-Meldungskanäle. Schritt 6 verwendet `../shared/annual-plan-editor.js` mit flüchtigen Feldern, Einheiten/Hinweisen aus Haushalt & Plan und strenger Validierung.
Gemeinsamer Jahresdialog für Vorbereitung, laufende Fortsetzung und bestätigte beziehungsweise unvollständige Ergebnisse.

Das Anzeigeprotokoll erzeugt keinen Dirty-/Eingabeverlustgrund. Während eines aktiven Jahres-Commits bleiben OK, X, Overlay und Escape gesperrt; die Fokusfalle bleibt aktiv. Nach Handlerende schließen alle Wege wieder und entfernen die Escape-/Fokuslistener. Eine darüber geöffnete Navigationsnachfrage behält den obersten Fokus und Escape.

**Exports:**
- `createAnnualModalHandlers({ getLastUpdateResults })`
  - `closeAnnualModal()` – sicherer Schließ-/Rückfokusweg; respektiert die aktive Commit-Sperre
  - `showAnnualPreparation()` – geplante Schritte und einmalige Abschlussbestätigung
  - `showAnnualContinuation()` – laufender Abschluss nach geprüftem Restore-Handoff
  - `showUpdateResultModal(results)` – tatsächliche Schritte; Periodenerfolg nur bei `confirmed`
  - `handleShowUpdateLog()` – Öffnet Protokoll des letzten Updates

**Dependencies:** `balance-renderer.js`, `app/shared/shared-formatting.js`, `app/shared/designsystem-number-format.js`, `app/shared/security-utils.js`, `app/shared/navigation-guard-dialog.js`

---

### 9.4 `balance-annual-orchestrator.js`
Reexportiert ausschließlich den gemeinsamen Navigationsbesitzer; der alte DOM-Jahresablauf existiert nur im Legacy-Testhelfer. Der produktive Abschluss verwendet `prepareAnnualUpdate()` und den Speichercommit.

**Exports:**
- `createAnnualNavigationLifecycle({ guard, flush })` – Registriert einen flüchtigen Jahresbesitzer beim bestehenden Seitenschutz. `run` hält Vorbereitung, abwartbare Kündigung und Schreibabschluss einschließlich Flush; echte geschachtelte Aufrufe erhalten denselben `navigationOperation`-Besitzer. Ein bloßes `nested: true` umgeht keine Sperre.
- `createAnnualOrchestrator({ dom, debouncedUpdate, handleFetchInflation, handleNachrueckenMitETF, handleFetchCapeAuto, showUpdateResultModal, setLastUpdateResults })`
  - `handleJahresUpdate()` – Orchestriert: Januaralter für das Folgeplanungsjahr projizieren (ohne Profilwrite) → Inflation → ETF → CAPE → Protokoll

**Dependencies:** `balance-config.js`, `balance-renderer.js`, `balance-storage.js`, `profile-state.js`, `profile-storage.js`, `persistence-facade.js`

---

### 9.5 `balance-annual-period.js`

Definiert den DOM-freien Jahresperioden-Contract. `balance-binder-snapshots.js` integriert ihn in alle Jahreszugänge und speichert die Metadaten im Balance-State unter `annualPeriodMetadata`. Wiederholte Perioden und Doppelklicks starten keine zweite Mutation; `incomplete_recovery` blockiert bis zur Wiederherstellung des referenzierten Snapshots.

Der Snapshot-Handler meldet die tatsächliche Laufzeit getrennt von den persistenten Metadaten: Queue, Legacyentscheidung/-flush, Preview, Bestandsflush und Snapshot-/Readback bleiben kündigbare Vorbereitung. Kündigung wartet offene Hilfssicherungen und den Handlerabschluss ab und verhindert danach `startAnnualPeriodCommit`. Ab `snapshot_confirmed` sperrt der Besitzer App-Links und Jahres-/Import-/Exportkürzel bis zum Ende von `writes_started`, `validating`, Finalisierung und Fehlerbehandlung. Fehler nach Schreibbeginn zeigen den bestehenden Recovery-Snapshot auch in der Snapshotliste; UI-Fehler nach bestätigtem Fachabschluss bleiben Erfolg. Ein `pendingCommit` ohne aktiven Handler bedeutet Recovery, keine dauerhafte Navigationssperre: Restore ist wieder erreichbar.

Einzelabrufe von Inflation, ETF und CAPE prüfen Kündigung vor Folgequellen/Retry und vor Antwortanwendung. Bei geschachtelten Abrufen bleibt die äußere Schreibsperre maßgeblich. Eigenständige Jahreswrites schließen vorgemerkte Inputupdates und den Persistenzflush vor der Freigabe ab; Jahresalter, Inflationswerte, Marktdaten- und Periodenverträge bleiben unverändert. Native Browserentscheidungen sind weiterhin synchron; akzeptiertes Verlassen während eines Commits benötigt den vorhandenen Recovery-Weg.
DOM- und persistenzfreier Contract fuer das abgeschlossene Kalenderjahr. Er erzeugt die stabile ID `calendar-year:<YYYY>`, plant Januaralter als lesende Projektion, Inflation, Marktdaten und Ausgaben-Rollover fuer dieselbe Periode und beschreibt die Zustaende `ready`, `already_committed`, `incomplete_recovery`, `legacy_confirmation_required` und `invalid`.

**Exports:**
- Schema-, Status- und Legacy-Entscheidungskonstanten
- `deriveCompletedCalendarYear(referenceDate)` / `createAnnualPeriodId(targetYear)`
- `createAnnualPeriodMetadata()` / `preflightAnnualPeriod()` / `createAnnualPeriodPlan()`
- `checkAnnualPeriodCommit()` / `startAnnualPeriodCommit()` / `completeAnnualPeriodCommit()`
- `resolveLegacyAnnualPeriod()` – explizite Baseline ohne Alter-/Datumsheuristik

**Dependencies:** Keine (Pure Logic)

---

### 9.6 Integrationsnachweis des Jahres- und Recovery-Vertrags

Der Abschlussgate fuer die Suite-Datenintegritaet fuehrt den echten
Browserpfad von Preview mit ausschließlich abgeleitetem Anzeigeeintrag zu genau einem bestaetigten
Periodencommit mit Recovery-Snapshot aus. Ein separater Browserfall speist
eine negative reale Aktienrendite aus `EngineAPI.simulateSingleYear()` in die
3-Bucket-Diagnose und verhindert damit einen nur aus Testdoubles abgeleiteten
Bear-Status. Import-Reject, Markt-CSV-Provenienz, korrupte Ausgaben und
raw-preserving Recovery bleiben eigenstaendige fail-closed Browserpfade.

Die Orakel O-01 bis O-22 und ihre konkreten Witnesses stehen im
maschinenlesbaren Inventar
`tests/fixtures/suite-data-integrity/oracle-traceability-v1.json`.

---

## 10. `balance-guardrail-reset.js`
Logik zur Erkennung signifikanter Eingabeänderungen, die den historischen Guardrail-State invalidieren.

**Exports:**
- `shouldResetGuardrailState(prevInputs, nextInputs)` – Prüft ob lastState zurückgesetzt werden soll

**Kriterien für Reset:**
- Bedarf (Floor/Flex): Änderung ≥1.000€ oder ≥10%
- Vermögen: Änderung ≥10.000€ oder ≥10%
- Rente: Statuswechsel oder Änderung ≥1.000€
- Marktdaten: Jede Änderung (ATH, Jahre seit ATH)
- Flex-Budget: Änderung ≥1.000€ oder ≥20%

**Dependencies:** Keine (Pure Logic)

---

## 11. Profilverbund-Module

### 11.1 `profilverbund-balance.js`
Kernlogik für den Profilverbund (Multi-Profil-Modus).

**Exports:**
- `loadProfilverbundProfiles()` – Lädt alle Profile aus dem Haushalt
- `aggregateProfilverbundInputs(profileInputs, overrides)` – Aggregiert Bedarf, Rente, Depot über Profile
- `calculateHouseholdWithdrawalNeed(profileInputs, overrides)` – Berechnet Bruttobedarf, Jahreseinkommen und Nettoentnahme einmal auf Haushaltsebene
- `calculateTaxPerEuro(inputs)` – Berechnet Steuerlast pro Euro für ein Profil
- `selectTranchesForSale(tranches, targetAmount, taxRate)` – Wählt steueroptimale Tranchen für Verkauf
- `calculateWithdrawalDistribution(profileInputs, aggregated, mode)` – Verteilt Entnahme nach Modus (tax_optimized, proportional, runway_first)
- `buildProfilverbundAssetSummary(profileInputs)` – Vermögenszusammenfassung aller Profile inklusive absoluter, profilbezogen diagnostizierter Goldstrategie
- `buildProfilverbundProfileSummaries(profileInputs)` – Einzelprofil-Übersichten

**Verteilungsmodi:**
- `tax_optimized` – globale, deterministische Verkaufsquellenwahl nach aktuellem marginalem Profilsteuerwert; Verlusttopf, Sparer-Pauschbetrag, Kirchensteuer, Kostenbasis und Teilfreistellung bleiben eigentuemerbezogen
- `proportional` – Quellenattribution nach Vermoegensanteil, innerhalb eines Profils steuerarm sortiert
- `runway_first` – Quellenattribution nach Runway-Zielen gewichtet, innerhalb eines Profils steuerarm sortiert

**Haushalts-/Finanzierungscontract:**
- `balance-main.js` fuehrt im Multi-Profil-Fall genau einen Haushalts-Engine-Lauf fuer Floor, Flex, Dynamic Flex, Einkommen und Transaktionsplanung aus.
- Single Profile und Profilverbund setzen `finalizeThreeBucketAction` nur auf einem nicht persistierten Engine-Input-Clone. Der Engine-Lauf verwendet die reale Aktienrendite als Ratio und den tatsaechlich entschiedenen Jahres-Nettoentnahmebedarf.
- Der Engine-Lauf erhaelt einen vollstaendigen Haushaltstranchenpool mit eindeutiger `sourceProfileId`; dessen Laufzeit-`trancheId` ist als `<profileId>:<trancheId>` profilbezogen, ohne die gespeicherte Profiltranche zu veraendern. Die 3-Bucket-Logik reserviert bereits geplante Lotverkaeufe und finalisiert Bond-Verkauf beziehungsweise -Wiederauffuellung genau einmal vor dem Steuerabschluss.
- Danach finden keine Profil-Engine-Laeufe statt. Die Profile erhalten ausschliesslich Quellen- und Verwendungsattributionen der finalen Haushaltsaktion; die Verteilungsmodi steuern diese Attribution, aber keine zweite Spending- oder Assetentscheidung.
- Das Haushaltssettlement ist fuer diesen Lauf explizit deferiert. Erst nach der Quellenattribution ruft `profilverbund-action-attribution.js` `settleTaxYear()` genau einmal je Steuer-Owner auf und setzt `taxSettlementDeferred` im finalen Ergebnis auf `false`.
- Quellen, Verwendungen und die Summe der finalen Profilsteuern muessen innerhalb 0,01 EUR reconciliert sein. Fehlende Herkunft oder nicht finanzierbare Restbetraege blockieren fail-closed.
- Haushalts-Guardrail-State und Profil-Steuer-State werden getrennt persistiert. Je Profil wird nur der aus den final attribuierten Verkaeufen berechnete `taxState` ersetzt; sonstige Profil-Last-State-Felder bleiben erhalten.
- Die Persistenzspiegel sind bewusst asymmetrisch: Die Profilregistry enthaelt
  nur profilbezogene Inputs, `lastState` und Profil-Steuer-State.
  `annualPeriodMetadata`, `balanceStateLifecycle`, `ageAdjustedForInflation`,
  `annualMarketDataMeta` und `capeMeta` gehoeren ausschliesslich dem aktiven
  Haupt-State und werden vor jedem Profilwrite aus dem Profildatensatz entfernt.
- Der aktive Haupt-State wird ueber den migrierenden
  `StorageManager.loadState()`-Pfad geladen und nur mit expliziten Patches
  aktualisiert. Input-Persistenz schreibt Inputs und Haushaltsinputs; erst ein
  Periodencommit schreibt fachliche Profil-/Haushalts-States und Lifecycle.
  Veraltete Profildaten koennen dadurch keinen Haupt-Periodenstatus
  zuruecksetzen.
- `profile-storage.js` erzwingt denselben Vertrag beim Profil-Capture und
  Profilwechsel. Bereits kontaminierte Altprofile werden beim Laden in der
  Registry bereinigt; fuer Haushaltsmetadaten gewinnt der aktuelle Haupt-State,
  waehrend Inputs und profilbezogener Fachstate aus dem Zielprofil stammen.
- Profil-Verlustvortraege sind die autoritative Steuerquelle. Der
  Haushalts-`taxState.lossCarry` ist nicht autoritativ und wird beim Commit
  bewusst mit nullwertiger Semantik gespeichert, um keine doppelte
  Verlustverrechnung zu suggerieren.

**Tranchen-/Cash-Contract:**
- Reale Detailtranchen behalten den optionalen Kurszeitpunkt `asOf` (positive ganzzahlige UTC-Sekunden) zusammen mit `currentPrice` und ihrer Profilherkunft. Fehlt der Zeitnachweis oder ist er `null`, bleibt der Bestand undatiert. Synthetische Fallbacks und ETF-Aggregate erhalten kein Datum aus Profil-`updatedAt` oder Strategie-ETF-`annualMarketDataMeta`. Der Zeitnachweis verändert weder Bewertung noch Steuersemantik; sein Alter wird getrennt im Frischegate bewertet.
- Entnahmen nutzen zuerst Tagesgeld und Geldmarkt, bevor ein Verkauf aus Detailtranchen geplant wird.
- Vorhandene Detailtranchen werden ohne Mutation mit Profilherkunft kopiert. Fehlen Detailtranchen, entstehen profilmarkierte synthetische Fallback-Tranchen aus den aggregierten Werten.
- Detailtranchen ersetzen in Asset-Summaries die aggregierten Depot-/Gold-/Geldmarktwerte, damit Werte nicht doppelt gezählt werden. Bonds behalten ihre Assetklasse und fliessen fuer Legacy-Kompatibilitaet zugleich in die Depotaggregate ein.
- Kategorie und Typ muessen die disjunkte Matrix aus `types/tranche-contract.js` erfuellen. Schema-1- und Engine-Paare wie `money_market`/`aktien_neu` werden fail-closed abgelehnt und niemals durch eine Prioritaetsregel still umklassifiziert. Nur der Persistenz-Lesepfad migriert diesen von der frueheren Manager-UI erzeugbaren Zustand bei unversionierten Altbestaenden auf `money_market`/`geldmarkt`. Valider Geldmarkt bleibt Haushaltsliquiditaet, ist kein Aktienverkaufskandidat und eine Umschichtung zu Tagesgeld veraendert die Gesamtliquiditaet nicht.
- Der Pflegebucket wird als Haushaltsdefinition aus dem Primary-Profil gelesen und in Balance nur diagnostisch ausgewiesen. Er ist keine zusätzliche Entnahmequelle im Verteilungsmodus.
- Die Goldstrategie verwendet unabhaengig davon je Profil eine freie Assetbasis aus reconciliertem Depot inklusive Gold und operativer Liquiditaet; die jeweilige Pflegebucket-Reservierung wird bis zur vorhandenen operativen Liquiditaet abgezogen. Profilziele/-Floors werden absolut summiert und erst adapterseitig als Haushaltsquote an den bestehenden Balance-Vertrag uebergeben.
- `balance-main-profilverbund.js` uebernimmt Zielbetrag, Floorbetrag, Basis und Profildiagnostik aus der Assetsummary. Dadurch koennen Goldfelder des aktuell geoeffneten DOM-Profils die Strategie einer unveraenderten Haushaltsauswahl nicht ueberschreiben.

**Dependencies:** `balance-config.js`, `app/profile/profile-storage.js`, `app/profile/profile-asset-values.js`

Der vollstaendige Persistenz-, Migrations-, Quote- und Reconcile-Vertrag steht in
[`TRANCHEN_MODULES_README.md`](./TRANCHEN_MODULES_README.md).

---

### 11.2 `profilverbund-action-attribution.js`

DOM-freier Contract zwischen finaler Haushaltsaktion, Profilquellen, Steuerzustand und Liquiditaets-KPIs.

**Aufgaben:**
- validiert die eindeutige Profilherkunft aller Verkaufsquellen und attribuiert Cash- und Assetquellen ohne gegenlaeufige Zusatztransaktion;
- trennt Geldmarkt als bestehende Haushaltsliquiditaet vor der Klassifikation von Aktien, Gold und Bonds;
- plant die fuer die Haushaltszwecke erforderlichen Verkaufstranchen je vorgegebener Assetklasse neu; `tax_optimized` vergleicht die aktuelle marginale Steuer ueber alle geeigneten Profile, die beiden gewichteten Modi begrenzen jede Quelle auf den Bestand ihres Eigentuemers;
- aggregiert die finalen steuerlichen Rohwerte je Profil und ruft `settleTaxYear()` genau einmal je Profil auf;
- reconciliert Bruttoquellen, Profilsteuern und Nettoverwendungen innerhalb der Cent-Toleranz;
- erzeugt Profilaktionen als reine Aufschluesselung der Haushaltsaktion;
- berechnet Deckung und Runway aus dem Cashflow der final gerenderten Aktion neu und aktualisiert die zugehoerige Diagnose.

**Dependencies:** `engine/tax-settlement.mjs`, `profilverbund-balance.js`

---

### 11.3 `profilverbund-balance-ui.js`
DOM-Operationen für die Profilverbund-UI.

**Exports:**
- `renderProfilverbundProfileSelector(profiles, containerId)` – Rendert Profil-Checkboxen
- `toggleProfilverbundMode(enabled)` – Zeigt/verbirgt Profilverbund-spezifische UI-Elemente

**Dependencies:** Keine (Pure DOM)

---

## Abhängigkeiten

```
app/balance/balance-main.js
  ├─ app/balance/balance-config.js
  ├─ app/balance/balance-utils.js
  ├─ app/balance/balance-storage.js
  ├─ app/balance/balance-reader.js
  │    └─ app/balance/balance-health-bucket.js
  ├─ app/balance/balance-renderer.js
  └─ app/balance/balance-binder.js
```

Die Module kommunizieren über definierte Schnittstellen; Änderungen lassen sich damit auf einzelne Komponenten begrenzen.

## Darstellungsvertrag: Designsystem (Slice 3)

Balance lädt Tokens, lokale Fonts und gemeinsame Komponenten vor den Seitenregeln.
Die benannten UI-Renderer ergänzen `ds-`-Rollen bei erhaltenen Funktionsklassen,
DOM-Ankern und Delegationshosts. Meldungsgründe, Jahresprozess, Snapshot-/Import-
und Berechnungsverträge bleiben gleich; Farben und Textdeckkraft sind tokenisiert.

`balance-main-profile-sync.js` exportiert zusätzlich `renderProfileInputOrigins`.
Nach der vorhandenen Wertsynchronisierung stellt die reine DOM-Hilfe die Herkunft
sichtbarer Einkünfte, Bestände und Einstandswerte dar. Werte/Sperren und verborgene
Renten-/Alters-/Depotinputs bleiben Eigentum der bestehenden Fachpfade.
Das Anleihenfeld nennt seine konstante Profil-/Tranchenherkunft im Markup.

`balance-expenses-renderer.js` unterscheidet Datensatzpräsenz und Betrag.
Die Matrixprojektion merkt die Jahrespräsenz in einer hostgebundenen WeakMap;
der bestehende Aufrufablauf rendert unmittelbar danach die Summary. Keine neue
Speicherabfrage oder Änderung am Statistikobjekt. Leerjahr/-monat ist neutral,
ein gespeicherter Nullimport bleibt eine echte Null. Ausgeblendete Profile zählen
weiterhin in der Jahressummary; Monatsgesamtsummen bleiben auf sichtbare Spalten
bezogen. Positive Datenmonatsdefinition, Median-/Forecastformel, Budgetgrenzen und
Import-/Details-/Delete-Verträge bleiben erhalten.

Nachweise: `designsystem-balance.test.mjs`, `balance-expenses.test.mjs`,
`balance-renderer-summary.test.mjs` sowie registrierter Browserfall
`Designsystem Balance`. Die vollständige Browser-/Druckabnahme läuft außerhalb
der Implementierer-Sandbox; Zahlenformatmigration folgt in Slice 8.

### Gemeinsame Dynamic-Flex-Feldzustände (Slice 4)

Der bestehende Import von `app/simulator/simulator-main-dynamic-flex.js` liefert
auch für B15–B17 die sichtbaren Gründe zu Details, Dynamic Flex, Horizont, Quantil,
Go-Go und Langlebigkeit. Der Controller behält sämtliche bisherigen Sperr- und
Sichtbarkeitsbedingungen. Nichtanwendbarkeit des direkten Horizonts bei aktuarischer
Methode oder des Quantils bei Erwartungswert wird ausschließlich dargestellt;
Parser und persistierte Werte bleiben gleich. Die bisherige Detail-Textdeckkraft
entfällt. `tests/designsystem-simulator-fields.test.mjs` prüft den gemeinsamen
Controller einschließlich Presets und Listenerwechseln mit DOM-Eltern und Gründen.

## Container und deutsche Datenanzeige

`balance-renderer-summary.js` verwendet die additive UI-Hilfe
`app/shared/designsystem-number-format.js`: Prozentwerte werden nicht erneut
skaliert, MiniSummary zeigt ein `%` je Wert, Reichweite Jahre und Runway Monate.
Die große Monatsentnahme behält ihren Betrag und ergänzt `/Monat`; der
Jahressubtext bleibt erhalten. Fehlende Deckung und fachlich vorhandene
unendliche Reichweite sind getrennt. Der Pflegebucket nennt bei fehlendem
positivem Zielbetrag den Nichtanwendbarkeitsgrund.

Die Ausgabenmatrix nennt Auswahljahr, gewählte Profilspalten und Summe;
Jahreskennzahlen bleiben auf alle im Jahr gespeicherten Profile bezogen.
Verlaufsrenderer ergänzen Tabellenrollen und Profil-/Teiljahres-/Einheitsbezüge;
Metriken, Aktivitätsgrenze, Datum, gespeicherte Stände und datenabhängige
SVG-Mindestbreite bleiben erhalten. Formularcontainer und Schrumpfregeln kapseln
Überbreiten intern, benannte Regionen sind mit Pfeiltasten bedienbar und zeigen
sichtbare Scrollhinweise. Druck blendet Hinweise zusätzlich aus, erhält sonst
seine bisherigen Ausblendungen und die DOM-Reihenfolge.

Nachweis: `designsystem-layout`, `designsystem-data-display`,
`balance-renderer-summary`, vorhandene Ausgaben-/Verlaufstests sowie registrierter
Browserfall `Designsystem data layout` (1366/1920/2560 px, lange Namen, gefüllte
Tabellen, aktive/inaktive Verläufe, Fokus und Druck). Der Browserlauf ist in der
Agentensandbox wegen `listen EPERM` nicht ausführbar; externe Abnahme bleibt offen.


## Suite-Kontextanzeige (Paket 2a, Slice 2)

`balance-main-profilverbund.js` meldet die bereits geladenen Haushaltsprofile an
`renderSuiteHousehold`; leere Auswahl und Recovery bleiben neutral. Der Adapter
liest keine zusätzlichen Profile, schreibt nichts und löst keine Berechnung aus.

Die Leistenpräferenz `ui_suite_sidebar_collapsed` ist reine Geräte-UI und gehört
weder zu Profilen noch zu Bundles, Fachbackups oder Snapshots. Unter 82rem
äußerer Containerbreite ist die Leiste automatisch kompakt; darüber gilt die
manuelle Wahl. BFCache-Rückkehr behält den vorhandenen `pageshow.persisted`-Reload.


## Rahmennavigation (Paket 2a, Slice 3)

Der frühere Startlink in `.app-header` entfällt; der Rahmenlink Übersicht verwendet
den zentralen delegierten Export-/Flushweg. `.app-header`, `#jahresabschlussBtn`
(B08), `#openDiagnosisBtn` (B36), der markierte Manager-Einstieg, Haushaltsauswahl
und Druckfuß bleiben erhalten. Hilfe im Inhalt öffnet weiterhin nativ einen neuen
Tab. `suite-frame.test.mjs` schützt diese Anker; `Suite frame navigation replacement`
aktiviert die erhaltenen Wege samt Tastatur und Handoff. Browser-/Layout-/EXE-Abnahme
ist extern offen; Navigationsschutz ist angeschlossen, Ergebnisablage folgt erst in 4.2.

## Bedarf, Jahresdialog und einmaliger Handkurs-Retry

Bedarf & Strategie gliedert sich in Dein Bedarf, Übernommen, Marktdaten, Haushalt und Alle Parameter. Alle Parameter enthält Flex-Budget & Mindest-Flex, Dynamic Flex · Details, Notfallpuffer & Gold, Steuern und 3-Bucket. Bestehende Langlebigkeitsmodi, Freigaben und Mindest-Flex-Validierung bleiben erhalten. Runway bleibt gemäß vorhandenem Vertrag in Jahren; es gibt keine Umrechnung auf die Entwurfsbeispielwerte. Übernommene Bestände und Einkünfte erscheinen als Herkunftszeilen mit geschützten Pflegewegen zu Personen & Vermögen. Ihre nativen Wertträger einschließlich TQF und Kostenbasis bleiben unter bisherigen IDs, Typen, Werten und Sperren dauerhaft verborgen; Laden, Lesen, Speichern und Einheiten ändern sich nicht. Einheitsfelder tragen ihre tatsächlichen Einheiten: Runway in Jahren, Quantile und relative Puffer als Ratios. Entnahmestrategie, Dynamic-Flex-Preset und Haushaltsverteilung sind Segmente über den bestehenden Selects; Detailschalter spiegeln die vorhandenen Checkboxen. Programmgesteuertes Laden aktualisiert die Ansicht ohne weitere Profilreads oder Writes. „Alle Parameter“ ist eine flüchtige native Klappe; ihr Öffnen aktualisiert nur die Detailansicht, ohne neue Speicherkeys. Ein Klick auf „Benutzerdefiniert“ öffnet sie auch bei presetgleichen Werten und fokussiert nach dem nativen Abgleich das erste freigegebene Dynamic-Flex-Detailfeld. Die bestehende Preseterkennung und Sperren bleiben maßgeblich. Marktdaten zeigt sechs Korrekturfelder mit Provenienzuntertitel und Textaktion Protokoll; CAPE liegt bei den Dynamic-Flex-Details. Export, Import, Legacy-Ordnerverbindung und Wiederherstellungspunkte liegen auf Daten & Sicherung; Balance enthält keine eigene Sicherungskarte. Suite-Navigation, Alt+E/Alt+I und Jahres-Recovery führen geschützt zur zentralen Seite. Markt-CSV, manuelles Nachrücken/Undo, Alt+N, Tranchenstatusklappe und Balance-Reset entfallen. Ausgaben-CSV und Simulator-Reset bleiben erhalten.

Die Kopfzugänge „Marktdaten aktualisieren“ und „Jahresabschluss“, der Strategiebutton und die Jahresaktion im Überblick sowie Alt+J starten denselben Snapshot-/Periodenkoordinator über `manual.withAnnual`. Der Jahresdialog zeigt vor Start nur geplante Schritte; „Jahr … abschließen“ ersetzt die bisherige Abschlussbestätigung an derselben Grenze nach Legacy-/Periodenprüfung. Optionaler Handkurs ersetzt ausschließlich den ETF-Abruf: aktive Periode, VWCE.DE, 31.12. des Zieljahrs, bisherige Plausibilitätsprüfung und Ganz-Euro-Rundung. Kursrotation, ATH, Inflation, CAPE, Alter, Readback, Rollover, Verlauf und finaler Flush behalten ihren Vertrag. Das Ergebnis heißt erst nach endgültiger Speicherbestätigung bestätigt. Während Commit, Finalisierung und Restore ist der Dialog unschließbar; Fokusfalle, Rückfokus und vorhandener Navigations-/Fensterschutz bleiben aktiv.

Bei ETF-Ausfall bleibt der Abschluss unvollständig und sein Recovery-Snapshot erreichbar. „Mit diesem Kurs erneut abschließen“ validiert den Handkurs vor Restore, fragt die bestehende Restorebestätigung ab und führt Restore → Flush → geschützten Reload → einmaligen Abschluss derselben Periode mit dem bereits eingegebenen Kurs aus. Weder erneute Kurseingabe noch Jahresbestätigung sind nötig. Nur der bestehende `StorageManager.restoreSnapshot(..., { reload })`-Callback legt nach bestätigtem Restoreflush `balance.annual-retry.once` in tabgebundenem `sessionStorage` ab. Der Auftrag enthält Kurs, den bestätigten `adoptedPlanPatch`, die bestätigten Jahresend-Cashwerte einschließlich Rohquellen sowie Profil-/Perioden-/Instrument-/Snapshotbindung, Token und Zeit; höchstens fünf Minuten gültig. Beide Seiten geben den bestätigten Beschluss ohne erneute Eingabe an den Koordinator weiter; der Restore ersetzt ihn nicht durch den alten Plan oder Cashstand. `init()` konsumiert und entfernt ihn synchron vor dem ersten `await`. Nach Persistenzinitialisierung, Engine-Handshake, restaurierten Inputs, Profil-/Tranchen-/Haushaltssynchronisierung, Binding und Vorschau werden Kontext, ursprünglicher Snapshot und offene Nicht-Legacy-Periode geprüft. Pending-Recovery, Profil-/Periodenabweichung, verbrauchter Auftrag oder Initialisierungsfehler erlauben keinen automatischen Write. Abbruch, Restore-/Flushfehler und ausgebliebener Reload verwerfen den Auftrag. Ein normaler Snapshotrestore startet keinen Abschluss. Der technische Auftrag gehört weder zu Finanz-/Profilkeys noch zu Export, Backup oder Snapshot.

Der erhaltene Cashhinweis liegt in `#balanceNextSteps` im Überblick. Der unveränderte `getReconciliationCashStatus()` liest denselben aktiven Profilkontext: nur `valid` mit `pendingCount > 0` liefert den nummerierten Schritt „N Realverkauf/Realverkäufe mit offener manueller Cashbuchung“ und den bestehenden geschützten Managerweg. Ein unlesbares Audit warnt; bestätigte, Legacy- oder fehlende Statusdaten erzeugen keinen Cashschritt. Erneutes Rendern ersetzt die Schritte. Die bisherige Tranchen-Input-Synchronisierung und ihr Storage-Listener bleiben ohne Badgehost und Badgetimer erhalten; die Anzeige schreibt weder Cash noch Bestände.


## Profilsicherung beim Verlassen (Paket 2b, Slice 1)

Der gemeinsame Unterseiten-Lifecycle in `app/profile/profile-navigation.js`
beginnt bei `beforeunload` zusätzlich früh den synchronen Profilsnapshot und den
asynchronen Facadeflush. Genau ein dauerhafter Speicherlistener verändert weder
`defaultPrevented` noch `returnValue`; nur der zentrale, verlust-/commitabhängige
Nachfragehandler schützt native Browserwege. Pagehide und Hidden behalten ihren
Capture-Snapshot vor dem Facade-Bubbleflush. Das ist keine Garantie für den
asynchronen Abschluss beim Entladen. Während eines dokumenteigenen Commitgrunds
oder einer aktiven Facade-Schreibsperre beginnt der unabhängige Profilpfad weder
Saver noch eigenen Flush; Besitzerflushes bleiben zulässig. Dirty-/Ergebnisgründe
und abgelehntes Verlassen verhindern spätere Profilsicherung nicht.


## Resetsperre beim echten Folgeupdate (Paket 2b4, Slice 1)

`StorageManager.loadState()` reicht `PERSISTENCE_RELOAD_REQUIRED` aus der
Migrationsflag-Schreibstelle unverändert durch, wie bereits `saveState()`.
Damit erhält auch `balanceMain.update({ mode: 'persist_inputs' })` nach Reset
in der alten Dokumentgeneration den Sperrcode und Originaltext, statt ihn als
allgemeinen LocalStorage-Ladefehler umzudeuten. Gewöhnliche JSON-Ladefehler,
Migrationen und vorhandene Fachfehler behalten ihren bisherigen Vertrag.

Der terminale Node-Smoke verbindet echten Resethandler, bereits initialisierte
Facade, originalen Adapter, originales Laden/Migration und echtes Main-Update.
Unbestätigter Adapterflushfehler und bestätigter Retry ohne Dokumentwechsel
werden getrennt ausgewertet: `ok: false`, Sperrcode, exakter phasengerechter
Text sowie bytegleicher Cache und Adapterbestand nach Folgeinput/Handoff.
Unbestätigt bleibt „Reset noch nicht dauerhaft bestätigt. Bitte den
Speicherabschluss abwarten oder erneut versuchen. Eingaben werden bis zum
Neuladen nicht gespeichert.“; bestätigt gilt exakt
`RESET_RELOAD_REQUIRED_MESSAGE`. Resetkeys, Registry und `window.name` bleiben
geschützt. Retry bestätigt nur den Flush, mutiert nicht erneut und gibt alte
Writes nicht frei. Die Probe setzt die Facade nicht neu auf und gibt den Guard
nicht manuell frei. Browser- und Kandidaten-EXE-Abnahme bleiben extern erforderlich.


### Überblick und Meldungsanschlüsse (Entwurf, Slice 1)

`SummaryRenderer.renderBudgetTrace()` zeigt „Geplant (flexibel)“, wirksame Monatswirkungen und „Finanziert“ aus `projectBalanceFlexTrace()`. Ganze Euro sind reine Formatierung; Vorzeichen und Balken bleiben am Rohwert ausgerichtet. Bei Kürzung ist der native Warum-Knopf sichtbar, die Treppe nach jedem Ergebnis-/Profilrender geschlossen. `bindBalanceBudgetWhy()` hält nur flüchtige DOM-Referenzen und bindet idempotent, ohne Writes. Fehlender Trace/Bedarf liefert keine erfundenen Stufen; gültige ungekürzte Budgets zeigen Vollfinanzierung ohne Knopf. Der strukturelle Grund steht in den Budgetchips, die Marktphase ausschließlich in ihrer bestehenden Marktkarte. `balance-main.js` und der Balance-Jahresloader im Binder fordern den Trace über `createBalanceDisplayEngineApi()` an; Finanz- und Persistenzpfade bleiben unverändert.

`SummaryRenderer.renderPlanCards()` projiziert Monatsbudget (feste Einkünfte plus finanzierte Entnahme), Bedarf, operative Reserven und Marktstatus aus dem vorhandenen Payload. Dynamic Flex verwendet den gelieferten Bedarf; Marktfarbe und Skala folgen `market.sKey`. `renderContext()` liest Jahresmetadaten und bestätigte Archivbelege ohne Writes: markerlose Bestände ohne Abschlussindiz bleiben nach erfolgreicher Lesung offen, isolierte Vorabpunkte nach Kurswrite verlangen sichtbare Klärung, `pendingCommit` erzeugt den dauerhaften Recoveryhinweis. Die Engine liefert Liquiditätsdeckung vor/nach. Netto-Floorreichweite nach Umsetzung ist nur eine eindeutige Cashflowprojektion: Cash-/Geldmarktquellen abziehen und Cash-/Geldmarktverwendungen addieren. Fehlen diese Angaben, bleibt der Istwert mit ausgewiesenem fehlendem Nachherwert. Eine zusätzliche Nachher-Runway wird nicht fingiert. `ActionRenderer` zeigt Abschnittstitel einmal als Boxkopf und hält Tabellen-Captions nur assistiv lesbar. Die Profilspalte bleibt einzeilig im horizontalen Tabellenüberlauf. Der Renderer ersetzt den fachlichen Kontextfuß bei jedem Planrender und leert ihn beim Verwerfen der Aktion. Er erhält seine integrierten Cash-/Haushalts-/Tranchen-/Steuerdetails; interne Umschichtung wird nicht zum externen Nettozufluss der Kurzfassung addiert.

`balanceMessages` liegt unter den Reitern. `error-container`, `toast-container` und `action-error-container` bleiben getrennt, ebenso Engine-/Persistenz-/Profilwarnungen und `balanceAnnualRecovery`. Scopebereinigung, sechs Sekunden Toastlaufzeit und Rückfokus auf `openDiagnosisBtn` bleiben erhalten. Diagnose ist ein Reiter, der Binder benötigt weder Drawer noch Overlay/Schließknoten. `.ds-info`-Hilfen reagieren auf Hover, Fokus, Klick, Fokuswechsel und Escape; ihr Zustand ist flüchtig. Der Entwicklerbereich bleibt unter `dev=true` erreichbar.


### Diagnose-Reiter und Abschlussbereinigung

Die Diagnose beginnt sichtbar mit Statuschips. Nummerierte Entscheidungsschritte
zeigen Beschreibung, Wirkung und Ergebnis-Chip; Schrittzahl und Filter bleiben
von den tatsächlichen Daten abhängig. Die Transaktion zeigt kuratierte Zeilen
mit Auslösung, Blockierung, Betrag, Tranchenauswahl und Aktien-/Goldgrenzen.
„Geplante Aktion“ nutzt ausschließlich die flüchtige Kurzfassung des tatsächlichen
Handlungsrenderers einschließlich materiellem Haushalt und Cashintegration.
`UIRenderer.getActionSummary()` stellt dieselbe Quelle für Copy bereit;
Initialisierung und Null-/fehlende Aktionen verwerfen alte Kurzfassungen.
Hypothetische Handelswerte bleiben getrennt in den initial geschlossenen
„Technischen Details“. Diese Klappe enthält die vollständige lesende
Transaktionsprojektion mit deutschen Schlüssel- und Regelbezeichnungen.
Copy liest alle Daten unabhängig vom Klappenstatus; Filtersemantik (`inactive`
bei Schritten, `ok` bei Leitplanken), Einheiten und Detailpräzision bleiben erhalten.
Die Leitplanken haben getrennte Karten-/Copywerte und Status-Chips; alle
Kennzahlen stehen in drei Spalten, unter 1180 px in einer Spalte, mit ihren Metadaten.

Der Handlungsdialog ist zentriert (bis 1080 px, Radius 20 px, Innenabstand
26/34/32 px) mit Kurzband, Quellen-/Verwendungs- und Zweckzeilen. Druck und
Schließen stehen oben, Copy außerhalb des ersetzbaren Handlungshosts.
Der Jahresdialog liegt rechts (bis 600 px, Innenabstand 30/34 px) mit einer
lesenden Prozessleiste und Statuszeilen. Die Leiste zeigt vor `confirmed=true`
offene Schritte mit zugänglich verborgenem Status, ohne sichtbare „Unbestätigt“-Zeilen;
sie führt keine neue Prozessstufe ein.
Bestätigung, Handkurs, Einmal-Retry, Commit-/Recovery-Sperren, Fokus,
Schließen und Protokoll bleiben beim bestehenden Jahresablauf.

`bindBalanceInfoPopups` bindet statische und dynamische Erläuterungen einmal je
Host. Warn-/Blocknotizen und Kennzahlenmetadaten bleiben sichtbar. Ersetzte
Panel-/Fieldset-/Formularraster-, Ergebniskasten- und Handlungskastenstile sind
entfernt; gemeinsame Suiteconsumer bleiben erhalten. Bekannte ältere Abruftexte
werden nur am Jahresbutton beziehungsweise am zuständigen Anzeigehost deutsch
und ohne Emojis dargestellt, ohne Fach- oder Speichertexte umzuschreiben.
Sicherung, Vertragsinputs, Meldungskanäle, Entwicklerbereich und offener
Cashschritt mit geschütztem Managerweg bleiben angeschlossen.

Gezielte Node-Prüfungen sichern die bestehenden Fach-/Dialogverträge; neue
Prüfinhalte betreffen ausschließlich die gemeinsame Aktionsquelle. Volle Suite
durch den Orchestrator, Browser-Smoke, Bildvergleich 07/08/09 und Abschlussrundgang
01–09 bei 1920/2560 px sowie Kandidaten-EXE durch die Steuerung bleiben getrennt.


### Balance: Schriftskala und Handlungskurzfassung

Alle drei Balance-Reiter und Dialogüberschriften konsumieren die lokalen
`--balance-*`-Tokens aus `css/tokens.css`. h1/h2/h3 sind 30/22/18 px;
Monatsbudget 52/60 px, Handlungsverb 28/30 px und Handlungsbetrag 38/44 px
(Standard/ab 2300 px nutzbarer `balance-page`-Inhaltsbreite). Unter 1180 px
bleiben höchstens die Standardwerte. Die vollständige Skala und Consumer stehen
in `docs/design/designsystem.md`; allgemeine Suite-Tokens bleiben unverändert.

`summarizeBalanceAction` in `balance-action-summary.js` projiziert nach der unveränderten Cashintegration die dargestellten Ströme: Aktienverkauf vor
Goldverkauf/-kauf, Aktienkauf, reiner Cashumschichtung und Nichts-tun. Der Aktienkaufbetrag entspricht ausschließlich der Aktienverwendung; ein gemischter Gold-/Aktienkauf behält den Goldvorrang. Sonstige materielle
Transaktionen zeigen „Handlung prüfen“. Materielle Profilaktionen ersetzen die
Gesamtaktion, externe Nettoquellen schließen Cashtransfers aus.
`UIRenderer` hält die zurückgegebene Kurzfassung nur für den aktuellen Renderzyklus und reicht sie als zweiten Anschluss an den Diagnoserenderer und über `getActionSummary()` an den Copyhandler. Initialisierung, fehlende oder ungültige Aktion und fehlender Detailhost verwerfen die alte Übergabe.
`#balanceActionTransfer` nennt zusätzliche dargestellte interne Umschichtungen
einmalig; getrennte Profilströme werden nicht zu einem Transfer kombiniert.
Alltagssätze folgen vorhandenen Verwendungen bzw. Blockgründen. Der vollständige,
gegebenenfalls durch Cashintegration ergänzte Titel sowie sämtliche bestehenden
Detail-, Haushalts- und Steuerzeilen bleiben in Details, Copy und Druck erhalten.

`UIUtils.formatBalanceCurrency` zeigt alle regulären sichtbaren Balance-Geldbeträge
in ganzen Euro: Karten und Nebenzeilen, Monats-/Jahrestabellen, Ausgabendetails,
SVG-Titel, Transaktionskurzfassung und alle Kennzahlen einschließlich Metazeilen.
Genau bleiben Diagnosecopy und andere Kopierwege, technische Details,
Exporte und Eingaben. Der vollständige Handlungsplan im Dialog „Details & Drucken“
und sein Druck zeigen ganze Euro; seine getrennte Kopierprojektion erhält alle
Planinformationen centgenau.
Die Anzeige formatiert Rohwerte erst nach Summe und Differenz; gespeicherte,
weitergereichte und Enginewerte bleiben ungerundet. Prozent, Ratios, Jahre und
Monate behalten ihre bisherigen Einheiten und Genauigkeiten. Leitplanken erhalten
über `withGuardrailCardValues` getrennte Kartenwerte; Copy liest weiterhin die
unveränderten `value`-/`threshold`-Felder.
Die Provenienz ist eine kleine Zeile der Marktdatenkarte mit unverändertem
Text-/Datasetvertrag; fehlende Provenienz allein sperrt nichts. `peak_hot` ist
wie der Höchststand positiv in Chip und Karte; der positive Überblick bleibt neutral und auch die Skala zeigt heiß gelaufen grün, bei unveränderter
Phase und unabhängigen Alarmwarnungen. Jahres-/Recovery-/Schreibschutz,
Profil-Handoff, Cashhinweis, Import und Capture behalten ihre bisherigen Besitzer.

Die bestehenden Browser-Grundbedienungsproben prüfen die Skala und Provenienz
zusätzlich; keine neuen Browserfälle und kein geänderter Jahresablauf.
Volle Suite durch den Orchestrator, Browser-/Optik-/Kandidaten-EXE-Abnahme durch
die Steuerung bleiben gesonderte Prüfungen.


## Darstellungsadapter für Bedarf & Strategie

`balance-presentation-controls.js` bindet die statischen `data-balance-control`-Hosts
an bestehende Selects und Checkboxen. Instanzaccessoren für `value`, `selectedIndex`,
`checked`, `disabled` und `open` spiegeln programmatisches Laden; ein MutationObserver
übernimmt Options-, Begründungs- und Sperränderungen. Alle Refreshwege einschließlich
`binding.refresh`, Initialisierung und Toggle bündeln die Anzeige in einem Microtask
nach dem synchronen Setter-/Feldbesitzerdurchlauf. Nur bei abweichendem Klappen-/
Checkboxzustand läuft der bisherige Detailbesitzer, danach werden Gründe projiziert.
Nur Segmentklick löst ein
bubbelndes `change` am nativen Control aus. `UIBinder` aktualisiert beim Öffnen der
Parameterklappe ausschließlich den unveränderten gemeinsamen Dynamic-Flex-Controller.
`renderProfileInputOrigins` liest für die Übernahmezeilen bereits synchronisierte
Inputwerte; es fordert keine zusätzlichen Profile oder Berechnungen an. Die
vorhandenen Handofflinks und die Checkboxdelegation bleiben bei ihren Besitzern.


### Balance-Feinschliff: Überblick und Parameteransicht

Das Monatsbudget zeigt feste Einkünfte und finanzierte Entnahme ausschließlich
als Betrag. Eine positive bekannte Monatskürzung ergänzt die dritte Legende;
der rote Satz verwendet die gelieferte finale Flex-Rate. Ohne Kürzung oder
fehlende Vergleichswerte verschwinden diese Zusatzanzeigen. Die Bedarfskarte
enthält vier Zeilen mit kleinen Einheiten; finanzierter Flex und der belegte
Inflationsanpassungsstatus sind Zusätze. Der alte Jahresbedarfhost `neuerBedarf`
bleibt verborgen und gepflegt. „Dein Bedarf“ zeigt keine Vermögensersatzzeilen:
Ohne Profilbedarfsdaten im vorhandenen Profilvertrag bleibt `#balanceNeedProfiles`
leer und verborgen. Eine nicht gelieferte individuelle Bedarfsaufteilung wird
nicht erfunden.

`balanceActionPurpose` und `balanceActionCoverage` trennen den Erklärungssatz aus
den dargestellten Aktionen von der gelieferten Nachherdeckung. Dadurch erhält
der nachfolgende Handlungsrenderer den Deckungszusatz. `balanceActionFootnote`
unterscheidet offene, abgeschlossene, ungeklärte und unterbrochene Perioden.
Die Kontextwerte liegen im gemeinsamen `#suiteContext` des Suite-Kopfs: `suiteProfileContext` liefert die Identität, `suiteHouseholdContext` den Summary-Berechnungsumfang und `balanceScope` die einmalige Änderungsaktion. Planjahr und Marktstichtag bleiben in ihren bisherigen Textknoten neben dekorativen SVGs;
`balanceNextAnnualLabel` hält den Jahresbezug aktuell, ohne das Kalendersymbol
zu ersetzen. Der eine Knopf nutzt weiterhin die bestehende Jahresdelegation.
Phasengründe bleiben am gefüllten Marktchip zugänglich; der Zusatz verwendet nur
bekannte Alarm-/Kürzungsdaten. `peak_hot` bleibt auch in der Skala grün.

In Balance ist „Alle Parameter zeigen“ der sichtbare Detailzugang.
`dynamicFlexShowAdvanced` bleibt als verborgener flüchtiger Ansichtsanschluss;
`dynamicFlexAdvancedToggleRow` als leerer verborgener Controlleranschluss.
Aktivierung, Horizont, Go-Go, Langlebigkeit und CAPE stehen gemeinsam im
Dreispaltenraster `dynamicFlexConfigGroup`. Native Werte und fachliche Sperren
bleiben unverändert. Bei ausgeschaltetem Dynamic Flex projiziert allein das
obere Presetsegment „Aus“, auch wenn nativ `custom` gespeichert ist. Echte
Segmentklicks verwenden den bisherigen Presetweg; eine Anzeigeprojektion führt
kein Formular-change und keinen Finanzwrite aus. Ein Customklick merkt die
Öffnungsabsicht unabhängig von der Preseterkennung und fokussiert nach dem
Detailabgleich das erste freigegebene native Detailfeld. Gesperrte Presetcontrols
werden weder geändert noch fokussiert; ausgeschaltete Details bleiben gesperrt.

Der Balance-Adapter ersetzt ausschließlich exakt gleiche Ausschaltgründe in
`aria-describedby` durch `balanceDynamicFlexOff`, einschließlich sichtbarer
Segmentgruppen. Er merkt ursprüngliche Ziele, solange deren Nodes bestehen,
und erhält andere Hilfs-, Fehler- und Nichtanwendbarkeitsziele. Die weiterhin
vom gemeinsamen Feldbesitzer gepflegten Kopien sind mit höherer CSS-Spezifität
als das Feldrahmenpadding auf 1 px abgeschnitten, ohne Padding oder Rand.
Idempotente Änderungen verhindern Observer-Schleifen. Haushaltscheckboxen
bleiben schlichte, bedienbare Mitgliedschaftszeilen ohne Vorgabe für das aktive
Profil. Die Sicherungskarte nennt den jeweiligen lokalen Speicher in
Alltagssprache; kleiner Leerzustand und bestehende Fehler-, Export-, Import-,
Ordner- und Restorewege bleiben erhalten.

Browser-Smoke, Bildvergleich 01–04 bei 1920/2560 px und Einstellungsprüfer mit
Ziel 0 Fehler bleiben externe Abnahmen; die volle Suite führt der Orchestrator aus.

### Balance-Feinschliff: Ausgaben, Verlauf und Diagnose

Die Monatsmatrix zeigt neutrale rahmenlose Aktionen links vom rechtsbündigen Wert,
Monatsnamen normal und vollständige Gesamtwerte fett ungefärbt. Gültige Nullimporte
sind `0 €`, fehlende Importsätze `—`, teilweise vorhandene benötigte Profilimporte
kursiv „unvollständig“. Abweichungen brauchen vollständige sichtbare Profilimporte
und ein vorhandenes Budget: Rohwert Ist minus Budget, ganze Euro mit „−“/„+“,
negativ grün, positiv messing, null neutral. Jahresmetriken bleiben davon getrennt:
Sie umfassen alle gespeicherten Profile und zählen weiterhin positive Datenmonate.

Die Jahresgrafik zeigt rahmenlose Säulen ohne y-Achse oder Raster: vergangene
Kalenderjahre grau-grün, laufendes Kalenderjahr messing. Fette Jahreslabels,
SVG-Beschreibung, alle importierten Jahre einschließlich Nulljahren und interne
Pixelgeometrie bleiben erhalten. Die fünf Tabellenspalten sind Jahr, Status,
Ausgaben gesamt, Monate mit Daten und Ø pro Monat. „Laufendes Teiljahr“ folgt
weiterhin `isCurrentPartialYear`, ohne behauptete fehlende Monatsnamen.

Verlaufskopf, Capture, Kennzahlen und Standstabelle liegen in Personen & Vermögen. Nur die Tabellenkopie wird umgekehrt: neueste Zeile zuerst, ganze Euro, Summe fett und sämtliche nominalen Spalten einschließlich Alt-/Neu-Depot. Profil-/Verbundstände werden als im aktiven Profil gespeichert ausgewiesen. Die alte Balance-Anzeige bleibt eine kompatible Renderer-API für Bestandsprüfungen.


Leitplankenchips nutzen `ds-chip-success`/`warning`/`error`. Nur der belegte
Inflations-Cap mit `details.capBinding === true` erhält „Löst aus“ und leichte
Kartentönung; fehlende Aktivitätsdaten und bloße Nähe begründen keine Auslösung.
Fachstatus, Schwellen, Filter und Copy bleiben erhalten. Cap-Hilfe steht im Kopf,
Pflichtwarnungen bleiben sichtbar. Werte sind lokale Serif 26 px regular; sechs
Karten stehen bei 1920 px in 3 × 2 und bei 2560 px in 6 × 1, anhand der verfügbaren
Balance-Inhaltsbreite (2100-px-Containergrenze), darunter gleichmäßig schmaler.

Abnahme außerhalb der Sandbox bleibt offen: bestehender Browser-Smoke,
Grundbedienung 10/10, Einstellungen & Strategie mit 0 Fehlern und Bildvergleich
gegen Referenzen 05–08 bei 1920/2560 px. Statische Prüfungen ersetzen diese Abnahme
nicht; die volle Node-Suite führt der Orchestrator aus.

## Jahresdialog und Prüfhinweise (Referenz 09)

`balance-annual-modal.js` projiziert Vorbereitung, Fortsetzung und Ergebnis in die
bestehende rechte Fläche. `balance-binder-snapshots.js` reicht das erfasste
`targetYear` mit dem Ergebnis weiter; Titeljahre bleiben nach dem Rollover korrekt.
Bestätigung steht im Inhalt und folgt allein `results.confirmed`. Vier Balken
bleiben reine Anzeige, ihr Status ist zugänglich verborgen. Ergebniszeilen zeigen
nur vorhandene Werte, ATH und tatsächliche Schrittfehler. Die bedingte Aktion
`annualShowLog` benutzt `handleShowUpdateLog(true)` und ergänzt vorhandene
Start-/Endzeiten und Fehler; kein zusätzlicher Speichervertrag.

`createBalanceValidationHint()` in der Rendererfassade typisiert ausschließlich
bekannte UI-Vorbedingungen als `ValidationError` mit konkretem Haupttext. Der
Aktionskanal zeigt diese warnfarben. Optional bindet `handleActionError` eine
`balance-message-action`; Ersetzung, Entfernung und Initialisierung machen alte
Knöpfe unwirksam. Der Mismatchhandler bewahrt `invalid`,
`ANNUAL_PERIOD_UI_YEAR_MISMATCH` und `expenses.yearSelect` und übergibt ein typisiertes
Zieljahr. Profil-, Perioden-, Jahres- und Navigationsprüfung verhindern stale Wirkung.

`UIBinder.openExpensesYear()` prüft Sperren und nutzt bei offenem Dialog
`closeAnnualModal()` über den bestehenden sicheren Schließ-/Fokusweg. Danach:
`selectTab` → nötigenfalls UI-Option ergänzen → Selectwert setzen → genau ein
natives `change` → bestehendes `setYear` → normale Jahresauswahl speichern,
Tabelle und `renderYearSelect`/Jahressegmente aktualisieren. Der Hinweiszugang
schreibt selbst keine Speicherdaten und startet keinen Jahresprozess.

Weitere explizit bekannte Prüfhinweise: ungültiges Zieljahr/Alter, ältere als zuletzt
abgeschlossene Periode, erforderliche Recovery und bekannte Handkursablehnung.
Metadatenkorruption, Snapshot-, Speicher-, Flush-, Readback- und Programmierfehler
bleiben echte Fehler. Preisparser, Commit-/Recovery-/Retryverträge bleiben erhalten.
Neue Nodebelege betreffen ausschließlich Punkt 15; bestehende Dialog-/Copy- und
Fachprüfungen bleiben erhalten. Referenz 09 und beide Dialogbilder bei 1920/2560 px,
Grundbedienung und Browser-Smoke bleiben bis zur externen Durchführung offen.


### Balance-Restpunkte: Parameter und Handlungsdialog

Der Darstellungsadapter bündelt Property-, Toggle-, Observer- und öffentliche
Refreshaufrufe in einem Microtask. Erst nach dem synchronen Feldbesitzerdurchlauf
wird `dynamicFlexShowAdvanced.checked` bei tatsächlicher Abweichung an
`balanceAllParameters.open` angeglichen. Danach werden native Sperren und Gründe
projiziert. Aus bleibt Aus, An/Benutzerdefiniert bleibt nach erneutem Öffnen
bearbeitbar; die aktuarische Nichtanwendbarkeit des direkten Horizonts wird weiterhin
nur als `inactive` samt Grund dargestellt, ohne neue fachliche Sperre. Klappenwechsel
senden kein Formularereignis, starten keine Engine und schreiben keine Finanzdaten;
ein echter Segmentklick behält genau ein natives `change`.

Der Handlungsdialog zeigt unter seiner Überschrift genau eine kleine Kontextzeile:
vollständiger Aktionstitel mit vorhandener Cashergänzung und verfügbarer Marktphase.
Der redundante generierte Zwecksatz entfällt; Nichtstun-, Mindesthandels-, Schutz-
und Umschichtungshinweise bleiben erhalten. Quellen nennen Namen und/oder deutsches
Kaufdatum (volles Datum oder Kaufmonat), ohne technische IDs oder FIFO-Zusatz.
Instrumentinformationen, Quellenreihenfolge und autoritative Brutto-/Steuer-/Nettosummen
bleiben erhalten; fehlende Beträge bleiben fehlend. Profilzuordnungen in Tabellen
erscheinen nur im Haushalt, der aktive Profilkontext bleibt im Fuß.

Eine eigene Steuerkarte entsteht nur mit zusätzlicher Settlement-/Verlusttopf-
oder Profilsteuerinformation. Reine Brutto-/Steuersummen wiederholen keine Box;
die bestehende finale/geschätzte Kennzeichnung steht weiterhin in der Tabelle.
„Wohin es fließt“ vereint alle bestehenden Verwendungen und Zielinformationen als
Kartenzeilen. Liquiditätszufluss zeigt `+` und bei bekanntem Ziel die Monate
Nettoentnahme; „Danach · laut Berechnung“ zeigt ausschließlich die gelieferte Deckung.
Es entsteht weder eine neue Tagesgeldzuweisung noch ein Nachher-Eurobetrag oder
Nullersatz. Interne Umschichtungen bleiben mit Richtung und Betrag getrennt.
Zwecklabels haben keinen abschließenden Doppelpunkt. Dialog und Druck zeigen ganze
Euro; die eigene Kopierprojektion erhält Quellen, Verwendungen, relevante Steuer-
und Transferdetails, Zweckwerte und Kontext centgenau. Berechnung und Export bleiben genau.

Alle bestehenden schließbaren Aktionsbänder verwenden `ds-icon-button` mit
`balance-message-close`. CSS ordnet × rechts neben der optionalen Jahresfolgeaktion;
der Schließknopf bleibt DOM-Kind 1 und damit der bisherige Nachbar-Fokusbesitzer.
ARIA, Scopebereinigung und Stale-Schutz bleiben erhalten. Jahres-Eyebrow: uppercase,
`.08em` Laufweite; Handkurshilfe: gedämpfte 14 px direkt unter dem Feld. Jahresprozess,
Parser, Retry und Commit-/Recovery-Sperren bleiben beim bisherigen Besitzer.

Aktive Kürzel sind Alt+J, Alt+E und Alt+I bei vorhandenen Buttons und ohne Aktionssperre.
Reiter verwenden Klick/Enter/Leertaste sowie Pfeiltasten/Home/End. Markt-CSV, separates
Nachrücken/Undo, Alt+N, Tranchenstatusklappe und Balance-Reset sind entfallen;
Ausgaben-CSV, Simulator-Reset, interner Guardrail-Reset und historische Provenienz
bleiben erhalten. Die vollständige Inventur der 52 Balance-Module samt Exporten und
Imports steht in `docs/reference/BALANCE_MODULES_README.md`.

Nodebelege: `designsystem-balance`, `balance-renderer-action`, `balance-messages` und
`designsystem-start-handbook`. Die bestehenden Browserfälle `Balance.html` und
`Balance annual commit` bleiben erhalten und sind um die Restpunkte ergänzt.
Volle Suite durch den Orchestrator; Grundbedienung 10/10, Druck/Browser und der
Dialogbildvergleich gegen 08/09 bei 1920 und 2560 px bleiben externe offene Abnahmen.

### Übersichtsanzeige nach erfolgreicher Rechnung (Paket 6, Slice 1)

`balance-main.js` erzeugt nach erfolgreicher Einzel-/Haushaltsrechnung über
`buildBalanceOverviewSummary` den profilbezogenen Anzeigeeintrag
`overview_balance_summary_v1`. Das gilt auch für Preview; seine Fachzustands-,
Input-, Snapshot- und Periodengarantien bleiben erhalten. Blockierte/gescheiterte
Läufe schreiben keinen neuen Plan. Während einer abbrechbaren Datenvorbereitung
oder ihres Abbruchs unterdrückt der Summary-Writer Anzeige-Writes: insbesondere
Import-Dry-Runs ersetzen keinen gespeicherten Plan, auch wenn die spätere
Wiederherstellungsvorschau scheitert. Erfolgreiche Importe schreiben in ihrer
Commitphase; normale Einzel-/Haushaltsvorschauen schreiben weiterhin.
`result.overviewPersistence` ist der getrennte
Schreibabschluss; sein Fehler wird als Anzeige-Persistenzfehler gemeldet.
Monatsentnahme folgt `ui.spending.monatlicheEntnahme`, das getrennte Monatsbudget
folgt `calculateExpensesBudget` einschließlich fester Einkünfte. Der Leser
bestimmt „fest“ aus bestätigten Jahresmetadaten aller Mitglieder und schreibt
beim Statusabgleich nichts. Haushaltspläne werden einmal gelesen, nicht summiert.
Die Infohilfe verwendet den gemeinsamen `designsystem-info-popover.js`-Binder.

### Lesende Übersichtseinstiege (Paket 6, Slice 2)

`balance-main.init` wertet nach erfolgreichem Start, Summary-Schreibabschluss
und Profilbereitschaft die festen Ziele `#jahresabschluss`, `#ausgaben` und
`#ausgaben-import` aus. Optionale `?year=2026&month=12` wählen nur die Ansicht;
die Einstiegsauswahl schreibt keinen Ausgaben-activeYear-Record. Import
fokussiert den bestehenden Monatsknopf, ohne einen Dateidialog zu starten.
Ungültige Parameter, unbekannte Ziele und Recovery-/Commitblocker tun nichts.

`UIBinder.openAnnualPreparation` verwendet den vorhandenen Snapshotworkflow
mit `preparationFirst`: Der vorhandene Vorbereitungsdialog kommt vor einer
möglichen Legacybestätigung. Abbruch bleibt vollständig schreibfrei. Erst nach
ausdrücklicher Dialogbestätigung werden Periodenklärung und bisheriger
Snapshot-/Commitprozess fortgesetzt; Identität und Metadaten werden nochmals
geprüft. Recovery und bereits bestätigte Perioden behalten ihre bestehenden
Blocker. Der normale manuelle Einstieg und Retryvertrag bleiben erhalten.

### Jahresband der Startübersicht (Paket 6, Slice 3)

`app/overview/overview-model.js` liest Ausgaben aus dem globalen Store nach
Haushaltsmitgliedern und abgeschlossenen Monaten. Gültige Nullimporte bleiben
von fehlenden und teilweisen Imports unterscheidbar. Hochrechnung benutzt die
bestehende `computeYearStats`-Regel auf vollständigen gefilterten Monaten.
Budgetlinien benötigen eine passende Jahres-/Umfangs-Summary; keine historische
Budgetrekonstruktion und keine Balanceberechnung beim Anzeigen. Januar mit
offenem Abschluss zeigt das Vorjahr, sonst läuft das Band im aktuellen Jahr.
Vermögensvergleiche benötigen echte Jahresgrenzen und vorhandene volle Basis;
Gold/Anleihen verhindern eine falsche Gesamtänderung. Die Fachverträge von
Ausgabenstore, Perioden und `wealthHistory` bleiben unverändert.


## Zentrale Personenquelle

`balance-reader.js` und `balance-main-profile-sync.js` lesen Alter, Einkommen, Kirchensteuer und SPB aus der zentralen Personenprojektion; der Haushalt summiert weiterhin pro Person. `balance-storage.js` und Profilcapture entfernen eigene Personeninputkopien, erhalten aber Ergebnis-/Snapshotbelege und `personInputEvidence`. Der JSON-Import verlangt kein eigenes Alter; alte vorhandene Personenfelder werden weiterhin validiert. Jahresplan, Orchestrator und Postcheck verwenden das abgeleitete Folgeplanungsjahr; ein Altalter-Fallback bleibt fest. Inflations- und Bedarfsgates sind jahresbezogen. Unter Snapshots ist der vollständige Personen-Recovery-Punkt wiederherstellbar. Datenmodell und Transaktionsablauf: TECHNICAL, Abschnitt „Zentrale Personendaten“. Die optionale Dialogbestätigung hält Personenfelder und Rechner bis zum dauerhaften Gesamtreadback gesperrt; beide Personenmarker und aktive/inaktive Registrykopien werden gemeinsam bestätigt. Mehrpersonen-/Partnerwahl bleibt in einer Dialogsitzung. Fehler bleiben sichtbar, Recovery schützt unbestätigten Rollback. Eine Wiederholung lädt erst nach Erfolg/Flush höchstens einmal neu; das alte Dokument bleibt gesperrt. Auch in kompakter Balance behalten Dialogoptionen eigenständige 16-px-Schrift.

Für die Rentenprojektion gilt [Rente ab Rentenbeginn (Paket 10d)](#rente-ab-rentenbeginn-paket-10d): Der bestätigte Beginnmonat zählt vollständig mit (Juli = sechs Monate). Die dort beschriebenen Fälle ohne Datum unterscheiden die Zwölfmonatsrechnung von der Balance-Budgetausnahme bei positivem erhaltenem Migrationsoffset.

### Lesender SPB und Altersdarstellung im Jahresdialog

`balance-main-profile-sync.js` projiziert den persönlichen SPB beziehungsweise die bisherige Haushaltssumme ausschließlich in eine gesperrte Anzeige. Expliziter SPB 0 bleibt erhalten. `balancePersonEditLink` führt mit bestehendem Handoff zur aktiven zentralen Personeneingabe unter `#personendaten`. Der Balance-Reader nimmt die tatsächliche Projektion; Persistenz entfernt eigene Personeninputs.

`balance-annual-modal.js` zeigt in Vorbereitung, Fortsetzung, Ergebnis und Protokoll das Alter am 01.01. des Folgeplanungsjahres (`targetYear + 1`). Ein fehlendes Datum zeigt das feste Altalter mit Ergänzungshinweis. Öffnen oder Retrydarstellung erhöht keinen Wert und übernimmt keine vermeintliche Alterserhöhung aus einem alten Ergebnisfeld.

`balance-person-data-readonly.test.mjs` prüft produktiven Sync, Binder und bestätigten Handoff mit Schreibrekorder und erneutem direktem Backendlesen nach Flush. `balance-annual-person-data.test.mjs` prüft die produktiven Modalhandler mit festen Geburtstags-/Fallbackfällen. Browserbedienung und Bildabnahme bleiben extern.


### Recovery- und Dokumentationsgrenze (Paket 10, Slice 4)

„In Personen & Vermögen ändern“ am SPB verwendet den bestehenden Handoff zur aktiven Person unter `depot-tranchen-manager.html#personendaten`. Fachwrite-Besitzer bleibt der Manager. Der Jahresabschluss, seine Wiederholung und Snapshotrestore erhöhen kein gespeichertes Alter; Inflation und Bedarfssperren folgen dem Planungsjahr. Monatsrente, Kirchensteuer und SPB kommen beim Öffnen/Profilabgleich erneut aus der zentralen Quelle.

Der Snapshot `person-data-migration-recovery` ist ein vollständiger Registry-/Live-Rollback, einschließlich Außenprofilen und alter Personenkeys, keine gewöhnliche Profilzusammenführung. Restore beendet die alte Ansicht über geschützten Reload; beim nächsten Start wird alter Personenbestand erneut gesichert geprüft. Standard-Jahressnapshots behalten ihren bisherigen Scope. Ergebnisbelege und `personInputEvidence` sind keine neuen editierbaren Personenquellen. Handbuchanker `balance-jahresupdate`, `balance-snapshots` und `profilverbund-personendaten` erklären die Wege. Externe Jahresabschluss-/Retry-/Restorebedienung in Browser und Windows-WebView bleibt bis Ausführung offen.

### Fachliche Personenunvollständigkeit (Paket 10b)

`balance-main.js` startet beziehungsweise erwartet den einmaligen gemeinsamen Profilweg (`initializeProfilePage`) vor der Eingabeinitialisierung; ein fehlgeschlagener Start oder Aufschub hält schreibende Initialisierung an. Es prüft über `readBalancePersonStatus()` in `person-data-status.js` vor der Rechenprojektion den tatsächlichen Balance-Umfang: Die angehakten Mitglieder bestimmen den Umfang unabhängig von der geöffneten Person. Nur ohne Auswahl rechnet die geöffnete Person allein. Bei A geöffnet und nur B ausgewählt liefert `loadProfilverbundProfiles()` genau B; Reader, Sync und produktiver Updatekörper verwenden Bs eigene Personenwerte und Balance-Quelle. Die Summary bindet den Haushaltsumfang `[B]`, die geöffnete Identität bleibt A. Fehlende Daten von B sperren, fehlende Daten ungewählter Personen nicht. Der Reader berechnet den SPB aus den aktuellen Personenprojektionen und übernimmt keine veraltete globale Summe. Fehlender Geburtstag ohne Altalter liefert `person_data_incomplete` mit Name und Link zum Ergänzungsband, ohne Engine-, Ergebnis- oder Commitwrite. Bestehende Ergebnisanzeige bleibt stehen. Profil-Sync und Verbundrefresh umgehen in diesem Fall ihre strikten Personenleser; beschädigte Daten bleiben Recovery-Fälle. Belegt im produktiven Updatekörper sowie Sync-/Handoffpfad durch `tests/balance-person-data-readonly.test.mjs`. Der Jahresabschluss leitet Alter aus unverändertem Geburtstag ab und erhöht keinen Personenrecord.

## Rente ab Rentenbeginn (Paket 10d)

Bei fehlendem Rentendatum ist ein positiver migrierter Versatz an `profile_person_migration_v1.referenceYear` gebunden: Beginn ist der 01.01. des Referenzjahres plus ursprünglichem Versatz. `projectPerson()` liefert `max(0, referenceYear + renteStartOffsetJahre - year)`, vor Beginn null Rentenmonate/-betrag und ab Beginn zwölf Monate. Positive Versätze ohne gültige datierte Herkunft werden kontrolliert abgewiesen. Fehlender oder nullwertiger Versatz bleibt mit laufender Zwölfmonatsrente kompatibel; sonstige Einkünfte wirken stets unabhängig ganzjährig. Projektion verändert keine Profil- oder Migrationbytes.

Der Simulator erhält die originale Monatsrente, den im jeweiligen Planjahr wirksamen Versatz und zwölf Startmonate. Referenzjahr 2026 mit Versatz 2 ergibt 2026/2027/2028/2029 die Versätze 2/1/0/0 und Balance-Jahresrenten 0/0/12.000/12.000 bei 1.000 monatlich. Ein bloßer Januarvorschlag ersetzt kein bestätigtes Datum. Ein expliziter Beginn hat Vorrang, einschließlich Juli-Teiljahr mit sechs Monaten. Kalender- und Betragsfehler bleiben kontrollierte Fehler.

`profile-person-data.js` leitet mit `deriveAnnualPension` die Rentenmonate des Planungsjahres rein aus dem ISO-Kalenderdatum ab: Bei bestätigtem Datum gelten vor dem Beginnjahr null Monate, im Beginnjahr `13 − Beginnmonat`, nach dem Beginnjahr zwölf Monate. Der Beginnmonat zählt vollständig, auch bei Beginn am 15. Juli (Juli = sechs Monate). Ohne Datum liefert diese Kalenderfunktion zwölf Monate; bei datiertem Migrationsbeginn setzt `projectPerson` Monate und Jahresrente nur vor dem Startjahr auf null, danach gelten zwölf Monate. Ungültige Kalenderdaten und Beträge werden abgewiesen. Der gespeicherte Monatsbetrag bleibt die erwartete Nettorente in heutigen Werten nach Kranken- und Pflegeversicherung.

Die Balance verwendet den wirksamen Jahresbetrag und zeigt dessen Monatsdurchschnitt. Sonstige Einkünfte bleiben unabhängig ganzjährig im Budget. Sync, Reader, Haushaltsaggregation, Verteilung und Summary rechnen mit demselben Anteil; Statushinweise nennen in Haushalten die Person. Profilwechsel und ein abgeschlossenes Planungsjahr aktualisieren die rein abgeleitete Anzeige ohne Profilwrite.

Der Simulator transportiert `renteStartMonate` für Hauptperson und Partner zusätzlich zum Jahresoffset. Ohne Zusatz gelten zwölf Monate. Die volle Jahresbasis wird weiterhin ab Index 0 angepasst; im Entnahmejahr wird nur die Eigenrentenauszahlung am Startindex anteilig, danach vollständig verwendet. Partnersteuerquote und Hinterbliebenenregeln bleiben erhalten. In jedem Ansparjahr sind `rente1`, `rente2`, `renteSum` und `pension_annual` exakt null, auch bei belegtem Kalenderbeginn: Die tatsächlichen externen Wertflüsse bleiben Cashzins und Sparrate. Cash am Jahresende entspricht Anfangscash plus Cashzins und Sparrate abzüglich Aktien- und Goldkäufen. `renteKalenderbeginn` wirkt in der Ansparphase ausschließlich auf das Liquiditätsziel und damit auf die Cash-/Kaufverteilung. Dafür zählen die zeitanteiligen, voll fortgeschriebenen Eigenrentenbasen; beim Partner gilt `rente2BruttoEigen` vor seiner Steuerquote. Bei vollem Kalenderfaktor entspricht diese Zielbasis dem Altpfad, auch mit positiver Partnersteuerquote. Historische Requests ohne Kalendermarker behalten ihre bisherigen Ziele und Wertflüsse. Die Nullspalten kürzen keine Rentenbasis: Das erste Entnahmejahr verwendet die unverändert fortgeschriebene volle Basis und die bisherigen Renten-/Steuerregeln. Protokoll sowie JSON-/CSV-Exporte übernehmen die tatsächlichen Jahreswerte einschließlich der Ansparnullen ohne erneute Kürzung oder Ersatzwerte. Ein späterer Personenentwurf verändert fertige Laufbelege nicht.

Bei der gesicherten Umstellung bleibt die Profilquelle grundsätzlich vorgeschlagen. Nur Profilbetrag null oder altes explizites Nein zusammen mit positiver Simulatorrente und Startoffset größer null erhält den Vorschlag „künftige Rente aus dem Simulator“. Betrag und Offset müssen derselben Person und Live-/Registryquelle entstammen. Vorschlag, Dialogvorauswahl und unveränderte Übernahme stimmen überein; explizite Profilwahl und Abbruch bleiben möglich. Ein gültiges vorhandenes Datum bleibt erhalten; bei fehlendem Datum bleibt Januar des Referenzjahres plus Offset lediglich der gekennzeichnete Vorschlag, kein erfundener Juli.

Node-Nachweise: `profile-person-data.test.mjs` (Kalenderregel, Zeitzonen und vollständiger synthetischer Altpfad-Bytevergleich), `balance-person-data-readonly.test.mjs` (produktive Eingänge, Engine, Summary und Bestandsschutz), `simulator-household-pension.test.mjs` (Eigenrenten, Anpassung, Partner, Ansparen und Monte Carlo), `historical-backtest-export.test.mjs` (realer Backtest, Protokoll und Export), `profile-person-migration.test.mjs` (Vorschlag, Readback, Reload und Abbruch). Browserfälle „Rentenbeginn Kalenderbudget“ und „Künftige Rentenquelle Umstellung“ sind registriert; Browserausführung und externe Bild-/Bedienabnahme bleiben bis zur tatsächlichen Ausführung offen. Das separate gepinnte Charakterisierungsgate bleibt unverändert und wird auf Linux nicht ausgeführt.

## Gemeinsamer Arbeitsstand der Startseite (Paket 13)

`balance-next-steps.js` leitet ausschließlich offene Pflichtschritte mit stabilen
Kennungen und bestehenden Links ab. `balance-renderer-summary.js` und
`overview-model.js` verwenden denselben Jahres-/Monats-/Cashkontext. Das
Vorplanungsjahr (`not_applicable`) verlangt keinen Abschluss. Materielle
Brokerempfehlungen sind keine offenen Schritte; Monatsbestätigungen belegen nur Bereitstellung.
`balance-main.js` ergänzt seine separate Anzeigezusammenfassung nach erfolgreicher
Rechnung um eine minimale, gegen Plan/Bestände gebundene Handlungsgrundlage und
beide Liquiditätsdeckungen. Keine Änderung des Preview-/Commitvertrags.
Fehlende oder veraltete Vorschaugrundlagen erzeugen keine Planprüfpflicht; eine
belegte leere Liste erlaubt „Alles erledigt“. `balance-action-origin.js` projiziert
lesend den passenden Jahresbeleg aus dem Planvergleich. `renderAnnualAction` zeigt
`adopted.action` mit Planjahr und `committedAt` im Host `#balanceAnnualAction`, ohne
heutige Cash-/Profilableitungen. Aktionskarte, Details und Copy bleiben ausdrücklich
vorläufige Vorschau für den nächsten Jahresabschluss. Das Vorschaujahr ist dessen
Abschlussjahr aus dem gemeinsamen Anlassmodell: offenes Vorjahr, danach laufendes
Jahr; im Erstjahr bleibt der erste Termin Anfang des Folgejahrs genannt. Karte,
Dialog und Kopie übernehmen dieselbe Herkunftsprojektion. Kein Umsetzungsvermerk und
keine Ablage; fehlender Beleg bleibt neutral, beschädigter Beleg eine Datenwarnung. Der Istwert stammt aus `deckungVorher`,
„nach Umsetzung“ aus `deckungNachher`; alte Nachher-only-Einträge behaupten keinen Iststand.

### Fachliche Uhr und Probelauf

Jahresdefaults, Ausgabenjahr/-Erfassungszeit, Vermögensaufnahme und Jahresaktions-
anzeige lesen `app/shared/app-clock.js` nach der gemeinsamen Seitenbereitschaft.
Explizite Referenzdaten und die bestehenden Abschlussperioden bleiben vorrangig.
Die Verlaufsschreibung ist eine erlaubte fachliche Transaktion im aktiven Kopielauf;
Vollbackup-Imports und fremde Snapshotrestores bleiben gesperrt; Ausgaben-CSV laufen über den Fachimport. **Vor Probelauf** hat einen
vollständigen Rohumfang und ist nur über den Probelauf-Koordinator wiederherstellbar.
Muster-Haushalt und Kursadapter sind angeschlossen; Browserabnahme bleibt extern offen.


### Probelauf: Jahreskurs und Übersicht (Paket D, Slice 2)

`balance-annual-marketdata.js` verzweigt vor Proxy-/Retryaufrufen über den gemeinsamen
Preisadapter. Im aktiven Probelauf liefert die Kurve ausschließlich das bestehende
27.–31.-Dezember-Fenster des Abschlussjahres. Nachrücken, ATH, Jahresperiodenprüfung,
Recovery-Snapshot und Vermögenswriter bleiben unverändert. Inflation/CAPE werden
im aktiven Probelauf vor allen echten Anbietern synthetisch erzeugt; ihre
Pflichtprüfungen bleiben erhalten. Der Muster-Haushalt startet ohne
offene Abschlüsse: Vorjahr und Vormonat sind für beide Personen bestätigt, der
Startjahrplan ist fest (`play`, `annualState = done`, `monthCompleted = true`).
Geburtsdaten, Rentenbeginne und Neuaktien-/Geldmarktkäufe verschieben sich einmalig
um Startjahr − 2026; Altaktien behalten 2016-06-15. Januaralter 67/64 wird aus
kanonischen Geburtsdaten gelesen, ohne Legacyalter in Balanceinputs zu speichern.
Ausgaben enden im Vormonat, Tagesgeld ist am ersten Tag des Startmonats bestätigt.
Historische Jahresend-/Januarstände verwenden damalige Kurse und Cashwerte;
Startjahr 2026 enthält keinen unzulässigen Jahresstand 2025. Spätere Datumssprünge
setzen denselben Bestand fort: Nach dem Jahreskoordinator ist Dezember wie bisher
über `storeMonthProvision()` bestätigbar; der Jahresanlass hat Vorrang. Die Übersicht ergänzt nur lesend
haushaltsweite Jahresmetadaten aus Live-Balance, gemäß bestehendem Eigentumsvertrag.
Kursgenerationen werden bei Start/Datumssprung erneuert; der normale Kursprovider
bleibt unverändert. Vollständige Rückkehr aus Rohstrings mit Ausnahme des zusätzlichen
Punkts Vor Probelauf, Steuerkey-Ausschluss und Recovery gelten wie in TECHNICAL.md.
Node-Nachweis: `probelauf-workflow.test.mjs`; externe Browser-/EXE-Abnahme offen.


### Seitenstart und bestätigte Bereitschaft (Paket D-Folge, Slice 2)

Der gemeinsame Start in `app/profile/profile-navigation.js` wartet auf bestätigte
Probelaufinitialisierung und gegebenenfalls die dauerhafte Personenumstellung.
Ein aktueller Personenbestand benötigt keine Migrations-Lease; eine frühe
`idle`-/`result`-Rückfrage verliert daher ihre Zustimmung beim Bootstrap nicht.
Nodebeleg: `tests/probelauf-page-start.test.mjs`; Browser-/BFCache-Abnahme offen.


### Gemeinsamer Jahresstatus und erster Planungsmonat (Paket 12, Slice 1)

`app/shared/planning-start.js` besitzt die DOM-freie P6c-Regel: Perioden-, Vermögens-, passende Summary- und Ausgabenbelege sowie die eng begrenzte Vorjahresinitialisierung bestimmen den Beginn. Quellfehler bleiben sichtbar. `deriveOverviewPlanningStart()` ist der kompatible Datenadapter; Startseite, Balanceüberblick und Abschlusskoordinator verwenden dieselbe Regel und die fachliche App-Uhr.

Der Periodenstand wird getrennt von den Haushaltsmitgliedern über seine Profilidentität projiziert: Liveüberlagerung beim geöffneten Writer, sonst Registry. Eine eindeutige bestehende Abschlussablage genügt auch ohne persönlichen Balance-Stand jedes Mitglieds; identische Kopien dürfen übereinstimmen, widersprüchliche Ablagen verlangen Klärung. Fremde bestätigte Quellen benötigen eine Anzeige für den exakten Umfang. Pending bleibt Recovery, beschädigte Quellen bleiben gesperrt. Der gemeinsame Plan passt ausschließlich zu Jahr und Scope und wird niemals aus Haushaltsergebnissen aufsummiert. Es werden keine neuen Abschlussmarker angelegt oder Periodenmetadaten auf Personen verteilt.

Liegt der Vormonat vor dem ersten Planungsjahr, zeigt die Startseite den ruhigen Zustand `start`, keinen Dezemberabschluss und keine Bereitstellung. Balance zeigt „Erstes Planungsjahr 2026 · erster Jahresabschluss Anfang 2027“. Der Kopfknopf öffnet einen schreibfreien Hinweis; alter Jahreslink und Ausgabenjahrkorrektur umgehen die Grenze nicht. Ab Februar wird Januar angeboten, ab Anfang 2027 der erste Abschluss 2026. Vorjahresbelege, Legacyprüfung, Recovery und Finalisierungsreadback behalten ihren Schutz.

Paket 12c erhält den ruhigen Hinweis nach Ende des vollständigen Kopfhandlers und beim alten Jahreslink, auch wenn der Überblickszugang fachlich deaktiviert ist. Technische Sperren bleiben wirksam. Eine gültige leere Vorjahresinitialisierung mit offenem ausgewähltem Periodenstand zählt eigenständig: Eine später automatisch gespeicherte Summary oder Vermögensanzeige 2027 verdrängt den Beginn 2026 nicht. Das Minimum früherer gültiger Belege bleibt maßgeblich; beliebiges `activeYear`, fremder Umfang und beschädigte notwendige Quellen erzeugen keinen Beginn. Der echte Balance-Summarywriter bleibt aktiv.

Die Browserfälle „Stabiler Planungsbeginn nach Balanceöffnung“, „Household annual source“ und „First planning year“ sind registriert. Ihre tatsächliche Ausführung und die externe Browser-/WebView-Abnahme bleiben offen; Nodebelege ersetzen sie nicht. Der bestehende Fall „Suite frame profile context“ bleibt unverändert.

### Tagesgeld bei bestätigten Abschlüssen

`app/profile/profile-cash-update.js` bereitet ausschließlich `profile_tagesgeld`
und `profile_cash_history_v1` über den bestehenden Profilwriter in privaten
Recordkopien vor. `app/shared/tagesgeld-fields.js` liefert schreibfreie,
namentlich zugeordnete Felder mit dem gemeinsamen Dezimalparser. Monatshaken,
Cashstände und Registry werden in einem begrenzten `replaceRecordsTransactional()`
mit Rohbyte-Vorbedingung und dauerhaftem Readback bestätigt; zuvor entsteht ein
geprüfter Monats-Wiederherstellungspunkt. Die Jahresfinalisierung nimmt dieselben
Cashrecords gemeinsam mit Plan und Beleg in den fachlichen Speicherabschluss auf und behält den
ursprünglichen Jahressnapshot auch bei Retry. Cashnachtrag und Korrektur
bestätigen den absoluten Stand gemeinsam mit dem append-only Audit. Duplikate
setzen neuere Stände nicht zurück. Die bestehende P8-Tagesnettoauswertung bleibt bestehen.

Gezielte Nachweise: `tests/profile-cash-update.test.mjs`,
`tests/tagesgeld-fields.test.mjs`, `tests/overview-month-close-integration.test.mjs`,
`tests/balance-wealth-history.test.mjs` und `tests/tranche-reconciliation.test.mjs`.
Cache und Backend werden getrennt geprüft. Browserfälle für Monatsstart, Wiederöffnung und Schrittaktivierung,
Abbruch, Escape, zwei Personen, unveränderte Werte und Doppelklick sowie Jahres-
und Cashnachtragfelder liegen in `tests/browser-smoke.test.mjs` und benötigen
externe Ausführung. Das gepinnte Windows-Charakterisierungsgate bleibt unverändert.

### Beispielausgaben und gemeinsame Importgrenze

Die gemeinsame Ausgabenmatrix zeigt Beispielimporte als `ds-icon-button` mit dem
synchronen Kopiersymbol aus `designsystem-icons.js`. Tooltip und Bezeichner nennen
den Zellenmonat und die Person. Monats-/Jahresdialoge verwenden dasselbe Symbol;
der Sammelzugang heißt „Beispiele für alle“. Die Importattribute bleiben erhalten.

`app/demo/beispielausgaben.js` liefert CSV ohne Writes: bestätigter aktiver Koordinator,
passende Fachuhr, kein busy/blocked/Recovery, stabile Personenkennung und gemeinsames
Budget für Jahr/Umfang oder einmaliger Jahresbedarf / zwölf. `default` ist nur der
Fallback ohne tatsächliche Einzelkennung. Centverteilung, Dezember und Reparatur
ändern weder CSV-Spalten noch Rechenformeln.

`balance-expenses-import.js` serialisiert alle Quellen und Oberflächen gemeinsam:
Text → `parseCategoryCsv` → gemeinsame DOM-Vorschau → Bestätigung → Sitzung/Umfang
prüfen → `saveExpensesStore` → `flush`. Sammelimporte validieren alle CSVs vor dem
ersten Write und melden einzelne Flushfehler. Guard-Commit schützt Writes; Navigation
bricht wartende Importe ab. Ein unbestätigter eigener Kandidat wird nur bei unverändertem
Kontext zurückgenommen. Der bestehende optionale Vermögensrückruf startet nach
Bestätigung mit freigegebenem Import-Guard; Folgefehler erhalten einen eigenen Kanal.

`balance-expenses.js` bindet Einzelzellen, `overview-example-expenses.js` den
delegierten Startseitenschritt. Der Startseitenweg erzeugt weder Vermögenspunkt noch
Monatshaken. `source: 'probelauf-example'` ist optionale Anzeigeherkunft im Version-1-
Record; echte CSV ersetzt sie. Monatsdetails und jährlicher Renderer weisen auch
gemischte Jahre aus. Persistenz, Summen, Median und Forecast bleiben unverändert.


### Synthetische Jahresmarktdaten im bestätigten Probelauf

`marketPriceAdapter()` unterstützt `inflation` und `cape` nur bei bestätigter Fachuhr,
nicht allein durch den URL-Parameter. Inflation beträgt jahresabhängig 1,5–3,0 Prozent
(2026: 2,5 Prozent). CAPE bildet den ungerundeten synthetischen VWCE-Jahresendkurs
gegen die Referenz 2016 monoton auf 20–35 ab. Beide Datenstände sind das feste
abgeschlossene Jahresende; ungültige Jahre scheitern ohne echten Fallback.
Die normale Quellenfolge bleibt EZB → Weltbank → OECD und Yale → Mirror → Stored.

Inflation wird weiterhin validiert und gemeinsam mit der Bedarfsmutation als
`annualMarketDataMeta.inflation` gespeichert. Der ETF-Aufbau übernimmt nur Meta
mit passendem `year === targetYear`; Profilwechsel und Readback nutzen den bestehenden
Haushaltsvertrag. ETF-Meta und Jahresergebnisse sowie CAPE-Meta und `sourceLabel`
tragen `Probelauf · synthetisch`; laufende Quotes/Charts behalten ihr bisheriges Label.
Der synthetische Inflations-/CAPE-Erfolgsstatus ist `ok_synthetic`.
Nodebelege: `probelauf-prices`, `balance-annual-inflation`, `balance-annual-cape`,
`balance-annual-marketdata`, `balance-annual-navigation` und `probelauf-workflow`.
Der registrierte Browserfall „Probelauf Jahresabschluss ohne Netz“ bleibt extern
auszuführen, gemeinsam mit „Balance annual commit“ und „Tagesgeld Jahresabschluss“.


### Fertiger Monatsdialog der Übersicht

`app/overview/overview-main.js` besitzt Monatsauftrag und Seitenguardlease;
`overview-month-confirmation.js` zeigt vier Schritte sowie nach dauerhaftem
`storeMonthProvision()`-Readback das Ergebnis in derselben Instanz. „Alles gespeichert“,
Ausgaben/Budget mit ehrlichen Lücken, exakte Personen-Cashwerte und Summe, Datum und
Folgemonatsbetrag bleiben bis „Fertig“ sichtbar. „Fertig“ schreibt nichts zusätzlich.
Fehler erhalten den Entwurf für „Erneut versuchen“; unbestätigter Rollback sperrt Retry
mit Wiederherstellungshinweis. Store, Schema und Jahresfinalisierung sind unverändert.

Schließen/Kreuz/Escape sind beim Commit gesperrt. Geänderter oder ungültiger Cashentwurf
nutzt den vorhandenen Seitenguard mit „Bleiben“/„Verwerfen“; finanziell gleiche deutsche
Schreibweisen benötigen keine Rückfrage. Nur ungespeichertes Cash geht verloren.
Bestätigte CSV-/Beispielimports bleiben nach Wiederöffnung/Backendneustart bestehen.
Echtes CSV nutzt auch im Dialog `createExpensesWealthCaptureController()` mit derselben
Frischeprüfung wie Balance; bestätigte Vermögenspunkte bleiben beim Cashverwerfen.
`expenses-wealth` meldet Folgefehler getrennt vom Import und Monatsabschluss.
Beispiele erzeugen keinen Vermögenspunkt. Bestehende Balance-Erfassungsrückrufe,
Handbuchanker und Jahreskarte bleiben erreichbar. Browserabnahme bleibt extern offen.

### Jahresvorbereitung außerhalb der Schreiblease

`balance-close-coordinator.js` registriert während des offenen Entwurfs ausschließlich
`idle/dirty`. Dadurch können CSV-Import und Vermögensfolgejob ihre vorhandenen
Besitzer vollständig abschließen. Vor dem Jahresstart wartet der Koordinator auf
beide Jobs, prüft Profil, Haushaltsscope, Fachdatum, Personen-, Cash-, Formular- und
Periodenquellen und übergibt genau ein `preparedMarketData`-Paket. Erfolglose Typen
können erneut gelesen werden, erfolgreiche Typen werden nicht erneut abgerufen.
Abbruch und Kontextwechsel verwerfen späte Antworten. Vorabrufe benutzen keinen
schreibenden Migrationsleser und erzeugen weder Fehler-Metadaten noch Snapshots.

Erreicht ein Jahreszugang bei abweichender Überblicksprojektion den Snapshotbinder
ohne bestätigtes Vorbereitungspaket, meldet dessen Binder-Bindung den Schutzabbruch
und liefert `null` statt eines unversorgten Dialogs. `preparationFirst` stellt auch
im Fallback sicher, dass die Meldung vor einer Legacy-Metadatenauflösung erfolgt.
Erstjahr-, bereits abgeschlossene und ungültige Perioden behalten ihre Schutzwege.

`prepareAnnualNeeds()` ist die gemeinsame Berechnung und Rundung für Vorschau und
Inflationsanwendung. `projectAnnualPreview()` benutzt die vorhandenen
Personen-/Rentenleser, einschließlich Januaralter, erlaubtem Altersfallback und
anteiliger Jahresrente. Die bestätigte Ansicht liest den tatsächlichen Planstand.
`showAnnualPreparation()` nutzt `createOverviewStepContent()` für Kurse, Import
und Budget. Tagesgeldfelder und Handkurs behalten bei Importrefresh ihre Identität.
Die Jahresvorbereitung endet nach sechs Schritten; ein siebter Schritt entfällt. Der Jahreswriter erhält über
`confirmedPreparation` die ausdrückliche Bestätigung ohne zweite Dialoginstanz;
Belegprüfung beziehungsweise erforderliche Klärung, Vorprüfung, Snapshotreadback, Pendingphasen, Rollover,
`COMMIT_PERIOD` und Finalisierung bleiben unverändert geordnet. Ein geprüfter
Reload-Einmalauftrag nutzt seinen Handkurs, den bestätigten Planpatch und die
bestätigten Jahresend-Cashwerte mit den zum Snapshot passenden Rohquellen
ohne erneute Eingabe; Inflation/CAPE werden vorab vorbereitet.


### Bestätigte Monatsphase nach dem Jahr

`createAnnualMonthSession()` beginnt nach Freigabe sämtlicher Jahresbesitzer.
Der Binder wartet auf `update(PREVIEW).overviewPersistence`; erst eine feste Summary
für Folgejahr und identischen Scope gibt die Bereitstellung frei. Pendingcommit,
Recovery, Fremdlease, Quell- oder Datumsabweichung verhindern den Monatswriter.
`projectAnnualClosePreparation()` zeigt im Jahresdialog den tatsächlichen Vormonat
und getrennt die vollständige Auswertung des Abschlussjahres, auch im März.
Die Startseitenkarte benutzt `#abschluss`; der Parser normalisiert den Altanker
`#jahresabschluss` auf denselben geschützten Auftrag nach Balanceinitialisierung.

Tagesgeldzahlen werden einmal bestätigt. Nach Jahresfinalisierung werden die neuen
Cash-/Historienrohbelege gebunden und gegen die Jahreszahlen geprüft. Der unveränderte
`storeMonthProvision()` erstellt einen zweiten Snapshot und bestätigt den Monat mit
seiner bestehenden Transaktion; gleiche Cashzahlen erzeugen keine Historienwrites.
Doppelklicks bleiben je Phase gesperrt. Monatsfehler rollen ausschließlich den Monat
zurück; der Jahresstand und Plan bleiben bestätigt. `rollback_failed` hält eine
Schreibsperre über das Dialogende hinaus. Der ausdrücklich bestätigte Monatsrestore nimmt nur Registry und Monatsrecord
für sämtliche Haushaltspersonen zurück. Jahresstand und Cash bleiben erhalten;
die Oberfläche bleibt bis zum geschützten Reload gesperrt. Andere Snapshotziele
werden während dieser Recovery abgewiesen.

Die ursprüngliche Dialoginstanz ersetzt nach dem Write alle sechs Vorbereitungen durch
Ergebnis C: sofortige verbindliche Handlung J+1, Planstand, MONAT und Wiederherstellungspunkte.
`annual-close-result.js` liest nur die bestätigte `planComparison` aus dem Monats-Sitzungsmodell;
beide Binder übergeben `actionResult` vor dem Rendern und nach Retry. Eine tief kopierte
Vorheraufnahme zeigt sichere Inflationsübergänge; Nachher und „von dir angepasst“ stammen aus dem Beleg.
Cashsumme und Monatsbetrag stehen ausschließlich im MONAT-Teil; technische IDs nur im Protokoll.
`#annualConfirmBtn` trägt in der Ergebnisphase zusätzlich `[data-overview-month-accept]`.
Ein Monatsfehler zeigt Teilfehlermeldung und „Erneut versuchen“ ohne weitere Vorbereitung.
`#annualShowRecovery` führt bei Recovery in die Sicherungsverwaltung.
Protokoll und Fertig sind schreibfrei; die separate Balance-Handlungsanzeige bleibt erhalten.
Node-Nachweis: `balance-close-coordinator.test.mjs` und
`balance-month-year-close-integration.test.mjs`; Browser-/Bildgate bleibt extern.

### Seitendialoge für Entscheidungen

Snapshot-Restore/-löschung, Legacy-Periodenwahl und Ausgabenreset/-löschung verwenden `app/shared/page-dialog.js`: konkrete Aktionsknöpfe, Abbruch/Escape vor Mutation und kontrollierte Öffnungsfehler. Snapshotumfang, Recovery-, Flush-, Retry- und Reloadbedingungen bleiben erhalten. Monats-/Jahresabschluss, Handlungsplan und Ausgabendetails behalten ihre eigenen Fachdialoge. `page-choice-dialog.js` nutzt den gemeinsamen Lebenszyklus für die Personenumstellung und Probelaufende; deren Texte sind ausdrücklich „Übernehmen“/„Später“ beziehungsweise „Probelauf beenden“/„Weiter testen“. Browser-/Bildabnahme bleibt extern offen.


### Archivrestore über gemeinsamen Plan (Paket 14, Slice 2)

`StorageManager.restoreSnapshot` delegiert an `app/shared/snapshot-restore.js`.
Vorschau und Ausführung verwenden `buildSnapshotRestorePlan`: Standard erhält
andere Profile, technische Einstellungen, Tageskurse, Verlaufsbeginn,
Sicherungsmetadaten und Archiv. Vollimport- und Personenumstellungs-Recovery
behalten ihren jeweils größeren bestehenden Rücksetzbereich. Der interne
Importrollback verwendet denselben Plan mit seinem bisherigen profilfreien
Fallback. Vor Benutzer-Restore entsteht ein vollständig zurückgelesener Punkt
„vor Zurückholen“, der Profilstand und vorherige aktive Auswahl im gleichen Umfang
wiederherstellbar macht. Stale Vorschau, Snapshot-/Quelländerungen und fehlender
Vorflush stoppen vor Zielmutation; Zielwritefehler nutzen den bestätigten
transaktionalen Rollback. Unbestätigter Rollback/Reload sperrt die alte UI.

Die vollständige eingebettete Vorschau und konservatives Aufräumen sind unter
`Daten-Sicherung.html` erreichbar. Die Balance-Bestätigung erläutert Standard,
größere Recovery und Rückkehrpunkt und verweist für die genaue Vorschau dorthin.
Anlässe stammen aus dem Archiv: Jahresabschluss und Personenumstellung dauerhaft,
Monatsabschluss mit eigenem Kind sowie kompatible alte Monatslabels, Import,
manuell und Probelauf. Probelauf-Rückkehr bleibt ausschließlich beim Probelauf.

Nachweise: `snapshot-restore`, `snapshot-retention`, `data-restoration`,
`balance-storage-contract`, `balance-binder-snapshots`, `overview-storage` und
`persistence-write-navigation`. Der registrierte Browserfall wird extern gefahren.

### Dateiaustausch und Sicherungsseite

`balance-file-service.js` übernimmt Export und Importtransaktion für Balance und
Daten & Sicherung. `evaluateBalanceFileInputs` ist deren gemeinsamer Enginepfad;
PREVIEW/PERSIST_INPUTS, bestehende Validatoren, Recovery, Replace und Rollback bleiben
verbindlich. Der alte Sicherungskasten ist entfernt. Suite-Navigation und Alt+E/Alt+I öffnen
die zentralen Austauschwege; der alte Hash `#snapshot-management` führt geschützt
zu Wiederherstellungspunkten. Die bisherige Ordnerverbindung bleibt auf der Sicherungsseite erreichbar. Jahres-Recovery übergibt die
konkrete Archiv-ID an die Sicherungsseite. Fachliche Jahresfortsetzung mit Handkurs
bleibt im vorhandenen Jahresprozess.


### P14b: Zentrale Sicherung ohne Balance-Karte

`openBalanceDataTarget()` in `balance-binder.js` bedient den vorhandenen
Handoff mit einem kurzlebigen echten Link. Alt+E/Alt+I fokussieren
`Daten-Sicherung.html#dataBalanceExport` beziehungsweise `#dataBalanceImport`;
die Zielseite klappt „Weitere Austauschwege“ auf. Jahres-Recovery und die
Fortsetzungssperre übergeben die konkrete Archiv-ID mit `?punkt=`.
`balance-main.js` leitet den alten Hash `#snapshot-management` initial und
bei `hashchange` geschützt nach `#wiederherstellung` weiter. Ohne alte
Ordner-/Listencontrols wird deren Initialisierung nicht gestartet.

Die zentrale Vorschau bestätigt ausstehende Writes vor dem Read; sie erzeugt
keine Recovery und schreibt kein Restoreziel. Flushfehler stoppen die Vorschau,
echte spätere Änderungen invalidieren sie weiter. Vorschau und Bestätigung
verwenden unverändert denselben Scopeplan, die Recovery vor Zielwrite und den
bestehenden transaktionalen Replace-/Rollback-/Reloadvertrag.

### H2: Gemeinsamen Plan kennzeichnen

`Balance.html#balancePlanSource` steht vor den lesenden Planfeldern:
„Aus Haushalt & Plan – gilt für Balance und Simulator. Hier lesend oder als flüchtiger Versuch.“ Der Link zu `depot-tranchen-manager.html#haushalt-plan` nutzt
den vorhandenen bewachten Profilhandoff ohne Export. Der gemeinsame Versuchsbesitzer schützt die Vorschau vor Eingabe- und Summarywrites;
die bestätigten Import-, Vermögens- und Abschlusswege bleiben erhalten. Simulatorversuche sind flüchtig; nur
bewusste Übernahme aktualisiert denselben gemeinsamen Plan. Nachweise:
`tests/balance-household-plan.test.mjs`, `tests/balance-smoke.test.mjs` und der
registrierte Max/Erika-Durchstich „Haushalt und Plan Manager und Belegvergleich“ im Browser-Smoke.


## Speicherbasierter Balance-Eingabebau

`balance-input-storage.js` stellt `buildBalanceEngineInputFromStorage({ scope, storage })`, `projectStoredHouseholdInputs()` und `buildStoredProfileEngineInput()` bereit. Der injizierte Rohrecordadapter und der validierte Rechenumfang bestimmen die Quelle; DOM, Fensteraggregate, Entprelltimer und vorgemerkte Metadaten sind keine Leserquellen. `readerInputData` entspricht dem alten Reader, `inputData` enthält zusätzlich Haushaltsextras. `engineInput` und `engineLastState` beschreiben den tatsächlichen Engine-Aufruf; `lastState`, `householdLastState`, `profileInputs`, `persistentState`, `history`, `householdPlan` und die Basis-/Quellenfingerprints halten die isolierten Eingaben und historischen Vergleiche fest. Die Profilattribution bleibt ein Haushaltslauf, keine zusätzliche Profil-Engine-Serie.

`balance-main.js:update()` verwendet den Speicherleser für jeden Lauf. `UIReader.captureStorageDraft()` ist der Formularbesitzer: Er bestätigt keine Daten während `PREVIEW`; schreibende Modi übernehmen valide Plan-/Nichtplanwerte samt Depotmetadaten vor der anschließenden Rechnung. Das optionale `balanceInputFields` im vorhandenen Balance-State bewahrt unterstützte Nichtplan-Rohwerte. Im leeren Demo-Bestand bleiben Personenfelder formulargeführt und werden ebenfalls darin bestätigt; reguläre Profile verwenden weiterhin ausschließlich ihre zentrale Personenprojektion. Nur `PREVIEW` fordert die zusätzliche unveränderte Speicherbasis an, damit gültige Formularkorrekturen einen ungültigen Altstand bestätigen können. Ergebnis- und LastState-Writes folgen erst nach erfolgreicher Rechnung und erneuter Quellenprüfung. Der Guardrail-Reset verwendet die historische Basis vor der Eingabebestätigung und erhält den Steuerstate.

`loadProfilverbundProfiles({ storage, status })` erlaubt den expliziten Speicher-/Personenanschluss; der bisherige direkte Seitenpfad bleibt verfügbar. `runProfilverbundProfileSimulations()` erhält optional `{ engineApi, withdrawalMode }`, damit produktive Rechenaufrufe den bestätigten Modus und den gebundenen Engine-Vertrag verwenden. Globale Profilverbundwerte dienen weiterhin der Anzeige, bestimmen aber nicht den Speicherleser. Mindest-Flex bleibt eine Validierung, keine Begrenzung. Jahresbelege werden bei gewöhnlichen Eingaben nicht geschrieben. Die transaktionale Jahresfortschreibung verwendet diesen Leser ebenfalls.

## Speicherbasierter Jahresabschluss (H3)

`computeAnnualPlanUpdate()` liefert ohne DOM, Abruf oder Livewrite den Jahresentwurf: fünf Bedarfswerte mit bisheriger Rundung, Inflation/Faktor/Marker, Januaralter, Kursrotation, ATH und CAPE samt Herkunft. `evaluateStoredAnnualHousehold()` nutzt den produktiven Haushaltslauf ohne Fensterpublikation. `evaluateAnnualDraft()` berechnet Empfehlung und optionalen validierten Planpatch von derselben historischen Basis.

`prepareAnnualCommitRecords()` führt `COMMIT_PERIOD`, Profile, gemeinsamen Plan, Ausgabenjahr, tatsächlichen Cashstand, Verlauf und Summary isoliert zusammen. `commitAnnualPlanUpdate()` bestätigt genau einen fachlichen transaktionalen Write mit Jahresbeleg und endgültigen Metadaten. Der Snapshotbinder besitzt Recovery-Snapshot und technische Phasen; Profil-/Umfangs-/Mitgliedschafts-/Rohbyteabweichungen verhindern den Commit. Fehler verlangen vollständigen bestätigten Rollback; unbestätigte Rücknahme sperrt weitere Writes. `finalizeAnnual()` bleibt für technische Kompatibilität, wird im produktiven Jahrespfad nicht nachgeschaltet.

Das Ausgaben-Auswahljahr wird ausschließlich im isolierten Jahresentwurf mit `setExpensesActiveYear(draft.planningYear, adapter)` auf das Folgejahr der bestätigten Abschlussperiode gesetzt und mit demselben fachlichen Jahreswrite bestätigt. Maßgeblich ist Abschlussjahr + 1, nicht das zuvor gespeicherte `activeYear`: Dieses darf bereits das Folgejahr sein und ist keine zusätzliche Periodenvoraussetzung. Beim Einstieg über `?year=2026#jahresabschluss` gilt die Abschlussperiode 2026, während gespeichert weiterhin 2027 steht; der bestätigte Abschluss setzt 2027 ohne Doppelsprung. Es gibt keinen vorgeschalteten Write zur Angleichung von Ansicht und Speicher. Vorhandene Monats-/Kategoriedaten bleiben erhalten; Storekorruption, Quellenabweichungen und bereits bestätigte Perioden behalten ihre bestehenden Schutzprüfungen.

Der Belegschreiber `app/profile/annual-plan-record.js:buildAnnualPlanRecord()` schreibt selbst nichts. Planungsjahr ist Abschlussjahr + 1, Periodenkennung das tatsächliche Abschlussjahr; H1-Gleichjahrbelege bleiben lesbar. Ohne Anpassung sind Empfehlung und Beschluss samt Momentaufnahme bytegleich. Monatsbetrags-Overrides und ungültiges Mindest-Flex sind unzulässig. Vorabschluss-Restore setzt Plan, Beleg, Profile, Marker und Verlauf gemeinsam zurück. Gewöhnliche Vorschau/Planänderung schreibt keinen Beleg. Die bestätigte UI-Projektion lädt Plan und State und stellt das bestätigte Ergebnis lesend dar; ein Ausgaben-DOM wird nicht benötigt. Schritt 6 erlaubt bewusste Anpassungen vor der Jahresbestätigung.

`tests/balance-smoke.test.mjs` führt den beim echten Seitenstart gebundenen Snapshothandler durch `handleJahresabschluss()` aus, einschließlich produktivem Commit, UI-Projektion und `update({ mode: PREVIEW, confirmedAnnualResult })`. Der aufzeichnende Backendadapter zählt ab `writes_started` jeden Batch mit State-, Plan-, Beleg-, Registry-, Ausgaben-, Summary- oder Cashkeys. Ausschließlich reine Metadaten-Phasenwrites sind ausgenommen; ihre übrigen Statebytes müssen unverändert sein. Ein während des Jahreswrites eingesetzter Eingabetimer, die bestätigte DOM-Anzeige und der anschließende Timer-/Flush-Nachlauf sichern genau einen gemeinsamen Fachbatch ab. Ein zusätzlicher Summarywrite ohne Beleg lässt diese Probe scheitern.

## Gemeinsamer Jahresdienst und Dialog (H4)

- `../shared/annual-coordinator.js`: DOM-freier Jahresablauf, Guardphasen, Snapshotreadback und einmalige Handkurswiederaufnahme.
- `../shared/annual-engine-loader.js`: einmaliger dynamischer Engine-Ladeauftrag mit bestehendem API-Handshake.
- `../shared/annual-marketdata.js`: gemeinsame lesende ETF-/CAPE-/Inflationsvorbereitung.
- `../shared/annual-operation-lock.js`: atomarer Jahresbesitz, vor dem kurzlebigen Persistenz-/Probelaufwriter erworben; schützt auch Monatswrites und Probelaufübergänge.
- `../shared/annual-close-session.js`: flüchtiger Entwurf und anschließende Monatssitzung aus bestätigtem Plan; `balance-close-coordinator.js` reexportiert die vorhandenen Importnamen.

Der Balanceadapter veröffentlicht das aktuelle Ergebnis und gibt `btnJahresUpdateLog`
gemeinsam frei. UIfehler nach Jahresreadback bewahren den bestätigten Abschluss.
Der Koordinator übergibt `confirmAnnual` die Cashpersonen aus dem geprüften
Planumfang über `captureCashPeople` mit dem injizierten Speicheradapter; Außenprofile
bleiben ausgeschlossen. Bewusste Vorbereitungsabbrüche liefern `cancelled`, ohne
den Jahresfehlerkanal zu setzen. Pending- und Finalisierungsphasen bleiben bis zum
Handlerende gegen Navigation, Restore und einen zweiten Abschluss gesperrt.
`createAnnualOrchestrator` ist produktiv entfernt und nur im unabhängigen Legacytesthelfer
vorhanden. Der gemeinsame Koordinator schließt genau die fachliche Periode J ab, unabhängig vom Ausgaben-Ansichtsjahr; ungültige Quellen und
Recovery bleiben vor Fachwrites gesperrt. Die Startseite ist über `overview-annual-close.js` direkt an denselben Dialog angebunden.

- `../shared/annual-close-dialog.js`: gemeinsamer Renderer für sechs Vorbereitungen und Ergebnis C; Balanceadapter enthält nur Seitenkanäle.
- `../shared/annual-plan-editor.js`: flüchtige Planfelder, gleiche Sichtbarkeit/Validierung wie Haushalt & Plan, Revisionsschutz und Verwerfen.
- `../overview/overview-annual-close.js`: tatsächlicher Startseitenbinder einschließlich Protokoll, Jahresbesitz, Monatsfortsetzung und Handkurs-Recovery.

Beide Binder geben den bestätigten Planpatch an `commitAnnualPlanUpdate` weiter. Der berechnete Monatsbetrag bleibt Ausgabe. Jahresreadback muss abgeschlossen sein, bevor der Monatswriter beginnt. Cash wird unverändert übernommen; Monatsfehler oder Dialogschluss lassen das bestätigte Jahr bestehen. Monatsretry bestätigt ausschließlich den Monat.

### H5: Gemeinsamer Planhinweis und erneuter Jahresabschlussstart

`UIReader.applyHouseholdPlanInputs()` projiziert den gemeinsamen Plan weiterhin
bearbeitbar ohne Simulatorherkunft oder grauen Übernahmezustand. Echte fachliche
Inaktivität und übernommene Personen-/Vermögenswerte behalten ihre Besitzerzustände.
Die Herkunft steht einmal im vorhandenen `#balancePlanSource`-Hinweis.

`balance-binder.js` meldet bei `already_committed` ohne `results` genau einen
Info-Toast „Die Jahresperiode <J> wurde bereits abgeschlossen.“ aus `periodId`.
Ein neuer Erfolg mit `results` öffnet unverändert Ergebnis-/Monatsdialog und
erhält keinen Doppelhinweis. `balance-close-coordinator` und
`overview-annual-close` messen die tatsächlichen Seitenbinder einschließlich
Dialog-, Backend-, Batch- und Snapshotgegenproben. Koordinator und Speichervertrag
bleiben unverändert; Browserabnahme erfolgt extern.


### Eigenständige Ausgaben (AU1)

Die sieben Suite-Einstiege sind `index.html`, `depot-tranchen-manager.html`,
`Ausgaben.html`, `Balance.html`, `Simulator.html`, `Handbuch.html` und
`Daten-Sicherung.html`. Die Navigation folgt dieser Reihenfolge.
`app/expenses/` besitzt den Seiteneinstieg, die lesende Jahres-/Personenprojektion,
Kategorien, Kennzahlen und die Anbindung an den gemeinsamen Monats-/Jahresdialog.
Die Import-, Speicher-, Recovery- und Jahresvergleichsdienste unter
`app/balance/balance-expenses*.js` bleiben gemeinsam importierbar; bestätigte CSV-
und Beispielimporte nutzen ausschließlich D5. Budgets stammen aus passenden
übernommenen Jahresbelegen oder passenden vorläufigen Zusammenfassungen.
Ansicht und Filter schreiben weder Ausgaben noch Jahresplan und benötigen keine
Balanceberechnung.

Balance enthält Überblick, Bedarf & Strategie und Diagnose. Seine
Ausgabenübersichtszeile verlinkt das Planjahr und liest dieselbe Budgetprojektion.
Vermögensverlauf und „Stand jetzt erfassen“ liegen in Personen & Vermögen. Der
Abschlusskontext benötigt keinen Ausgaben-DOM und erhält seine Periode vom
gemeinsamen Jahreskoordinator.
Alte Balanceziele `#ausgaben`, `#ausgaben-import` und gültige `?year=…&month=…`
ohne Hash leiten geschützt auf `Ausgaben.html` weiter; der initiale Altlink wird
vor Berechnung und Planmigration in der Browserhistorie ersetzt. Ungültige und
doppelte Parameter bewirken keine Ausgabenaktion. Abschluss-/Handlungslinks
bleiben Balanceziele. Der bestehende Dist-Sync übernimmt die neue Root-HTML-Datei
und ihre lokalen Module/CSS/Assets automatisch; Tauri besitzt keine Seitenliste.

`UIBinder.initializeExpensesNavigation()` installiert nach Profilbereitschaft den Altlink-Handler und bearbeitet initiale Ausgabenziele vor Planmigration und Engine-Start. Ein gültiges initiales Ziel stoppt den Balance-Start auch bei verweigerter Navigation. `UIBinder.openOverviewTarget(requestedLocation, { ready })` verwendet ausschließlich das übergebene Ziel; Ablehnung und Jahreszugang liefern `boolean`, Ausgabenziele `Promise<boolean>` für den bestätigten geschützten Seitenwechsel. Aufrufer verwenden `await`; `init()` wartet ebenfalls auf dieses Ergebnis.

### Abschlussdialog: lokale Prüfschritte (AU1a, Slice 1)

`close-dialog.js` trennt fachliche Zustände von der geöffneten Ansicht. Schrittköpfe
und Weiter sind schreibfrei; `not_applicable`/`skipped` bleiben neutral. Der gemeinsame
Renderer erhält Kursaktionen über die Seitenbinder. `close-price-actions.js` wartet
auf einen laufenden Startupauftrag und nutzt denselben `runStartupPriceRefresh()`-
Guard-/Commitpfad, ohne den einmaligen Sitzungsmerker zurückzusetzen. Währenddessen
sind Abschlussaktionen gesperrt. Profil-, Umfangs-, Datumswechsel und Abbruch verwerfen
veraltete UI-Fortsetzungen; Entwurfsfelder behalten ihre Identität.

`overviewPricesDone()` verlangt eindeutige relevante Tranchen und gültige, nicht
zukünftige Kurszeiten. Ein vollständiger heutiger Speicherbericht, der letzte
Montag–Freitag-Kalendertag vor heute oder das abgeschlossene Periodenende kann den
Kursstand belegen. Ein fremder Profilfehler wird nicht zur Haushaltslücke. Es gibt
keinen zusätzlichen Börsenfeiertagskalender und keine Änderung der synthetischen Kurve.
Budgetquellen stammen aus `readExpensesBudget()` für den tatsächlichen Abschlussmonat;
fehlend, ungültig und Nullbudget werden getrennt dargestellt. Lokale Ausgabendetails
lesen Personenrecords einschließlich Kategorien. Balance verwendet für seinen Status
wie die Startseite `projectOverviewFromRecords()`; die Erstplanjahresgrenze bleibt erhalten.

Gezielte Node-/DOM-Nachweise liegen in den Abschluss-, Modell-, Kursaktions- und
Importtests. Browserfolgen auf Startseite und Balance sind registriert; die externe
Browser-/Tauri-Abnahme steht noch aus.

### Jahresvorbereitung und Monatsübergang (AU1a, Slice 2)

`annual-close-dialog.js` zeigt gültige Tagesgeldentwürfe als `entered` mit Haken und
Speicherhinweis. Die drei Jahresmarktdaten werden beim Öffnen vorbereitet; plausible
Handergänzungen in `annual-marketdata.js` liefern dieselben Ergebnisformen und
Herkunftsangaben für Vorschau und Jahresdienst. Handfelder ergänzen nur fehlende
Abrufe; späte erfolgreiche Antworten verdrängen keine eingetragenen Handwerte.
`annual-close-session.js` übernimmt
den bestätigten vorbereiteten Datensatz, ohne eine weitere Speichergrenze einzuführen.
Fehlende Pflichtwerte erhalten konkrete Fehler und Schrittsprünge; laufende
Planrechnungen sperren die Jahresbestätigung. Offene Empfehlungen bleiben optional.

Schritt 6 hat keinen Weiterknopf. Die einzige Bereitschaft steht über dem Hauptknopf:
Besuche aller sechs Schritte, Tagesgeldbestätigung und Pflichtwerte sind erforderlich;
Import, Busy und Recovery sperren zusätzlich. Teilimporte bleiben bei Ausgaben und nennen
fehlende Personen; Budget zeigt `partialSpent`. Erst vollständige Personenrecords des
Abschlussmonats öffnen Budget, unabhängig vom Jahresvollständigkeitsstand der Startseitenkarte.
Der Importbinder darf keinen Hauptknopf eigenständig freigeben. Die Vorab-Sicherung bleibt
nach dem Jahreswrite ausgeblendet. Retry und Recovery bewahren Jahresrecord und Planbeleg.
Die vorhandenen Stores, Snapshots und verspäteten Bereitstellungsmonate bleiben maßgeblich.
Node-/DOM-Gates sichern diese Übergänge; Browserfolgen und Bilder sind extern abzunehmen.

## Gemeinsame Dynamic-Flex-Voreinstellungen

`app/shared/dynamic-flex-presets.js` ist die einzige Presetquelle für Balance,
Simulator, Manager und Abschlusseditor: Aus, Konservativ, Ausgewogen, Offensiv,
Benutzerdefiniert. Sie erzeugt ausschließlich bestehende Dynamikfelder; die
Langlebigkeitsdefaults stammen weiterhin aus
`app/simulator/dynamic-flex-longevity-contract.js`. Die Erkennung ist lesend:
Aus gilt unabhängig von erhaltenen Details; aktive Presets vergleichen sieben
Felder mit Toleranz `1e-9`, sonst gilt Benutzerdefiniert. Inaktive
Langlebigkeits-Unterwerte beeinflussen die Erkennung nicht.

`app/shared/household-plan-dynamic-flex.js` bindet die fünf Segmente in Manager
und Jahreseditor. Feste Presets verbergen die Details und zeigen
„Voreinstellung gilt; Details sind ausgeblendet.“. Aus → Benutzerdefiniert
setzt nur `dynamicFlex = true`, erhält vorhandene Details und validiert auch
noch offene Eingaben im selben Batch. Bei aktiver Dynamik öffnet Benutzerdefiniert
nur die Details; diese Absicht bleibt lokal bis zum Neuladen oder Verwerfen.
Die native An/Aus-Kontrolle ist dort verborgen, Ausschalten erfolgt über Aus.
Sperren, fachliche Feldabhängigkeiten, Retry und Rücknahme bleiben erhalten.

Der Manager bestätigt den gesamten Batch über seinen entprellten Autosave.
Der Simulator liest den bestätigten Plan; Presetänderungen im Versuch bleiben
flüchtig bis zur ausdrücklichen Übernahme. Der Jahresabschluss ändert nur den
Entwurf über `createAnnualPlanDraft.changeBatch`: eine Revision und eine aktuelle
Berechnung, ältere Resultate werden entwertet. Abbruch/Verwerfen speichert nichts;
ausschließlich die vorhandene Abschlussbestätigung übernimmt den
`adoptedPlanPatch`. Es gibt keine neue Presetkennung im Plandatensatz und keinen
neuen Persistenzkey; CAPE-Provenienz und übrige Planfelder bleiben erhalten.

Node-Belege: `tests/dynamic-flex-presets.test.mjs`,
`tests/household-plan-fields.test.mjs`, `tests/tranchen-manager-page.test.mjs`,
`tests/annual-plan-editor.test.mjs`, `tests/simulator-dynamic-flex-persistence.test.mjs`
und `tests/balance-dynamic-flex-gate.test.mjs`. Browserfälle:
„Dynamic Flex Voreinstellungen seitenübergreifend“ und
„Dynamic Flex Voreinstellungen im Abschlussentwurf“.

Bei ausgeschalteter Dynamik und bereits offener Balance-Parameterklappe bleibt
der bestehende native Customwert als lokale Detailabsicht erhalten. Die sichtbare
Presetprojektion zeigt trotzdem das gemeinsam erkannte Aus; Lesen verändert
weder Details noch native Sperren. Dieser Darstellungsvertrag ist durch
`tests/designsystem-balance.test.mjs` zusätzlich abgesichert.

### AU1c: Ein Hauptklick und belegte Altperioden

`annual-close-session.js:finalizeAnnualMonth()` verbindet auf Startseite und Balance
den bestätigten Jahreswrite mit dem bestehenden Monatswriter. Derselbe Tagesgeldstand
wird einmal bestätigt und zweimal unverändert verwendet; Jahr und Monat haben
getrennte verifizierte Wiederherstellungspunkte. Der Monatsbetrag erscheint anschließend
einmal im Ergebnis; es gibt keinen Platzhalterschritt. Eine Überweisung
wird dadurch nicht als ausgeführt bestätigt. Monatsfehler einschließlich eines
Erzeugungsfehlers der Sitzung erhalten Jahr, Inflation, Plan und Beleg; der Retry
erzeugt bei Bedarf die Sitzung neu und speichert ausschließlich den Monat.

`annual-close-evidence.js` ist die gemeinsame reine Belegprüfung. Fehlende
Periodenmetadaten ohne Abschlussindiz erlauben die normale Vorbereitung ohne Popup.
Passende Jahresverlauf-/Planbelege erlauben eine dauerhafte reine Metadatenübernahme.
Alte Alters-/Inflationsschlüssel, teilweise oder widersprüchliche Jahresmarker sowie
ein isolierter Vorabpunkt verlangen zuerst Klärung; Pending-Recovery bleibt vorrangig.
Quellvergleich und einmalig konsumierter ETF-Retry gelten auch für metadatenlose Punkte.
Bei ausschließlich undatierten Altmarkern bestätigt „Noch nicht abgeschlossen“
transaktional einen offenen Periodenstand ohne Finanzwrite. Beide Seitenanschlüsse
können danach normal vorbereiten; Klärungsabbruch beendet sie ohne Jahreserfolg.
Ein vollständig quellgleich zurückgeladener Jahresvorabpunkt blockiert den normalen
Jahresknopf nicht. Der Vergleich umfasst alle Keys der Snapshot-Keypolicy;
Abweichende Finanzquellen sind kein quellgleicher Restorenachweis und verlangen bei markerlosen Vorabpunkten ausdrückliche Klärung; echte Zieljahresteilmarker bleiben gesperrt.
`annual-close-recovery.js` liefert die sichtbare Archivkennung mit vorhandenem
Label und Datum selbst ohne Marktergebnisse; allgemeiner Ladeknopf bei Recovery,
Handkurs zusätzlich nur mit Retrykontext, kein Ladeknopf bei ungültiger Vorprüfung.

Die Monatssummary wird aus allen dauerhaften Mitgliedsrecords bestätigt statt nur
aus dem Liveprofil. Ohne Haushalt wird der geprüfte Einzelprofilumfang verwendet;
fremde Umfänge und Mitgliedschaftswechsel während des Vorflushs bleiben abgewiesen.
Veraltete Anzeigen nicht geöffneter Außenpersonen blockieren einen bestätigten
Haushaltsabschluss nicht; eine Pendingquelle des geöffneten Writers bleibt vorrangig.

### Ausgaben-Nachzug und Startseitenlead (AU1c, Slice 3)

Die Ankunft auf Ausgaben übergibt Jahr, Monat und Aktion an den Seitencontroller.
Er wählt lesend und fokussiert nur freigegebene Monatsknöpfe der sichtbaren Person;
datenlose Details fallen auf deren Import zurück. Eine Commitsperre hält den
Fokusauftrag bis zur Freigabe. Neuer Nutzerfokus beendet ihn. Auch der gemeinsame
Probelauf-Matrixaufbau erhält die Identität einer zuvor fokussierten Aktion
(Jahr, Monat, Person), ohne Dateidialog oder Finanzwrite.

`css/expenses.css` reserviert einen rechtsbündigen tabellarischen Betragsslot;
Herkunftstext bricht innerhalb desselben Slots um. Kategorien verwenden gemeinsame
Wertspalten und gleich breite Spuren, am Handy darunter. Positive Anteile unter
0,5 % erscheinen als `< 1 %`; Null und Erstattungen behalten ihre Bedeutung.
Beispielimporte stehen nur im bestätigten Probelauf auf Ausgaben je Person/Jahr/
Monat sowie im Ausgabenschritt des Abschlussdialogs zur Verfügung.

Der Startseitenlead nennt heutige Kurse nur bei vollständigem, gültigem Abrufbericht
mit heutigem Abruf-/Kursdatum. Ein gespeicherter heutiger Stichtag allein genügt
nicht. Kursfrischeprüfung, Pflichtdaten und Rechenregeln bleiben unverändert.
Nodebelege liegen in `expenses-page`, `expenses-navigation`, `overview-ui` und
`designsystem-balance`. Der Browserfall „Ausgaben Monatsaktionen und Kategorien“
misst echte Kanten bei 1366/1920 px und den Handyumbruch bei 390 px, jeweils im
Normalbetrieb und Probelauf. Browser-/Bildabnahme und volle Suite bleiben externe
Prüfungen der Steuerung beziehungsweise des Orchestrators.

### Sichtbare Klärung nach Jahresvorabpunkt und Kurswrite (AU1c-Follow-up, Slice 2)

Nach einem abgebrochenen Jahreslauf oder dem vollständigen Restore eines markerlosen
Jahresvorabpunkts kann ein späterer Kurswrite in `depot_tranchen` und der Registry den
quellgleichen Vorabstand verändern. Der archivierte Vorabpunkt beweist keinen
Jahresabschluss. Startseite und Balance zeigen dann vor der normalen Vorbereitung
„Jahresstatus klären“; Balance kennzeichnet den Jahresstatus zusätzlich als ungeklärt.
Die initiale Archivlesung und das Rendern bleiben lesend und öffnen kein Popup.

Erst die Nutzeraktion öffnet die gemeinsame Jahresklärung. „Noch nicht abgeschlossen“
bestätigt bei einem isolierten markerlosen Vorabpunkt ausschließlich offene
Periodenmetadaten und führt einmal in die vollständige normale Vorbereitung. Der
anschließende Coordinatorabschluss fragt nicht erneut. Abbrechen beendet den Weg ohne
Vorbereitung, Metadatenübernahme, neuen Snapshot oder Fachwrite. Echte Teilmarker des
Zieljahres erlauben weiterhin keine Offenfreigabe; Pending-Recovery hat Vorrang.
Ein vollständig quellgleicher Restore bleibt dagegen ohne diese Zusatzfrage offen.

Beide Seiten verwenden bestätigte Archivpayloads für Profil, Umfang und Abschlussjahr.
Ausstehende oder fehlerhafte Lesungen geben den markerlosen Jahresstand nicht normal
frei; veraltete Antworten nach Kontextwechsel werden verworfen. Aktuelle Finanzrecords
werden bei jeder Projektion erneut klassifiziert, auch bei unveränderter Archivliste.
Ein Nutzerstart prüft das Archiv erneut und erreicht die aktuelle Klärung auch aus
einer veralteten offenen Anzeige. Beide Jahreseinstiege erneuern die gemeinsame
Archivevidenz zusätzlich nach jedem beendeten Versuch (`cancelled`, `invalid`,
`incomplete_recovery` und `already_committed`), auch nach früher Vorbereitung,
Ausnahme oder Wiederaufnahme. Nach der Lesung wird die jeweilige Anzeige automatisch
lesend aktualisiert; ein paralleles `in_flight` beginnt keinen weiteren Versuch.
So kennt die geöffnete Seite einen gerade gespeicherten Vorabpunkt auch dann, wenn
der Versuch vor dem Metadatenstart endet. Ein späterer bestätigter Kurswrite führt
beim reinen Rendern ohne Reload oder weiteren Jahresklick zu „Jahresstatus klären“.
Die Nachlesung öffnet keinen Dialog und schreibt weder Finanzdaten noch Archivpunkte;
sie ersetzt keinen Ergebnisstatus und keine ursprüngliche Ausnahme. Fehlerhafte oder
veraltete Readerantworten geben keine normalen Jahresaktionen aus alten Payloads frei.
Erfolg und begonnener Teilfehler behalten ihren Abschluss- beziehungsweise Recoverystatus.
Snapshot-/Restoreformat, Engine-Semantik, Fachcommit
und geschützter ETF-Retry bleiben unverändert. Der registrierte Browserfall
„Jahresabschluss abgebrochener Vorabpunkt auf derselben Seite“ prüft den Fehler vor
dem Metadatenstart und den Folgewrite auf beiden Seiten;
„Jahresabschluss Vorabpunkt nach Kurswrite“ ergänzt „Jahresabschluss Altdaten ohne Popup“
und „Jahresabschluss Jahr und Dezember“; die Browserausführung erfolgt außerhalb der
Agenten-Sandbox.

## Balanceversuch und gespeicherte Jahresinflation (AU1d, Slice 3)

`balance-plan-trial.js` projiziert Balance-IDs auf `HOUSEHOLD_PLAN_FIELDS` und benutzt
`app/shared/plan-trial.js` als gemeinsamen Besitzer mit dem Simulator. Beide
Kartenköpfe und das kompakte Band schalten denselben Versuch. Alle Planfelder
bleiben außerhalb des Versuchs lesend, einschließlich Budget-, Reserve- und
Dynamikdetails. Gold-Umschichtungsband ist eine zusätzliche flüchtige Profilabweichung;
dauerhafte Goldpflege bleibt im Manager. Nur ausdrücklich ausgewählte gültige
Planfelder werden über `patchHouseholdPlan` übernommen.

`update` erzwingt im Versuch `PREVIEW`, überspringt den gesamten Summary-Schreibblock
und veröffentlicht keine Profil-Ergebnisaggregate. Reader und Rohrecordadapter
bauen denselben isolierten Planpatch für Einzelprofil und Haushalt. Entprellte
Ereignisse und Navigationsvorbereitung schreiben keinen Versuch. Rückkehr und
bewusste Übernahme rechnen erneut mit dem aktuellen Plan; ein Abschluss setzt
vor der Vorbereitung auf die Planbasis zurück.

`balance-inflation-source.js` liefert beiden Eingabebauern und der Anzeige den
zum Bereich und zur Jahresperiode passenden `adopted.snapshot.inflation`-Wert.
Das angezeigte Jahr folgt `periodId`. Ohne Beleg bleibt der gespeicherte Jahres-
oder Altstand lesbar; fehlende Herkunft wird nicht ergänzt. Die neue Jahresrechnung
mit ausdrücklichem `referenceYear` verwendet weiterhin ihre vorbereitete Ersatzrate,
wenn es für die neue Periode keinen Beleg gibt. DOM-Inflation ist keine Rechenquelle.
Nachweis: `tests/balance-plan-trial.test.mjs`, einschließlich echter Engine,
Binderereignissen, Entprellung und Speichervergleich nach Flush.
