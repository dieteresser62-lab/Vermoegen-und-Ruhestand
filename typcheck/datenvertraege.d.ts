/** Gelesene Speicherverträge (Code vor Doku). Keine Laufzeit und keine Migration.
 * Euro und Cent sind hier dokumentierte Zahlen, keine umrechnenden Typen.
 */
export type Euro = number;
export type SignedEuro = number;
export type Cent = number;
export type IsoDate = string;
export type YearMonth = string;
export type StringRecords = Record<string, string>;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json | undefined };
export interface RecordStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): unknown;
    removeItem(key: string): unknown;
    key(index: number): string | null;
    readonly length: number;
}
export type RecordReader = Pick<RecordStorage, 'getItem'>;
export type RecordWriter = Pick<RecordStorage, 'getItem' | 'setItem'>;
export type KeyPolicy = (key: string) => boolean;

/** Feste Keys plus ausdrücklich zugelassene Präfixbereiche; Zulassung bleibt Keypolicy. */
export interface PersistenceContents {
    rs_profiles_v1: ProfileRegistry | ProfileRegistryAlt;
    rs_current_profile: string; rs_active_profile: string; rs_profile_live_base_v1: ProfileLiveBase;
    household_plan_v1: HouseholdPlanRecord;
    annual_plan_record_v1: AnnualPlanRecord;
    household_planned_expenses_v1: PlannedExpensesRecord;
    household_partnership_v1: PartnershipRecord;
    household_care_values_v1: HouseholdCareValues;
    household_care_forms_notice_v1: "pending" | "shown";
    household_withdrawal_mode: PlanValues["householdWithdrawalMode"];
    household_simulator_needs_v1: HouseholdSimulatorNeedsAlt;
    household_simulator_needs_warning_ack_v1: string;
    balance_expenses_v1: ExpensesStore | ExpensesStoreAlt;
    overview_balance_summary_v1: OverviewRecord<BalanceSummary>;
    overview_month_provision_v1: OverviewRecord<MonthProvision>;
    overview_last_full_backup_v1: string;
    rs_data_backup_summary_v1: BackupSummary;
    profile_health_bucket: HealthBucket;
    profile_cash_history_v1: CashHistory;
    profile_tagesgeld_confirmed_date: IsoDate;
    profile_planned_inflows_v1: PlannedInflowsAlt;
    profile_aktuelles_alter: number; profile_sonstige_einkuenfte: Euro;
    depot_tranchen: (Tranche | TrancheAlt)[];
    rs_probelauf_state_v1: ProbelaufState | ProbelaufStateAlt;
    ruhestandsmodellValues_v29_guardrails: BalanceState;
    rs_snapshot_archive_v1: SnapshotListArchive;
    profile_geburtsdatum: IsoDate; profile_geschlecht: 'm' | 'w' | 'd';
    profile_rentenbeginn: IsoDate; profile_rentenanpassung_art: 'wage' | 'cpi' | 'fix';
    profile_rentenanpassung_pct: number; profile_kirchensteuer_pct: number;
    profile_sparer_pauschbetrag: Euro; profile_rente_steuerquote_pct: number;
    profile_person_schema_version: '1'; profile_person_migration_v1: { referenceYear: number; [key: string]: Json };
    profile_rente_aktiv: boolean; profile_rente_monatlich: Euro; profile_tagesgeld: Euro;
    profile_einkuenfte_v1: { schemaVersion: 1; entries: IncomeEntry[] };
    profile_einkuenfte_migration_v1: '1'; profile_rente_bezeichnung: string;
    profile_care_grade_today: 0 | 1 | 2 | 3 | 4 | 5;
    profile_care_progression: 'usual' | 'slower' | 'much_slower';
    profile_care_form_today: 'family' | 'home-support' | 'residential' | 'external';
}
export type PersistenceKey = keyof PersistenceContents | `sim_${string}` | `sim.${string}` | `ruhestandsmodell_snapshot_${string}` | `balance_expenses_${string}`
    | 'depot_tranchen' | 'household_care_values_v1' | 'household_care_forms_notice_v1'
    | 'overview_simulation_summary_v1' | 'rs_data_backup_summary_v1' | 'rs_wealth_history_start_v1'
    | 'rs_daily_prices_v1' | 'rs_household_wealth_captures_v1' | 'rs_probelauf_state_v1'
    | 'etfProxyUrl' | 'etfProxyUrls' | 'enableWorkerTelemetry' | 'featureFlags'
    | 'profile_gold_aktiv' | 'profile_gold_ziel_pct' | 'profile_gold_floor_pct' | 'profile_gold_steuerfrei' | 'profile_gold_rebal_band'
    | 'profile_care_additional_monthly' | 'profile_care_allowance_as_income' | 'profile_immobilien_v1' | 'profile_wealth_history_lots_v1'
    | 'migration_v29_inflation_sanitized' | 'ruhestandsapp_migrated_to_target'
    | 'ruhestandsapp_migration_completed_at' | 'ruhestandsapp_migration_checksum'
    | 'showCareDetails' | 'logDetailLevel' | 'worstLogDetailLevel' | 'backtestLogDetailLevel';
/** Alte Einzelwerte bleiben als Strings lesbar; bestätigte Personendaten haben Vorrang. */
export interface PersonRecordsAlt {
    profile_aktuelles_alter?: string; profile_sonstige_einkuenfte?: string;
    profile_planned_inflows_v1?: string; profile_rente_steuerquote_pct?: string;
    profile_care_additional_monthly?: string; profile_care_allowance_as_income?: string;
}
export type PersonRecords = StringRecords & PersonRecordsAlt;
export interface ProfileMeta { id: string; name?: string; belongsToHousehold?: boolean; createdAt?: string; updatedAt?: string; }
export interface Profile { meta: ProfileMeta; data: PersonRecords; [key: string]: unknown; }
export interface ProfileRegistry { version: 1; profiles: Record<string, Profile>; }
export interface ProfileRegistryAlt { version?: 1; profiles: Record<string, { meta: Omit<ProfileMeta, 'id'> & { id?: string | null }; data: PersonRecords }>; }
export interface ProfileLiveBase { profileId: string; data: string; live?: string; }
export interface IncomeOnce { id: string; monat: YearMonth; betrag: Euro; bezeichnung: string; }
export interface IncomeFixed { id: string; art: 'sonstige'; bezeichnung: string; betragMonat: Euro; ab: YearMonth | null; bis: YearMonth | null; anpassung: 'keine' | 'inflation' | 'lohn'; }
export type IncomeEntry = IncomeOnce | IncomeFixed;
export interface PlanScope { kind: 'single' | 'household'; ids: string[]; key: string; }
export interface PlanValues {
    floorBedarf: Euro; flexBedarf: Euro; minimumFlexAnnual: Euro;
    flexBudgetAnnual: Euro; flexBudgetYears: number; flexBudgetRecharge: Euro;
    liquidityRunwayYears: number; liquidityCashMonths?: number; minCashBufferMonths: number;
    maxSkimPctOfEq: number; maxBearRefillPctOfEq: number;
    decumulation: { mode: 'standard' | '3_bucket_jilge'; bondTargetFactor: number; drawdownTrigger: number; bondRefillThreshold: number | null };
    dynamicFlex: boolean; horizonMethod: 'mean' | 'survival_quantile'; horizonYears: number; survivalQuantile: number;
    goGoActive: boolean; goGoMultiplier: number; longevityMode: 'none' | 'quantile_shift' | 'relative_horizon_buffer' | 'buffer_years'; longevityQuantileShift: number;
    jointAssessment?: boolean; longevityRelativePct: number; longevityBufferYears: number;
    householdWithdrawalMode: 'tax_optimized' | 'proportional' | 'runway_first';
    cape: { value: number; asOf: string | null; source: string | null };
}
export interface HouseholdPlanRecord { version: 1; entries: Record<string, { scope: PlanScope; updatedAt: string; values: PlanValues }>; }
export type PlanValuesAlt = Omit<PlanValues, 'liquidityCashMonths'>;
export interface PlannedExpenseBase { id: string; bezeichnung: string; priceYear?: number; priceFactor?: number; }
export interface PlannedExpenseOnce extends PlannedExpenseBase { monat: YearMonth; betrag: Euro; }
export interface PlannedExpenseFixed extends PlannedExpenseBase { betragMonat: Euro; ab: YearMonth | null; bis: YearMonth | null; anpassung: 'keine' | 'inflation'; }
export type PlannedExpense = PlannedExpenseOnce | PlannedExpenseFixed;
export type PlannedExpenseAlt = Omit<PlannedExpenseOnce, 'priceYear' | 'priceFactor'> | Omit<PlannedExpenseFixed, 'priceYear' | 'priceFactor'>;
export interface PlannedExpensesRecord { version: 1; entries: Record<string, { scope: PlanScope; items: PlannedExpense[] }>; }
export interface ExpensePayment { id: string; month: YearMonth; label: string; amount: Euro; scopeKey: string; }
/** FR-68: Euro mit Vorzeichen, Ausgaben negativ; floor + flex entspricht Kategorie. */
export interface CategoryNeeds { floor: SignedEuro; flex: SignedEuro; }
export interface ExpenseEntry {
    categories?: Record<string, SignedEuro | string>;
    categoryNeeds?: Record<string, CategoryNeeds>;
    plannedExpenses?: ExpensePayment[];
    updatedAt?: string; source?: string;
    [key: string]: unknown;
}
/** Vor FR-68: kein Bedarfssplit; endliche Zahlenstrings bleiben als Rohwerte erhalten. */
export interface ExpenseEntryAlt { categories?: Record<string, number | string>; updatedAt?: string; source?: string; plannedExpenses?: ExpensePayment[]; }
export interface ExpenseImportEntry extends ExpenseEntry { categories: Record<string, SignedEuro>; }
/** Die Ladegrenze erhält auch ungültige optionale Splits, statt sie zu migrieren. */
export interface ExpenseEntryRead extends Omit<ExpenseEntryAlt, 'categories'> { categories?: Record<string, number | string>; categoryNeeds?: unknown; }
/** Alte Auswahlcontainer dürfen Monate/Personenlisten noch nicht besitzen. */
export interface ExpensesMonthAlt { profiles?: Record<string, ExpenseEntryRead>; }
export interface ExpensesYearAlt { months?: Record<string, ExpensesMonthAlt>; }
/** Die beiden Speicherhelfer garantieren nur den jeweils angeforderten Container. */
export interface ExpensesMonth extends ExpensesMonthAlt { profiles: Record<string, ExpenseEntryRead>; }
export interface ExpensesYear extends ExpensesYearAlt { months: Record<string, ExpensesMonthAlt>; }
export interface ExpensesStore { version: 1; activeYear: number; years: Record<string, ExpensesYearAlt>; }
export interface ExpensesStoreAlt { version?: 1 | '1'; activeYear?: number | string; years?: Record<string, ExpensesYearAlt>; }
export type ExpensesResult = { status: 'corrupt'; store: null; raw: string | null; error: { code: string; message: string } }
    | { status: 'empty' | 'ok'; store: ExpensesStore; raw: string | null; error: null; diagnostics?: { code: string; year: string; month: string; profileId: string }[] };
export interface ExpenseRecoveryOptions { exportedAt?: string; backend?: string; storage?: RecordWriter; activeYear?: number; rawPreserved?: boolean; quarantineReference?: string; }

export interface OverviewRecord<T> { version: 1; entries: Record<string, T>; }
/** entries wird gemeinsam für Anzeigen und Monatshaken gelesen; einzelne Leser prüfen die Pflichtfelder. */
export type OverviewEntry = Partial<BalanceSummary & MonthProvision>;
export interface BalanceSummary { year: number; scope: PlanScope; monthlyWithdrawal: Euro; monthlyBudget: Euro; createdAt: string; [key: string]: unknown; }
export interface MonthProvision { month: YearMonth; scope: PlanScope; completedAt: string; playValues?: PlayMonthValues; }
export interface PlayCashValue { source: 'spielwert'; value: Euro; from: IsoDate; through: IsoDate; pension: Euro; income: Euro;
    expenses: Euro; interest: Euro; explanation: string; error?: string; }
export type PlayMonthValues = Record<string, PlayCashValue | PlayCashValueAlt>;
/** Frühere Herleitungen dürfen die inzwischen entfallenen Entnahmen behalten. */
export interface PlayCashValueAlt extends PlayCashValue { withdrawals?: Euro; }
export type PlayMonthValuesAlt = Record<string, PlayCashValueAlt>;
export interface PlannedPosts { year: number; reserve: Euro; expenseTotal: Euro; items: { id: string; month: string; label: string; amount: Euro; kind: string; paid?: boolean; paidAmount?: Euro; person?: string; fixed?: boolean }[]; }
export interface AnnualAction {
    type: 'NONE' | 'TRANSACTION'; title: string;
    quellen?: { kind: string; brutto: Euro; netto: Euro; steuer: Euro; [key: string]: Json | undefined }[];
    verwendungen?: Record<string, Euro>; steuer?: Euro; [key: string]: unknown;
}
export interface YearHighChoice { value: number; asOf: string; }
export interface AnnualOutcome {
    monthlyWithdrawal: Euro; monthlyBudget: Euro; monthlySaving?: Euro;
    liquidityBefore: number; liquidityAfter: number; flexRate: number; marketPhase: string;
    action: AnnualAction; snapshot?: { plan: PlanValues; inflation: number; ageByPerson: Record<string, number>; marketReading?: YearHighChoice & {reading: 'year_high'} };
    plannedPosts?: PlannedPosts;
}
/** Ergebniskandidat vor assertAnnualPlanRecord; null wird am bestehenden Validator abgewiesen. */
export type AnnualOutcomeCandidate = Omit<AnnualOutcome, "monthlyBudget" | "action" | "flexRate"> & { monthlyBudget: Euro | null; flexRate?: number; action: AnnualAction | import('./rechenkern.js').Action };
export interface AnnualPlanEntry { year: number; scope: PlanScope; periodId: string; committedAt: string;
    recommended: AnnualOutcome; adopted: AnnualOutcome & { snapshot: NonNullable<AnnualOutcome['snapshot']> };
    adjusted: boolean; adjustedFields: string[]; }
export interface AnnualPlanRecord { version: 1; entries: Record<string, AnnualPlanEntry>; }
/** Alte Rundungen und calendar-year:Planjahr bleiben gültig. Keine Neuberechnung. */
export type AnnualPlanEntryAlt = AnnualPlanEntry;
/** Balance-State ist erweiterbar; dieser Auftrag besitzt nur Speicher-/Jahresmetadaten. */
export interface BalanceState { [key: string]: unknown; inputs?: Record<string, unknown>; lastState?: { cumulativeInflationFactor?: number; [key: string]: unknown }; annualPeriodMetadata?: AnnualPeriodMetadata; }
export interface RestoreScope { profileRegistryMode: string; profileLiveDataMode: string; liveKeyMode?: string; [key: string]: unknown; }
export interface Snapshot { schemaVersion: 1; snapshotType: 'persistence-records-v1'; id: string; kind: string; createdAt: string; label: string;
    activeProfileId: string; activeProfileName: string; recordCount: number; records: StringRecords; restoreScope: RestoreScope; }
export type SnapshotIndex = Omit<Snapshot, 'records' | 'schemaVersion' | 'snapshotType'> & { standardRestorable?: boolean };
export interface SnapshotListArchive { schemaVersion: 1; savedAt: string; snapshots: Snapshot[]; }
export interface SnapshotAlt { snapshotType: 'full-localstorage'; localStorage: StringRecords; [key: string]: unknown; }
export interface PersistenceFile { schemaVersion: 1; savedAt: string; records: StringRecords; metadata: Record<string, unknown>; }
export interface FullBackup { backupType: 'ruhestand-suite-full-persistence-backup'; app: 'ruhestand-suite'; schemaVersion: 2;
    exportedAt: string; runtime: string; recordScope: 'authorized-application-records'; records: StringRecords; localStorage: StringRecords;
    recordCount: number; excludedRecordCount: number; excludedKeys: string[]; backupPurpose?: string; recoveryReason?: string;
    sourceSchemaVersion?: 1 | 2; migrated?: boolean; }
/** Import prüft Export-Metadaten nicht vollständig: runtime bleibt offen; V2-excludedKeys kann beliebige Arrayelemente enthalten. */
export type NormalizedFullBackup = Omit<FullBackup, "runtime" | "excludedKeys"> & { runtime?: unknown; excludedKeys: unknown[]; sourceSchemaVersion: 1 | 2; migrated: boolean };
export interface FullBackupAlt { backupType: FullBackup['backupType']; app: FullBackup['app']; schemaVersion: 1; exportedAt: string;
    runtime?: string; records?: StringRecords; localStorage?: StringRecords; recordCount: number; }
export type DomainValidation = { ok: true; records: StringRecords; registry: ProfileRegistry; code?: never; message?: never; error?: never } | { ok: false; code?: string; message: string; error?: unknown };
export type BackupValidation = { ok: true; backup: NormalizedFullBackup; message?: never; code?: never; error?: never } | Extract<DomainValidation, { ok: false }>;
export interface ProfileRecovery { status: string; scope: string; code: string; message: string; storageKey?: string | null; profileId?: string | null;
    profileName?: string; raw: unknown; registryRaw?: unknown; detail?: string; canReset: boolean; }
export interface ProfileRecoveryDocument { schema: string; schemaVersion: number; exportedAt: string; backend: string;
    recovery: Omit<ProfileRecovery, 'canReset' | 'profileName'> & { profileName?: string | null }; }
export interface ProfileLoadResult { status: string; storageKey: string; value: unknown; raw: unknown; error?: { code?: string; message?: string; cause?: unknown } | null; }
export interface BootstrapResult { currentId: string | null; action: string; importResult: { ok: boolean; message?: string } | null; recovery: ProfileRecovery | null; }

/** Haushaltsrecords, deren Eigentümer die vorhandenen Domänenvalidatoren bleiben. */
export interface PartnershipRecord { schemaVersion: 1; status: 'married' | 'unmarried'; maritalPropertyRegime?: 'community' | 'separation';
    inheritance: Record<string, number>; marriedInheritance?: Record<string, number>;
    homeAndTaxInheritance?: Record<string, boolean>; activeInheritanceRule?: Record<string, 'testament' | 'home-and-tax'>;
    testament?: Record<string, {minimum?: Euro; minimumStand?: YearMonth; maximumPercent?: number; home?: 'money' | 'residence' | 'life-estate'; residenceTax?: 'immediate' | 'annual'}>; }
export interface CareValueSource { asOf: YearMonth; source: string; origin: 'mitgeliefert' | 'von Hand'; validFrom: YearMonth; }
export interface HouseholdCareValues { version: 1; allowance: CareValueSource & {values: Record<2 | 3 | 4 | 5, Euro>};
    residential: CareValueSource & {monthly: Euro}; confirmedForYear: number | null; }
export interface HealthBucket { enabled: boolean; initialAmount: Euro; assetSource: 'money_market_first_then_cash'; triggerMinGrade: number;
    triggerMode: 'OR' | 'AND'; coverageMode: 'care_additional_floor_only' | 'floor_when_care_active'; returnMode: 'cash_return';
    targetMode: 'inflation_indexed_diagnostic' | 'nominal_fixed'; }
export interface CashHistory { version: 1; baselineValue: Euro; entries: {date: IsoDate; value: Euro}[]; }
export interface BackupSummary { version: 1; exportedAt: string; profiles: Record<string, {months: Record<string, string>; cash: Record<string, string>; tranches: Record<string, string>}>; }
export interface PlannedInflowsAlt { schemaVersion: 1; entries: {year: number; amount: Euro; label?: string}[]; }
export interface HouseholdSimulatorNeedsAlt { schemaVersion: 1; mode: 'override' | 'migration_pending' | 'profile_default'; source?: string;
    values?: Partial<Record<'startFloorBedarf' | 'startFlexBedarf' | 'minimumFlexAnnual', number | string>>; overriddenFields?: string[]; }
/** Frühere Simulator-Personeneingaben werden vor der Keyfilterung ausgewertet. */
export type SimulatorPersonKeysAlt = `sim_${'p1StartAlter' | 'startAlter' | 'p1Geschlecht' | 'geschlecht' | 'p1Monatsrente' | 'renteMonatlich'
    | 'p1StartInJahren' | 'renteStartOffsetJahre' | 'rentAdjMode' | 'renteIndexierungsart' | 'rentAdjPct' | 'renteFesterSatz' | 'r2Anpassung'
    | 'p1KirchensteuerPct' | 'kirchensteuerSatz' | 'p1SparerPauschbetrag' | 'startSPB' | 'r2StartAlter' | 'r2Geschlecht' | 'r2Monatsrente'
    | 'r2Brutto' | 'r2StartInJahren' | 'r2KirchensteuerPct' | 'r2SparerPauschbetrag' | 'r2Steuerquote' | 'partnerAktiv' | 'chkPartnerAktiv'}`;
export type SimulatorPersonRecordsAlt = Partial<Record<SimulatorPersonKeysAlt, string>>;
export interface Tranche { schemaVersion: 2; trancheId: string; name: string; isin: string; ticker: string; shares: number;
    purchasePrice: Euro; currentPrice: Euro; asOf?: number; purchaseDate: string | null;
    category: 'equity' | 'bonds' | 'money_market' | 'gold'; type: 'aktien_alt' | 'aktien_neu' | 'anleihe' | 'geldmarkt' | 'gold';
    tqf: number; taxExempt: boolean; notes: string; }
/** V0/1 ohne kanonische IDs/Steuerflags: der Tranchevalidator besitzt die Lese-Normalisierung. */
export type TrancheAlt = Partial<Omit<Tranche, 'schemaVersion'>> & { schemaVersion?: 0 | 1; id?: string; };
export interface ProbelaufState { version: 2; active: true; phase: 'starting' | 'active'; source: 'copy' | 'demo'; runtime: 'browser' | 'tauri';
    testDate: IsoDate | null; hasDateJump?: boolean; startedAt?: string; realDomainChecksum?: string;
    initialDomain?: Json; initialMonteCarloRuns?: string[]; householdId?: string; variantId?: string; }
export interface ProbelaufStateAlt extends Omit<ProbelaufState, 'version' | 'phase' | 'testDate'> { version: 1;
    phase: 'starting' | 'active' | 'restoring'; testDate: IsoDate; snapshotId: string; archiveIds: string[]; sessions: Record<string, string | null>; }

export interface AnnualPeriodMetadata { schemaVersion: 1; lastCommittedPeriod: string | null;
    pendingCommit: {periodId: string; phase: 'snapshot_confirmed' | 'writes_started' | 'validating' | 'incomplete_recovery'; snapshotId: string; [key: string]: unknown} | null; }
/** Datenhülle des alten Adapters; fehlende Records/Metadaten werden nur lesend ergänzt. */
export interface PersistenceFileAlt { schemaVersion?: number; savedAt?: string; records?: Record<string, unknown>; metadata?: Record<string, unknown>; }
