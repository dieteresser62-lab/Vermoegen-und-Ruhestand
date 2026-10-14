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
    assert(texts.includes('Handlungsanweisung 2027 · festgeschrieben'), 'Bestätigtes Folgejahr steht in der Überschrift');
    assert(texts.includes('Die Umsetzung (Verkäufe, Umbuchungen) entscheidest du.'), 'Freiwillige Umsetzung steht direkt bei der Handlungsanweisung');
    assert(texts.some(text => text.includes('30.000,00 € → 30.750,00 € (+2,5 % Inflation 2026)')), 'Sichere Vorheraufnahme zeigt tatsächliche Inflation');
    assertEqual(texts.join(' ').split('Monatsbetrag Januar').length - 1, 1, 'Januarbetrag erscheint genau einmal');
    assert(texts.includes('Monatsinformation aus dem bestätigten Plan 2027'), 'Monatsbetrag nennt Plan J+1');
    assert(texts.includes('Steuer gesamt: ' + (type === 'NONE' ? '0,00 €' : '200,00 €')), 'Steuerinformation kommt aus dem Beleg');
    if (type === 'NONE') assert(texts.includes('Nichts tun – kein Handlungsbedarf'), 'NONE hat eine klare Kernaussage');
    else assert(texts.includes('Vorgeschlagene Verkäufe nach Person') && texts.includes('Käufe / Verwendung') && texts.some(text => text.includes('Aktien (Neubestand)')) && texts.some(text => text.includes('Gold:')), 'Transaktion gliedert Anlageklassen, Quellen und Verwendung');
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
        assert(!dialogElements(createAnnualActionResult({ doc, result: fallback })).some(node => node.textContent.includes('festgeschrieben')),
            invalid + ': fehlender Beleg wird nicht als festgeschrieben bezeichnet');
    }
    const resumed = projectAnnualCloseResult({ targetYear: 2026, confirmed: true, model });
    assert(!formatAnnualNeed(resumed.needs[0], resumed).includes('→'), 'Wiederaufnahme ohne sichere Vorherquelle zeigt nur neue Bedarfe');
}
{
    const { doc } = createDialogFixture();
    const result = { year: 2027, people: [{ id: 'a', name: 'Max Mustermann' }, { id: 'b', name: 'Erika Mustermann' }],
        text: 'Aktien verkaufen', action: { type: 'TRANSACTION', title: 'Profilverbund-Transaktionen', steuer: 300,
            quellen: [
                { kind: 'aktien_neu', sourceProfileName: 'Max Mustermann', name: 'Muster Welt-ETF', isin: 'DE000TEST001', brutto: 1200, netto: 1000, steuer: 200 },
                { kind: 'aktien_neu', sourceProfileId: 'b', name: 'Muster Europa-ETF', isin: 'DE000TEST002', brutto: 600, netto: 500, steuer: 100 },
                { kind: 'liquiditaet', sourceProfileName: 'Max Mustermann', brutto: 50, netto: 50, steuer: 0 }
            ], verwendungen: { liquiditaet: 1550 } } };
    const before = JSON.stringify(result);
    const section = createAnnualActionResult({ doc, result });
    const table = section.querySelector('[data-annual-action-sales]');
    const rows = table.querySelector('tbody').children;
    const rowText = row => row.children.map(node => clean(node.textContent)).join(' | ');
    assertEqual(rowText(rows[0]), 'Max Mustermann | Muster Welt-ETF · DE000TEST001 | 1.000,00 €', 'Erste Position ordnet Person, Wertpapier und bestätigten Nettoerlös zu');
    assertEqual(rowText(rows[1]), 'Erika Mustermann | Muster Europa-ETF · DE000TEST002 | 500,00 €', 'Zweite Position bleibt trotz gleicher Anlageklasse eindeutig zugeordnet');
    assertEqual(rows.length, 2, 'Tagesgeldentnahme wird nicht als Wertpapierverkauf bezeichnet');
    const details = section.querySelector('[data-annual-action-details]');
    assert(!details.open && dialogElements(details).some(node => clean(node.textContent).includes('1.200,00 € brutto · 200,00 € Steuer')), 'Brutto und Steuer bleiben in geschlossenen Details erreichbar');
    assert(dialogElements(details).some(node => clean(node.textContent) === 'Steuer gesamt: 300,00 €'), 'Gesamtssteuer steht ebenfalls in den Details');
    assert(!dialogElements(section).some(node => node.textContent.includes('Profilverbund-Transaktionen')), 'Technische Transaktionsbezeichnung entfällt in der Anzeige');
    assertEqual(JSON.stringify(result), before, 'Verkaufsanzeige erhält alle bestätigten Belegwerte');
}
const options = { inflation: { rate: 2.5 }, targetYear: 2026 };
assertEqual(clean(formatAnnualNeed({ id: 'floorBedarf', before: 30000, after: 31000 }, { ...options, adjustedFields: ['floorBedarf'] })), '30.000,00 € → 31.000,00 € (von dir angepasst)', 'Bewusste Anpassung wird nicht als Inflation ausgegeben');
assert(!formatAnnualNeed({ id: 'floorBedarf', before: 30000, after: 30000 }, options).includes('→'), 'Gleiche Werte erzeugen keinen identischen Pfeil');
