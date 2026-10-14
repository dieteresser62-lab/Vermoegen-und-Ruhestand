import { buildGuardrails, withGuardrailCardValues } from '../app/balance/balance-diagnosis-guardrails.js';

console.log('--- Balance Diagnosis Guardrails Tests ---');

class MockNode {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.dataset = {};
        this.attributes = {};
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    append(...nodes) {
        nodes.forEach(node => this.appendChild(node));
    }
    appendChild(node) {
        this.children.push(node);
        return node;
    }
}

const mockDocument = {
    createElement: (tag) => new MockNode(tag),
    createDocumentFragment: () => new MockNode('fragment')
};

const prevDocument = global.document;
try {
    global.document = mockDocument;

    // --- TEST 1: Bear-Market Chip created (regime bear_*) ---
    {
        const fragment = buildGuardrails([
            { name: 'Bear Market', value: 'bear_deep', threshold: '-', status: 'warn' }
        ]);
        assertEqual(fragment.children.length, 1, 'Bear Market card should be created');
        const card = fragment.children[0];
        assert(card.className.includes('status-warn'), 'Bear Market card should be warn');
        assertEqual(card.children[0].textContent, 'Bear Market', 'Bear Market label should be preserved');
    }

    // --- TEST 2: Runway warning at <75% ---
    {
        const fragment = buildGuardrails([
            { name: 'Runway', value: '70%', threshold: '75%', status: 'warn' }
        ]);
        const card = fragment.children[0];
        assert(card.className.includes('status-warn'), 'Runway < 75% should be warn');
    }

    // --- TEST 3: Alarm chip for activeAlarm > 0 ---
    {
        const fragment = buildGuardrails([
            { name: 'Alarm', value: 'AKTIV', threshold: '-', status: 'danger' }
        ]);
        const card = fragment.children[0];
        assert(card.className.includes('status-danger'), 'Alarm should be danger');
    }

    // --- TEST 4: Refill-Cap hint in Bear-Market ---
    {
        const fragment = buildGuardrails([
            { name: 'Refill-Cap', value: 'aktiv', threshold: '-', status: 'info' }
        ]);
        const card = fragment.children[0];
        assert(card.className.includes('status-info'), 'Refill-Cap hint should be info');
    }

    // --- TEST 5: Correct color coding classes ---
    {
        // Status-Klassen müssen dem Ampel-Schema folgen.
        const formatted = { guardrails: [
            { name: 'OK', value: '1.234,56 €', threshold: '-', status: 'ok', note: 'Erläuternde Zielquelle' },
            { name: 'Realer Drawdown', value: 'warn', threshold: '-', status: 'warn', note: 'Pflichtwarnung' },
            { name: 'Danger', value: 'danger', threshold: '-', status: 'danger', note: 'Blockgrund' }
        ] };
        const before = JSON.stringify(formatted);
        const projected = withGuardrailCardValues(formatted, { guardrails: [
            { name: 'OK', value: 1234.56, threshold: 2000, type: 'currency' },
            { name: 'Realer Drawdown', value: .532, threshold: .55, type: 'percent', rule: 'max' },
            { name: 'Danger', value: 30, threshold: 60, type: 'months', rule: 'min' }
        ] });
        const fragment = buildGuardrails(projected.guardrails);
        assertEqual(fragment.children[0].children[1].textContent, '1.235 €', 'Großer Geldwert wird aus dem Rohwert in ganzen Euro angezeigt');
        assertEqual(projected.guardrails[0].value, '1.234,56 €', 'Copywert behält die vollständige Centpräzision');
        assertEqual(fragment.children[1].children[1].textContent, '-53,2 %', 'Drawdown-Ratiowert wird deutsch und richtig skaliert angezeigt');
        assertEqual(fragment.children[1].children[2].textContent, 'Grenze ≥ -55,0 %', 'Vorzeichen und einschließlicher Operator spiegeln die maximale Rückgangsgrenze');
        assertEqual(fragment.children[2].children[2].textContent, 'Grenze ≥ 60 Mon.', 'Monatsminimum ist einschließlich und behält seine Einheit');
        assertEqual(JSON.stringify(formatted), before, 'Kartenprojektion verändert den bisherigen Payload nicht');
        assert(fragment.children[0].className.includes('status-ok'), 'OK should be green');
        assert(fragment.children[1].className.includes('status-warn'), 'Warn should be yellow');
        assert(fragment.children[2].className.includes('status-danger'), 'Danger should be red');
        const info = fragment.children[0].children[3];
        assertEqual(info.className, 'ds-info', 'OK-Erläuterung verwendet Info-Popup');
        assertEqual(info.dataset.visible, 'false', 'Dynamische Erläuterung ist initial geschlossen');
        assertEqual(info.children[0].attributes['aria-controls'], info.children[1].id, 'Infoauslöser verweist auf eigenen Tooltip');
        assertEqual(info.children[1].textContent, 'Erläuternde Zielquelle', 'Erläuterungsinhalt bleibt vollständig');
        assertEqual(fragment.children[1].children[3].textContent, 'Pflichtwarnung', 'Warnnotiz bleibt ohne Popup sichtbar');
        assertEqual(fragment.children[2].children[3].textContent, 'Blockgrund', 'Blocknotiz bleibt ohne Popup sichtbar');

    }

    // --- TEST 6: Chip order preserved ---
    {
        const fragment = buildGuardrails([
            { name: 'First', value: '1', threshold: '-', status: 'ok' },
            { name: 'Second', value: '2', threshold: '-', status: 'warn' },
            { name: 'Third', value: '3', threshold: '-', status: 'danger' }
        ]);
        assertEqual(fragment.children[0].children[0].textContent, 'First', 'First card should be first');
        assertEqual(fragment.children[1].children[0].textContent, 'Second', 'Second card should be second');
        assertEqual(fragment.children[2].children[0].textContent, 'Third', 'Third card should be third');
    }

    for (const binding of [true, false, undefined]) {
        const formatted = { guardrails: [{ name: 'Inflations-Cap', value: '3,0 %', threshold: '< 2,0 %', status: 'danger', note: 'Pflichtwarnung' }] };
        const raw = { guardrails: [{ name: 'Inflations-Cap', value: .03, threshold: .02, type: 'percent', details: { capBinding: binding } }] };
        const before = JSON.stringify({ formatted, raw });
        const projected = withGuardrailCardValues(formatted, raw);
        const card = buildGuardrails(projected.guardrails).children[0];
        assertEqual(card.className.includes('guardrail-triggered'), binding === true, 'Nur belegtes capBinding tönt die Karte');
        assert(card.className.includes('status-danger'), 'Fachstatus und Filterklasse bleiben erhalten');
        const chip = card.children.at(-1);
        assertEqual(chip.textContent, binding === true ? 'Löst aus' : 'Grenze überschritten', 'Zusatzstatus braucht belegte Aktivität');
        assert(chip.className.includes(binding === true ? 'ds-chip-warning' : 'ds-chip-error'), 'Chip zeigt den Anzeigezustand getönt');
        assertEqual(card.children[0].children[0].className, 'ds-info', 'Cap-Hilfe steht im Kopf');
        assert(card.children[0].children[0].children[1].textContent.includes('Pflichtwarnung'), 'Cap-Hilfe im Kopf enthält auch den vorhandenen Hinweis');
        assertEqual(card.children.length, 4, 'Inflations-Cap besitzt genau ein Infoelement und keinen zweiten Körperhinweis');
        assertEqual(projected.guardrails[0].threshold, '< 2,0 %', 'Copygrenze unverändert');
        assertEqual(JSON.stringify({ formatted, raw }), before, 'Aktivitätsprojektion ändert keine Diagnosewerte');
    }
    const near = buildGuardrails([{ name: 'Runway', value: '61 Mon.', threshold: '60 Mon.', status: 'warn' }]).children[0];
    assert(!near.className.includes('guardrail-triggered') && near.children.at(-1).className.includes('ds-chip-warning'), 'Bloße Nähe färbt nur den Chip');
    for (const [name, rule, expected] of [
        ['Budget-Floor Deckung', 'min', 'Deckungsziel nicht erreicht'],
        ['Runway (vs. Min)', 'min', 'Mindestgrenze unterschritten'],
        ['Runway (vs. Ziel)', 'min', 'Mindestgrenze unterschritten'],
        ['Entnahmequote', 'max', 'Grenze überschritten'],
        ['Realer Drawdown (Gesamt)', 'max', 'Grenze überschritten']
    ]) {
        const { formatDiagnosisPayload } = await import('../app/balance/balance-diagnosis-format.js');
        const raw = { guardrails: [{ name, rule, value: rule === 'min' ? 1 : 3, threshold: 2, type: 'months' }] };
        const before = JSON.stringify(raw);
        const payload = withGuardrailCardValues(formatDiagnosisPayload(raw), raw);
        assertEqual(buildGuardrails(payload.guardrails).children[0].children.at(-1).textContent, expected, `${name}: Verletzung folgt der Grenzrichtung`);
        assertEqual(JSON.stringify(raw), before, 'Leitplankenwortlaut verändert keine Rohwerte');
    }
    console.log('✅ Balance diagnosis guardrails tests passed');
} finally {
    if (prevDocument === undefined) delete global.document; else global.document = prevDocument;
}

console.log('--- Balance Diagnosis Guardrails Tests Completed ---');
