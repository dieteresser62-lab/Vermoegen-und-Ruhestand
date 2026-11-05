/** Formular- und Zeichnungsgrenzen des Personen-/Vermögensmanagers. */
import type * as D from './datenvertraege.js';
import type * as P from './profile-ui.js';
import type * as H from './tranches-history.js';
import type {SimulatorControl} from './simulator-ui.js';
/** Planfelder sind Inputs oder Selects; checked gehört nur zu Checkboxen. */
export type PlanControl = SimulatorControl;
export type PropertyLayers = [string, (point: H.Point)=>number, (point: H.Point)=>number][];
export type InheritancePreview = ReturnType<typeof import('../app/profile/household-partnership.js').inheritancePreview> & Partial<P.Estate>;
export type BindPlanField = (options: {
    doc: Document; field: PlanControl; path: string; nativeOnly?: boolean; row?: Element;
    onChange?: (field: PlanControl)=>void; onFocusStateChange?: (state?: {correctionChanged?: boolean})=>void;
})=>ReturnType<typeof import('../app/shared/household-plan-fields.js').bindHouseholdPlanField>;
export type IncomeDraft = Partial<D.IncomeOnce & D.IncomeFixed>;
export type BindDynamicFlex = (options: {doc: Document; root?: HTMLElement; host?: Element; details?: Element;
    read: ()=>D.PlanValues|null; disabled: ()=>boolean; onChange: (patch: Record<string, unknown>)=>void;
    hasDetailErrors?: ()=>boolean; hasDetailCorrections?: ()=>boolean;
})=>ReturnType<typeof import('../app/shared/household-plan-dynamic-flex.js').bindHouseholdPlanDynamicFlex>;
declare global {interface Window {DepotTranchenStatus?: {
    getStatus: typeof import('../app/tranches/depot-tranchen-status.js').getTranchenStatus;
    renderBadge: typeof import('../app/tranches/depot-tranchen-status.js').renderTranchenStatusBadge;
    init: typeof import('../app/tranches/depot-tranchen-status.js').initTranchenStatus;
    syncToInputs: ()=>boolean; calculateAggregated: typeof import('../app/tranches/depot-tranchen-status.js').calculateAggregatedValues;
};}}
