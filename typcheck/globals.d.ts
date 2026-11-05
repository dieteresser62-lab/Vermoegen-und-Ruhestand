/** Globale Brücken der Browser-/Tauri-Laufzeit; keine Laufzeitdatei. */
interface TauriBridge {
    core?: { invoke<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> };
    event?: { listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): Promise<() => void> };
}

interface Window {
    tranchen?: readonly unknown[];
    __personMigrationDeferred?: boolean;
    EngineAPI?: typeof import('../engine/index.mjs').EngineAPI;
    Ruhestandsmodell_v30?: typeof import('../engine/index.mjs').EngineAPI;
    __TAURI__?: TauriBridge;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_METADATA__?: unknown;
}

declare var __TAURI__: TauriBridge | undefined;
// onmessage, postMessage, Worker und DedicatedWorkerGlobalScope kommen aus lib WebWorker.

interface Window { __profileRecoveryBlocker?: import("./simulator-ui.js").ProfileBlocker | null; }

interface Window {featureFlags?: typeof import("../app/shared/feature-flags.js").featureFlags; simulateOneYearAdapter?: typeof import("../app/simulator/simulator-engine-wrapper.js").simulateOneYear;}

interface TauriBridge {app?: {getIdentifier(): Promise<string>};}

interface Window {__rsProbelaufChannel?: BroadcastChannel;}
