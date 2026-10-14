import { requestOverviewMonthConfirmation as requestMonth, projectOverviewMonthSteps, projectConfirmedMonthResult } from '../app/overview/overview-month-confirmation.js';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { showNavigationGuardDialog } from '../app/shared/navigation-guard-dialog.js';
// Derselbe native Seitenguard wie im Produkt, nur sein DOM ist gedoppelt.
function requestOverviewMonthConfirmation(options) {
    const doc = options.doc;
    let host = doc.getElementById('navigationGuardDialog'), created = false;
    if (!host) {
        created = true; host = doc.createElement('dialog'); host.id = 'navigationGuardDialog';
        for (const [tag, id] of [['h2', 'navigationGuardTitle'], ['p', 'navigationGuardDescription'], ['button', 'navigationGuardStay'], ['button', 'navigationGuardLeave']]) {
            const node = doc.createElement(tag); node.id = id; host.append(node);
        }
        doc.body.append(host);
    }
    return requestMonth({ ...options, confirmDiscard: () => showNavigationGuardDialog({ reasons: [{ dirty: true }], intent: 'discard', opener: doc.activeElement, signal: options.signal }, doc) })
        .finally(() => { if (created) host.remove(); });
}
const now = new Date(2026, 9, 8, 12);
export const monthDialogModel = { activeId: 'a', now, scope: { key: 'single:a', ids: ['a'] },
    members: [{ id: 'a', name: 'A', count: 2 }], quoteDate: now.toISOString(),
    occasion: { kind: 'monthly', month: '2026-09', previousYear: 2026, previousMonth: 9 },
    expenses: { year: 2026, month: 9, complete: false, spent: null, rows: [{ id: 'a', present: false }] },
    summary: { monthlyWithdrawal: 500 }, expenseBudget: 700,
    cashPeople: [{ id: 'a', name: 'A', value: 18000, lastDate: '2026-09-01', error: null }] };
for (const [complete, spent, budget, done] of [[false, null, 700, false], [true, 0, 700, true], [true, 900, null, false], [true, 900, 700, true]]) {
    const steps = projectOverviewMonthSteps({ ...monthDialogModel, expenseBudget: budget, expenses: { complete, spent } });
    assertEqual(steps[2].done, done, 'Budgetzustand erfordert vollständige Ausgaben und endliches Budget');
    assertEqual(steps[1].done, complete, 'Nullausgaben bleiben vollständig');
}
assertEqual(projectOverviewMonthSteps({ ...monthDialogModel, quoteDate: '2026-09-01' })[0].done, false, 'Alte Kurse bleiben offen');
assertEqual(projectOverviewMonthSteps({ ...monthDialogModel, priceReport: { results: [{ status: 'failed' }] } })[0].done, false, 'Teilkurse bleiben offen');
assertEqual(projectOverviewMonthSteps(monthDialogModel)[2].continueLabel, 'Weiter zum Budgetvergleich', 'Budgetnavigation verwendet einen lesbaren Zieltext');
for (const status of ['missing', 'valid', 'invalid', 'other-year']) {
    const model = { ...monthDialogModel, now: new Date(2026, 10, 14),
        summary: { year: 2026, monthlyWithdrawal: 2400, status: 'fest' },
        planComparison: { year: status === 'other-year' ? 2025 : 2026, recordStatus: status === 'other-year' ? 'valid' : status } };
    const step = projectOverviewMonthSteps(model)[3];
    const result = projectConfirmedMonthResult(model);
    assertEqual(result.withdrawal.replaceAll('\u00a0', ' '), '2.400,00 €', status + ': Planstatus ändert die Entnahme nicht');
    if (status === 'valid') {
        assert(step.amountText.includes('festgeschriebener Plan 2026'), 'Monatsdialog benennt den vorhandenen Jahresbeleg');
        assertEqual(result.withdrawalDetail, 'Monatsinformation aus dem festgeschriebenen Plan 2026', 'Monatsbeleg verwendet dieselbe feste Quelle');
    } else {
        assert(step.amountText.startsWith('Vorläufige Entnahme'), status + ': Vorschauwert allein belegt keinen Jahresplan');
        assertEqual(result.withdrawalDetail, `Vorläufige Entnahme für November · ${status === 'invalid' ? 'Jahresplan 2026 nicht sicher lesbar' : 'noch kein festgeschriebener Jahresplan 2026'}`, status + ': Beleg und Dialog bewahren den Quellenstatus');
    }
}
for (const outcome of ['accept', 'cancel', 'escape', 'close', 'context']) {
    const f = createDialogFixture(), controller = new AbortController(), opener = f.doc.createElement('button'); let handle;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people: monthDialogModel.cashPeople,
        signal: controller.signal, returnFocus: () => opener.focus(), onReady: value => { handle = value; } });
    assert(handle.root.open, outcome + ': echter Monatsdialog offen');
    assertEqual(await requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel }), false, 'Doppelte Öffnung bleibt schreibfrei');
    assertEqual(f.doc.getElementById('overviewMonthConfirmationTitle').textContent, 'September abschließen', 'Titel nennt Abschlussmonat');
    assertEqual(f.doc.querySelector('[data-close-dialog-next="expenses"]').textContent, 'Weiter zum Budgetvergleich', 'Weiterknopf übernimmt den Zieltext des Budgetvergleichs');
    handle.activate('cash'); const input = f.doc.querySelector('[data-tagesgeld-person]'); input.value = '18.000,125';
    handle.update({ ...monthDialogModel, expenses: { ...monthDialogModel.expenses, complete: true, spent: 0 } });
    assertEqual(input.value, '18.000,125', 'Importrefresh erhält Tagesgeldentwurf');
    const fields = f.doc.querySelector('.tagesgeld-fields');
    assert(!fields.querySelector('h3') && fields.children[0].className === 'tagesgeld-provenance'
        && fields.querySelectorAll('[data-tagesgeld-confirm]').length === 1, 'Monatsdialog zeigt eine Herkunftszeile und Bestätigung je Person');
    assert(f.doc.querySelector('[data-tagesgeld-person]') === input, 'Monatsrefresh erhält Feldidentität');
    if (outcome === 'accept') await prepareCloseFixture(f.doc);
    if (outcome === 'accept') await f.doc.querySelector('[data-overview-month-accept]').fire('click');
    if (outcome === 'cancel') await f.doc.querySelector('[data-overview-month-cancel]').fire('click');
    if (outcome === 'escape') await handle.root.fire('keydown', { key: 'Escape' });
    if (outcome === 'close') handle.root.close();
    if (outcome === 'context') controller.abort();
    if (outcome === 'cancel' || outcome === 'escape') await f.doc.getElementById('navigationGuardLeave').fire('click');
    const accepted = await result;
    assertEqual(Boolean(accepted), outcome === 'accept', outcome + ': passende Entscheidung');
    if (accepted) { assertEqual(accepted.cash.values.a, 18000.125, 'Deutsche Cashwerte im unveränderten Auftrag'); assertEqual(JSON.stringify(accepted.cash.people), JSON.stringify(monthDialogModel.cashPeople), 'Originale Rohbelege unverändert'); }
    assertEqual(f.doc.body.children.length, 0, outcome + ': Host entfernt');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), outcome + ': Listener entfernt');
    assert(f.doc.activeElement === opener, outcome + ': Rückfokus');
}
// Die Ergebnisansicht bestätigt genau den eingefrorenen Auftrag, auch bei einem Refresh.
{
    const f = createDialogFixture(); let handle, writes = 0;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people: monthDialogModel.cashPeople,
        onReady: value => { handle = value; }, onAccept: async () => { writes++; handle.update({ ...monthDialogModel, summary: { monthlyWithdrawal: 999 } }); return true; } });
    const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = '19.000,125'; await cash.fire('input');
    await prepareCloseFixture(f.doc);
    const root = handle.root; await f.doc.querySelector('[data-overview-month-accept]').fire('click');
    assert(handle.root === root && root.open, 'Dauerhafter Erfolg bleibt in derselben Dialoginstanz');
    const texts = f.nodes.filter(node => node.isConnected).map(node => node.textContent).join(' ');
    assert(texts.includes('September ist abgeschlossen.') && texts.includes('19.000,125') && texts.includes('500,00'), 'Ergebnis zeigt gespeicherte Cashwerte und passenden Monatsbetrag');
    assert(texts.includes('Ausgaben fehlen noch') && texts.includes('Für den Vergleich fehlen'), 'Ergebnis behauptet bei Lücken keine vollständigen Ausgaben oder Budgetprüfung');
    assert(!handle.dirty(), 'Dauerhaft gespeicherter Entwurf ist sauber');
    assertEqual(f.doc.getElementById('overviewMonthConfirmationTitle').textContent, 'September abgeschlossen', 'Bestätigtes Ergebnis hat den Abschlusstitel');
    assertEqual(f.doc.getElementById('overviewMonthConfirmationSubtitle').textContent, 'A · gespeichert am 08.10.2026', 'Ergebnis nennt Personen und Datum der angenommenen Instanz');
    assert(f.doc.querySelector('[data-close-dialog-result-month]'), 'Normaler Monat verwendet den gemeinsamen Faktenteil C');
    assert(!texts.includes('JAHR') && !texts.includes('aufs Girokonto überwiesen'), 'Normaler Monat enthält ausschließlich den bestätigten Monatsteil');
    assertEqual(f.doc.querySelector('[data-overview-month-accept]').textContent, 'Fertig', 'Ergebnis hat ausdrücklichen Fertigknopf');
    assertEqual(f.doc.querySelector('.close-dialog-status').textContent, 'Nächster Monatsabschluss: 1. November.', 'Erfolg enthält links den nächsten Abschlusstermin');
    assert(f.doc.querySelector('.close-dialog-footnote').hidden && !f.doc.querySelector('[data-close-dialog-derivation]').open, 'Erfolg hat keine zweite Fußzeile; Herleitung ist geschlossen');
    assert(!texts.includes('Vorbereitungsschritte') && !texts.includes('verworfen') && !texts.includes('Stand stimmt'), 'Erfolg enthält keine Vorbereitung oder Verwerfhinweise');
    assert(texts.includes('Entnahme Oktober') && texts.includes('vorläufig'), 'Gespeicherter Betrag nennt die vorläufige Vermögensentnahme ohne Jahresbeleg');
    await f.doc.querySelector('[data-overview-month-accept]').fire('click'); await result;
    assertEqual(writes, 1, 'Fertig schreibt keinen zweiten Monat und öffnet keine Verlustnachfrage');
}
for (const [inputs, expected] of [
    [['1,1', '2,2'], '3,3'],
    [['0,1', '0,2'], '0,3'],
    [['0,0000001', '0,0000002'], '0,0000003'],
    [['1,005', '2,2'], '3,205'],
    [['0', '0'], '0'],
    [['90.000,125', '180.000,25'], '270.000,375']
]) {
    const f = createDialogFixture(); let handle, stored;
    const people = [...monthDialogModel.cashPeople, { id: 'b', name: 'B', value: 0, lastDate: null, error: null }];
    const model = { ...monthDialogModel, scope: { key: 'household', ids: ['a', 'b'] },
        members: [...monthDialogModel.members, { id: 'b', name: 'B', count: 0 }], cashPeople: people };
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model, people,
        onReady: h => { handle = h; }, onAccept: async accepted => { stored = structuredClone(accepted); return true; } });
    for (const [index, input] of f.doc.querySelectorAll('[data-tagesgeld-person]').entries()) { input.value = inputs[index]; await input.fire('input'); }
    await prepareCloseFixture(f.doc);
    await f.doc.querySelector('[data-overview-month-accept]').fire('click');
    assertEqual(handle.root.dataset.monthResult, 'confirmed', 'Cashsumme erscheint erst nach bestätigtem Speichererfolg');
    assertEqual(JSON.stringify(stored.cash.values), JSON.stringify({ a: Number(inputs[0].replaceAll('.', '').replace(',', '.')), b: Number(inputs[1].replaceAll('.', '').replace(',', '.')) }), 'Ergebnis basiert auf den unveränderten gespeicherten Personenwerten');
    const texts = dialogElements(f.doc.querySelector('[data-overview-month-result]')).map(node => node.textContent);
    assert(texts.includes(`Cashsumme: ${expected} €`), 'Cashsumme ist dezimalexakt: ' + expected);
    assert(!texts.some(text => /3,3000000000000003|0,30000000000000004/.test(text)), 'Cashsumme enthält keine binären Additionsartefakte');
    if (expected === '270.000,375') assert(texts.includes('Tagesgeld A') && texts.includes('90.000,125 €') && texts.includes('Tagesgeld B') && texts.includes('180.000,25 €'), 'Ungerundete Personenwerte bleiben erhalten');
    await f.doc.querySelector('[data-overview-month-accept]').fire('click'); await result;
}
for (const value of ['19.000', 'ungültig', '18.000,000', '18000']) {
    const f = createDialogFixture(); let handle;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people: monthDialogModel.cashPeople, onReady: h => { handle = h; } });
    handle.activate('cash'); const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = value; cash.focus();
    await f.doc.querySelector('[data-overview-month-cancel]').fire('click');
    const prompt = (f.doc.getElementById('navigationGuardDialog')?.open ? f.doc.getElementById('navigationGuardStay') : null);
    if (value === '19.000' || value === 'ungültig') {
        assert(prompt && handle.root.open, 'Geänderter oder ungültiger Entwurf fragt vor Verlust nach');
        await prompt.fire('click'); assert(f.doc.activeElement === cash && cash.value === value, 'Bleiben erhält Entwurf und Fokus');
        await f.doc.querySelector('[data-overview-month-cancel]').fire('click'); await f.doc.getElementById('navigationGuardLeave').fire('click');
    } else assert(!prompt, 'Finanziell gleiche deutsche Schreibweise benötigt keine Verlustnachfrage');
    await result; assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Auch Verwerfrückfrage entfernt sämtliche Listener');
}
{
    const f = createDialogFixture(); let handle, calls = 0;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people: monthDialogModel.cashPeople,
        onReady: h => { handle = h; }, onAccept: async () => { if (++calls === 1) throw new Error('Vorflushfehler'); return true; } });
    const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = '19000';
    await prepareCloseFixture(f.doc);
    await f.doc.querySelector('[data-overview-month-accept]').fire('click');
    assert(handle.root.open && !handle.root.dataset.monthResult && cash.value === '19000', 'Vorflushfehler erhält Eingaben ohne Erfolg');
    await f.doc.querySelector('[data-overview-month-accept]').fire('click');
    assertEqual(handle.root.dataset.monthResult, 'confirmed', 'Zulässiger Retry erreicht Ergebnis');
    handle.close(true); await result;
}
{
    const f = createDialogFixture(); let handle;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: { ...monthDialogModel, summary: null }, onReady: value => { handle = value; } });
    assert(f.doc.querySelector('[data-overview-month-accept]').disabled, 'Ohne Plan nur die Speicherung gesperrt');
    assert(f.doc.querySelector('[data-overview-expenses-file]'), 'Ohne Plan bleibt CSV erreichbar'); handle.close(false); await result;
}
for (const outcome of [false, 'throw']) {
    const f = createDialogFixture(); let handle, release;
    const commit = new Promise(resolve => { release = resolve; });
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel,
        onReady: value => { handle = value; }, onAccept: async () => {
            await commit;
            if (outcome === 'throw') throw new Error('Synthetischer Speicherfehler');
            return outcome;
        } });
    await prepareCloseFixture(f.doc);
    const job = f.doc.querySelector('[data-overview-month-accept]').fire('click');
    assertEqual(handle.root.getAttribute('aria-busy'), 'true', 'Asynchroner Monatsauftrag sperrt den Dialog');
    handle.root.close(); release(); await job;
    let timer;
    try {
        const closed = await Promise.race([result, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Nativ geschlossener Monatsdialog hängt')), 2000);
        })]);
        assertEqual(closed, false, String(outcome) + ': nativer Close beendet auch einen nicht bestätigten Monatsauftrag');
    } finally { clearTimeout(timer); }
    assertEqual(f.doc.body.children.length, 0, String(outcome) + ': fehlgeschlagener Monatsauftrag hinterlässt keinen geschlossenen Host');
    const retry = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, onReady: value => { handle = value; } });
    assert(handle.root.open, String(outcome) + ': Monatsdialog ist nach nativem Close erneut erreichbar');
    handle.close(false); await retry;
}

// R-02: Ohne Personen entfällt die Cashbestätigung; Besuche und Fachsperren bleiben Pflicht.
for (const options of [{}, { people: [] }]) {
    const f = createDialogFixture(); let handle, calls = 0, payload;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, ...options,
        onReady: value => { handle = value; }, onAccept: async accepted => { calls++; payload = accepted; return true; } });
    const accept = f.doc.querySelector('[data-overview-month-accept]');
    assert(accept.disabled, 'Ohne Personen bleibt der Monatsknopf bis zu allen Besuchen gesperrt');
    await accept.fire('click'); assertEqual(calls, 0, 'Ohne Besuche erfolgt auch ohne Personen kein Monatsauftrag');
    for (const id of ['prices', 'expenses', 'budget', 'cash']) handle.activate(id);
    assertEqual(accept.disabled, false, 'Alle sichtbaren Besuche geben den personenlosen Monatsknopf frei');
    const text = dialogElements(handle.root).filter(node => !node.hidden).map(node => node.textContent || '').join(' ');
    assert(!text.includes('Stand stimmt') && !text.includes('Tagesgeld je Person bestätigen') && !text.includes('Tagesgeld noch nicht bestätigt'), 'Hinweise verlangen keine nicht vorhandene Tagesgeldbestätigung');
    assertEqual(f.doc.querySelectorAll('[data-tagesgeld-person]').length, 0, 'Personenloser Dialog erfindet keine Tagesgeldfelder');
    handle.update({ ...monthDialogModel, summary: null });
    assert(accept.disabled, 'Fehlender Plan sperrt auch ohne Personen');
    handle.update({ ...monthDialogModel, recovery: true });
    assert(accept.disabled, 'Recovery sperrt auch ohne Personen');
    handle.update(monthDialogModel);
    assertEqual(accept.disabled, false, 'Wiederhergestellter Plan erhält die bisherigen Besuche');
    assert(!f.doc.querySelector('[data-close-dialog-next="cash"]'), 'Letzter Monatsschritt ohne Weiter');
    assert(!accept.disabled, 'Personenloser Monatsknopf bleibt nach allen Besuchen frei');
    await accept.fire('click');
    assertEqual(calls, 1, 'Personenloser Monatsauftrag wird genau einmal ausgeführt');
    assertEqual(payload, true, 'Personenloser Monatsauftrag erhält weiterhin true');
    assertEqual(handle.root.dataset.monthResult, 'confirmed', 'Erfolgreicher personenloser Monatsauftrag zeigt das bestätigte Ergebnis');
    await accept.fire('click'); assertEqual(await result, true, 'Fertig beendet den personenlosen Monatsauftrag erfolgreich');
}

{
    const f = createDialogFixture(), controller = new AbortController(); let handle;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, signal: controller.signal, model: monthDialogModel, people: monthDialogModel.cashPeople, onReady: h => { handle = h; } });
    f.doc.querySelector('[data-tagesgeld-person]').value = '19000';
    const closeJob = f.doc.querySelector('[data-close-dialog-close]').fire('click');
    assert(f.doc.getElementById('navigationGuardDialog').open, 'Schließkreuz verwendet echte Verwerfrückfrage');
    controller.abort(); await closeJob; await result;
    assertEqual(f.doc.body.children.length, 0, 'Kontextabbruch während Verlustnachfrage entfernt alle Hosts');
    assert(f.nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Kontextabbruch während Verlustnachfrage entfernt alle Listener');
}

// Sichtbare Zusammenfassung wechselt mit der Aufklappung, ohne den Entwurf zu ersetzen.
{
    const f = createDialogFixture(); let handle;
    const result = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people: monthDialogModel.cashPeople, onReady: h => { handle = h; } });
    const visibleText = () => dialogElements(handle.root).filter(node => {
        for (let parent = node; parent; parent = parent.parent) if (parent.hidden) return false;
        return true;
    }).map(node => node.textContent).join(' ');
    const budget = projectOverviewMonthSteps(monthDialogModel)[2].result;
    for (const active of ['budget', 'cash', 'prices']) {
        handle.activate(active);
        assertEqual(visibleText().split(budget).length - 1, 1, active + ': Budgetlücke genau einmal sichtbar');
        assertEqual(visibleText().split('Entnahme im Oktober:').length - 1, active === 'cash' ? 1 : 0, active + ': Monatsinformation nur im sichtbaren Tagesgeldinhalt');
    }
    handle.activate('cash'); await f.doc.querySelector('[data-tagesgeld-edit]').fire('click'); const input = f.doc.querySelector('[data-tagesgeld-person]'); input.value = '19.000,123456'; input.focus();
    handle.update({ ...monthDialogModel, summary: { ...monthDialogModel.summary, monthlyWithdrawal: 750, action: { verb: 'Nichts tun' } } });
    assert(f.doc.activeElement === input && input.value === '19.000,123456', 'Refresh erhält Feldidentität, Präzision und Fokus');
    assertEqual(visibleText().split('750,00').length - 1, 1, 'Refresh aktualisiert den sichtbaren Überweisungsbetrag');
    assertEqual(f.doc.getElementById('overviewMonthConfirmationSubtitle').textContent, 'A · 3 von 4 Schritten angesehen', 'Fortschritt folgt Aktivierung ohne Dauer');
    const foot = dialogElements(handle.root).find(node => node.className === 'close-dialog-footnote');
    assertEqual(foot.textContent, 'Nächster Monatsabschluss: 1. November.', 'Kalenderkorrekte kurze Fußnotiz');
    assert(foot.querySelector('.ds-info-pop').textContent.includes('ungespeicherte Eingaben'), 'Regeltext bleibt hinter dem Info-Knopf erreichbar');
    assert(foot.parent.children.at(-1) === foot, 'Fußnotiz folgt den Knöpfen');
    handle.close(false); await result;
}

for (const [status, budget, state, done, text] of [
    ['missing', null, 'not_applicable', false, 'September 2026'],
    ['invalid', null, 'open', false, 'nicht sicher lesbar'],
    ['adopted', 0, 'done', true, 'über'],
    ['provisional', 700, 'done', true, 'unter']
]) {
    const model = { ...monthDialogModel, expenseBudget: budget, expenseBudgetSource: { monthly: budget, status },
        expenses: { ...monthDialogModel.expenses, complete: true, spent: 120 } };
    const step = projectOverviewMonthSteps(model)[2];
    assertEqual(step.state, state, 'Budgetquelle wird getrennt dargestellt: ' + status);
    assertEqual(step.done, done, 'Nur ein wirklicher Vergleich erhält einen Haken: ' + status);
    assert(step.result.includes(text), 'Budgetgrund ist datiert oder erklärt den Vergleich: ' + status);
}
assert(!projectOverviewMonthSteps({ ...monthDialogModel, summary: null })[3].result.includes('500'), 'Ohne Plan wird kein Überweisungsbetrag erfunden');
assert(!projectOverviewMonthSteps({ ...monthDialogModel, summary: { monthlyWithdrawal: 500, action: { verb: 'Aktien verkaufen' } } })[3].result.includes('verkaufen'), 'Transferinhalt enthält keine Verkaufsanweisung');

// FR-4/FR-5: Bereitschaft, echte Besuche, gleiche Zahl und erneute Sperre zusammen.
{
    const f = createDialogFixture(); let h, writes = 0;
    const people = [...monthDialogModel.cashPeople, { id: 'b', name: 'B', value: 200, lastDate: null }];
    const promise = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people,
        onReady: handle => { h = handle; }, onAccept: async () => { writes++; return true; } });
    const accept = f.doc.querySelector('[data-overview-month-accept]');
    const readiness = f.doc.querySelector('[data-close-dialog-status]');
    assertEqual(readiness.textContent, 'Noch offen: Ausgaben September', 'Monatsfuß nennt den Schrittnamen ohne angehängtes Verb');
    assert(h.hasVisited('prices') && !h.hasVisited('expenses'), 'Initial zählt ausschließlich der sichtbare Kursschritt');
    assert(accept.disabled, 'Gültige Vorbelegung sperrt den Monatsknopf');
    h.update(monthDialogModel);
    assert(!h.hasVisited('expenses'), 'Modellrefresh zählt keine verborgenen Inhalte');
    await f.doc.querySelector('[data-close-dialog-next="prices"]').fire('click');
    assert(h.hasVisited('expenses') && !h.hasVisited('budget'), 'Weiter zählt ausschließlich den unmittelbar nächsten sichtbaren Schritt');
    assertEqual(readiness.textContent, 'Noch offen: Mit dem Budget vergleichen', 'Budgethinweis ergänzt kein zweites Verb');
    h.update({ ...monthDialogModel, expenses: { ...monthDialogModel.expenses, complete: true, spent: 100, rows: [{ id: 'a', present: true, spent: 100 }] } });
    assert(h.hasVisited('budget') && !h.hasVisited('cash'), 'Ausgabenimport zeigt Budget und überspringt kein Tagesgeld');
    assertEqual(readiness.textContent, 'Noch offen: Tagesgeld prüfen', 'Unbesuchtes Tagesgeld zeigt nur den Schrittnamen');
    assertEqual(f.doc.querySelectorAll('[data-close-expenses-details]').length, 1, 'Genau eine lokale Ausgabendetailansicht');
    h.activate('cash');
    assertEqual(readiness.textContent, 'Noch offen: Tagesgeld A, B bestätigen oder ändern', 'Nach dem Besuch nennt der Fuß die noch unbestätigten Personen');
    const fields = f.doc.querySelectorAll('[data-tagesgeld-person]');
    assert(!f.doc.querySelector('[data-close-dialog-next="cash"]'), 'Letzter Monatsschritt ohne Weiter');
    assert(accept.disabled, 'Vorbelegung braucht ausdrückliche Tagesgeldbestätigung');
    const statuses = f.doc.querySelectorAll('[data-tagesgeld-status]'), confirms = f.doc.querySelectorAll('[data-tagesgeld-confirm]');
    const edits = f.doc.querySelectorAll('[data-tagesgeld-edit]'), applies = f.doc.querySelectorAll('[data-tagesgeld-apply]');
    assert(statuses.every(node => node.textContent === 'noch nicht bestätigt') && confirms.every(node => !node.hidden), 'Unbestätigte Vorbelegung bietet je Person Stand stimmt');
    assertEqual(f.doc.querySelectorAll('[data-tagesgeld-date]').length, 1, 'Herkunft steht einmal vor den Personen');
    assert(fields.every(field => field.hidden), 'Beträge beginnen als Lesewerte');
    await confirms[0].fire('click');
    assertEqual(readiness.textContent, 'Noch offen: Tagesgeld B bestätigen oder ändern', 'Erste Bestätigung lässt nur die zweite Person im Fuß offen');
    assert(accept.disabled && !h.dirty() && statuses[0].textContent === 'bestätigt · Stand vom 01.09.2026', 'Stand stimmt bestätigt ausschließlich die erste Person ohne Finanzänderung');
    assertEqual(f.doc.querySelector('[data-close-dialog-step="cash"]').querySelector('.close-dialog-step-pill').textContent, '1 offen', 'Schrittkopf zählt die offene Person');
    assert(statuses[1].textContent === 'noch nicht bestätigt' && confirms[0].hidden, 'Andere Person bleibt offen');
    await edits[1].fire('click'); await fields[1].fire('input');
    assert(accept.disabled && !fields[1].hidden && !applies[1].hidden, 'Tippen allein bestätigt den Entwurf noch nicht');
    await applies[1].fire('click'); assert(!accept.disabled, 'Übernehmen derselben zweiten Zahl gibt nach allen Besuchen frei');
    assertEqual(readiness.textContent, 'Alles bereit – jetzt ‚September abschließen‘', 'Bestätigte Personen geben die unveränderte Bereitschaftszeile frei');
    assertEqual(f.doc.querySelector('[data-close-dialog-step="cash"]').querySelector('.close-dialog-step-pill').textContent, 'erledigt', 'Schrittkopf meldet erledigt');
    await edits[0].fire('click'); fields[0].value = '-1'; await fields[0].fire('input');
    assert(accept.disabled && fields[0].getAttribute('aria-invalid') === 'true', 'Ungültige Folgeeingabe sperrt erneut');
    await accept.fire('click'); assertEqual(writes, 0, 'Gesperrter Hauptklick schreibt keine Finanzdaten');
    fields[0].value = '18.001,125'; await fields[0].fire('input'); await applies[0].fire('click');
    assert(!accept.disabled && statuses[0].textContent === 'geändert · vorher 18.000 €', 'Übernommene Änderung behält den Ausgangswert im Status');
    assert(confirms.every(node => node.hidden) && fields.every(field => field.hidden), 'Fertige Personen zeigen Lesewerte statt Eingabefelder');
    h.close(false); await promise;
    const again = requestOverviewMonthConfirmation({ doc: f.doc, model: monthDialogModel, people, onReady: handle => { h = handle; } });
    assert(!h.hasVisited('expenses') && f.doc.querySelector('[data-overview-month-accept]').disabled, 'Wiederöffnung beginnt mit neuer Besuchsmenge und unbestätigtem Cash');
    h.close(false); await again;
}

// Die Ergebniszeile enthält genau einen Budgetbegriff und keine zweite Scheinsumme.
for (const [status, spent, budget, expected] of [
    ['adopted', 800, 700, 'über Budget'], ['adopted', 600, 700, 'unter Budget'],
    ['adopted', 700, 700, 'genau im Budget'], ['missing', 700, null, 'Entfällt'], ['invalid', 700, null, 'Budgetquelle']
]) {
    const { projectConfirmedMonthResult } = await import('../app/overview/overview-month-confirmation.js');
    const result = projectConfirmedMonthResult({ ...monthDialogModel, expenseBudget: budget, expenseBudgetSource: { status },
        expenses: { complete: true, spent } });
    assert(result.budgetComparison.includes(expected), status + ': korrekte Vergleichsprojektion');
    assertEqual(result.budgetComparison.split('Budget').length - 1, 1, status + ': Budget steht genau einmal in der Vergleichszeile');
    assert(!result.budgetComparison.includes('Budget: —'), status + ': kein angehängter Scheinbetrag');
}

// Fortschritt benennt nur den Besuch; eine Überschreitung bleibt ein eigenes Ergebnis.
{
    const f = createDialogFixture(); let handle;
    const model = { ...monthDialogModel, expenseBudget: 5000,
        expenses: { ...monthDialogModel.expenses, complete: true, spent: 5135 },
        priceReport: { completed: 2, total: 2 } };
    const promise = requestOverviewMonthConfirmation({ doc: f.doc, model, onReady: h => { handle = h; } });
    const budget = f.doc.querySelector('[data-close-dialog-step="budget"]');
    assertEqual(budget.querySelector('.close-dialog-step-symbol').textContent, '3', 'Unbesuchter Vergleich hat auch mit vollständigen Daten keinen Haken');
    assertEqual(budget.querySelector('.close-dialog-step-pill').textContent, 'offen', 'Vorhandener Vergleich behauptet keinen Besuch');
    handle.activate('budget');
    assertEqual(budget.querySelector('.close-dialog-step-symbol').textContent, '✓', 'Besuchter Vergleich erhält Fortschrittshaken');
    assertEqual(budget.querySelector('.close-dialog-step-pill').textContent, 'angesehen', 'Haken benennt den Besuch statt ein positives Budgetergebnis');
    const result = budget.querySelector('.close-dialog-result-warning');
    assert(result.textContent.includes('135,00') && result.textContent.includes('über Budget · 2,7 %'), 'Budgetüberschreitung steht getrennt als Warnung mit Euro und Prozent');
    const step = projectOverviewMonthSteps(model)[0];
    assert(step.result.includes('im Abruf bearbeitet') && !step.result.includes('geprüft'), 'Automatischer Kursabruf behauptet keine Prüfung durch den Nutzer');
    assert(!projectOverviewMonthSteps({ ...model, expenseBudget: 0 })[2].result.includes('%'), 'Nullbudget erzeugt keinen erfundenen Prozentvergleich');
    handle.close(false); await promise;
}
