/** Ergänzungen, die an Fehlerobjekte der Speicher- und Profilpfade geschrieben werden. */
export interface AppError extends Error {
    code?: string; status?: string; profileId?: string; storageKey?: string;
    rollbackError?: unknown; raw?: unknown; quarantinePath?: string; recoverySnapshotId?: string;
}
export interface StorageReader { getItem(key: string): string | null; }
export interface StorageKeys extends StorageReader { readonly length: number; key(index: number): string | null; }
export interface StorageWriter extends StorageReader { setItem(key: string, value: string): unknown; removeItem?(key: string): unknown; }
export interface NavigationOperation {
    check(): void; commit(): void; controller: AbortController; phase: string;
    owner?: symbol; ended?: Promise<unknown>; owns?(owner: symbol): boolean;
}
/** Ungeprüfte JSON-Felder bleiben am Ein-/Ausgang der bestehenden Validatoren offen. */
export type JsonRecord = Record<string, any>;
export interface DomainValidation {
    ok: boolean; code?: string; message?: string; error?: unknown;
    records?: Record<string, string>; registry?: JsonRecord;
}
export interface BackupValidation extends DomainValidation { backup?: JsonRecord; }
export interface PersistenceAdapter {
    name: string; open?(): Promise<unknown>; loadAll(): Promise<Record<string, string>>;
    readPersistedRecords?(): Promise<Record<string, string>>;
    loadAllSync?(): Record<string, string>; getItemSync?(key: string): string | null;
    setItemSync?(key: string, value: string): void; removeItemSync?(key: string): void; keysSync?(): string[];
    saveBatch(batch?: {upserts?: string[][]; deletes?: string[]}): Promise<{ok?: boolean, message?: string} | void>;
    readMetadata?(key: string): Promise<unknown>; writeMetadata?(key: string, value: unknown): Promise<unknown>;
    // Snapshot-Nutzdaten sind JSON; die Archivvalidatoren prüfen die konkrete Form.
    createSnapshot?(snapshot: import("./datenvertraege.js").Snapshot): Promise<import("./datenvertraege.js").Snapshot>; listSnapshots?(): Promise<import("./datenvertraege.js").Snapshot[]>;
    getSnapshot?(id: string): Promise<import("./datenvertraege.js").Snapshot>; deleteSnapshot?(id: string): Promise<unknown>;
    replaceLiveRecords?(records: Record<string, string>, options: object): Promise<{ok?: boolean, message?: string}>;
    readPersistedSnapshot?(id: string): Promise<import("./datenvertraege.js").Snapshot>;
    readPersistedSnapshots?(): Promise<import("./datenvertraege.js").Snapshot[]>;
    readSnapshot?(id: string): Promise<import("./datenvertraege.js").Snapshot>;
    writeSnapshot?(snapshot: import("./datenvertraege.js").Snapshot): Promise<boolean>;
    writeSnapshots?(snapshots: import("./datenvertraege.js").Snapshot[]): Promise<boolean>;
    migrateLegacySnapshotsIfNeeded?(options?: object): Promise<unknown>;
    close?(): void;
}
