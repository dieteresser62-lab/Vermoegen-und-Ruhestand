import { deriveBalanceNextSteps } from '../app/balance/balance-next-steps.js';
const base = { occasion: { kind: 'play', annualState: 'done', closingYear: 2025 }, actionBasis: { material: false }, basisCurrent: true,
    cashStatus: { state: 'valid', pendingCount: 0 } };
const ids = changes => deriveBalanceNextSteps({ ...base, ...changes }).map(step => step.id).join(',');
assertEqual(ids({}), '', 'Belegte leere Pflichtliste ist erledigt');
assertEqual(ids({ actionBasis: { material: true } }), '', 'Materielle Handlung erzeugt keine Umsetzungspflicht');
assertEqual(ids({ basisCurrent: false }), '', 'Veraltete Vorschau erzeugt keine Planprüfpflicht');
assertEqual(ids({ actionBasis: null }), '', 'Alte Summary ohne Grundlage erzeugt keine Planprüfpflicht');
assertEqual(ids({ occasion: { ...base.occasion, annualState: 'not_applicable' } }), '', 'Vor Planungsbeginn weder Jahresabschluss noch ungeklärt');
for (const annualState of ['open', 'unclear', 'recovery', 'unavailable']) {
    assertEqual(ids({ occasion: { ...base.occasion, kind: 'annual', annualState } }), 'annual,monthly', annualState + ': bestehender Jahresweg plus unbestätigter Monat');
}
assertEqual(ids({ occasion: { ...base.occasion, kind: 'monthly' } }), 'monthly', 'Nur bestätigte Bereitstellung entfernt Monatspflicht');
assertEqual(ids({ cashStatus: { state: 'valid', pendingCount: 2 } }), 'cash', 'Offene manuelle Cashbuchungen bleiben Pflicht');
assertEqual(ids({ cashStatus: { state: 'error' } }), 'cash', 'Beschädigtes Audit liefert keine Entwarnung');
assertEqual(ids({ cashStatus: null }), 'cash', 'Fehlendes Audit liefert keine Entwarnung');
const all = deriveBalanceNextSteps({ ...base, occasion: { kind: 'annual', annualState: 'open', closingYear: 2025 }, actionBasis: { material: true }, cashStatus: { state: 'error' } });
assertEqual(all.map(step => step.id).join(','), 'annual,monthly,cash', 'Identische stabile Kennungen für beide Renderer');
assert(all.every(step => step.status === 'open' && step.title && step.href), 'Jeder Pflichtschritt besitzt Titel und bedienbaren bestehenden Link');

const { projectOverview } = await import('../app/overview/overview-model.js');
const { CONFIG } = await import('../app/balance/balance-config.js');
const source = { depot_tranchen: '[]', profile_tagesgeld: '100',
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null } }),
    balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
const projected = projectOverview({ registry: { version: 1, profiles: { a: { meta: { name: 'A' }, data: source } } }, activeId: 'a', liveData: source, now: new Date(2027, 0, 15) });
const actual = { ...base, occasion: projected.occasion, actionBasis: { material: true }, expenses: projected.expenses, monthlyWithdrawal: 500 };
const before = JSON.stringify(actual);
assertEqual(ids(actual), 'annual,monthly,expenses', 'Echte Vorjahresprojektion: Jahresabschluss, Betrag und fehlender Import bleiben echte Pflichten');
assertEqual(deriveBalanceNextSteps(actual)[0].href, 'Balance.html?year=2026#jahresabschluss', 'Gemeinsame Quelle bewahrt die Abschlussperiode');
assertEqual(deriveBalanceNextSteps(actual).find(step => step.id === 'expenses').href, 'Balance.html?year=2026&month=1#ausgaben-import', 'Erster fehlender Personenmonat ist erreichbar');
assertEqual(JSON.stringify(actual), before, 'Gemeinsame Ableitung verändert keine Eingaben');
for (const monthlyWithdrawal of [undefined, null, NaN, 0, 500]) {
    const result = deriveBalanceNextSteps({ ...base, monthlyWithdrawal, expenses: { year: 2026, month: 9, complete: false }, occasion: { ...base.occasion, monthCompleted: true } });
    assertEqual(result.map(step => step.id).join(','), 'expenses', 'Bestätigte Bereitstellung ersetzt keinen fehlenden Import, Betrag: ' + monthlyWithdrawal);
}
assertEqual(ids({ expenses: { year: 2026, month: 9, complete: true }, monthlyWithdrawal: null }), 'expenses', 'Fehlender Monatsbetrag erhält bestehenden Ausgabenvergleich');
assertEqual(ids({ occasion: { ...base.occasion, kind: 'monthly' }, expenses: { year: 2026, month: 9, complete: true }, monthlyWithdrawal: 0 }), 'monthly,expenses', 'Nullbetrag bleibt gültig; Import und Vergleich bestätigen keine Bereitstellung');
assertEqual(ids({ expenses: { beforePlanning: true, complete: false } }), '', 'Vor Planungsbeginn wird kein Import verlangt');

for (const kind of ['start', 'monthly']) {
    const steps = deriveBalanceNextSteps({ occasion: { kind, annualState: 'not_applicable', monthApplicable: false },
        actionBasis: { material: false }, basisCurrent: true, cashStatus: { state: 'valid', pendingCount: 0 } });
    assert(!steps.some(step => step.id === 'annual' || step.id === 'monthly'), 'Vor Planungsbeginn gibt es weder Abschluss noch Bereitstellung');
}
