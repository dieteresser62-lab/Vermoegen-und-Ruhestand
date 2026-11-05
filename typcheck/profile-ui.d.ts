/** Personen- und Plangrenzen; Rohdaten bleiben bis zur bestehenden Validierung getrennt. */
import type * as D from './datenvertraege.js';
import type * as R from './rechenkern.js';
import type * as I from './speicher-integration.js';
export type PlanEntry = D.HouseholdPlanRecord['entries'][string];
export interface PlanRead {status: 'valid'|'missing'|'invalid'; entry: PlanEntry|null; raw: string|null; record?: D.HouseholdPlanRecord; error?: unknown;}
export interface PlanReadOptions {scope?: D.PlanScope; storage?: D.RecordReader;}
export interface SelectedPlanOptions {storage?: D.RecordReader; profileId?: string;}
export type PlanPatch = Partial<Omit<D.PlanValues, 'cape'|'decumulation'>> & {cape?: Partial<D.PlanValues['cape']>; decumulation?: Partial<D.PlanValues['decumulation']>};
export interface PlanPatchOptions extends PlanReadOptions {patch?: PlanPatch; persistence?: typeof import('../app/shared/persistence-facade.js').PersistenceFacade; now?: ()=>Date; navigationOperation?: I.Operation; isCurrent?: ()=>boolean;}
export interface AnnualRead extends Partial<D.AnnualPlanEntry> {status?: 'invalid'; error?: unknown; raw?: string;}
export type ReadAnnualPlan = (options?: {year?: number; scope?: D.PlanScope; storage?: D.RecordReader})=>AnnualRead|null;
export interface PersonValues {geburtsdatum: string; rentenbeginn: string; geschlecht: string; rentenanpassungArt: string;
    rentenanpassungPct: number; kirchensteuerPct: number; sparerPauschbetrag: number; renteSteuerquotePct: number;}
export type PersonDraft = Partial<Omit<PersonValues, 'rentenanpassungPct'|'kirchensteuerPct'|'sparerPauschbetrag'|'renteSteuerquotePct'>> & Partial<Record<'rentenanpassungPct'|'kirchensteuerPct'|'sparerPauschbetrag'|'renteSteuerquotePct', string|number|boolean|null>>;
export type ValidationError = Error & {code: string; errors: {field: string; message: string}[]};
export type TestamentRule = NonNullable<D.PartnershipRecord['testament']>[string];
export interface Gains {deceasedAssets?: number; survivorAssets?: number; deceasedInitialAssets?: number; survivorInitialAssets?: number; inflationFactor?: number; acquisition?: number; exemptHome?: number;}
export interface EstateOptions {minimumFactor?: number; partnerAge?: number; partnerGender?: string; status?: string; residenceValue?: number; residenceEligible?: boolean; familyHome?: number; maritalPropertyRegime?: string; gains?: Gains;}
export interface PreviewOptions extends EstateOptions {exemptHome?: number; selfUsedHome?: number; homeAndTax?: boolean; cash?: number; tranches?: R.EngineTranche[]; kirchensteuerSatz?: number; sparerPauschbetrag?: number; taxStatePrev?: R.TaxState; testament?: TestamentRule;}
export interface Estate {inherited: number; share: number; home: number; residenceCapital: number; exemptHome: number; tax: number; mode: string; exemptGain?: number;
    residenceTax?: {annualValue: number; rate: number; annualTax: number; allowanceRemaining: number; immediateComparison: number};}
export interface MigrationPerson {id: string; name: string; data: D.StringRecords; needed: boolean; candidates: Record<string, MigrationCandidate[]>; sources: Record<string, string[]>; suggested?: Record<string, number>; suggestionReason?: string;}
export interface MigrationCandidate {value: string|number; sources: string[]; pensionOrigins?: {offset: number; source: string}[];}
export interface PlanMigrationOptions {storage?: D.RecordStorage; persistence?: typeof import('../app/shared/persistence-facade.js').PersistenceFacade; archive?: typeof import('../app/shared/snapshot-archive.js').SnapshotArchive;
    choose?: (analysis: ReturnType<typeof import('../app/profile/household-plan-migration.js').analyzeHouseholdPlanMigration>['analyses'][number], options: {signal: AbortSignal})=>Promise<object|null>;
    guard?: ReturnType<typeof import('../app/shared/navigation-guard-dialog.js').getPageNavigationGuard>; now?: ()=>Date; isBlocked?: ()=>boolean;}
export interface StrategyOptions {kind?: string; profileId?: string; scopeKey?: string; storage?: D.RecordStorage; persistence?: typeof import('../app/shared/persistence-facade.js').PersistenceFacade; navigationOperation?: I.Operation;}
export interface AttributionResult {finalAction: R.Action; profileActions: {profileId: string; action: R.Action; taxStateNext?: R.TaxState}[]; settlements: {profileId: string; rawAggregate: R.RawTaxAggregate; taxDue: number; taxStateNext: R.TaxState; details: NonNullable<R.Action['taxSettlement']>; sources: R.ActionSource[]}[]; assetScale: number;}

/** Die reine Aktionssumme liest kein input; Steuer-Netting behält den vollständigen Enginevertrag. */
declare module '../engine/transactions/net-action.mjs' {
    export function sumPersonalActions(base: R.Action, entries: {action: R.Action}[]): R.Action;
}
