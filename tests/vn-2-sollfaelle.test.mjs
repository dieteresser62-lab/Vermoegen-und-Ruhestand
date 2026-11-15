// VN-2: Nachschritt zu VN-1 aus den Gutachten Gemini (1.1, 2.1–2.3, 3.1–3.3) und Codex (F01–F03). Nur synthetische Werte.
import { euroProgress, progressBalanceText, createTodoResult, createPlanDetails } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const text = node => (node.textContent ?? '').replaceAll(' ', ' ');

// Codex F03 / Gemini 3.3: Plan = verkauft + offen + weniger als geplant − mehr als geplant, je Zeile auf den Euro.
{
    // Beispiel aus dem Gutachten: Zeile 1 bewusst belassen (4.600 von 9.600), Zeile 2 offen, Zeile 3 überkauft.
    const rows = [{ plan: 9600.4, done: 4600.2, open: 0 }, { plan: 70000, done: 60649.6, open: 9350 }, { plan: 9712.6, done: 9700, open: 0 }];
    const progress = euroProgress(rows);
    assertEqual(progress.plan, progress.done + progress.open + progress.less - progress.more, 'F03: Gleichung geht auf');
    assertEqual(progress.less, 5000 + 13, 'F03: bewusst belassener Rest und Fehlbetrag erledigter Zeilen zählen als „weniger als geplant“');
    const over = euroProgress([{ plan: 10000, done: 10250, open: 0 }]);
    assertEqual([over.open, over.less, over.more].join('/'), '0/0/250', 'F03: Überkauf als „mehr als geplant“');
    assertEqual(over.plan, over.done + over.open + over.less - over.more, 'F03: Gleichung auch beim Überkauf');
    assertEqual(progressBalanceText(over).replaceAll(' ', ' '), ' · 250 € mehr als geplant', 'F03: Ausgleichsposten sichtbar');
    assertEqual(progressBalanceText(euroProgress([{ plan: 5000, done: 5000, open: 0 }])), '', 'F03: ohne Abweichung kein Zusatz');
}

// Gemini 3.1 und 3.2 (DS-1 Punkt 7): Jahresabschluss und „Details & Drucken“ rechnen auf den Euro wie die Karte.
{
    const doc = new MockDocument();
    const rows = [{ who: 'Max', security: 'Muster Aktien-ETF', planNet: 1000.4, soldNet: 400.6, restNet: 599.8, status: 'teilweise', profileId: 'a' }];
    const result = text(createTodoResult(doc, { year: 2026, verb: 'Verkaufen', rows, destinations: [], nothing: false, text: '' }));
    assert(result.includes('1.000 €') && !result.includes('1.000 € ·') && result.includes('ca.'), `3.2: Zeile auf den Euro, Hauptzeile mit „ca.“ (${result})`);
    const details = createPlanDetails(doc, { year: 2026, decidedOn: '', rows, destinations: [], status: 'teilweise', soldNet: 400.6, planNet: 1000.4 },
        { type: 'TRANSACTION', quellen: [] }, [{ id: 'a', name: 'Max' }]);
    assert(details.text.replaceAll(' ', ' ').includes('Stand: 401 € von 1.000 € verkauft.'), `3.1: Standzeile wie die Karte (${details.text})`);
}
console.log('✅ VN-2: Gleichung mit Ausgleichsposten, Jahresabschluss und Details auf den Euro');
