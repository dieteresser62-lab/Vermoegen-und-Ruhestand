
import { SNAPSHOT_KINDS } from '../snapshot-archive.js';

export const FULL_BACKUP_TYPE = 'ruhestand-suite-full-persistence-backup';

export const FULL_BACKUP_APP_ID = 'ruhestand-suite';

export const FULL_BACKUP_LEGACY_SCHEMA_VERSION = 1;

export const FULL_BACKUP_SCHEMA_VERSION = 2;

export const FULL_BACKUP_RECOVERY_KIND = SNAPSHOT_KINDS.fullBackupImportRecovery;

export const PROBELAUF_BACKUP_MESSAGE = 'Vollsicherung und Import sind während des Spielbereichs gesperrt. Bitte zuerst den Spielbereich beenden.';

export const PROBELAUF_BACKUP_STATE_UNAVAILABLE_MESSAGE = 'Vollsicherung und Import gesperrt: Spielbereich-Zustand konnte nicht sicher gelesen werden. Bitte neu laden.';

// HL-1 (H-04): Hinweis der Schreibsperre nach dem Einspielen, gleich gebaut wie beim Zurückholen eines Punkts.
export const FULL_BACKUP_RELOAD_MESSAGE = 'Sicherung eingespielt; die Seite wurde nicht neu geladen. Bitte die Seite jetzt neu laden. Eingaben werden bis dahin nicht gespeichert.';

// Nur der lokale Bestandsvergleich darf diesen Hinweis auslösen, keine Backendmeldung.
export class FullBackupLiveChangedError extends Error {
    constructor() {
        super('Der Livebestand hat sich nach der Importsicherung geändert. Bitte erneut importieren.');
    }
}

export const FULL_BACKUP_RECORD_SCOPE = 'authorized-application-records';

export const BLOCKED_BACKUP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
