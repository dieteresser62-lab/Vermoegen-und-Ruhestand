/** Spielbereichsoptionen; gespeicherte Zustände stammen aus den Datenverträgen. */
import type * as D from './datenvertraege.js';
import type * as I from './speicher-integration.js';
export type Persistence = typeof import('../app/shared/persistence-facade.js').PersistenceFacade;
export type Guard = ReturnType<typeof import('../app/shared/navigation-guard.js').createNavigationGuard>;
export type Controller = ReturnType<typeof import('../app/shared/probelauf-state.js').createProbelaufController>;
export type State = D.ProbelaufState | D.ProbelaufStateAlt;
export interface ControllerOptions {doc?: Document; persistence?: Persistence; archive?: typeof import('../app/shared/snapshot-archive.js').SnapshotArchive;
    win?: Window & typeof globalThis; session?: D.RecordStorage; runtimeResolver?: typeof import('../app/shared/probelauf-runtime.js').resolveProbelaufRuntime;
    guard?: Guard; saveProfile?: ()=>boolean|void|Promise<boolean|void>; reload?: ()=>unknown; restoreReload?: ()=>unknown;
    notify?: (controller: object, error?: Error)=>void; demoLoader?: (date: string, householdId: string, variantId: string)=>Promise<D.StringRecords>;
    clock?: ()=>number; wait?: (ms: number)=>Promise<unknown>; timeoutMs?: number;
}
export interface TransitionOptions {choose?: (options: {testDate: string; demoAvailable: boolean})=>Promise<{testDate?: string; source: string; householdId?: string; variantId?: string}|null>;
    confirm?: (state: State)=>Promise<boolean|{action: string; review: {playDomainChecksum: string}}>; date?: string;
    ending?: boolean; restarting?: boolean; variantId?: string; opener?: HTMLElement; onTransferred?: (result: unknown)=>unknown|Promise<unknown>;
}
export interface ComparisonOptions {now?: Date; state?: State; play?: boolean; engineApi?: typeof import('../engine/index.mjs').EngineAPI;
    balance?: Awaited<ReturnType<typeof import('../app/shared/probelauf-comparison.js').loadProbelaufBalance>>; calculationError?: Error;
}
export interface EndReviewOptions extends ComparisonOptions {realRecords?: D.StringRecords; playRecords: D.StringRecords;}
export interface EndDialogOptions {doc?: Document; opener?: Element; state?: State; loadReview?: ()=>Promise<ReturnType<typeof import('../app/shared/probelauf-comparison.js').buildProbelaufEndReview>>;}
export interface TimeLapseOptions {controller?: Controller; session?: D.RecordWriter & {removeItem(key: string): unknown}; notify?: (api: object)=>void;
    services?: ReturnType<typeof import('../app/overview/overview-timelapse.js').createTimeLapseServices>;
    loadServices?: ()=>Promise<ReturnType<typeof import('../app/overview/overview-timelapse.js').createTimeLapseServices>>; yieldStep?: ()=>Promise<unknown>;
}
