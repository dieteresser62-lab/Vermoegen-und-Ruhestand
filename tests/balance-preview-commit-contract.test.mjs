import {
    BALANCE_STATE_LIFECYCLE_KEY,
    BALANCE_UPDATE_MODE,
    BalanceStateLifecycleError,
    assertBalanceCandidateFresh,
    assertBalanceCommitStillCurrent,
    cloneBalanceState,
    createBalanceCommitBaseFingerprint,
    createBalanceFingerprint,
    persistBalanceUpdate,
    prepareEngineLastState,
    resolveBalanceUpdateRequest
} from '../app/balance/balance-update-pipeline.js';

console.log('--- Balance Preview/Commit Contract Tests ---');

const PERIOD_ID = 'calendar-year:2025';

function captureError(callback) {
    try {
        callback();
        return null;
    } catch (error) {
        return error;
    }
}

console.log('Test 1: update modes are explicit and every implicit or legacy request fails write-closed');
{
    assertEqual(
        resolveBalanceUpdateRequest().mode,
        BALANCE_UPDATE_MODE.PREVIEW,
        'Default updates are write-free'
    );
    assertEqual(
        resolveBalanceUpdateRequest({ mode: BALANCE_UPDATE_MODE.PREVIEW }).mode,
        BALANCE_UPDATE_MODE.PREVIEW,
        'Explicit preview mode is preserved'
    );
    [false, true, 0, null, '', 'false'].forEach(persist => {
        const legacyRequest = captureError(() => resolveBalanceUpdateRequest({ persist }));
        assert(legacyRequest instanceof BalanceStateLifecycleError,
            `Legacy persist=${String(persist)} is rejected instead of guessing a write mode`);
        assertEqual(legacyRequest.reason, 'legacy_persist_unsupported',
            'Legacy persist requests expose one stable fail-closed reason');
    });

    const missingPeriod = captureError(() => resolveBalanceUpdateRequest({
        mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD
    }));
    assert(missingPeriod instanceof BalanceStateLifecycleError, 'Commit without period id fails closed');

    const booleanCombination = captureError(() => resolveBalanceUpdateRequest({
        mode: BALANCE_UPDATE_MODE.PREVIEW,
        persist: false
    }));
    assert(booleanCombination instanceof BalanceStateLifecycleError, 'Mode and legacy boolean cannot be combined');
}

console.log('Test 2: engine candidates receive an isolated copy of fachlichen State');
{
    const persistentState = {
        inputs: { aktuellesAlter: 67 },
        lastState: {
            taxState: { lossCarry: 20000 },
            flexBudget: { balanceYears: 3 },
            vpw: { streak: 4 },
            lastWithdrawal: 36000
        }
    };
    const prepared = prepareEngineLastState(persistentState, persistentState.inputs);
    prepared.taxState.lossCarry = 0;
    prepared.flexBudget.balanceYears = 2;
    prepared.vpw.streak = 5;
    prepared.lastWithdrawal = 37000;

    assertEqual(persistentState.lastState.taxState.lossCarry, 20000, 'Preview keeps loss carry isolated');
    assertEqual(persistentState.lastState.flexBudget.balanceYears, 3, 'Preview keeps flex budget isolated');
    assertEqual(persistentState.lastState.vpw.streak, 4, 'Preview keeps VPW streak isolated');
    assertEqual(persistentState.lastState.lastWithdrawal, 36000, 'Preview keeps last withdrawal isolated');
}

console.log('Test 3: preview and input persistence never replace lastState');
{
    const saves = [];
    const persistentState = {
        inputs: { aktuellesAlter: 67, floorBedarf: 24000 },
        lastState: {
            taxState: { lossCarry: 20000 },
            flexBudget: { balanceYears: 3 },
            vpw: { streak: 4 }
        },
        annualPeriodMetadata: { lastCommittedPeriod: null, pendingCommit: null }
    };
    const storageManager = {
        loadState: () => persistentState,
        saveState: state => saves.push(structuredClone(state))
    };
    const modelResult = {
        newState: {
            taxState: { lossCarry: 0 },
            flexBudget: { balanceYears: 2 },
            vpw: { streak: 5 }
        }
    };

    const preview = persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.PREVIEW,
        storageManager,
        persistentState,
        inputData: { aktuellesAlter: 67, floorBedarf: 25000 },
        modelResult
    });
    assertEqual(preview.persisted, false, 'Preview reports no persistence');
    assertEqual(saves.length, 0, 'Preview performs no storage write');

    const inputWrite = persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS,
        storageManager,
        persistentState,
        inputData: { aktuellesAlter: 67, floorBedarf: 25000 },
        modelResult
    });
    assertEqual(inputWrite.persisted, true, 'Input mode reports persistence');
    assertEqual(inputWrite.kind, BALANCE_UPDATE_MODE.PERSIST_INPUTS, 'Input mode reports its persistence kind');
    assertEqual(saves.length, 1, 'Input mode performs one storage write');
    assertEqual(saves[0].inputs.floorBedarf, 25000, 'Changed input is reload-fest');
    assertEqual(saves[0].lastState.taxState.lossCarry, 20000, 'Input mode keeps loss carry');
    assertEqual(saves[0].lastState.flexBudget.balanceYears, 3, 'Input mode keeps flex budget');
    assertEqual(saves[0].lastState.vpw.streak, 4, 'Input mode keeps VPW state');
}

console.log('Test 4: a valid period commit advances state exactly once');
{
    let currentState = {
        inputs: { aktuellesAlter: 68, floorBedarf: 25000 },
        lastState: {
            taxState: { lossCarry: 20000 },
            flexBudget: { balanceYears: 3 },
            vpw: { streak: 4 }
        },
        annualPeriodMetadata: {
            lastCommittedPeriod: null,
            pendingCommit: {
                periodId: PERIOD_ID,
                snapshotId: 'snapshot-2025',
                phase: 'validating'
            }
        }
    };
    let saveCount = 0;
    const storageManager = {
        loadState: () => structuredClone(currentState),
        saveState: state => {
            saveCount += 1;
            currentState = structuredClone(state);
        }
    };
    const modelResult = {
        newState: {
            taxState: { lossCarry: 15000 },
            flexBudget: { balanceYears: 2 },
            vpw: { streak: 5 }
        }
    };
    const fingerprints = {
        inputFingerprint: createBalanceFingerprint(currentState.inputs),
        baseStateFingerprint: createBalanceFingerprint(currentState.lastState),
        candidateStateFingerprint: createBalanceFingerprint(modelResult.newState)
    };

    const committed = persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD,
        periodId: PERIOD_ID,
        storageManager,
        persistentState: currentState,
        inputData: currentState.inputs,
        modelResult,
        fingerprints
    });
    assertEqual(committed.persisted, true, 'Commit reports persistence');
    assertEqual(committed.kind, BALANCE_UPDATE_MODE.COMMIT_PERIOD, 'Commit reports its persistence kind');
    assertEqual(saveCount, 1, 'First commit writes once');
    assertEqual(currentState.lastState.taxState.lossCarry, 15000, 'Commit advances loss carry');
    assertEqual(currentState.lastState.flexBudget.balanceYears, 2, 'Commit advances flex budget');
    assertEqual(currentState.lastState.vpw.streak, 5, 'Commit advances VPW state');
    assertEqual(
        currentState[BALANCE_STATE_LIFECYCLE_KEY].lastCommittedPeriod,
        PERIOD_ID,
        'Commit records period id in lifecycle metadata'
    );
    assertEqual(
        currentState[BALANCE_STATE_LIFECYCLE_KEY].candidateStateFingerprint,
        fingerprints.candidateStateFingerprint,
        'Commit records the candidate fingerprint'
    );

    const duplicate = captureError(() => persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD,
        periodId: PERIOD_ID,
        storageManager,
        persistentState: currentState,
        inputData: currentState.inputs,
        modelResult,
        fingerprints
    }));
    assert(duplicate instanceof BalanceStateLifecycleError, 'Duplicate period commit fails closed');
    assertEqual(duplicate.reason, 'period_already_committed', 'Duplicate exposes a stable reason');
    assertEqual(saveCount, 1, 'Duplicate period commit performs no second write');
}

console.log('Test 5: stale candidates and invalid annual metadata fail closed');
{
    const stable = createBalanceFingerprint({ state: 1, inputs: 2 });
    assertEqual(assertBalanceCandidateFresh(stable, stable), stable, 'Matching fingerprints remain valid');

    const stale = captureError(() => assertBalanceCandidateFresh(stable, createBalanceFingerprint({
        state: 2,
        inputs: 2
    })));
    assert(stale instanceof BalanceStateLifecycleError, 'Changed basis state blocks stale candidate');
    assertEqual(stale.reason, 'stale_candidate', 'Stale candidate exposes a stable reason');

    const storageManager = {
        loadState: () => ({}),
        saveState: () => {
            throw new Error('must not write');
        }
    };
    const invalidPeriod = captureError(() => persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD,
        periodId: PERIOD_ID,
        storageManager,
        persistentState: {
            annualPeriodMetadata: {
                lastCommittedPeriod: null,
                pendingCommit: {
                    periodId: 'calendar-year:2024',
                    snapshotId: 'snapshot-2024',
                    phase: 'validating'
                }
            }
        },
        inputData: {},
        modelResult: { newState: {} },
        fingerprints: {}
    }));
    assert(invalidPeriod instanceof BalanceStateLifecycleError, 'Mismatched pending period blocks commit');
    assertEqual(invalidPeriod.reason, 'period_mismatch', 'Period mismatch exposes a stable reason');

    const baseState = {
        inputs: {
            floorBedarf: 24000,
            flexBedarf: 12000,
            depotLastUpdate: 100
        },
        lastState: { taxState: { lossCarry: 20000 } },
        annualPeriodMetadata: { pendingCommit: { phase: 'writes_started' } },
        uiOnlyMarker: 'first'
    };
    const baseFingerprint = createBalanceCommitBaseFingerprint({
        persistentState: baseState,
        profilverbundProfiles: []
    });
    const transientOnlyFingerprint = createBalanceCommitBaseFingerprint({
        persistentState: {
            ...baseState,
            inputs: { ...baseState.inputs, depotLastUpdate: 999 },
            annualPeriodMetadata: { pendingCommit: { phase: 'validating' } },
            uiOnlyMarker: 'second'
        },
        profilverbundProfiles: []
    });
    assertEqual(
        transientOnlyFingerprint,
        baseFingerprint,
        'Transient timestamp and workflow metadata do not invalidate a fachlichen candidate'
    );
    const financialChangeFingerprint = createBalanceCommitBaseFingerprint({
        persistentState: {
            ...baseState,
            lastState: { taxState: { lossCarry: 19999 } }
        },
        profilverbundProfiles: []
    });
    assert(financialChangeFingerprint !== baseFingerprint,
        'A changed fachlicher state still invalidates the candidate');

    const concurrentlyCommitted = captureError(() => assertBalanceCommitStillCurrent({
        expectedBaseFingerprint: baseFingerprint,
        currentBaseFingerprint: baseFingerprint,
        currentPersistentState: {
            ...baseState,
            annualPeriodMetadata: {
                lastCommittedPeriod: PERIOD_ID,
                pendingCommit: null
            }
        },
        periodId: PERIOD_ID
    }));
    assert(concurrentlyCommitted instanceof BalanceStateLifecycleError,
        'Final commit guard re-checks workflow metadata even when financial state is unchanged');
    assertEqual(concurrentlyCommitted.reason, 'period_already_committed',
        'Cross-window completion is detected by the final period re-check');

    [new Date('2026-01-01T00:00:00.000Z'), new Map([['state', 1]]), new Set([1])].forEach(value => {
        const nonJsonState = captureError(() => createBalanceFingerprint(value));
        assert(nonJsonState instanceof BalanceStateLifecycleError,
            'Fingerprinting rejects non-JSON runtime objects');
        assertEqual(nonJsonState.reason, 'non_json_state',
            'Non-JSON runtime objects expose one stable fail-closed reason');
        const nonJsonClone = captureError(() => cloneBalanceState(value));
        assert(nonJsonClone instanceof BalanceStateLifecycleError,
            'Cloning rejects the same non-JSON runtime objects as fingerprinting');
        assertEqual(nonJsonClone.reason, 'non_json_state',
            'Clone and fingerprint share the same non-JSON failure contract');
    });
}

console.log('Test 6: multi-profile modes dispatch inputs and fachlichen State separately');
{
    const calls = [];
    const profilverbundHandlers = {
        persistProfilverbundInputs: (runs, context) => calls.push({ kind: 'inputs', runs, context }),
        persistProfilverbundProfileStates: (runs, context) => calls.push({ kind: 'commit', runs, context })
    };
    const profilverbundRuns = Object.assign([{ profileId: 'p1' }, { profileId: 'p2' }], {
        householdResult: { newState: { taxState: { lossCarry: 0 } } }
    });
    const persistentState = {
        annualPeriodMetadata: {
            lastCommittedPeriod: null,
            pendingCommit: {
                periodId: PERIOD_ID,
                snapshotId: 'snapshot-multi',
                phase: 'validating'
            }
        }
    };

    persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS,
        profilverbundRuns,
        profilverbundHandlers,
        storageManager: {},
        persistentState,
        inputData: { floorBedarf: 25000 },
        modelResult: profilverbundRuns.householdResult
    });
    assertEqual(calls.length, 1, 'Multi-profile input mode dispatches once');
    assertEqual(calls[0].kind, 'inputs', 'Multi-profile input mode uses input-only writer');

    persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.COMMIT_PERIOD,
        periodId: PERIOD_ID,
        profilverbundRuns,
        profilverbundHandlers,
        storageManager: {},
        persistentState,
        inputData: { floorBedarf: 25000 },
        modelResult: profilverbundRuns.householdResult,
        fingerprints: {
            inputFingerprint: 'input',
            baseStateFingerprint: 'base',
            candidateStateFingerprint: 'candidate'
        }
    });
    assertEqual(calls.length, 2, 'Multi-profile commit dispatches once');
    assertEqual(calls[1].kind, 'commit', 'Multi-profile commit uses fachlichen state writer');
    assertEqual(
        calls[1].context.lifecycle.lastCommittedPeriod,
        PERIOD_ID,
        'Multi-profile commit receives the same lifecycle period'
    );

    const emptyRuns = captureError(() => persistBalanceUpdate({
        mode: BALANCE_UPDATE_MODE.PERSIST_INPUTS,
        profilverbundRuns: [],
        profilverbundHandlers,
        storageManager: {},
        persistentState,
        inputData: {}
    }));
    assert(emptyRuns instanceof BalanceStateLifecycleError,
        'An empty multi-profile run list fails closed instead of reporting a phantom write');
    assertEqual(emptyRuns.reason, 'profile_runs_required',
        'Empty multi-profile persistence exposes a stable reason');
}

console.log('Balance preview/commit contract tests passed');

// Echte Main-Orchestrierung mit isolierten UI-/Enginegrenzen. Der fachliche
// Persistenzvertrag oben bleibt unverändert; nur der neue Anzeigeeintrag kommt hinzu.
const { functionSource } = await import('./designsystem-selection-dom.mjs');
const pipeline = await import('../app/balance/balance-update-pipeline.js');
const { evaluateBalanceFileInputs } = await import('../app/balance/balance-file-service.js');
const { buildBalanceOverviewSummary } = await import('../app/overview/overview-model.js');
const { overviewScope } = await import('../app/overview/overview-storage.js');
const noop = () => {};
const financial = { annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null }, inputs: { unchanged: true }, lastState: { unchanged: true } };
const financialBytes = JSON.stringify(financial);
let members = [], saved = [], fachwrites = 0, engineCalls = 0, inputReads = 0, blocked = false, broken = false;
const engine = { simulateSingleYear() { engineCalls++; if (broken) throw new Error('synthetische Engineabweichung'); return { ui: { spending: { monatlicheEntnahme: 700 }, action: {}, market: {}, liquiditaet: {} }, newState: { candidate: true }, diagnosis: {} }; } };
const deps = { document: { getElementById: () => null }, getBalancePlanTrial: () => ({ read: () => ({ active: false }), reset() {} }), renderBalanceInflationSource() {}, ...pipeline, evaluateBalanceFileInputs, buildBalanceOverviewSummary, overviewScope,
    // Diese Altweg-Fixture bildet die ausdrückliche Entscheidung „Später“ ohne Plan ab.
    readBalanceHouseholdPlan: () => ({ status: 'missing', scope: null }),
    readBalancePersonStatus: () => ({ ready: true, status: 'complete' }), showPersonDataStatus: noop,
    refreshBalanceWealthHistory: noop, refreshBalanceExpensesHistory: noop,
    getCurrentProfileId: () => 'a', dom: { inputs: { fixedIncomeAnnual: { value: '12000' } } },
    appState: {}, window: { EngineAPI: engine }, console: { error: noop },
    assertActiveEngineHandshake: () => engine, profileSyncHandlers: { syncProfileDerivedInputs: noop },
    UIReader: { captureStorageDraft: () => { inputReads++; const calculation = deps.buildBalanceEngineInputFromStorage();
        return { calculation, fields: {}, patch: {}, plan: calculation.householdPlan, source: deps.UIReader.readInputSourceFingerprint(), baseSourceFingerprint: calculation.sourceFingerprint }; },
        readInputSourceFingerprint: () => JSON.stringify(deps.dom.inputs), renderMarketDataProvenance: noop },
    validateBalanceInputs: noop, loadProfilverbundProfiles: () => members,
    profilverbundHandlers: { updateProfilverbundGlobals: noop, refreshProfilverbundBalance: noop,
        runProfilverbundProfileSimulations: () => Object.assign(members.map(p => ({ ...p, newState: {} })), { householdResult: engine.simulateSingleYear() }) },
    UIRenderer: { clearError: noop, renderContext: noop, renderBedarfAnpassungUI: noop,
        render: noop, formatDiagnosisPayload: () => ({}), renderDiagnosis: noop, handleError: noop },
    StorageManager: { loadState: () => financial, saveState: noop },
    stripBalancePlanInputs: input => input, persistenceStorage: { getItem: () => null }, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' },
    buildBalanceEngineInputFromStorage: () => {
        const householdPlan = deps.readBalanceHouseholdPlan();
        return { inputData: { aktuellesAlter: blocked ? 0 : 67 }, persistentState: financial, householdPlan, scope: householdPlan.scope,
            profiles: members, history: { persistentState: financial, profiles: members },
            baseStateFingerprint: pipeline.createBalanceFingerprint(householdPlan), sourceFingerprint: pipeline.createBalanceFingerprint(householdPlan) };
    }, prepareEngineLastState: () => ({}),
    postprocessBalanceAction: () => ({}), withGuardrailCardValues: value => value,
    ANNUAL_MARKET_DATA_META_KEY: 'annualMarketDataMeta', UIUtils: { parseCurrency: Number }, updateExpensesBudget: noop,
    persistBalanceUpdate: () => { fachwrites++; return {}; },
    storeOverviewSummary: (summary, options) => { saved.push({ summary, options }); return Promise.resolve(true); }
};
const mainUpdate = new Function('deps', `with (deps) { ${functionSource('app/balance/balance-main.js', 'update')} return update; }`)(deps);
const preview = mainUpdate({ mode: 'preview' });
assertEqual(preview.ok, true, 'Echte Main-Vorschau bleibt erfolgreich');
assertEqual(inputReads, 1, 'Main-Vorschau aggregiert Fachinputs genau einmal');
preview.validateWealthHistorySource();
deps.dom.inputs.fixedIncomeAnnual.value = '13000';
assert(captureError(() => preview.validateWealthHistorySource()) instanceof Error,
    'Main-Vorschau bindet Rohwertänderungen über die gesonderte Reader-Methode');
assertEqual(inputReads, 1, 'Quellenvalidierung aggregiert keine weiteren Fachinputs');
deps.dom.inputs.fixedIncomeAnnual.value = '12000';
assertEqual(await preview.overviewPersistence, true, 'Main liefert den gesonderten Summary-Schreibabschluss');
assertEqual(saved.length, 1, 'Erfolgreicher Einzelpreview schreibt genau einen Anzeigeeintrag');
assertEqual(saved[0].summary.scope.key, overviewScope('single', ['a']).key, 'Einzelplan bindet die aktive Profilidentität');
assertEqual(saved[0].summary.monthlyWithdrawal, 700, 'Summary verwendet die vorhandene Entnahme');
assertEqual(saved[0].summary.monthlyBudget, 1700, 'Budget enthält feste Einkünfte getrennt von Entnahme');
assertEqual(saved[0].summary.status, 'vorläufig', 'Erfolgreicher Preview allein ist kein fester Plan');
assertEqual(fachwrites, 0, 'Preview ergänzt keine Fachpersistenz');
assertEqual(JSON.stringify(financial), financialBytes, 'Preview erhält Inputs, Enginezustand und Jahresmetadaten bytegleich');
const initialCalls = engineCalls;
blocked = true;
assertEqual(mainUpdate({ mode: 'preview' }).status, 'blocked', 'Unvollständiger Lauf bleibt blockiert');
assertEqual(engineCalls, initialCalls, 'Blockierter Lauf startet keine Engine');
broken = true; blocked = false;
assertEqual(mainUpdate({ mode: 'preview' }).ok, false, 'Enginefehler bleibt fehlgeschlagen');
assertEqual(saved.length, 1, 'Fehlerhafte und blockierte Läufe ersetzen keine Summary');
broken = false; members = [{ profileId: 'b', balanceState: {} }, { profileId: 'a', balanceState: {} }];
const household = mainUpdate({ mode: 'preview' });
assertEqual(await household.overviewPersistence, true, 'Erfolgreicher Haushalt speichert eine gemeinsame Summary');
assertEqual(saved[1].summary.scope.key, overviewScope('household', ['a', 'b']).key, 'Haushaltsumfang bindet alle beteiligten IDs sortiert');
assertEqual(saved[1].summary.monthlyWithdrawal, 700, 'Haushaltsentnahme wird nicht aus Einzel-Summaries addiert');
assertEqual(fachwrites, 0, 'Auch Haushaltspreview ergänzt keine Fachpersistenz');

const writesBeforeFailure = saved.length;
deps.persistBalanceUpdate = () => { throw new Error('synthetischer Fachpersistenzfehler'); };
assertEqual(mainUpdate({ mode: 'persist_inputs' }).ok, false, 'Gescheiterte Fachpersistenz bleibt ein fehlgeschlagener Lauf');
assertEqual(saved.length, writesBeforeFailure, 'Gescheiterte Fachpersistenz ersetzt keinen gespeicherten Plan');
deps.buildBalanceOverviewSummary = () => { throw new Error('synthetischer Anzeigefehler'); };
const failedDisplay = mainUpdate({ mode: 'preview' });
assertEqual(failedDisplay.ok, true, 'Zusammenfassungsfehler ändert keinen erfolgreichen Fachlauf');
assertEqual(await failedDisplay.overviewPersistence, false, 'Zusammenfassungsfehler hat einen getrennten Schreibstatus');

// Die neue Planquelle muss auch am produktiven Main-Schreibgate neu gelesen werden.
{
    const { PLAN_DEFAULTS, planScope } = await import('../app/profile/household-plan.js');
    let planValues = structuredClone(PLAN_DEFAULTS), planWrites = 0;
    members = [];
    deps.buildBalanceOverviewSummary = buildBalanceOverviewSummary;
    deps.readBalanceHouseholdPlan = () => ({ status: 'valid', scope: planScope('household', ['a']),
        entry: { values: structuredClone(planValues) } });
    deps.stageBalancePlanPatch = () => { planWrites++; return { values: structuredClone(planValues) }; };
    deps.UIReader.readHouseholdPlanPatch = () => ({});
    deps.UIReader.applyHouseholdPlanInputs = noop;
    deps.persistBalanceUpdate = () => { fachwrites++; return {}; };
    deps.UIRenderer.render = () => { planValues.floorBedarf++; };
    const writesBeforeStale = fachwrites, summariesBeforeStale = saved.length;
    const stalePlanResult = mainUpdate({ mode: 'persist_inputs' });
    assertEqual(stalePlanResult.ok, false, 'Main verwirft den durch Planänderung veralteten Kandidaten');
    assertEqual(stalePlanResult.error.reason, 'stale_candidate', 'Planänderung nutzt den bestehenden Kandidatenfehler');
    assertEqual(planWrites, 1, 'Formularbesitzer bestätigt Eingaben vor der Rechnung; veralteter Engine-State bleibt gesperrt');
    assertEqual(fachwrites, writesBeforeStale, 'Main schreibt keinen Fachstate aus einem veralteten Kandidaten');
    assertEqual(saved.length, summariesBeforeStale, 'Veralteter Kandidat ersetzt keine Jahreszusammenfassung');
    assertEqual(JSON.stringify(financial), financialBytes, 'Abgewiesener Plankandidat erhält den Ausgangsstate bytegleich');
    deps.UIRenderer.render = noop;
    const currentPlanResult = mainUpdate({ mode: 'persist_inputs' });
    assertEqual(currentPlanResult.ok, true, 'Unveränderte Planbasis bleibt am selben Main-Gate schreibbar');
    assertEqual(planWrites, 2, 'Jeder bestätigte Formularlauf erreicht genau einen Planpatch');
    assertEqual(fachwrites, writesBeforeStale + 1, 'Gültiger Main-Kandidat erreicht die vorhandene Fachpersistenz');
    assertEqual(await currentPlanResult.overviewPersistence, true, 'Gültiger Main-Kandidat speichert seine Zusammenfassung');
}
