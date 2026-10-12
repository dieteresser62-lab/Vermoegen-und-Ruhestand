import { projectAnnualCloseResult, createAnnualActionResult, createAnnualPlanResult, ANNUAL_ACTION_NOTICE } from '../app/shared/annual-close-result.js';
import { createCloseResult, dialogElements } from '../app/shared/close-dialog.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { buildAnnualPlanRecord, ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { PLAN_DEFAULTS, planScope } from '../app/profile/household-plan.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { formatAnnualNeed } from '../app/balance/balance-annual-preview.js';

const scope = planScope('household', ['a', 'b']);
const displayPreview = { targetYear: 2026, planningYear: 2027, inflation: { rate: 2.5 }, needs: [{ id: 'floorBedarf', before: 30000, after: 30750 }, { id: 'flexBedarf', before: 24000, after: 24600 }] };
const clean = text => text.replaceAll('\u00a0', ' ');
for (const type of ['NONE', 'TRANSACTION']) {
    const action = type === 'NONE' ? { type, title: 'Keine Transaktion', steuer: 0 } : { type, title: 'Aktien verkaufen und Gold kaufen',
        quellen: [{ kind: 'aktien_neu', brutto: 1200, netto: 1000, steuer: 200 }], verwendungen: { gold: 600, liquiditaet: 400 }, steuer: 200 };
    const adopted = { monthlyWithdrawal: 1500, monthlyBudget: 2000, liquidityBefore: 70, liquidityAfter: 80, flexRate: 100, marketPhase: 'Test', action,
        snapshot: { plan: { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 30750, flexBedarf: 24600 }, inflation: 2.5, ageByPerson: { a: 60, b: 62 } } };
    const record = buildAnnualPlanRecord(null, { targetYear: 2026, scope, committedAt: '2027-01-02T12:00:00Z', recommended: adopted });
    const raw = record.raw;
    const storage = { getItem: key => key === ANNUAL_PLAN_RECORD_KEY ? raw : null, setItem() { throw new Error('Kein Write erlaubt'); } };
    const view = projectHouseholdPlanComparison({ year: 2027, scope, storage, preview: { year: 2027, scope, action: { verb: 'Heutige Vorschau' } } });
    const model = { scope, planComparison: view };
    const before = JSON.stringify({ model, displayPreview });
    const result = projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model, displayPreview });
    const { doc } = createDialogFixture();
    const actionSection = createAnnualActionResult({ doc, result }), yearSection = createAnnualPlanResult({ doc, result });
    const body = createCloseResult({ doc, month: 'Dezember', nextMonth: 'Januar', expenses: '100 €', budgetComparison: 'im Budget',
        people: [{ name: 'A', value: '100 €' }, { name: 'B', value: '200 €' }], cashTotal: '300 €', withdrawal: '1.500 €', planYear: 2027, actionSection, yearSection });
    assertEqual(body.children[1], actionSection, 'Handlungsanweisung folgt unmittelbar auf Alles gespeichert');
    assertEqual(body.children[2], yearSection, 'Verbindlicher Planstand folgt vor MONAT');
    const texts = dialogElements(body).map(node => clean(node.textContent || ''));
    assert(texts.includes('Handlungsanweisung 2027 (verbindlich)'), 'Bestätigtes Folgejahr steht in der Überschrift');
    assert(texts.some(text => text.includes('30.000,00 € → 30.750,00 € (+2,5 % Inflation 2026)')), 'Sichere Vorheraufnahme zeigt tatsächliche Inflation');
    assertEqual(texts.join(' ').split('Monatsbetrag Januar').length - 1, 1, 'Januarbetrag erscheint genau einmal');
    assert(texts.includes('Monatsinformation aus dem bestätigten Plan 2027'), 'Monatsbetrag nennt Plan J+1');
    assert(texts.includes('Steuer gesamt: ' + (type === 'NONE' ? '0,00 €' : '200,00 €')), 'Steuerinformation kommt aus dem Beleg');
    if (type === 'NONE') assert(texts.includes('Nichts tun – kein Handlungsbedarf'), 'NONE hat eine klare Kernaussage');
    else assert(texts.includes('Verkäufe / Entnahmen') && texts.includes('Käufe / Verwendung') && texts.some(text => text.includes('Aktien (Neubestand)')) && texts.some(text => text.includes('Gold:')), 'Transaktion gliedert Anlageklassen, Quellen und Verwendung');
    assert(!texts.join(' ').includes('Heutige Vorschau'), 'Unterjährige Vorschau wird nicht zur verbindlichen Handlung');
    assertEqual(JSON.stringify({ model, displayPreview }), before, 'Anzeige verändert weder Modell noch flüchtige Vorheraufnahme');
    for (const invalid of ['year', 'scope', 'missing', 'unconfirmed']) {
        const changed = structuredClone(model);
        if (invalid === 'year') changed.planComparison.year = 2028;
        if (invalid === 'scope') changed.scope = planScope('single', ['outside']);
        if (invalid === 'missing') changed.planComparison.recordStatus = 'missing';
        const fallback = projectAnnualCloseResult({ targetYear: 2026, confirmed: invalid !== 'unconfirmed', model: changed });
        assertEqual(fallback.notice, ANNUAL_ACTION_NOTICE, invalid + ': fehlende passende Bestätigung zeigt den bestehenden Hinweis');
        assert(!fallback.action, invalid + ': keine Ersatzhandlung');
    }
    const resumed = projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model });
    assert(!formatAnnualNeed(resumed.needs[0], resumed).includes('→'), 'Wiederaufnahme ohne sichere Vorherquelle zeigt nur neue Bedarfe');
}
const options = { inflation: { rate: 2.5 }, targetYear: 2026 };
assertEqual(clean(formatAnnualNeed({ id: 'floorBedarf', before: 30000, after: 31000 }, { ...options, adjustedFields: ['floorBedarf'] })), '30.000,00 € → 31.000,00 € (von dir angepasst)', 'Bewusste Anpassung wird nicht als Inflation ausgegeben');
assert(!formatAnnualNeed({ id: 'floorBedarf', before: 30000, after: 30000 }, options).includes('→'), 'Gleiche Werte erzeugen keinen identischen Pfeil');
