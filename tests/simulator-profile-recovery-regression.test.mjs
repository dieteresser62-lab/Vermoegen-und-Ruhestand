import { createSelectionDocument, addField, functionSource } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { initializeProfilePage, whenProfilePageReady } from '../app/profile/profile-navigation.js';
import { createSimulatorInitialization } from '../app/simulator/simulator-auto-backtest.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { buildPersonMigrationDraft } from '../app/profile/profile-person-migration.js';
import { readHouseholdPersonStatus } from '../app/shared/person-data-status.js';
import { activateSimulatorTab, initTabSwitching, renderSimulatorProfileRecovery } from '../app/simulator/simulator-main-tabs.js';
import { runMonteCarlo } from '../app/simulator/simulator-monte-carlo.js';

function addMainTabs(doc) {
    const tabs = ['ergebnis', 'annahmen', 'backtesting', 'montecarlo', 'werkstatt'];
    for (const tab of tabs) {
        const panel = doc.body.appendChild(doc.createElement('div')); panel.id = 'tab-' + tab;
        panel.className = 'tab-panel' + (tab === 'ergebnis' ? ' active' : '');
        const button = doc.body.appendChild(doc.createElement('button')); button.dataset.tab = tab;
        button.className = 'tab-btn' + (tab === 'ergebnis' ? ' active' : '');
        button.setAttribute('aria-selected', String(tab === 'ergebnis'));
        for (const element of [panel, button]) element.classList.toggle = (name, enabled) => {
            const classes = new Set(element.className.split(/\s+/));
            if (enabled) classes.add(name); else classes.delete(name);
            element.className = [...classes].join(' ');
        };
    }
    const queryAll = doc.querySelectorAll.bind(doc);
    doc.querySelectorAll = selector => selector.startsWith('.')
        ? queryAll('*').filter(node => node.classList.contains(selector.slice(1))) : queryAll(selector);
    doc.querySelector = selector => doc.querySelectorAll(selector)[0] || null;
}
const previous = { document: globalThis.document, window: globalThis.window };
try {
    for (const [current, active, expectedId] of [['ghost', 'ghost', 'ghost'], ['a', 'ghost', 'ghost'], ['ghost', 'a', 'ghost'], ['a', 'b', 'b']]) {
        const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14' };
        const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Muster A' }, data }, b: { meta: { id: 'b', name: 'Muster B' }, data }
        } }), rs_current_profile: current, rs_active_profile: active };
        let draftError;
        try { buildPersonMigrationDraft(records); } catch (error) { draftError = error; }
        assertEqual(draftError?.name, 'ProfileRecoveryError', 'Identitätsfehler vor Migration ist typisierte Recovery');
        assertEqual(draftError.profileId, expectedId, 'Recovery bezeichnet die betroffene ID');
        assertEqual(draftError.recovery.registryRaw, records.rs_profiles_v1, 'Recovery hält die Originalregistry');
        for (const kind of ['balance', 'simulator']) {
            const doc = createSelectionDocument();
            doc.documentElement = { dataset: { suitePage: kind } };
            const listeners = new Map();
            doc.addEventListener = (type, fn) => { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); };
            doc.removeEventListener = () => {}; doc.contains = () => false;
            for (const id of ['suiteNavigationStatus', 'error-container', 'simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'mcButton', 'btButton', 'sweepButton', 'ao_run_btn']) addField(doc, id);
            if (kind === 'simulator') addMainTabs(doc);
            const win = { addEventListener() {}, removeEventListener() {} };
            globalThis.document = doc; globalThis.window = win;
            let writes = 0, snapshots = 0, starts = 0;
            PersistenceFacade.resetPersistenceForTests({ name: 'Ghost-Regression', async init() {}, async loadAll() { return { ...records }; },
                async saveBatch() { writes++; }, async writeSnapshot() { snapshots++; } });
            const profileReady = whenProfilePageReady(doc);
            const initialization = kind === 'simulator' ? createSimulatorInitialization({ persistenceReady: Promise.resolve(), profileReady,
                initialize: () => { starts++; }, isBlocked: () => Boolean(win.__profileRecoveryBlocker),
                onReadinessError: () => initSimulatorProfileSelection() }) : null;
            const observed = profileReady.catch(error => error);
            assertEqual(await initializeProfilePage({ doc, win }), false, 'Echter Seitenstart meldet Recovery');
            const failure = await observed;
            assertEqual(failure.name, 'ProfileRecoveryError', 'Bereitschaft bewahrt typisierten Startfehler');
            if (initialization) await initialization.settle();
            const host = doc.getElementById(kind === 'balance' ? 'error-container' : 'simProfileStatus');
            assert(host.textContent.includes('Profil-Recovery erforderlich') && host.textContent.includes(expectedId), kind + ': sichtbare Recovery mit ID');
            if (kind === 'simulator') {
                for (const id of ['mcButton', 'btButton', 'sweepButton', 'ao_run_btn']) assert(doc.getElementById(id).disabled, id + ': früher Start installiert Sperre');
                assertEqual(starts, 0, 'Kein schreibender Normalstart nach Recovery');
                const buttons = doc.querySelectorAll('.tab-btn');
                assertEqual(buttons.length, 5, 'Echter Startzustand hat fünf Hauptreiter');
                for (const button of buttons) {
                    assert(button.disabled && button.getAttribute('aria-disabled') === 'true'
                        && button.getAttribute('title') === 'Profil-Recovery erforderlich', 'Frühe Recovery sperrt alle fünf Hauptreiter sichtbar und assistiv');
                }
                const visibleStatus = doc.getElementById('simProfileRecoveryStatus');
                assert(visibleStatus && visibleStatus.parentNode === doc.getElementById('tab-ergebnis')
                    && visibleStatus.textContent === host.textContent && visibleStatus.textContent.includes(expectedId),
                    'Aktives Ergebnispanel zeigt vollständige Recoverymeldung samt Profil-ID');
                assertEqual(visibleStatus.getAttribute('role'), 'status', 'Recoveryhost ist für Hilfstechnik gekennzeichnet');
                const selection = buttons.map(button => button.getAttribute('aria-selected')).join(',');
                assertEqual(activateSimulatorTab('annahmen'), false, 'Programmatischer Wechsel bleibt im Recoveryzustand gesperrt');
                initTabSwitching(); buttons[1].dispatchEvent({ type: 'click' });
                assert(doc.getElementById('tab-ergebnis').classList.contains('active')
                    && !doc.getElementById('tab-annahmen').classList.contains('active'), 'Synthetischer Klick verändert kein aktives Panel');
                assertEqual(buttons.map(button => button.getAttribute('aria-selected')).join(','), selection, 'Recoverywechsel verändert keine Reiterauswahl');
                initSimulatorProfileSelection();
                assertEqual(doc.querySelectorAll('*').filter(node => node.id === 'simProfileRecoveryStatus').length, 1,
                    'Wiederholte Recoverydarstellung erzeugt keinen doppelten Statushost');

                let activity = 0;
                assertEqual(runMonteCarlo({ runSerial: () => activity++, runWorkers: () => activity++, createUI: () => activity++ }), false, 'Öffentlicher MC-Einstieg blockiert synchron');
                assertEqual(activity, 0, 'Keine Runner-, Worker- oder UI-Aktivität');
                assertEqual(readHouseholdPersonStatus().ready, false, 'DOM-freier Leser erkennt ungültige Identität');
            }
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), JSON.stringify(records), 'Cache und Identitätskeys bytegleich');
            assertEqual(writes, 0, 'Keine Registry-/Defaultwrites');
            assertEqual(snapshots, 0, 'Keine Migrationsersatzsicherung');
        }
    }
    for (const completePerson of [true, false]) {
        const doc = createSelectionDocument(); addMainTabs(doc);
        const create = doc.createElement.bind(doc);
        doc.createElement = tag => { const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child)); return node; };
        doc.addEventListener = () => {}; doc.removeEventListener = () => {};
        for (const id of ['simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'p1StartAlter', 'r2StartAlter',
            'displayPortfolioBreakdown', 'simStartVermoegen', 'depotwertAlt', 'einstandAlt', 'tagesgeld', 'geldmarktEtf', 'mcButton', 'btButton']) addField(doc, id);
        globalThis.document = doc; globalThis.window = { addEventListener() {}, removeEventListener() {} };
        const data = { profile_person_schema_version: '1', depot_tranchen: '[]',
            ...(completePerson ? { profile_geburtsdatum: '1958-03-14' } : {}) };
        const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Gesunde Identität', belongsToHousehold: true }, data }
        } }), rs_current_profile: 'a', rs_active_profile: 'a', ...data };
        PersistenceFacade.resetPersistenceForTests({ name: 'Recovery-Kontrolle', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() {} });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        initSimulatorProfileSelection();
        const buttons = doc.querySelectorAll('.tab-btn');
        assert(buttons.every(button => !button.disabled && button.getAttribute('aria-disabled') === null),
            'Gesunde Profilidentität behält bedienbare Hauptreiter, auch bei fehlenden Personendaten');
        assertEqual(doc.getElementById('simProfileRecoveryStatus'), null, 'Fachlicher Personenhinweis wird nicht als technische Recovery dargestellt');
        assert(!window.__profileRecoveryBlocker, 'Gesunder Kontrollstart erhält keinen technischen Recoveryblocker');
        assertEqual(Boolean(window.__personDataBlocker), !completePerson, 'Fehlende Personendaten behalten ihren eigenen fachlichen Blocker');
        initTabSwitching(); buttons[1].dispatchEvent({ type: 'click' });
        assert(doc.getElementById('tab-annahmen').classList.contains('active'), 'Gesunder Kontrollstart erlaubt Reiterwechsel');
        buttons[4].disabled = true; buttons[4].setAttribute('aria-disabled', 'true'); buttons[4].setAttribute('title', 'Vorherige Sperre');
        renderSimulatorProfileRecovery('Profil-Recovery erforderlich: Kontrollfall');
        renderSimulatorProfileRecovery('Profil-Recovery erforderlich: Kontrollfall wiederholt');
        renderSimulatorProfileRecovery(null);
        assert(buttons[4].disabled && buttons[4].getAttribute('aria-disabled') === 'true'
            && buttons[4].getAttribute('title') === 'Vorherige Sperre', 'Recoveryfreigabe erhält vorherige Disabled-, ARIA- und Hinweiszustände');
        assert(buttons.slice(0, 4).every(button => !button.disabled && button.getAttribute('aria-disabled') === null
            && button.getAttribute('title') === null), 'Recoveryfreigabe stellt ursprünglich bedienbare Reiter wieder her');
        assertEqual(doc.getElementById('simProfileRecoveryStatus'), null, 'Recoveryfreigabe entfernt dedizierten Statushost');
        assertEqual(activateSimulatorTab('ergebnis'), true, 'Nach Recoveryfreigabe ist programmatischer Wechsel wieder möglich');
    }
    // Der echte Balance-init-Körper stoppt vor DOM-Defaultübernahme und Engine-Handschlag.
    {
        const body = functionSource('app/balance/balance-main.js', 'init');
        const doc = createSelectionDocument(); doc.addEventListener = () => {}; const win = {};
        const calls = [];
        const init = new Function('window', 'document', 'initPersistence', 'initializeProfilePage', 'createBlockedUpdateResult', `async ${body}; return init;`)
            (win, doc, async () => calls.push('persistence'), async () => false, reason => ({ reason }));
        assertEqual((await init()).reason, 'profile_recovery', 'Produktiver Balance-Start bleibt vor Defaultübernahme gesperrt');
        assertEqual(calls.join(','), 'persistence', 'Nur Persistenzbereitschaft vor blockiertem Profilstart');
    }
} finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
