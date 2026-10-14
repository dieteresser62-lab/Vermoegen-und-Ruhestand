import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { renderOverview } from '../app/overview/overview-renderer.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { completedComparisonFixture } from './household-plan-comparison.test.mjs?fixture';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryKey } from '../app/profile/annual-plan-record.js';
import { planScope } from '../app/profile/household-plan.js';
import { overviewScope, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';

const f = completedComparisonFixture({ adjusted: true });
const record = JSON.parse(f.records[ANNUAL_PLAN_RECORD_KEY]);
const adopted = record.entries[annualPlanEntryKey(2026, f.scope)].adopted;
adopted.action = { type: 'TRANSACTION', title: 'Beschlossener Verkauf',
    quellen: [{ kind: 'aktien_neu', source: 'Synthetisch', brutto: 1234, netto: 1000, steuer: 234 }],
    verwendungen: { gold: 600, liquiditaet: 400 }, steuer: 234 };
f.records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
const storage = { getItem: key => f.records[key] ?? null, setItem() { throw new Error('Anzeige darf nicht schreiben'); } };
const sourceBytes = JSON.stringify(f);
const view = projectHouseholdPlanComparison({ year: 2026, scope: f.scope, storage });
const options = { comparison: view, year: 2026, scope: overviewScope('household', ['z', 'a']),
    occasion: { closingYear: 2025, annualState: 'done' } };
const origin = projectBalanceActionOrigin(options);
assertEqual(origin.label, 'Handlungsanweisung 2026 · festgeschrieben im Jahresabschluss vom 02.01.2026', 'Jahr und Abschlussdatum stammen aus dem Beleg');
assertEqual(JSON.stringify(origin.confirmed.action), JSON.stringify(adopted.action), 'Jahresaktion ist exakt adopted.action, ohne heutige Ableitung');
assertEqual(origin.previewYear, 2026, 'Oktobervorschau nennt das nächste Abschlussjahr statt des Folgeplanjahrs');
assertEqual(projectBalanceActionOrigin({ ...options, occasion: { closingYear: 2025, annualState: 'open' } }).previewYear, 2025,
    'Offener Vorjahresabschluss bleibt die unmittelbar nächste Abschlussperiode');
const { doc } = createDialogFixture();
const host = doc.createElement('div');
host.replaceChildren = (...children) => { [...host.children].forEach(child => child.remove()); host.append(...children); };
for (const id of ['overviewPlanComparison', 'overviewPlanStatus', 'overviewTitle', 'overviewLead']) {
    const node = doc.createElement('div'); node.id = id; doc.body.appendChild(node);
}
const renderer = new SummaryRenderer({ outputs: { balanceAnnualAction: host } });
const texts = () => dialogElements(host).map(node => node.textContent).join(' ').replaceAll('\u00a0', ' ');
renderer.renderAnnualAction(origin);
assert(texts().includes('1.234,00 € brutto · 234,00 € Steuer') && texts().includes('1.000,00 €') && texts().includes('Gold: 600,00 €') && texts().includes('Tagesgeld: 400,00 €'), 'Jahresblock zeigt unveränderte Quellen, Verwendungen und Steuer');
assert(!host.querySelector('[data-annual-action-details]').open && host.querySelector('[data-annual-action-sales]'), 'Gemeinsamer Jahresblock zeigt Nettoerlös offen und Brutto/Steuer in Details');
assert(!texts().includes('Heutige materielle Vorschau') && texts().includes('Beschlossener Verkauf'), 'Jahresblock ersetzt den Beschluss nicht durch Vorschau oder recommended');
renderer.renderAnnualAction(origin);
assertEqual(host.querySelectorAll('[data-annual-action-result]').length, 1, 'Wiederholtes Rendern erzeugt genau einen Jahresblock');
origin.confirmed.action.steuer = 9999;
assertEqual(adopted.action.steuer, 234, 'Herkunftsprojektion liefert eine unabhängige Ansichtskopie');
assertEqual(view.confirmedAction.action.steuer, 234, 'Auch der Vergleich bleibt unverändert');

for (const now of [new Date('2026-01-15T12:00:00Z'), f.now]) {
    const model = projectOverview({ registry: f.registry, activeId: 'z', liveData: f.records, now });
    renderOverview(doc, model);
    const overviewHtml = doc.getElementById('overviewPlanComparison').innerHTML;
    assert(overviewHtml.includes('festgeschrieben im Jahresabschluss vom 02.01.2026') && overviewHtml.includes('Vorläufige Vorschau · Jahresabschluss 2026'), 'Startseite zeigt Beschlussdatum und vorläufige Vorschau mit nächstem Jahresabschluss');
    assert(model.actionOrigin.confirmed && model.actionOrigin.confirmed.action.steuer === 234, 'Januar und Oktober zeigen den gespeicherten Jahresbeschluss');
    assert(!model.nextSteps.some(step => ['action', 'plan'].includes(step.id)), 'Materieller Beschluss und materielle Vorschau erzeugen keine offenen Schritte');
    if (now.getMonth() === 9) assertEqual(model.previewSummary.action.verb, 'Aktien verkaufen', 'Die heutige Vorschau bleibt unabhängig verfügbar');
}
for (const change of [{ year: 2027 }, { scope: planScope('single', ['out']) },
    { comparison: { ...view, recordStatus: 'missing' } }, { comparison: { ...view, recordStatus: 'invalid', notice: 'Jahresbeleg beschädigt' } }]) {
    const missing = projectBalanceActionOrigin({ ...options, ...change });
    renderer.renderAnnualAction(missing);
    assert(!missing.confirmed && !host.querySelector('[data-annual-action-result]'), 'Falsches Jahr, Fremdprofil und fehlender/ungültiger Beleg leeren den Jahresblock');
    assert(!texts().includes('1.234') && !texts().includes('festgeschrieben im'), 'Kein Fremdbeschluss und keine falsche Verbindlichkeit bleiben stehen');
    if (change.comparison?.recordStatus === 'invalid') assert(host.querySelector('[role="alert"]'), 'Beschädigter Beleg bleibt als Datenproblem sichtbar');
}
const single = planScope('household', ['a']);
const alias = projectBalanceActionOrigin({ ...options, scope: overviewScope('single', ['a']), comparison: { ...view, scope: single } });
assert(alias.confirmed, 'Der bestehende Einpersonenhaushaltsalias bleibt lesbar');
assert(!projectBalanceActionOrigin({ ...options, scope: planScope('single', ['out']) }).confirmed, 'Eine Außenperson erhält keinen Haushaltsbeschluss');
const noneView = structuredClone(view); noneView.confirmedAction.action = { type: 'NONE', title: 'Keine Transaktion', steuer: 0 };
renderer.renderAnnualAction(projectBalanceActionOrigin({ ...options, comparison: noneView }));
assert(texts().includes('Nichts tun – kein Handlungsbedarf') && texts().includes('Steuer gesamt: 0,00 €'), 'Beschlossenes Nichtstun bleibt eine vollständige Jahresanzeige');

// Normaler Einzelumfang, nachdem die Haushaltsauswahl aufgehoben wurde.
const outsideRegistry = structuredClone(f.registry);
for (const profile of Object.values(outsideRegistry.profiles)) profile.meta.belongsToHousehold = false;
const outside = projectOverview({ registry: outsideRegistry, activeId: 'out', liveData: f.records, now: f.now, balanceSingleFallback: true });
renderer.renderAnnualAction(outside.actionOrigin);
assertEqual(outside.scope.key, planScope('single', ['out']).key, 'Profilwechsel lädt den tatsächlichen Einzelumfang');
assert(!outside.actionOrigin.confirmed && !texts().includes('Beschlossener Verkauf'), 'Außenperson ohne eigenen Beleg zeigt keine fremde Jahresaktion');
const reloaded = projectOverview({ registry: structuredClone(f.registry), activeId: 'a', liveData: structuredClone(f.records), now: f.now });
renderer.renderAnnualAction(reloaded.actionOrigin);
assert(texts().includes('Beschlossener Verkauf') && host.querySelectorAll('[data-annual-action-result]').length === 1, 'Reload und Rückkehr zum Haushalt zeigen genau den passenden Jahresbeschluss');

for (const preview of [null, '{broken', JSON.stringify({ version: 1, entries: {} })]) {
    const liveData = { ...f.records, [OVERVIEW_SUMMARY_KEY]: preview };
    delete liveData[ANNUAL_PLAN_RECORD_KEY];
    const model = projectOverview({ registry: f.registry, activeId: 'z', liveData, now: f.now });
    assert(!model.actionOrigin.confirmed, 'Alte Abschlussmetadaten und Summary ersetzen keinen Beleg');
    assert(!model.nextSteps.some(step => ['action', 'plan'].includes(step.id)), 'Fehlende oder beschädigte Vorschau erzeugt keine unterjährige Planpflicht');
}
assertEqual(JSON.stringify(f), sourceBytes, 'Herkunft, Modell und Rendering verändern keine Eingabe- oder Speicherbytes');
assertEqual(JSON.stringify(options.comparison), JSON.stringify(view), 'Die Anzeige verändert das Vergleichsmodell nicht');
