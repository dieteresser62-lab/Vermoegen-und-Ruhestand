import { init } from './initialization.js';
import { storeState, assertDocumentWritable } from './state.js';
import { withProbelaufOperation, flush } from './writes.js';

// HV-1: Anlegen und Wechseln schreiben nur das Haushaltsverzeichnis; danach braucht jedes Dokument einen Neustart.
/** @param {(manager: NonNullable<typeof storeState.areaManager>) => Promise<unknown>} change */
async function changeHousehold(change) {
    await init();
    assertDocumentWritable();
    if (!storeState.areaManager || storeState.areaControl.activeArea !== 'echt') throw new Error('Erst den Spielbereich beenden.');
    return withProbelaufOperation(async () => {
        assertDocumentWritable();
        if (storeState.dirtyKeys.size || storeState.deletedKeys.size) throw new Error('Bitte zuerst die Eingaben speichern.');
        storeState.areaReloadRequired = true;
        try {
            const result = await change(/** @type {NonNullable<typeof storeState.areaManager>} */ (storeState.areaManager));
            if (result === false) storeState.areaReloadRequired = false;
            return result;
        } catch (error) { storeState.areaReloadRequired = false; throw error; }
    });
}

/** @param {string} name @returns {Promise<string>} Kennung des neuen, schon aktiven Haushalts. */
export const createHousehold = name => /** @type {Promise<string>} */ (changeHousehold(manager => manager.createHousehold(name)));
/** @param {string} id @returns {Promise<boolean>} false, wenn der Haushalt schon offen war. */
export const switchHousehold = id => /** @type {Promise<boolean>} */ (changeHousehold(manager => manager.switchHousehold(id)));
/** HV-2 Verwaltung: Umbenennen, endgültig Löschen (nie Haushalt 1, nie der geöffnete), Bereich wieder anlegen.
 * Alle drei ändern das Verzeichnis; danach braucht die Seite einen Neustart.
 * @param {string} id @param {string} name */
export const renameHousehold = (id, name) => changeHousehold(manager => manager.renameHousehold(id, name));
/** @param {string} id @param {string} confirmName */
export const deleteHousehold = (id, confirmName) => changeHousehold(manager => manager.deleteHousehold(id, confirmName));
/** @param {string} id */
export const rebuildHousehold = id => changeHousehold(manager => manager.rebuildHousehold(id));
/** HV-3: neuer Haushalt aus einer geprüften Übergabedatei; erst nach vollständigem Rücklesen im Verzeichnis.
 * @param {string} name @param {Record<string, string>} records @returns {Promise<string>} */
export const createHouseholdFromRecords = (name, records) => /** @type {Promise<string>} */ (changeHousehold(manager => manager.createHousehold(name, undefined, records)));
/** Nur lesend, für die Übergabedatei; der geöffnete Haushalt wird vorher gespeichert. @param {string} id */
export async function readHouseholdRecords(id) {
    await init();
    if (!storeState.areaManager) throw new Error('Haushalte benötigen einen Laufzeitadapter.');
    if (storeState.households?.active === id) await flush();
    return storeState.areaManager.readHouseholdRecords(id);
}
/** @returns {ReturnType<typeof import('../household-registry.js').defaultHouseholdRegistry> | null} */
export function getHouseholds() { return storeState.households ? structuredClone(storeState.households) : null; }
