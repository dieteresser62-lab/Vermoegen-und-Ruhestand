import * as facade from '../app/shared/persistence-backup.js';
import * as schema from '../app/shared/persistence-backup/schema.js';
import * as domains from '../app/shared/persistence-backup/domain-validation.js';
import * as format from '../app/shared/persistence-backup/format.js';
import * as guard from '../app/shared/persistence-backup/guard.js';
import * as download from '../app/shared/persistence-backup/download.js';
import * as restore from '../app/shared/persistence-backup/restore.js';
import * as bindings from '../app/shared/persistence-backup/bindings.js';

const expected = {
    FULL_BACKUP_TYPE: schema.FULL_BACKUP_TYPE,
    FULL_BACKUP_APP_ID: schema.FULL_BACKUP_APP_ID,
    FULL_BACKUP_LEGACY_SCHEMA_VERSION: schema.FULL_BACKUP_LEGACY_SCHEMA_VERSION,
    FULL_BACKUP_SCHEMA_VERSION: schema.FULL_BACKUP_SCHEMA_VERSION,
    FULL_BACKUP_RECOVERY_KIND: schema.FULL_BACKUP_RECOVERY_KIND,
    PROBELAUF_BACKUP_MESSAGE: schema.PROBELAUF_BACKUP_MESSAGE,
    validateProfileManagementRecords: domains.validateProfileManagementRecords,
    validatePersistenceDomainRecords: domains.validatePersistenceDomainRecords,
    buildFullPersistenceBackup: format.buildFullPersistenceBackup,
    createFullBackupFilename: format.createFullBackupFilename,
    createRecoveryBackupFilename: format.createRecoveryBackupFilename,
    buildRecoveryPersistenceBackup: format.buildRecoveryPersistenceBackup,
    normalizeFullPersistenceBackup: format.normalizeFullPersistenceBackup,
    assertFullBackupAllowed: guard.assertFullBackupAllowed,
    downloadJsonFile: download.downloadJsonFile,
    downloadFullPersistenceBackup: download.downloadFullPersistenceBackup,
    downloadRecoveryPersistenceBackup: download.downloadRecoveryPersistenceBackup,
    importFullPersistenceBackup: restore.importFullPersistenceBackup,
    bindFullBackupButton: bindings.bindFullBackupButton,
    bindFullBackupImport: bindings.bindFullBackupImport
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Fassade erhält alle 20 öffentlichen Namen und hält interne Helfer privat');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
