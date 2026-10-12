import { buildTransactionDiagnostics } from '../app/balance/balance-diagnosis-transaction.js';
import { createDiagnosisHandlers } from '../app/balance/balance-binder-diagnosis.js';

console.log('--- Balance Diagnosis Transaction Tests ---');

class MockNode {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.className = '';
        this.textContent = '';
        this.title = '';
    }
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

// Flatten node tree to string to assert content.
function collectText(node) {
    if (!node) return '';
    if (typeof node.textContent === 'string' && node.children.length === 0) return node.textContent;
    let text = node.textContent || '';
    if (Array.isArray(node.children)) {
        node.children.forEach(child => {
            text += collectText(child);
        });
    }
    return text;
}

const previousDocument = global.document;
try {
    global.document = mockDocument;

    // --- TEST 1: Empty diagnostics ---
    {
        const fragment = buildTransactionDiagnostics(null);
        assert(fragment.children.length === 1, 'Empty diagnostics should return one element');
        assert(fragment.children[0].className.includes('diag-empty-state'), 'Empty state should be marked');
    }

    // --- TEST 2: Guardrail block status ---
    {
        const diag = {
            wasTriggered: true,
            blockReason: 'guardrail_block',
            blockedAmount: 500,
            potentialTrade: { direction: 'Verkauf', netAmount: 1000 },
            equityThresholds: { maxSkimPctOfEq: 10, maxSellAmount: 1234.56 }
        };
        const fragment = buildTransactionDiagnostics(diag);
        const card = fragment.children[0];
        assert(card.className.includes('status-danger'), 'Guardrail block should be danger status');
        const text = collectText(card);
        assert(text.includes('Ja'), 'Summary should indicate triggered');
        assert(text.includes('Verkauf'), 'Potential trade should be shown');
        assert(text.includes('Abschöpfen ≤ 10,0 % des Aktienwerts'), 'Sichtbare Aktiengrenze ist kompakt und skaliert');
        assert(card.children.slice(1).every(row => !row.children[0].textContent.endsWith(':')), 'Transaktionslabels haben keinen Doppelpunkt');
        assert(collectText(fragment.children[1]).includes('1.234,56'), 'Einzelgrenzen bleiben centgenau in den Details');
    }

    // --- TEST 3: Emergency / cap block ---
    {
        const diag = {
            wasTriggered: false,
            blockReason: 'cap_active',
            blockedAmount: 0
        };
        const fragment = buildTransactionDiagnostics(diag);
        const card = fragment.children[0];
        assert(card.className.includes('status-warn'), 'Cap active should be warn status');
        const text = collectText(card);
        assert(text.includes('Keine geplante Aktion'), 'Empty trade should render "Keine geplante Aktion"');
        assert(!text.includes('Unbekannte Aktion'), 'Empty trade should not render "Unbekannte Aktion"');
    }

    // --- TEST 4: Tranche selection rendering ---
    {
        const diag = {
            wasTriggered: true,
            blockReason: 'none',
            blockedAmount: 0,
            selectedTranches: [
                { name: 'ETF A', kind: 'aktien', taxPerEuro: 0.1, brutto: 500, steuer: 50 }
            ]
        };
        const fragment = buildTransactionDiagnostics(diag);
        const last = fragment.children[fragment.children.length - 1];
        const text = collectText(last);
        assert(text.includes('Tranchenauswahl'), 'Tranche selection card should be present');
        assert(text.includes('ETF A'), 'Tranche row should include name');
    }

    // --- TEST 5: Gold why-not explanation ---
    {
        const diag = {
            wasTriggered: false,
            blockReason: 'liquidity_sufficient',
            blockedAmount: 0,
            potentialTrade: { direction: 'Keine Aktion', netAmount: 0 },
            goldThresholds: {
                currentGoldValue: 0,
                minGoldReserve: 25000,
                targetGoldValue: 50000,
                targetPct: 5
            }
        };
        const fragment = buildTransactionDiagnostics(diag);
        const text = collectText(fragment);
        assert(text.includes('Warum kein Goldkauf?'), 'Gold no-buy explanation should be rendered');
        assert(text.includes('Nicht jede Zielabweichung'), 'Gold no-buy subtitle should explain target vs action');
        assert(text.includes('Aktueller Goldwert'), 'Gold no-buy card should show current value');
        assert(collectText(fragment.children[0]).includes('Unter Mindestreserve von 25.000'), 'Goldkurzzeile behauptet keinen erfüllten Schutz bei Unterdeckung');

        // Nur die sichtbare Kurzzeile der ersten Karte, nicht die technische Klappe.
        const goldShortValue = rendered => rendered.children[0].children
            .find(row => row.className === 'value-row' && row.children[0].textContent === 'Gold-Grenzen')
            ?.children[1].textContent;
        const neutral = 'Weitere Goldgrenzen in den technischen Details';
        const defaults = { currentGoldValue: 0, minGoldReserve: 0, targetGoldValue: 0,
            targetPct: 0, maxBearRefillPctOfEq: 5 };
        const handlers = createDiagnosisHandlers({
            dom: { diagnosis: { filterToggle: { checked: false } } },
            appState: { lastUpdateTimestamp: '2026-10-06T08:00:00.000Z' }
        });
        for (const currentGoldValue of [0, 1234.56]) {
            const fixture = { ...diag, goldThresholds: { ...defaults, currentGoldValue } };
            const before = JSON.stringify(fixture);
            const rendered = buildTransactionDiagnostics(fixture);
            const short = goldShortValue(rendered);
            assert(short === neutral, `Defaultbestand ${currentGoldValue}: sichtbare Goldkurzzeile bleibt neutral`);
            assert(!/erreicht|erfüllt/.test(short), `Defaultbestand ${currentGoldValue}: kein unbelegter Erfolgszustand`);
            const details = rendered.children[1];
            assert(details.tagName === 'details', 'Vollständige Golddaten liegen in der technischen Klappe');
            const rows = details.children[1].children.filter(row => row.className === 'value-row');
            const copy = handlers.generateDiagnosisText({ general: {}, keyParams: {},
                decisionTree: [], guardrails: [], transactionDiagnostics: fixture });
            for (const [label, expected] of [
                ['Aktueller Goldwert', currentGoldValue === 0 ? '0,00\u00a0€' : '1.234,56\u00a0€'],
                ['Min. Goldreserve', '0,00\u00a0€'],
                ['Zielwert Gold', '0,00\u00a0€'],
                ['Goldzielanteil', '0,0\u00a0%'],
                ['Auffüllgrenze im Bärenmarkt (% des Aktienwerts)', '5,0\u00a0%']
            ]) {
                const fullLabel = `Gold-Grenzen / ${label}`;
                assert(rows.find(row => row.children[0].textContent === fullLabel)?.children[1].textContent === expected,
                    `${currentGoldValue}: Renderer erhält ${label} mit vollständiger Präzision`);
                assert(copy.includes(`  - ${fullLabel}: ${expected}\n`),
                    `${currentGoldValue}: echter Copygenerator erhält ${label} mit vollständiger Präzision`);
            }
            assert(JSON.stringify(fixture) === before, 'Renderer und Copygenerator verändern die Rohdaten nicht');
        }

        for (const [label, overrides, expected] of [
            ['Positives Ziel unterdeckt', { currentGoldValue: 1000, targetGoldValue: 2000 }, 'Unter Goldziel von 2.000\u00a0€'],
            ['Positives Ziel exakt erreicht', { currentGoldValue: 2000, targetGoldValue: 2000 }, 'Goldziel von 2.000\u00a0€ erreicht'],
            ['Positives Ziel überschritten', { currentGoldValue: 3000, targetGoldValue: 2000 }, 'Goldziel von 2.000\u00a0€ erreicht'],
            ['Positive Mindestreserve erfüllt, Zielbetrag null', { currentGoldValue: 2000, minGoldReserve: 2000 }, 'Mindestreserve von 2.000\u00a0€ erfüllt'],
            ['Mindestreserve hat Vorrang vor erreichtem Ziel', { currentGoldValue: 2000, minGoldReserve: 3000, targetGoldValue: 1000 }, 'Unter Mindestreserve von 3.000\u00a0€'],
            ['Positiver Zielanteil ohne Betragsgrundlage', { currentGoldValue: undefined, targetPct: 5 }, 'Zielanteil 5,0\u00a0%']
        ]) {
            assert(goldShortValue(buildTransactionDiagnostics({ ...diag, goldThresholds: { ...defaults, ...overrides } })) === expected, label);
        }
        for (const currentGoldValue of [undefined, null, NaN, Infinity, -Infinity]) {
            const thresholds = { ...defaults, currentGoldValue, minGoldReserve: 1000, targetGoldValue: 2000 };
            assert(goldShortValue(buildTransactionDiagnostics({ ...diag, goldThresholds: thresholds })) === neutral,
                `Nicht endlicher oder fehlender Istwert ${currentGoldValue} begründet keinen Betragsvergleich`);
            assert(goldShortValue(buildTransactionDiagnostics({ ...diag, goldThresholds: { ...thresholds, targetPct: 5 } })) === 'Zielanteil 5,0\u00a0%',
                `Ohne endlichen Istwert ${currentGoldValue} wird ein positiver Zielanteil nur benannt`);
        }
        for (const field of ['minGoldReserve', 'targetGoldValue', 'targetPct']) {
            for (const value of [undefined, null, 0, -1, NaN, Infinity, -Infinity, '5']) {
                const fixture = { ...diag, goldThresholds: { ...defaults, currentGoldValue: 1234.56, [field]: value } };
                assert(goldShortValue(buildTransactionDiagnostics(fixture)) === neutral,
                    `${field} mit Wert ${value} ist keine positive endliche Grenze`);
            }
        }
    }

    {
        const diag = { wasTriggered: true, blockReason: 'cap_active', blockedAmount: 1234.56,
            potentialTrade: { netAmount: 3456.78 } };
        const action = { verb: 'Aktien verkaufen', amount: 3456.78, amountUnit: '€ netto', extraTransfer: 123.45, goldPurchaseAmount: 0 };
        const before = JSON.stringify({ diag, action });
        const view = buildTransactionDiagnostics(diag, action);
        assert(collectText(view.children[0]).includes('1.235 €'), 'Blockierter Betrag in der Kurzfassung ist ganze Euro');
        assert(collectText(view.children[0]).includes('3.457 € netto') && collectText(view.children[0]).includes('123 €'), 'Geplante Aktion und interner Transfer verwenden ganze Euro');
        assert(!/\d,\d{2} €/.test(collectText(view.children[0])), 'Kurzfassung enthält keine Centbeträge');
        assert(collectText(view.children[1]).includes('1.234,56 €') && collectText(view.children[1]).includes('3.456,78 €'), 'Vollständige technische Beträge bleiben genau');
        assertEqual(JSON.stringify({ diag, action }), before, 'Transaktionsanzeige verändert keine Fachwerte');
    }
    console.log('✅ Balance diagnosis transaction tests passed');
} finally {
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument;
}

console.log('--- Balance Diagnosis Transaction Tests Completed ---');
