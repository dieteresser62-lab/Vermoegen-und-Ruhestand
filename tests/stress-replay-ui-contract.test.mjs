import * as facade from '../app/simulator/stress-replay-ui.js';
import { createStressReplayController } from '../app/simulator/stress-replay-ui/controller.js';
import { formatStressReplayUiError } from '../app/simulator/stress-replay-ui/values.js';
import { renderStressReplayWorkspaceBanner, updateStressReplayStepStates } from '../app/simulator/stress-replay-ui/workspace-view.js';

assertEqual(facade.createStressReplayController, createStressReplayController, 'Fassade erhält die Controllerbindung');
assertEqual(facade.formatStressReplayUiError, formatStressReplayUiError, 'Fassade erhält die Fehlerdarstellung');
assertEqual(facade.renderStressReplayWorkspaceBanner, renderStressReplayWorkspaceBanner, 'Fassade erhält die Bannerdarstellung');
assertEqual(facade.updateStressReplayStepStates, updateStressReplayStepStates, 'Fassade erhält die Schrittanzeige');

function fixture() {
    const listeners = [];
    let loads = 0;
    let renders = 0;
    const elements = new Map();
    const ids = ['stressReplayFixButton', 'stressReplayExportButton', 'stressReplayExportCsvButton',
        'stressReplayImportButton', 'stressReplayDiscardButton', 'stressReplayExpertToggle',
        'stressReplayVariantEditor', 'stressReplayAddVariantButton', 'stressReplayVariantList', 'stressReplayImportFile'];
    for (const id of ids) elements.set(id, {
        addEventListener(type, handler) { listeners.push({ id, type, handler }); }
    });
    const empty = { status: 'empty', workspace: null, compatibility: null, error: null };
    return {
        listeners, empty, get loads() { return loads; }, get renders() { return renders; },
        options: {
            documentRef: { getElementById: id => elements.get(id), querySelectorAll: () => [] },
            resolveCompatibility: () => ({}),
            loadWorkspace() { assertEqual(this, undefined, 'Injizierter Lader behält seinen freien Aufruf'); loads++; return empty; },
            renderViews() { assertEqual(this, undefined, 'Injizierter Renderer behält seinen freien Aufruf'); renders++; }
        }
    };
}

const first = fixture();
const second = fixture();
const firstController = createStressReplayController(first.options);
const secondController = createStressReplayController(second.options);
firstController.initialize();
const firstHandlers = first.listeners.map(entry => entry.handler);
firstController.initialize();
assertEqual(first.loads, 1, 'Wiederholte Initialisierung lädt den Zustand genau einmal');
assertEqual(first.renders, 1, 'Wiederholte Initialisierung rendert nicht erneut');
assertEqual(first.listeners.length, 10, 'Jedes Ereignis wird genau einmal gebunden');
assert(first.listeners.every((entry, index) => entry.handler === firstHandlers[index]), 'Wiederholung erhält dieselben Handler');
assertEqual(second.loads, 0, 'Ein zweiter Controller wird nicht mitinitialisiert');
secondController.initialize();
assertEqual(firstController.getState(), first.empty, 'Erster Controller hält seinen eigenen lebenden Zustand');
assertEqual(secondController.getState(), second.empty, 'Zweiter Controller hält seinen eigenen lebenden Zustand');
assert(firstController.getState() !== secondController.getState(), 'Die Controller teilen keinen Arbeitsstand');

// Eigener Moduleinstieg hält den Singletontest von anderen UI-Tests getrennt.
const entry = await import('../app/simulator/stress-replay-ui/entry.js?zs6-contract');
const singleton = fixture();
const active = entry.initStressReplayUI(singleton.options);
assertEqual(entry.initStressReplayUI(second.options), active, 'Der Einstieg behält denselben aktiven Controller');
assertEqual(singleton.loads, 1, 'Der Singleton lädt nur einmal');
assertEqual(singleton.listeners.length, 10, 'Der Singleton bindet keine doppelten Listener');
