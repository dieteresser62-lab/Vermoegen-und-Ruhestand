// VN-4: letzter Nachschritt vor der Prüf-EXE (Gutachten ABS1 P2/P3, Abnahme ST-4, VN1-4). Nur synthetische Werte.
import { projectAnnualActionProgress } from '../app/balance/annual-action-progress.js';
import { euroProgress, progressBalanceText, createPlanProgressNote, createTodoPlan } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { readFileSync } from 'node:fs';
import { protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { creditStep } from '../app/tranches/sale-flow-steps.js';
import { debitStep } from '../app/tranches/buy-flow-steps.js';

const text = node => (node.textContent ?? '').replaceAll(' ', ' ');
const sale = (profileId, netProceeds, executedAt = '2026-03-01') => ({ profileId, trancheId: 'x', executedAt, netProceeds, assetClass: 'equity', creditPending: false });
const source = (profileId, netto) => ({ kind: 'aktien_neu', category: 'equity', sourceProfileId: profileId, brutto: netto, steuer: 0, netto });

// ABS1 P2: Ein Mehrverkauf wird nicht auf den Plan gekappt; er erscheint wie beim Kauf als „mehr als geplant“.
{
    const progress = projectAnnualActionProgress({ year: 2026, decidedOn: '2026-01-05', action: { quellen: [source('a', 50000)] }, sales: [sale('a', 55000)] });
    assertEqual(progress.lines[0].soldNet, 55000, 'P2: Mehrverkauf bleibt in der Zeile (55.000 statt 50.000)');
    assertEqual([progress.status, progress.restNet].join('/'), 'erledigt/0', 'P2: Zeile erledigt, nichts offen');
    const close = text(createPlanProgressNote(new MockDocument(), progress));
    assert(close.includes('55.000 € von 50.000 € verkauft · 5.000 € mehr als geplant'), `P2: Jahresabschluss nennt den Mehrverkauf (${close})`);
    // Zwei Zeilen derselben Person und Klasse: Der Überschuss steht bei der letzten Zeile, die Summe bleibt der Verkauf.
    const two = projectAnnualActionProgress({ year: 2026, decidedOn: '2026-01-05', action: { quellen: [source('a', 30000), source('a', 20000)] }, sales: [sale('a', 52000)] });
    assertEqual(two.lines.map(line => line.soldNet).join('/'), '30000/22000', 'P2: Überschuss bei der letzten Zeile der Gruppe');
    assertEqual(two.soldNet, 52000, 'P2: Summe verkauft = Verkauf');
}

// Abnahme ST-4: Mit Überkauf und offener Zeile steht „offen“ in der Standzeile; Plan = gekauft + offen + weniger − mehr ist ablesbar.
{
    const progress = euroProgress([{ plan: 100000, done: 109761.5, open: 0 }, { plan: 22000, done: 0, open: 22000 }]);
    assertEqual(progressBalanceText(progress).replaceAll(' ', ' '), ' · 22.000 € offen · 9.762 € mehr als geplant', 'ST-4: offener Posten neben „mehr als geplant“');
    assertEqual(progress.plan, progress.done + progress.open + progress.less - progress.more, 'ST-4: Gleichung geht auf');
    const note = text(createPlanProgressNote(new MockDocument(), { year: 2026, status: null, soldNet: 0, planNet: 0, lines: [],
        buy: { status: 'teilweise', bought: 109761.5, plan: 122000, lines: [{ amount: 100000, bought: 109761.5, restAmount: 0 }, { amount: 22000, bought: 0, restAmount: 22000 }] } }));
    assert(note.includes('109.762 € von 122.000 € gekauft · 22.000 € offen · 9.762 € mehr als geplant'), `ST-4: Jahresabschluss mit offenem Posten (${note})`);
}

// ABS1 P3 (Mischplan): Verkauf erledigt, Kauf offen → im Jahresabschluss „Teilweise umgesetzt“, nicht „Umgesetzt“.
{
    const sold = projectAnnualActionProgress({ year: 2026, decidedOn: '2026-01-05', action: { quellen: [source('a', 50000)] }, sales: [sale('a', 50000)] });
    const mixed = { ...sold, buy: { status: 'offen', bought: 0, plan: 20000, lines: [{ amount: 20000, bought: 0, restAmount: 20000 }] } };
    const note = createPlanProgressNote(new MockDocument(), mixed);
    assert(text(note).includes('Teilweise umgesetzt'), `Mischplan: Status über Verkauf und Kauf (${text(note)})`);
    assert(text(createPlanProgressNote(new MockDocument(), mixed, true)).includes('teilweise'), `Mischplan, Kurzform: teilweise (${text(createPlanProgressNote(new MockDocument(), mixed, true))})`);
    const done = { ...sold, buy: { status: 'erledigt', bought: 20000, plan: 20000, lines: [{ amount: 20000, bought: 20000, restAmount: 0 }] } };
    assert(text(createPlanProgressNote(new MockDocument(), done)).includes('Umgesetzt'), 'Mischplan: beide erledigt → Umgesetzt');
}

// ABS1 P3: Kauf-Tabellenzeile nennt den Überkauf wie die Verkaufszeile; VN1-4: „Gutschrift nachtragen“ einheitlich mit Cent.
{
    const plan = { year: 2026, status: 'teilweise', decidedOn: '', verb: 'Verkaufen', amount: 0, nothing: false, text: '', share: 0.5, tax: 0, openSecurities: [],
        rows: [{ who: 'Erika', security: 'ETF', planNet: 80000, soldNet: 30381, restNet: 49619, status: 'teilweise', profileId: 'b' }],
        credits: [{ profileId: 'b', date: '02.09.2026', amount: 30381, who: 'Erika' }], destinations: [], purchases: [],
        buyFlow: { allEntered: true, bought: 55000, plan: 50000, pending: [], lines: [{ key: 'k', name: 'Max', assetClass: 'equity', amount: 50000, bought: 55000, restAmount: 0, status: 'erledigt' }] } };
    const card = text(createTodoPlan(new MockDocument(), plan));
    assert(/Max.*Aktien.*50\.000 €.*Erledigt.*5\.000 € mehr als geplant/.test(card), `P3: Kaufzeile „mehr als geplant“ (${card})`);
    assert(/auf dem Tagesgeld \(30\.381\s€\)/.test(card), `VN1-4 / N2: Kontostand im Kasten in ganzen Euro (${card})`);
}
// Abnahme LZDS-2: Im Simulator nennt das Handlungs-ⓘ bei „Verkäufe und Käufe je Person“ die Werte je Person (Verkauf, Steuer, Tagesgeld danach).
{
    const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'traegt');
    inputs.simulationPeople = inputs.simulationPeople.map(entry => ({ ...entry, tagesgeld: entry.profileId === 'muster_martin' ? 10000 : 30000 }));
    inputs.tagesgeld = 40000;
    const entry = backtest(inputs, 2000, 2025).rows[0];
    const info = protocolActionExplanation(entry, { source: 'backtest', inputs }).replaceAll(' ', ' ');
    assert(info.startsWith('Verkäufe und Käufe je Person'), `LZDS-2: Überschrift (${info})`);
    assert(/Martin verkauft 120\.285\s€ \(trägt die Entnahme\), die andere Person verkauft nichts/.test(info), `LZDS-2: wer verkauft (${info})`);
    // KR-1c (NG-5): Zins 2000 auf 40.000 € vor der Entscheidung statt auf 131.832 € nach dem Verkauf; Zinssteuer 1.169 → 171 €.
    assert(/Steuer im Jahr 8\.824\s€/.test(info), `LZDS-2: Steuer (${info})`);
    assert(/Tagesgeld danach: Martin [\d.]+\s€, Petra [\d.]+\s€/.test(info), `LZDS-2: Tagesgeld je Person (${info})`);
}
// Abnahme LZDS-7, Nachtrag 1 N2: Kontostand im Gutschrift- und Abbuchungsschritt nach dem Verlassen mit Tausenderpunkt, ganze Euro (Komma bleibt).
{
    const walk = node => [node, ...(node.children || []).flatMap(walk)];
    const sale = { executedAt: '2026-10-23', shares: 10, gross: 1000, fees: 0, taxes: 0, net: 1000, creditPending: true };
    const buy = { executedAt: '2026-10-23', shares: 10, gross: 1000, fees: 0, debit: 1000, debitPending: true };
    for (const [label, dom, key, typed, shown] of [
        ['Gutschrift', creditStep(new MockDocument(), { people: [{ profileId: 'a', name: 'Erika', pending: true, cash: 41381, sales: [sale] }], drafts: { a: { choice: 'now' } }, onChange() {} }), 'saleFlowCash', '42381', '42.381'],
        ['Abbuchung', debitStep(new MockDocument(), { people: [{ profileId: 'a', name: 'Max', pending: true, cash: 17785.1, buys: [buy] }], missing: [], drafts: { a: { choice: 'now' } }, lines: [], plan: false, onChange() {}, onSettle() {} }), 'buyFlowCash', '16785,1', '16.785,1']]) {
        const field = walk(dom).find(node => node.dataset?.[key] === 'a');
        field.value = typed; field.dispatchEvent({ type: 'input' }); field.dispatchEvent({ type: 'change' });
        assertEqual(field.value, shown, `LZDS-7: ${label}, Tagesgeld nach dem Verlassen`);
    }
}
// Abnahme VN1-5, LZDS-6 Teil 2: Seitenknöpfe in Personen & Vermögen ohne Altstil; Balance-Altregeln gelten nicht im geführten Dialog.
// Gemessen (Chromium 1920×1080): Seitenknöpfe vorher 14px/500, Radius 6px; nachher 16px/400, Radius 12px wie Balance; Kaufdialog P&V = Balance.
{
    const css = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    const page = css('css/personen-vermoegen-seite.css'), balance = css('css/balance.css');
    for (const selector of [':where(.personen-vermoegen-page) *:where(', ':where(.personen-vermoegen-page) button:where(']) {
        const rule = page.slice(page.indexOf(selector), page.indexOf('{', page.indexOf(selector)));
        assert(rule.includes('.ds-button-secondary') && rule.includes('.ds-button-primary'), `LZDS-6: Altstil ohne Designsystem-Knöpfe (${rule})`);
    }
    for (const selector of ['h2:where(:not(.sale-flow-dialog *))', 'label:where(:not(.sale-flow-dialog *))', ':is(input, select):where(:not(.sale-flow-dialog *))',
        'html[data-density=compact] label:where(:not(.sale-flow-dialog *))', 'html[data-density=compact] :is(input, select):where(:not(.sale-flow-dialog *))']) {
        assert(balance.includes(selector + ' {'), `VN1-5: Balance-Altregel ohne geführten Dialog (${selector})`);
    }
}
console.log('✅ VN-4: Mehrverkauf, offener Posten, Mischplan, Kaufzeile und Gutschrift-Kasten');
