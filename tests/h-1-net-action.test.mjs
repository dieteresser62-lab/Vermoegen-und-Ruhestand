import * as netAction from '../engine/transactions/net-action.mjs';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
const { netActionEntries } = netAction;
const netActionEntriesOrOriginal = netAction.netActionEntriesOrOriginal || netActionEntries;

const source = (kind, brutto, gain) => ({ kind, brutto, netto: brutto, steuer: 0,
    realizedGainSigned: gain, taxableAfterTqfSigned: gain });
const action = { type: 'TRANSACTION', steuer: 0, nettoErlös: 2000,
    quellen: [source('aktien_neu', 1000, 1000), source('anleihe', 1000, -1000)],
    verwendungen: { bonds: 1000 }, taxSettlement: { lossCarryStart: 0 } };
const input = { sparerPauschbetrag: 0, kirchensteuerSatz: 0, decumulation: { mode: '3_bucket_jilge' } };

if (!process.env.H1_CASE || process.env.H1_CASE === '3') {
    const entries = [{ action, input }], before = JSON.stringify(entries);
    let message;
    try { netActionEntries(entries); } catch (error) { message = error.message; }
    assertEqual(message, 'Verrechneter Auftrag kann die Verkaufssteuer nicht decken.', 'H-1 Zeile mit aufgehobenem Verlustverkauf löst die ungedeckte Neuveranlagung aus');
    let rejected;
    try { netActionEntriesOrOriginal(entries); } catch (error) { rejected = error.code; }
    assertEqual(rejected, 'NET_ACTION_TAX_SHORTFALL', 'QS-C: ungedeckter Restauftrag darf nicht unverrechnet gebucht werden');
    assertEqual(JSON.stringify(entries), before, 'H-1 Fehlgeschlagene Verrechnung verändert den ursprünglichen Auftrag nicht');
    let unexpected = false;
    try { netActionEntriesOrOriginal([{ action: null }]); } catch { unexpected = true; }
    assert(unexpected, 'H-1 Andere Fehler der Verrechnung werden weiter gemeldet');

    const previous = { document: globalThis.document, window: globalThis.window };
    const container = { children: [], appendChild(node) { this.children.push(node); } };
    globalThis.document = { createElement: () => ({}), getElementById: () => null };
    globalThis.window = {};
    try {
        const renderer = new ActionRenderer({ outputs: { handlungsanweisung: container } });
        let rendered;
        renderer.determineInternalCashRebalance = () => null;
        renderer._integrateCashRebalance = value => value;
        renderer._integrateProfileCashRebalance = () => null;
        renderer._materialProfileActions = () => null;
        renderer._summarizeAction = () => ({ verb: 'Handlung prüfen', amount: null });
        renderer._projectTransaction = () => null;
        renderer._renderDetails = (content, plan, original, value) => { rendered = value; };
        renderer._playExecutionEntries = () => [];
        let rejection;
        try { renderer.renderAction(action, input); } catch (error) { rejection = error.code; }
        assertEqual(rejection, 'NET_ACTION_TAX_SHORTFALL', 'QS-C: Balance meldet die ungedeckte Neuveranlagung');
        assertEqual(rendered, undefined, 'QS-C: kein unverrechneter Ausführungsauftrag');
        assertEqual(container.children.length, 0, 'QS-C: keine ungesicherte Handlung dargestellt');
    } finally { globalThis.document = previous.document; globalThis.window = previous.window; }
}

if (!process.env.H1_CASE || process.env.H1_CASE === '4') {
    const uns = { ...action, quellen: [source('aktien_neu', 2000, 2000)], verwendungen: { aktien: 1000, liquiditaet: 1000 }, taxSettlement: undefined };
    const entries = [{ action: uns, input: { ...input, taxStatePrev: { lossCarry: 1500 } } }];
    const net = netActionEntries(entries)[0].action;
    assertEqual(net.steuer, 0, 'H-1 Ohne Settlement wird vorhandener Verlustvortrag auf den Restverkauf angewandt');
    assertEqual(net.taxSettlement.lossCarryStart, 1500, 'H-1 Neuveranlagung erhält den bisherigen Steuerzustand');
    const explicit = netActionEntries([{ ...entries[0], action: { ...uns, taxSettlement: { lossCarryStart: 0 } } }])[0].action;
    assertClose(explicit.steuer, 263.75, .000001, 'H-1 Explizites Settlement mit null behält Vorrang');
}
