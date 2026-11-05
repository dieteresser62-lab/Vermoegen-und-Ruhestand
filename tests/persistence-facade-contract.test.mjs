import facade, * as publicExports from '../app/shared/persistence-facade.js';
import { PersistenceFacade as assembledFacade, persistenceStorage } from '../app/shared/persistence-facade/api.js';

// Dieselbe Identität ist für bestehende Methodenüberschreibungen der Aufrufer nötig.
assert(facade === publicExports.PersistenceFacade, 'default und benannte Fassade sind dasselbe Objekt');
assert(facade === assembledFacade, 'Re-Export erhält das einmal zusammengesetzte API-Objekt');
assert(persistenceStorage === publicExports.persistenceStorage, 'Storage-Re-Export erhält dieselbe Objektidentität');
// HV-1/HV-2: Haushaltsfunktionen kommen bewusst hinzu.
assertEqual(Object.keys(facade).length, 50, 'öffentliche Fassade hat ihre 50 Eigenschaften');
for (const name of ['createHousehold', 'switchHousehold', 'getHouseholds', 'renameHousehold', 'deleteHousehold', 'rebuildHousehold', 'createHouseholdFromRecords', 'readHouseholdRecords']) assert(typeof facade[name] === 'function', `Fassade bietet ${name}`);
for (const [name, method] of Object.entries(facade)) {
    assert(method === publicExports[name], `${name}: Objektmethode und benannter Funktionsexport sind identisch`);
}
assert(persistenceStorage.getItem === publicExports.getItemSync, 'Storage liest mit derselben Cachefunktion');
assert(persistenceStorage.setItem === publicExports.setItemSync, 'Storage schreibt mit derselben Cachefunktion');
