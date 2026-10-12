import { bindOverviewMonthClose } from '../overview/overview-main.js';
import { bindOverviewAnnualClose } from '../overview/overview-annual-close.js';
import { bindOverviewExampleExpenses } from '../overview/overview-example-expenses.js';
import { projectOverviewFromRecords } from '../overview/overview-model.js';
import { loadProfileRegistry, getCurrentProfileId } from '../profile/profile-registry.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { readLastFullBackup } from '../overview/overview-storage.js';

/** Abschlusskontext ausschließlich aus Fachdatum und Quellen, nie aus den Anzeigefiltern. */
export function bindExpensesClose({ doc, win, refresh, wealthCapture, storage = persistenceStorage, pageImports = null, options = {} }) {
    let model = null, imports, dialogImports, months, annual;
    const read = () => {
        const liveData = Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)).map(key => [key, storage.getItem(key)]));
        let next = projectOverviewFromRecords({ registry: loadProfileRegistry(storage).value,
            activeId: getCurrentProfileId(storage), liveData, lastBackup: readLastFullBackup(storage),
            recovery: Boolean(win.__profileRecoveryBlocker || PersistenceFacade.getPersistenceStatus().migrationWarning) });
        next = months?.projectModel(next) || next;
        next = imports?.projectModel(next) || next;
        model = next;
        return model;
    };
    const changed = () => { read(); refresh(); };
    read();
    dialogImports = bindOverviewExampleExpenses({ doc, win, getModel: () => model, refresh: changed, wealthCapture, ...options.imports });
    // Ein Seitenbesitzer umfasst Zellimporte und Dialogimporte einschließlich Capture-Folgejobs.
    imports = {
        projectModel: next => dialogImports.projectModel(next),
        bindRoot: (...args) => dialogImports.bindRoot(...args),
        syncButtons() { dialogImports.syncButtons(); pageImports?.syncButtons(); },
        abort() { dialogImports.abort(); pageImports?.abort(); },
        async wait() { await dialogImports.wait(); await pageImports?.wait(); },
        get pending() { return dialogImports.pending || Boolean(pageImports?.pending); }
    };
    months = bindOverviewMonthClose({ doc, win, getModel: () => model, refresh: changed, getImports: () => imports, returnFocus: () => doc.getElementById('expensesClose')?.focus(), ...options.months });
    annual = bindOverviewAnnualClose({ doc, win, getModel: () => model, refresh: changed, getImports: () => imports, ...options.annual });
    return { read, imports, months, annual, sync() { months.syncButtons(); imports.syncButtons(); annual.syncButtons(); } };
}
