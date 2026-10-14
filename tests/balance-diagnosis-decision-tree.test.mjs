import { buildDecisionTree } from '../app/balance/balance-diagnosis-decision-tree.js';

console.log('--- Balance Diagnosis Decision Tree Tests ---');

class MockNode {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.className = '';
        this.textContent = '';
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

const prevDocument = global.document;
try {
    global.document = mockDocument;

    // --- TEST 1: Überschuss -> "Investieren" ---
    {
        const fragment = buildDecisionTree([
            { step: 'Überschuss erkannt: Investieren', impact: '+', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('Investieren'), 'Überschuss sollte Investieren empfehlen');
    }

    // --- TEST 2: Unterdeckung -> "Verkaufen" ---
    {
        const fragment = buildDecisionTree([
            { step: 'Unterdeckung: Verkaufen', impact: '-', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('Verkaufen'), 'Unterdeckung sollte Verkaufen empfehlen');
    }

    // --- TEST 3: Gold über Limit -> "Gold reduzieren" ---
    {
        const fragment = buildDecisionTree([
            { step: 'Gold über Limit: Gold reduzieren', impact: '-', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('Gold reduzieren'), 'Gold-Übergewicht sollte Reduktion empfehlen');
    }

    // --- TEST 4: Liquidität kritisch -> "Notfall-Refill" ---
    {
        const fragment = buildDecisionTree([
            { step: 'Liquidität kritisch: Notfall-Refill', impact: '!', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('Notfall-Auffüllen'), 'Kritische Liquidität sollte Notfall-Refill empfehlen');
    }

    // --- TEST 5: Neutraler Fall -> "Keine Aktion nötig" ---
    {
        const fragment = buildDecisionTree([
            { step: 'Neutral: Keine Aktion nötig', impact: '0', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('Keine Aktion nötig'), 'Neutral sollte keine Aktion empfehlen');
    }

    // --- TEST 6: Kombination Unterdeckung + Bear -> konservative Empfehlung ---
    {
        const fragment = buildDecisionTree([
            { step: 'Unterdeckung + Bear: konservative Empfehlung', impact: '-', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.children[1].children[0].textContent.includes('konservative'), 'Unterdeckung + Bear sollte konservativ empfehlen');
    }

    // --- TEST 7: Guardrail severity when "cap wirksam" ---
    {
        // Severity-Klasse signalisiert Guardrail-Eingriff.
        const fragment = buildDecisionTree([
            { step: 'Cap wirksam: Guardrail greift', impact: '-', status: 'active' }
        ]);
        const li = fragment.children[0];
        assert(li.className.includes('severity-guardrail'), 'Cap wirksam should set guardrail severity');
    }

    {
        const data = [{ step: 'Flex-S-Kurve', impact: 'Flex-Anteil 100% -> Cap 20.1%. Mindest-Flex 6550€.', status: 'active' }];
        const before = JSON.stringify(data);
        const impact = buildDecisionTree(data).children[0].children[1].children[1].textContent;
        assertEqual(impact, 'Flex-Anteil 100\u00a0% → Cap 20,1\u00a0%. Mindest-Flex 6.550\u00a0€.', 'Diagnosesätze zeigen deutsche Werte und Pfeil');
        assertEqual(JSON.stringify(data), before, 'Anzeige verändert keine Engine-Diagnose');
    }

    console.log('✅ Balance diagnosis decision tree tests passed');
} finally {
    if (prevDocument === undefined) delete global.document; else global.document = prevDocument;
}

console.log('--- Balance Diagnosis Decision Tree Tests Completed ---');
