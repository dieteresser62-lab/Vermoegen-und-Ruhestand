// VN-1: Nachlese aus dem Nutzertest des Pakets VK. Nur synthetische Daten (Max und Erika, Testdatum 23.10.2026).
import { projectSaleFlowState } from '../app/tranches/sale-flow-model.js';

// Punkt 3 · Die Kachel „Abrechnung“ zählt eine Teilabrechnung mit („0 von 2 · 1 teilweise“).
{
    const sale = { net: 57264.07, creditPending: true, profileId: 'muster_b' };
    const lines = [{ key: 'max', status: 'offen', sales: [] }, { key: 'erika', status: 'teilweise', sales: [sale] }];
    const flow = projectSaleFlowState(/** @type {any} */ (lines));
    assertEqual(flow.steps.settle.label, '0 von 2 · 1 teilweise', 'Punkt 3: Abrechnung nennt die Teilabrechnung');
    assertEqual(flow.steps.sell.label, '1 von 2', 'Punkt 3: Verkaufen zählt Erika');
    lines[0] = { key: 'max', status: 'erledigt', sales: [{ net: 9388.9, creditPending: false, profileId: 'muster_a' }] };
    assertEqual(projectSaleFlowState(/** @type {any} */ (lines)).steps.settle.label, '1 von 2 · 1 teilweise', 'Punkt 3: erledigt und teilweise nebeneinander');
}

// Punkt 4 · Karte nach Teilverkauf (Erika 400 + 160 Stück, Max offen): Plan, verkauft und offen auf den Euro, Plan − verkauft = offen.
{
    const { createTodoPlan, euroProgress } = await import('../app/shared/annual-todo-view.js');
    const { MockDocument } = await import('./helpers/balance-page-fixture.mjs');
    const rows = [{ who: 'Max', security: 'Muster Aktien-ETF', planNet: 9362.58, soldNet: 0, restNet: 9362.58, status: 'offen', key: 'max' },
        { who: 'Erika', security: 'Muster Aktien-ETF', planNet: 79949.58, soldNet: 79949.58, restNet: 0, status: 'erledigt', key: 'erika', lastSaleAt: '2026-10-23' }];
    const plan = { year: 2026, status: 'teilweise', decidedOn: '23.10.2026', soldNet: 79949.58, planNet: 89312.16, share: 0.9, tax: 827, verb: 'Aktien verkaufen', amount: 89312.16,
        rows, credits: [], destinations: [], purchases: [], nothing: false, openSecurities: ['Muster Aktien-ETF'] };
    const card = createTodoPlan(new MockDocument(), /** @type {any} */ (plan)).textContent.replace(/\s+/g, ' ');
    assert(card.includes('79.950 € von 89.313 € verkauft'), `Punkt 4: Standzeile auf den Euro (${card.slice(0, 200)})`);
    assert(card.includes('Noch offen9.363 €') || card.includes('Noch offen 9.363 €'), `Punkt 4: Noch offen = 89.313 − 79.950 = 9.363 € (${card.slice(0, 260)})`);
    assert(card.includes('9.363 €') && card.includes('79.950 €') && !card.includes('9.500 €') && !card.includes('80.000 €'), 'Punkt 4: Zeilen auf den Euro wie die Standzeile');
    const sums = euroProgress([{ plan: 9362.58, done: 0, open: 9362.58 }, { plan: 79949.58, done: 79949.58, open: 0 }]);
    assertEqual(sums.plan - sums.done, sums.open, 'Punkt 4: Plan − verkauft = offen');
    const fresh = createTodoPlan(new MockDocument(), /** @type {any} */ ({ ...plan, status: 'offen', soldNet: 0, rows: rows.map(row => ({ ...row, soldNet: 0, restNet: row.planNet, status: 'offen' })) }))
        .textContent.replace(/\s+/g, ' ');
    assert(fresh.includes('ca. 89.500 €'), `Punkt 4: nur die Handlungszeile gerundet mit „ca.“ (${fresh.slice(0, 200)})`);
}

// Punkt 15 (Ergänzung 1 FR-81) · Martin und Petra unverheiratet, Martin 0 €, Petra 5.000 € Tagesgeld, ohne Aktien, Backtest ab 2000 (wie RK-3 P1):
// Petras Flex-Anteil wird gekürzt, obwohl die Einkünfte beider den Bedarf decken. Das Handlungs-ⓘ nennt „Eine Person trägt“; die Rechnung bleibt.
{
    const { measurementInputs, backtest } = await import('./helpers/ek-1b-measurement.mjs');
    const { protocolActionExplanation } = await import('../app/simulator/protocol-renderer.js');
    const inputs = structuredClone(await measurementInputs(0, 'martin-petra', '2026-10-23'));
    const cash = { muster_martin: 0, muster_petra: 5000 };
    inputs.simulationPeople = inputs.simulationPeople.map(person => ({ ...person, tagesgeld: cash[person.profileId] }));
    inputs.tagesgeld = 5000;
    for (const lot of inputs.detailledTranches) { inputs.depotwertNeu -= lot.marketValue; inputs.costBasisNeu -= lot.costBasis; }
    inputs.detailledTranches = [];
    inputs.startVermoegen = 5000;
    const entry = backtest(inputs).rows[0];
    assertClose(entry.row.personalPayout.flexCut.reduce((sum, row) => sum + row.amount, 0), 9400, 0.01, 'Punkt 15: Kürzung unverändert 9.400 €');
    const hint = 'Mit „Eine Person trägt“ legt die App die Einkünfte beider zusammen.';
    const text = protocolActionExplanation(entry, { source: 'backtest', inputs });
    assert(text.includes('Flex-Anteil von') && text.includes(hint), `Punkt 15: Hinweis bei gedeckten Einkünften (${text})`);
    const without = structuredClone(entry); delete without.row.personalPayout.flexCutIncomeCovers;
    assert(!protocolActionExplanation(without, { source: 'backtest', inputs }).includes(hint), 'Punkt 15: ohne gedeckte Einkünfte kein Hinweis');
}
