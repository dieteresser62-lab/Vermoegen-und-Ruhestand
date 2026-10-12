import { UIRenderer, initUIRenderer } from '../app/balance/balance-renderer.js';
import { createDiagnosisHandlers } from '../app/balance/balance-binder-diagnosis.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { readSources, rules } from './designsystem-source-contract.mjs';

console.log('--- Balance Renderer Action Tests ---');

class FakeElement {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.style = { cssText: '' };
        this.id = '';
        this.dataset = {};
        this.attributes = {};
        this.className = '';
        this.classList = {
            add: (...classes) => {
                const current = new Set((this.className || '').split(/\s+/).filter(Boolean));
                classes.forEach(c => current.add(c));
                this.className = Array.from(current).join(' ');
            },
            remove: (...classes) => {
                const current = new Set((this.className || '').split(/\s+/).filter(Boolean));
                classes.forEach(c => current.delete(c));
                this.className = Array.from(current).join(' ');
            },
            contains: (cls) => (this.className || '').split(/\s+/).includes(cls)
        };
        this.textContent = '';
        this.parentNode = null;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    get textContent() { return this._text || ''; }
    set textContent(value) { this._text = String(value); this.children = []; }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    append(...nodes) {
        nodes.forEach(node => {
            if (typeof node === 'string') {
                const textNode = new FakeElement('#text');
                textNode.textContent = node;
                this.appendChild(textNode);
            } else {
                this.appendChild(node);
            }
        });
    }

    replaceChildren(...nodes) {
        this.children.forEach(child => { child.parentNode = null; });
        this.children = []; this.textContent = '';
        this.append(...nodes);
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(node => node !== this);
        this.parentNode = null;
    }
}

function collectText(node) {
    let out = node?.textContent || '';
    const children = Array.isArray(node?.children) ? node.children : [];
    children.forEach(child => {
        out += collectText(child);
    });
    return out;
}

global.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => {
        const node = new FakeElement('#text');
        node.textContent = String(text ?? '');
        return node;
    }
};

// Ungültige Profilaktionen dürfen weder Kurzkarte noch Gesamtaktionsdetails abbrechen.
{
    const previousWindow = globalThis.window;
    globalThis.window = { __profilverbundActionResults: [{ name: 'X', action: null }] };
    try {
        const host = new FakeElement();
        const outputs = { handlungsanweisung: host, balanceActionTitle: new FakeElement(),
            balanceActionAmount: new FakeElement(), balanceActionNote: new FakeElement() };
        const renderer = new ActionRenderer({ outputs });
        const action = { type: 'TRANSACTION', title: 'Gesamtaktion Aktienverkauf',
            quellen: [{ kind: 'aktien_alt', brutto: 1250.75, netto: 1200.5, steuer: 50.25 }],
            verwendungen: { liquiditaet: 1200.5 }, nettoErlös: 1200.5, steuer: 50.25 };
        for (const invalidAction of [null, undefined, false, 0, 42, 'ungültig']) {
            globalThis.window.__profilverbundActionResults[0].action = invalidAction;
            let renderError = null;
            try { renderer.renderAction(action); } catch (error) { renderError = error; }
            assertEqual(renderError, null, `renderAction wirft nicht bei Profilaktion ${String(invalidAction)}`);
            assertEqual(outputs.balanceActionTitle.textContent, 'Aktien verkaufen', 'Ungültiges Profil ersetzt nicht das Verb der Gesamtaktion');
            assertEqual(collectText(outputs.balanceActionAmount), '1.201\u00a0€ netto', 'Kurzkarte behält den Betrag der Gesamtaktion');
            const detail = renderer.getActionCopyText();
            assert(detail.includes(action.title), 'Vollständiger Titel der Gesamtaktion wird im Detail gerendert');
            assert(detail.includes('Aktien (alt)') && detail.includes('1.250,75'), 'Detail enthält die centgenaue Quelle der Gesamtaktion');
            assert(detail.includes('Zufluss Liquidität') && detail.includes('1.200,50'), 'Detail enthält die Verwendung der Gesamtaktion');
        }
    } finally { globalThis.window = previousWindow; }
}

// Ensure renderer does not emit synthetic 0,00 lines for Profilverbund when no material profile actions exist.
{
    global.window = {
        __profilverbundActionResults: [
            { name: 'Muster A', action: { type: 'NONE', quellen: [], verwendungen: {}, steuer: 0 } },
            { name: 'Muster B', action: { type: 'NONE', quellen: [], verwendungen: {}, steuer: 0 } }
        ],
        __profilverbundProfileSummaries: [
            { name: 'Muster A', totalAssets: 100000, tagesgeld: 10000, geldmarkt: 5000, gold: 0, depotAlt: 50000, depotNeu: 35000 },
            { name: 'Muster B', totalAssets: 80000, tagesgeld: 8000, geldmarkt: 4000, gold: 0, depotAlt: 40000, depotNeu: 28000 }
        ]
    };

    const container = new FakeElement('div');
    const copyBtn = new FakeElement('button');
    copyBtn.id = 'copyAction';
    container.appendChild(copyBtn);

    const renderer = new ActionRenderer({
        outputs: { handlungsanweisung: container }
    });

    const warnBackup = console.warn;
    console.warn = () => { };
    renderer.renderAction(
        {
            type: 'TRANSACTION',
            title: 'Liquiditäts-Management',
            anweisungKlasse: 'anweisung-gelb',
            nettoErlös: 0,
            steuer: 0,
            quellen: [],
            verwendungen: {}
        },
        null,
        {},
        0
    );
    console.warn = warnBackup;

    const renderedText = collectText(container);
    assert(!renderedText.includes('Depotverkauf'), 'Should not render forced Depotverkauf zero rows');
    assert(!renderedText.includes('Tranchen'), 'Should not render forced Tranchen zero rows');
    assert(!renderedText.includes('Steuern (geschaetzt)'), 'Should not render forced Steuer zero rows');
}

// Split lines should hide zero-value Geldmarkt/Tagesgeld entries in Profilverbund rendering.
{
    global.window = {
        __profilverbundActionResults: [
            {
                name: 'Muster A',
                action: {
                    type: 'TRANSACTION',
                    quellen: [{ kind: 'liquiditaet', brutto: 59540.23, netto: 59540.23, steuer: 0 }],
                    verwendungen: { geldmarkt: 59540.23 },
                    steuer: 0,
                    nettoErlös: 0
                },
                input: { tagesgeld: 174000, geldmarktEtf: 370973 },
                spending: { monatlicheEntnahme: 2200 },
                targetLiquidity: 26800
            },
            {
                name: 'Muster B',
                action: {
                    type: 'TRANSACTION',
                    quellen: [{ kind: 'liquiditaet', brutto: 80459.77, netto: 80459.77, steuer: 0 }],
                    verwendungen: { geldmarkt: 80459.77 },
                    steuer: 0,
                    nettoErlös: 0
                },
                input: { tagesgeld: 174000, geldmarktEtf: 370973 },
                spending: { monatlicheEntnahme: 2200 },
                targetLiquidity: 26800
            }
        ],
        __profilverbundProfileSummaries: []
    };

    const container = new FakeElement('div');
    const copyBtn = new FakeElement('button');
    copyBtn.id = 'copyAction';
    container.appendChild(copyBtn);

    const renderer = new ActionRenderer({
        outputs: { handlungsanweisung: container }
    });

    renderer.renderAction(
        {
            type: 'TRANSACTION',
            title: 'Liquiditäts-Management',
            anweisungKlasse: 'anweisung-gelb',
            nettoErlös: 0,
            steuer: 0,
            quellen: [{ kind: 'liquiditaet', brutto: 140000 }],
            verwendungen: { geldmarkt: 140000 }
        },
        { tagesgeld: 174000, geldmarktEtf: 370973 },
        { monatlicheEntnahme: 2200 },
        26800
    );

    const renderedText = collectText(container);
    assert(!renderedText.includes(': Geldmarkt-ETF0,00'), 'Should not show Profilverbund Geldmarkt-ETF rows with 0,00 €');
}

// Settlement breakdown should be rendered when taxSettlement data exists.
{
    global.window = {
        __profilverbundActionResults: null,
        __profilverbundProfileSummaries: null
    };

    const container = new FakeElement('div');
    const copyBtn = new FakeElement('button');
    copyBtn.id = 'copyAction';
    container.appendChild(copyBtn);

    const renderer = new ActionRenderer({
        outputs: { handlungsanweisung: container }
    });

    renderer.renderAction(
        {
            type: 'TRANSACTION',
            title: 'Verkauf',
            anweisungKlasse: 'anweisung-gelb',
            nettoErlös: 10000,
            steuer: 500,
            quellen: [{ kind: 'aktien_alt', brutto: 10500, netto: 10000, steuer: 500 }],
            verwendungen: {},
            taxSettlement: {
                taxBeforeLossCarry: 800,
                taxAfterLossCarry: 500,
                taxSavedByLossCarry: 300
            }
        },
        null,
        {},
        0
    );

    const renderedText = collectText(container);
    assert(renderedText.includes('Steuern vor Verlusttopf:'), 'Should render tax-before-loss-carry row');
    assert(renderedText.includes('Steuern nach Verlusttopf:'), 'Should render tax-after-loss-carry row');
    assert(renderedText.includes('Steuerersparnis Verlusttopf:'), 'Should render tax-saved row');
    assert(renderedText.includes('Steuern (final, Settlement)'), 'Should render final settlement tax row label');
    assert(renderedText.includes('Plan nach Zweck'), 'Should render purpose summary section');
    assert(renderedText.includes('Steuerzahlung'), 'Purpose summary should include tax payment');
}

// Zero settlement values should be hidden to stay consistent with other 0-row filters.
{
    global.window = {
        __profilverbundActionResults: null,
        __profilverbundProfileSummaries: null
    };

    const container = new FakeElement('div');
    const copyBtn = new FakeElement('button');
    copyBtn.id = 'copyAction';
    container.appendChild(copyBtn);

    const renderer = new ActionRenderer({
        outputs: { handlungsanweisung: container }
    });

    renderer.renderAction(
        {
            type: 'TRANSACTION',
            title: 'Verkauf',
            anweisungKlasse: 'anweisung-gelb',
            nettoErlös: 0,
            steuer: 0,
            quellen: [{ kind: 'aktien_alt', brutto: 0, netto: 0, steuer: 0 }],
            verwendungen: {},
            taxSettlement: {
                taxBeforeLossCarry: 0,
                taxAfterLossCarry: 0,
                taxSavedByLossCarry: 0
            }
        },
        null,
        {},
        0
    );

    const renderedText = collectText(container);
    assert(!renderedText.includes('Steuern vor Verlusttopf:'), 'Should hide tax-before row when value is 0');
    assert(!renderedText.includes('Steuern nach Verlusttopf:'), 'Should hide tax-after row when value is 0');
    assert(!renderedText.includes('Steuerersparnis Verlusttopf:'), 'Should hide tax-saved row when value is 0');
    assert(!renderedText.includes('Steuern (final, Settlement)'), 'Should hide final settlement tax row when value is 0');
}

console.log('✅ Balance renderer action tests passed');
// Interne Umschichtung bleibt im vollständigen Plan, ohne externen Zufluss
// in der Kurzfassung und ohne Austausch der stabilen Popupcontrols.
{
    const previousDocument = globalThis.document, previousWindow = globalThis.window;
    globalThis.document = { createElement: tag => new FakeElement(tag), createTextNode: text => { const node = new FakeElement('text'); node.textContent = text; return node; } };
    globalThis.window = {};
    try {
        const host = new FakeElement('div'), copy = new FakeElement('button'); copy.id = 'copyAction';
        const outputs = { handlungsanweisung: host, balanceActionTitle: new FakeElement('div'), balanceActionAmount: new FakeElement('div'), balanceActionNote: new FakeElement('div') };
        const dialog = new FakeElement('dialog'); dialog.appendChild(copy); dialog.appendChild(host);
        const action = { type: 'NONE', title: 'Kein Handlungsbedarf', nettoErlös: 0 };
        const original = JSON.stringify(action);
        const renderer = new ActionRenderer({ outputs });
        renderer.renderAction(action, { tagesgeld: 100000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 }, 14000);
        const content = collectText(host);
        assert(content.includes('Geldmarkt-ETF') && content.includes('Liquidität'), 'Interne Cashumschichtung bleibt in Quellen und Verwendungen');
        assertEqual(outputs.balanceActionTitle.textContent, 'Umschichten', 'Interne Umschichtung erhält ein eigenes Verb');
        assertEqual(collectText(outputs.balanceActionAmount), '75.000\u00a0€', 'Transferbetrag wird ohne externen Nettozufluss angezeigt');
        assert(!collectText(outputs.balanceActionAmount).includes('netto'), 'Transfer ist kein externer Nettozufluss');
        assert(outputs.balanceActionNote.textContent.includes('Tagesgeld und Geldmarkt'), 'Kurzfassung erklärt die interne Empfehlung');
        renderer.renderAction(action, { tagesgeld: 100000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 }, 14000);
        assertEqual(dialog.children[0], copy, 'Wiederholtes Rendering erhält den stabilen Kopierknopf');
        assertEqual(host.children.length, 1, 'Wiederholtes Rendering ersetzt ausschließlich den Detailinhalt');
        assertEqual(JSON.stringify(action), original, 'Darstellung verändert keine Engineaktion');
    } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
}

// Kurzprojektion: Vorrang, Centpräzision im Detail, unveränderte Daten und Folgerendern.
{
    globalThis.window = {};
    const host = new FakeElement(), copy = new FakeElement('button'); copy.id = 'copyAction';
    host.appendChild(copy);
    const outputs = { handlungsanweisung: host, balanceActionTitle: new FakeElement(),
        balanceActionAmount: new FakeElement(), balanceActionNote: new FakeElement(), balanceActionTransfer: new FakeElement() };
    const renderer = new ActionRenderer({ outputs });
    const source = (kind, netto, steuer = 0) => ({ kind, netto, brutto: netto + steuer, steuer });
    const transaction = (quellen = [], verwendungen = {}) => ({ type: 'TRANSACTION',
        title: 'Vollständiger bisheriger Titel', quellen, verwendungen,
        nettoErlös: quellen.reduce((sum, q) => sum + q.netto, 0), steuer: quellen.reduce((sum, q) => sum + q.steuer, 0) });
    const cases = [
        [transaction([source('aktien_alt', 1234.56, 10.25)], { liquiditaet: 1234.56 }), 'Aktien verkaufen', '1.235\u00a0€ netto', 'Liquidität aufzufüllen'],
        [transaction([source('aktien_neu', 1500), source('gold', 200)]), 'Aktien verkaufen', '1.700\u00a0€ netto', 'Goldbestand anzupassen'],
        [transaction([source('gold', 300.25)], { liquiditaet: 300.25 }), 'Gold verkaufen', '300\u00a0€ netto', 'Goldbestand anzupassen'],
        [transaction([source('liquiditaet', 400.75)], { gold: 400.75 }), 'Gold kaufen', '401\u00a0€', 'Goldbestand anzupassen'],
        [transaction([source('gold', 600)], { gold: 400 }), 'Gold verkaufen', '600\u00a0€ netto', 'Goldbestand anzupassen'],
        [transaction([source('liquiditaet', 1700.65)], { geldmarkt: 1700.65 }), 'Umschichten', '1.701\u00a0€', 'Tagesgeld und Geldmarkt'],
        [transaction([source('geldmarkt', 800.25)], { liquiditaet: 800.25 }), 'Umschichten', '800\u00a0€', 'Tagesgeld und Geldmarkt'],
        [transaction([source('anleihe', 456.78)]), 'Handlung prüfen', '', 'Details prüfen'],
        [transaction([source('liquiditaet', 789.12)], { aktien: 789.12 }), 'Aktien kaufen', '789\u00a0€', 'Aktienbestand anzupassen'],
        [{ type: 'NONE', title: 'Technischer Titel ohne Marktbeleg' }, 'Nichts tun', '', 'Keine Transaktion empfohlen']
    ];
    for (const [action, verb, amount, note] of cases) {
        const before = JSON.stringify(action);
        renderer.renderAction(action);
        assertEqual(outputs.balanceActionTitle.textContent, verb, 'Kurzverb aus tatsächlichen Strömen');
        assertEqual(collectText(outputs.balanceActionAmount), amount, 'Nur Kartenbetrag wird auf ganze Euro formatiert');
        assert(outputs.balanceActionNote.textContent.includes(note), 'Alltagssatz aus Verwendung oder Nichtstun');
        assert(!outputs.balanceActionNote.textContent.includes('Bärenmarkt'), 'Ohne Beleg wird kein Bärenmarktgrund erfunden');
        assertEqual(outputs.balanceActionTransfer.textContent, '', 'Keine alte Zusatzzeile nach Folgerendern');
        const detail = renderer.getActionCopyText();
        assertEqual(collectText(host).includes('Woher das Geld kommt'), verb !== 'Nichts tun', 'Nichtstun besitzt keine Quellentabelle');
        assertEqual(collectText(host).includes('· Verkäufe'), (action.quellen || []).some(q => q.brutto > 0 && !['liquiditaet', 'geldmarkt'].includes(q.kind)), 'Verkaufskennzeichnung folgt den tatsächlichen Quellen');
        assert(collectText(host).includes(action.title), 'Vollständiger bisheriger Titel bleibt im Detaildialog');
        assert(!/\d,\d{2}\s*€/.test(collectText(host)), 'Sichtbarer Dialog enthält ausschließlich ganze Euro');
        for (const q of action.quellen || []) {
            assert(detail.includes(q.brutto.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 'Quellenzeilen bleiben centgenau');
        }
        for (const [key, amount] of Object.entries(action.verwendungen || {})) {
            assert(detail.includes(amount.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 'Verwendungen bleiben centgenau');
        }
        assert(![verb, detail, collectText(outputs.balanceActionAmount), outputs.balanceActionNote.textContent].join(' ').includes('Engine-Aktion'), 'Kein sichtbarer Engine-Aktion-Text');
        assertEqual(JSON.stringify(action), before, 'Engineaktion bleibt numerisch unverändert');
        assertEqual(host.children[0], copy, 'Kopiercontrol bleibt erhalten');
        assertEqual(host.children.length, 2, 'Keine alten Detailknoten');
    }
    const purchase = transaction([source('liquiditaet', 1789.12)], { aktien: 1789.12 });
    const purchaseBefore = JSON.stringify(purchase);
    const purchaseSummary = renderer.renderAction(purchase, { tagesgeld: 50000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 });
    assertEqual(purchaseSummary.verb, 'Aktien kaufen', 'Aktienkauf aus Liquidität erhält sein eigenes Kurzverb');
    assertEqual(purchaseSummary.amount, 1789.12, 'Aktienkaufbetrag ist exakt die Aktienverwendung ohne Cashtransfer');
    assertEqual(collectText(outputs.balanceActionAmount), '1.789\u00a0€', 'Aktienkaufkarte formatiert ausschließlich die Aktienverwendung');
    assertEqual(outputs.balanceActionTransfer.textContent, 'plus interne Umschichtung von 25.000\u00a0€', 'Cashtransfer bleibt neben dem Aktienkauf separat');
    assertEqual(JSON.stringify(purchase), purchaseBefore, 'Aktienkauf und Quellen werden nicht verändert');
    globalThis.window = { __profilverbundActionResults: [
        { name: 'Profil A', action: transaction([source('liquiditaet', 1500.25)], { aktien: 1000.25, geldmarkt: 500 }) },
        { name: 'Profil B', action: transaction([source('liquiditaet', 700.5)], { aktien: 700.5 }) }
    ] };
    const householdBefore = JSON.stringify(globalThis.window);
    const householdPurchase = renderer.renderAction(purchase, { tagesgeld: 100000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 });
    assertEqual(householdPurchase.verb, 'Aktien kaufen', 'Materielle Haushaltskäufe ersetzen die Gesamtprojektion');
    assertEqual(householdPurchase.amount, 1700.75, 'Haushaltsbetrag addiert ausschließlich dargestellte Aktienverwendungen');
    assertEqual(householdPurchase.extraTransfer, 500, 'Nur dargestellter Profiltransfer zählt neben dem Aktienkauf');
    assertEqual(JSON.stringify(globalThis.window), householdBefore, 'Haushaltsaktienkauf bleibt lesend');
    assert(collectText(host).includes('Profil A') && collectText(host).includes('Profil B'), 'Aktienkaufdetails behalten die Profilzuordnung');
    globalThis.window = {};
    const sale = transaction([source('aktien_alt', 2300.75)], { liquiditaet: 2300.75 });
    renderer.renderAction(sale, { tagesgeld: 50000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 });
    assertEqual(collectText(outputs.balanceActionAmount), '2.301\u00a0€ netto', 'Zusatztransfer ist nicht Verkaufsnetto');
    assertEqual(outputs.balanceActionTransfer.textContent, 'plus interne Umschichtung von 25.000\u00a0€', 'Bereits integrierter Zusatztransfer zählt einmal');
    assert(collectText(host).includes('Vollständiger bisheriger Titel & Geldmarkt-Opt.'), 'Integrierter bisheriger Titel bleibt vollständig');
    renderer.renderAction(transaction([source('aktien_neu', 2000), source('geldmarkt', 500)], { liquiditaet: 2500 }));
    assertEqual(collectText(outputs.balanceActionAmount), '2.000\u00a0€ netto', 'Geldmarktquelle wird aus externer Nettosumme ausgeschlossen');
    assertEqual(outputs.balanceActionTransfer.textContent, 'plus interne Umschichtung von 500\u00a0€', 'Bestehender Transfer ohne Zusatzrebalance zählt einmal');

    const profileA = transaction([source('aktien_alt', 1000.25)], { liquiditaet: 1000.25 });
    const profileB = transaction([source('gold', 300.5), source('geldmarkt', 200.75)], { liquiditaet: 501.25 });
    globalThis.window = { __profilverbundActionResults: [ { name: 'Profil A', action: profileA }, { name: 'Profil B', action: profileB } ] };
    const beforeProfiles = JSON.stringify(globalThis.window);
    for (const aggregate of [transaction([], {}), transaction([source('aktien_alt', 9999)], { liquiditaet: 9999 })]) {
        renderer.renderAction(aggregate, { tagesgeld: 100000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 });
        assertEqual(outputs.balanceActionTitle.textContent, 'Aktien verkaufen', 'Materielle Profile statt leerer oder voller Gesamtaktion');
        assertEqual(collectText(outputs.balanceActionAmount), '1.301\u00a0€ netto', 'Profilnettosumme ohne doppelte Gesamtaktion oder Cashquelle');
        assertEqual(outputs.balanceActionTransfer.textContent, 'plus interne Umschichtung von 201\u00a0€', 'Nur tatsächlich im Profilplan angezeigter Transfer');
        const detail = renderer.getActionCopyText();
        assert(detail.includes('Profil A') && detail.includes('Profil B') && detail.includes('1.000,25') && detail.includes('300,50'), 'Haushaltsdetails behalten Profilzeilen und Cent');
    }
    assertEqual(JSON.stringify(globalThis.window), beforeProfiles, 'Profilaktionen werden nicht verändert');
    globalThis.window = { __profilverbundActionResults: [
        { action: transaction([source('liquiditaet', 500)], { gold: 500 }) },
        { action: transaction([source('aktien_alt', 700)], { liquiditaet: 700 }) }
    ] };
    renderer.renderAction(transaction());
    assertEqual(outputs.balanceActionTransfer.textContent, '', 'Getrennte Profilkäufe und Liquiditätszuflüsse bilden keinen erfundenen Transfer');

    globalThis.window = {};
    renderer.renderAction({ type: 'NONE', title: 'Kein Handlungsbedarf', transactionDiagnostics: { blockReason: 'liquidity_sufficient' } });
    assertEqual(outputs.balanceActionNote.textContent, 'Die vorhandene Liquidität reicht aus.', 'Nichtstungrund benötigt vorhandenen Beleg');
    assertEqual(collectText(outputs.balanceActionAmount), '', 'Alter Verkaufsbetrag wird entfernt');
    assertEqual(outputs.balanceActionTransfer.textContent, '', 'Alter Profiltransfer wird entfernt');
}

// Gemeinsame Quelle: echter Fassaden-/Diagnose-/Copyweg, keine zweite Ableitung.
{
    const savedDocument = globalThis.document, savedWindow = globalThis.window;
    globalThis.document = { createElement: tag => new FakeElement(tag), createDocumentFragment: () => new FakeElement('fragment'),
        createTextNode: text => { const node = new FakeElement('text'); node.textContent = text; return node; } };
    globalThis.window = {};
    try {
        const outputs = { handlungsanweisung: new FakeElement(), balanceActionTitle: new FakeElement(),
            balanceActionAmount: new FakeElement(), balanceActionTransfer: new FakeElement() };
        const dom = { outputs, diagnosis: { transaction: new FakeElement(), filterToggle: { checked: false } } };
        const diagnosis = { general: {}, keyParams: {}, decisionTree: [], guardrails: [], transactionDiagnostics: {
            wasTriggered: false, blockReason: 'min_trade', blockedAmount: 42000,
            potentialTrade: { direction: 'Verkauf', netAmount: 42000 }, equityThresholds: {}, goldThresholds: {} } };
        const purchase = { type: 'TRANSACTION', title: 'Aktien aus Überschuss',
            quellen: [{ kind: 'liquiditaet', brutto: 1789.12, netto: 1789.12 }], verwendungen: { aktien: 1789.12 } };
        const input = { tagesgeld: 50000, geldmarktEtf: 0 };
        initUIRenderer(dom, {});
        const handlers = createDiagnosisHandlers({ dom, appState: { lastUpdateTimestamp: 0 } });
        const project = ui => { UIRenderer.render(ui); UIRenderer.renderDiagnosis(diagnosis);
            const card = dom.diagnosis.transaction.children[0].children[0];
            const planned = card.children.find(row => row.children?.[0]?.textContent === 'Geplante Aktion:');
            return { screen: collectText(card), planned: collectText(planned), copy: handlers.generateDiagnosisText(diagnosis) }; };
        const single = project({ action: purchase, input, spending: { monatlicheEntnahme: 1000 } });
        assert(single.screen.includes('Aktien kaufen · 1.789\u00a0€') && single.screen.includes('25.000\u00a0€'), 'Sichtbare Diagnose zeigt Aktienkauf und integrierte Cashumschichtung in ganzen Euro');
        assert(single.copy.includes('Geplante Aktion: Aktien kaufen · 1.789,12') && single.copy.includes('25.000,00'), 'Copy nutzt denselben Kurzplan bei geschlossener Detailklappe');
        assert(!single.planned.includes('42.000'), 'Blockierter hypothetischer Handel ersetzt die tatsächliche Empfehlung nicht');
        assert(single.copy.includes('Hypothetischer Handel: Verkauf / 42.000,00'), 'Hypothetischer Handel bleibt im vollständigen Copytext erhalten');
        globalThis.window.__profilverbundActionResults = [
            { name: 'A', action: { ...purchase, verwendungen: { aktien: 1000.25, geldmarkt: 500 } } },
            { name: 'B', action: { ...purchase, quellen: [{ kind: 'liquiditaet', brutto: 289.87, netto: 289.87 }], verwendungen: { aktien: 289.87 } } }
        ];
        const household = project({ action: purchase, input, spending: { monatlicheEntnahme: 1000 } });
        assert(household.screen.includes('Aktien kaufen · 1.290\u00a0€'), 'Sichtbare Haushaltsdiagnose zeigt die gemeinsame Summe in ganzen Euro');
        assert(household.copy.includes('Geplante Aktion: Aktien kaufen · 1.290,12'), 'Haushaltscopy behält die gemeinsame Summe centgenau');
        assertEqual(UIRenderer.getActionSummary().amount, 1290.12, 'Gemeinsamer Haushaltsbetrag stammt aus dem tatsächlichen Handlungsrenderer');
        for (const ui of [null, { input, action: null }, { input }]) {
            const missing = project(ui);
            assertEqual(UIRenderer.getActionCopyText(), '', 'Fehlende Aktion verwirft den alten centgenauen Kopierplan');
            assert(missing.screen.includes('Keine geplante Aktion') && missing.copy.includes('Geplante Aktion: Keine geplante Aktion'), 'Fehlende Aktion verwirft die Kurzfassung des vorigen Renderzyklus');
            assert(!missing.screen.includes('Aktien kaufen'), 'Kein alter Kaufplan nach Null-/fehlender Aktion');
        }
    } finally { globalThis.document = savedDocument; globalThis.window = savedWindow; }
}

// Der Zwecktext lässt den separat gelieferten Deckungszusatz und exakte Details stehen.
{
    const savedWindow = globalThis.window;
    globalThis.window = { __profilverbundActionResults: null };
    try {
        const host = new FakeElement();
        const outputs = { handlungsanweisung: host, balanceActionNote: new FakeElement('p'),
            balanceActionPurpose: new FakeElement('span'), balanceActionCoverage: new FakeElement('span') };
        outputs.balanceActionCoverage.textContent = ' Danach 99,3 % des Ziels.';
        outputs.balanceActionNote.append(outputs.balanceActionPurpose, outputs.balanceActionCoverage);
        const action = { type: 'TRANSACTION', title: 'Exakter bisheriger Plan',
            quellen: [{ kind: 'aktien_alt', brutto: 1250.75, netto: 1200.50, steuer: 50.25 }],
            verwendungen: { liquiditaet: 1200.50 }, nettoErlös: 1200.50, steuer: 50.25 };
        const renderer = new ActionRenderer({ outputs });
        const before = JSON.stringify(action);
        renderer.renderAction(action); renderer.renderAction(action);
        assertEqual(outputs.balanceActionNote.children.length, 2, 'Zweckneuerung erhält beide stabilen Erklärungshosts');
        assertEqual(outputs.balanceActionCoverage.textContent, ' Danach 99,3 % des Ziels.', 'Handlungsrenderer überschreibt keine gelieferte Nachherdeckung');
        assert(outputs.balanceActionPurpose.textContent.includes('Liquidität aufzufüllen'), 'Vollständiger Zwecktext folgt der tatsächlichen Verwendung');
        assert(renderer.getActionCopyText().includes('1.250,75') && renderer.getActionCopyText().includes('1.200,50'), 'Zweckneuerung lässt Quellen und Verwendungen centgenau');
        assert(collectText(host).includes('1.251\u00a0€') && collectText(host).includes('1.201\u00a0€'), 'Dialog und Druck zeigen ganze Euro aus denselben Detaildaten');
        assertEqual(JSON.stringify(action), before, 'Erklärung verändert weder Beträge noch Handlung');
        globalThis.window.__profilverbundActionResults = [{ name: 'Profil A', action }];
        renderer.renderAction(action);
        assertEqual(outputs.balanceActionPurpose.textContent, 'Um die Liquidität aufzufüllen · aus einem Profil.', 'Ein materielles Profil wird grammatisch korrekt genannt');
        globalThis.window.__profilverbundActionResults = [{ name: 'Profil A', action }, { name: 'Profil B', action }];
        renderer.renderAction(action);
        assertEqual(outputs.balanceActionPurpose.textContent, 'Um die Liquidität aufzufüllen · aus beiden Profilen.', 'Umfang nennt ausschließlich die materiell dargestellten Profilaktionen');
        globalThis.window.__profilverbundActionResults.push({ name: 'Profil C', action });
        renderer.renderAction(action);
        assert(outputs.balanceActionPurpose.textContent.includes('aus 3 Profilen.'), 'Mehr als zwei materielle Profile erhalten eine korrekte Anzahlform');
    } finally { globalThis.window = savedWindow; }
}

// Regression: Quelle und Tranche bleiben in jedem Projektionspfad getrennt.
{
    const savedWindow = globalThis.window;
    const nodes = node => [node, ...node.children.flatMap(nodes)];
    const failures = [];
    const lot = { kind: 'aktien_alt', name: 'Synthetische lange Tranche', isin: 'SYNTHETIC-A',
        purchaseDate: '2014-03-01', trancheId: 'hidden-lot', sourceProfileId: 'hidden-owner',
        brutto: 1250.75, steuer: 50.25, netto: 1200.50 };
    const second = { ...lot, name: 'Synthetische Monatstranche', isin: 'SYNTHETIC-B', purchaseDate: '2019-04' };
    const transaction = sources => ({ type: 'TRANSACTION', title: 'Synthetischer Verkauf', quellen: sources,
        steuer: sources.reduce((sum, q) => sum + q.steuer, 0),
        nettoErlös: sources.reduce((sum, q) => sum + q.netto, 0),
        verwendungen: { liquiditaet: sources.reduce((sum, q) => sum + q.netto, 0) } });
    const fallbackSources = [
        { ...lot, name: 'Nur Name ohne Datum', isin: undefined, purchaseDate: undefined },
        { ...lot, name: 'Nur Name mit unlesbarem Datum', purchaseDate: 'unlesbar' },
        { ...lot, name: undefined, purchaseDate: '2019-04' },
        { ...lot, name: undefined, purchaseDate: undefined },
        { ...lot, name: undefined, purchaseDate: '2019-13' }
    ];
    const dateLabel = q => q.purchaseDate === '2014-03-01' ? 'Kauf 01.03.2014'
        : q.purchaseDate === '2019-04' ? 'Kauf 04/2019' : '';
    const tranche = q => [q.name, dateLabel(q)].filter(Boolean).join(' · ') || '—';
    const named = [lot, second];
    const profiles = [{ name: 'Profil B', depotAlt: 100, totalAssets: 100 },
        { name: 'Profil A', depotAlt: 100, totalAssets: 100 }];
    const distributed = named.map(q => ({ ...q, brutto: 2501.50, steuer: 100.50, netto: 2401.00 }));
    const scenarios = [
        { name: 'Einzelprofil', globals: { __profilverbundActionResults: [], __profilverbundProfileSummaries: [] },
            action: transaction([...named, ...fallbackSources]),
            expected: [...named, ...fallbackSources].map(q => ({ q, profile: null })),
            total: ['8.755', '352', '8.404'], preciseTotal: ['8.755,25', '351,75', '8.403,50'] },
        { name: 'Materieller Haushalt', globals: { __profilverbundProfileSummaries: profiles,
            __profilverbundActionResults: [{ name: 'Profil B', action: transaction(named) },
                { name: 'Profil A', action: transaction([second, lot]) }] },
            action: transaction([lot]),
            expected: [lot, second, second, lot].map((q, index) => ({ q, profile: index < 2 ? 'Profil B' : 'Profil A' })),
            total: ['5.003', '201', '4.802'], preciseTotal: ['5.003,00', '201,00', '4.802,00'] },
        { name: 'Verteilungshaushalt', globals: { __profilverbundActionResults: [], __profilverbundProfileSummaries: profiles },
            action: transaction(distributed),
            expected: distributed.flatMap(q => profiles.map(profile => ({ q, profile: profile.name, allocated: true }))),
            total: ['5.003', '201', '4.802'], preciseTotal: ['5.003,00', '201,00', '4.802,00'] }
    ];
    try {
        for (const scenario of scenarios) {
            try {
                globalThis.window = scenario.globals;
                const host = new FakeElement(), copyButton = new FakeElement('button');
                copyButton.id = 'copyAction'; host.appendChild(copyButton);
                const renderer = new ActionRenderer({ outputs: { handlungsanweisung: host } });
                const input = { profilName: 'Synthetisches Profil' };
                const before = JSON.stringify({ action: scenario.action, input, globals: scenario.globals });
                let previous = null;
                for (let render = 0; render < 2; render++) {
                    renderer.renderAction(scenario.action, input);
                    const tables = nodes(host).filter(node => node.tagName === 'table'
                        && node.children.some(child => child.tagName === 'caption' && child.textContent.startsWith('Woher das Geld kommt')));
                    assertEqual(tables.length, 1, `${scenario.name}: genau eine Quellentabelle`);
                    const table = tables[0];
                    const columns = table.children.find(node => node.tagName === 'thead').children[0].children.map(cell => cell.textContent);
                    const body = table.children.find(node => node.tagName === 'tbody');
                    const rows = body.children.filter(row => row.className !== 'balance-action-total');
                    assertEqual(rows.length, scenario.expected.length, `${scenario.name}: vollständige Quellenanzahl`);
                    const copy = renderer.getActionCopyText();
                    const lines = copy.split('\n');
                    const headingIndex = lines.indexOf(columns.join(' | '));
                    assert(headingIndex >= 0, `${scenario.name}: Tabellenkopf in der Kopie`);
                    scenario.expected.forEach(({ q, profile, allocated }, index) => {
                        const cells = rows[index].children.map(cell => cell.textContent);
                        const copied = lines[headingIndex + 1 + index].split(' | ');
                        for (const [values, medium] of [[cells, 'Tabelle'], [copied, 'Kopie']]) {
                            if (q.name) assertEqual(values.reduce((sum, value) => sum + value.split(q.name).length - 1, 0), 1,
                                `${scenario.name}: ${medium} Zeile ${index + 1} enthält den Namen genau einmal`);
                            const source = values[columns.indexOf('Quelle')];
                            assertEqual(source, `Aktien (alt)${q.isin ? ` · ${q.isin}` : ''}`, `${scenario.name}: ${medium} nur Kategorie und ISIN`);
                            if (q.isin) assertEqual(source.split(q.isin).length - 1, 1, `${scenario.name}: ${medium} ISIN einmal`);
                            assertEqual(values[columns.indexOf('Tranche')], tranche(q), `${scenario.name}: ${medium} Name und Kaufdatum mit Fallback`);
                            if (profile) assertEqual(values[columns.indexOf('Profil')], profile, `${scenario.name}: ${medium} Profil-/Quellenreihenfolge`);
                        }
                        const moneyColumns = ['Brutto', columns.find(column => column.startsWith('Steuern')), 'Netto'];
                        const visible = allocated ? ['1.251', '—', '—'] : ['1.251', '50', '1.201'];
                        const precise = allocated ? ['1.250,75', '—', '—'] : ['1.250,75', '50,25', '1.200,50'];
                        moneyColumns.forEach((column, i) => {
                            assertEqual(cells[columns.indexOf(column)], visible[i] === '—' ? '—' : `${visible[i]}\u00a0€`, `${scenario.name}: Zeilenbetrag ganze Euro`);
                            assertEqual(copied[columns.indexOf(column)], precise[i] === '—' ? '—' : `${precise[i]}\u00a0€`, `${scenario.name}: Zeilenbetrag centgenau`);
                        });
                    });
                    const total = body.children.find(row => row.className === 'balance-action-total').children.map(cell => cell.textContent);
                    const copiedTotal = lines[headingIndex + 1 + rows.length].split(' | ');
                    assertEqual(total.slice(-3).join('|'), scenario.total.map(amount => `${amount}\u00a0€`).join('|'), `${scenario.name}: autoritative sichtbare Summen`);
                    assertEqual(copiedTotal.slice(-3).join('|'), scenario.preciseTotal.map(amount => `${amount}\u00a0€`).join('|'), `${scenario.name}: autoritative Cent-Summen`);
                    for (const id of [lot.trancheId, lot.sourceProfileId]) assert(!collectText(host).includes(id) && !copy.includes(id), `${scenario.name}: keine technische ID`);
                    assertEqual(JSON.stringify({ action: scenario.action, input, globals: scenario.globals }), before, `${scenario.name}: keine Datenmutation`);
                    assertEqual(host.children.length, 2, `${scenario.name}: keine doppelten Detailknoten`);
                    assertEqual(host.children[0], copyButton, `${scenario.name}: bestehender Kopierknopf erhalten`);
                    const snapshot = JSON.stringify({ text: collectText(host), copy });
                    if (previous !== null) assertEqual(snapshot, previous, `${scenario.name}: Wiederholungsrendern ist identisch`);
                    previous = snapshot;
                }
            } catch (error) {
                if (!error.isTestAssertionError) throw error;
                failures.push(error);
            }
        }
        if (failures.length) throw failures[0];
    } finally { globalThis.window = savedWindow; }
}

// Restpunkte: kompakter Kopf, lesbare Tranchen, bedingte Steuerdetails und Zeilenkarte.
{
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
        const host = new FakeElement(), purposeHost = new FakeElement();
        const outputs = { handlungsanweisung: host, actionPurposeContent: purposeHost,
            actionDetailsTitle: new FakeElement(), printFooter: new FakeElement() };
        const renderer = new ActionRenderer({ outputs });
        const sources = [
            { kind: 'aktien_alt', name: 'Synthetische lange Tranche', purchaseDate: '2014-03-01', trancheId: 'technical-lot-a', sourceProfileId: 'technical-owner', isin: 'SYNTHETIC', brutto: 1250.75, netto: 1200.50, steuer: 50.25 },
            { kind: 'aktien_neu', purchaseDate: '2019-04', trancheId: 'technical-lot-b', brutto: 300.33, netto: 300.33 },
            { kind: 'gold', name: 'Nur Name', purchaseDate: 'nicht verfügbar', trancheId: 'technical-lot-c', brutto: 20.12, netto: 20.12 },
            { kind: 'gold', trancheId: 'technical-lot-d', brutto: 10.01, netto: 10.01 }
        ];
        const action = { type: 'TRANSACTION', title: 'Liquiditäts-Management', quellen: sources,
            verwendungen: { liquiditaet: 1200.50, gold: 100.25, aktien: 75.15, geldmarkt: 40.02, bonds: 10.01 },
            steuer: 50.25, nettoErlös: 1530.96, spending: { monatlicheEntnahme: 100 } };
        const input = { liquidityRunwayYears: 3, profilName: 'Synthetisches aktives Profil' };
        const context = { input, market: { szenarioText: 'Stabiler Höchststand' }, liquiditaet: { deckungNachher: 99.3 } };
        const before = JSON.stringify({ action, input, context });
        const nodes = node => [node, ...node.children.flatMap(nodes)];
        renderer.renderAction(action, input, {}, undefined, context);
        const text = collectText(host), copy = renderer.getActionCopyText();
        const header = nodes(host).find(node => node.className === 'balance-action-detail-title');
        assertEqual(header.textContent, 'Liquiditäts-Management · Marktphase: Stabiler Höchststand', 'Aktionstitel und Marktphase bilden genau eine Kontextzeile');
        assertEqual(text.split(action.title).length - 1, 1, 'Vollständiger Titel wird sichtbar einmal ausgegeben');
        assertEqual(copy.split(action.title).length - 1, 1, 'Kopie wiederholt den Aktionstitel nicht');
        assert(!text.includes('Um die') && !copy.includes('Um die'), 'Redundanter Zweckabsatz entfällt in Dialog und Kopie');
        assert(text.includes('Synthetische lange Tranche · Kauf 01.03.2014') && text.includes('Kauf 04/2019') && text.includes('Nur Name'), 'Name, volles Kaufdatum und Monatsdatum bleiben lesbar');
        for (const id of ['technical-lot-a', 'technical-lot-b', 'technical-lot-c', 'technical-lot-d', 'technical-owner']) {
            assert(!text.includes(id) && !copy.includes(id), 'Technische Tranchen-/Profil-ID ist kein lesbarer Fallback');
        }
        assert(!text.includes('FIFO') && text.includes('SYNTHETIC'), 'Instrument bleibt lesbar, kein unbelegtes FIFO');
        const sourceTable = nodes(host).find(node => node.tagName === 'table');
        const body = sourceTable.children.find(node => node.tagName === 'tbody');
        assertEqual(body.children[3].children[1].textContent, '—', 'Fehlender Name und Kaufzeitpunkt zeigen einen neutralen Fallback');
        assertEqual(body.children.map(row => row.children[2].textContent).join('|'), '1.251\u00a0€|300\u00a0€|20\u00a0€|10\u00a0€|1.581\u00a0€', 'Quellenreihenfolge und autoritative Bruttosumme bleiben erhalten');
        assert(!text.includes('Quellen- und Steuerdetails'), 'Ohne Zusatzsteuerinformation entsteht keine separate Summenbox');
        assert(text.includes('Steuern (geschätzt)'), 'Steuerschätzung bleibt in der Quellentabelle gekennzeichnet');
        const uses = nodes(host).find(node => node.className.includes('balance-action-uses'));
        const rows = uses.children.slice(1);
        assertEqual(rows.length, 7, 'Alle fünf Verwendungen, bestehende Zielinformation und Nachherdeckung bleiben in der Karte');
        assert(collectText(uses).includes('Ziel Tagesgeld (Jahr + 2 Monate)') && collectText(uses).includes('1.400\u00a0€'), 'Vorhandene Tagesgeldzielinformation bleibt ohne neue Zuflussaufteilung erhalten');
        const liquidity = rows.find(row => row.children[0].textContent === 'Zufluss Liquidität');
        assertEqual(liquidity.children[1].textContent, 'Liquiditätsziel: 36 Monate Nettoentnahme', 'Zielmonate stehen direkt bei der vorhandenen Verwendung');
        assertEqual(liquidity.children[2].textContent, '+1.201\u00a0€', 'Liquiditätszufluss erhält ein sichtbares Plus');
        assertEqual(rows.at(-1).children.map(cell => cell.textContent).join('|'), 'Danach|laut Berechnung|99,3 % des Ziels', 'Nachherdeckung erhält keinen erfundenen Eurobetrag');
        assert(copy.includes('Vorläufige Vorschau') && copy.includes('wenn heute Jahresabschluss wäre'), 'Details und Kopie kennzeichnen die heutige Aktion ausdrücklich als Vorschau');
        for (const amount of ['1.250,75', '50,25', '1.200,50', '300,33', '20,12', '10,01', '100,25', '75,15', '40,02', '1.400,00']) assert(copy.includes(amount), 'Kopie erhält sämtliche Detailbeträge centgenau');
        assert(!nodes(purposeHost).some(node => node.tagName === 'td' && node.textContent.endsWith(':')), 'Zwecklabels haben keinen abschließenden Doppelpunkt');
        assertEqual(JSON.stringify({ action, input, context }), before, 'Rendern mutiert keine Eingangs- oder Ergebnisdaten');
        renderer.renderAction({ ...action, taxSettlement: {} });
        assert(!collectText(host).includes('Quellen- und Steuerdetails') && collectText(host).includes('Steuern (final, Settlement)'), 'Settlementkennzeichnung allein erzeugt keine redundante Steuerbox');
        renderer.renderAction({ ...action, verwendungen: { gold: 100.25 } }, input, {}, undefined, context);
        assert(collectText(host).includes('LiquiditätszielNettoentnahme36 Monate') && renderer.getActionCopyText().includes('Liquiditätsziel | Nettoentnahme | 36 Monate'), 'Vorhandene Zielinformation bleibt auch ohne Liquiditätszufluss in der Karte');
        renderer.renderAction(action);
        assert(!collectText(host).includes('Monate Nettoentnahme') && !collectText(host).includes('laut Berechnung'), 'Fehlendes Ziel und fehlende Nachherdeckung erzeugen keine Nullzeile');
        assertEqual(nodes(host).find(node => node.className === 'balance-action-detail-title').textContent, action.title, 'Fehlende Marktphase erzeugt keinen leeren Trenner');
        for (const [reason, expected] of [['liquidity_sufficient', 'Die vorhandene Liquidität reicht aus.'], ['min_trade', 'Der mögliche Handel liegt unter der Mindestgröße.']]) {
            renderer.renderAction({ type: 'NONE', title: 'Keine Aktion', transactionDiagnostics: { blockReason: reason } });
            assert(collectText(host).includes(expected) && renderer.getActionCopyText().includes(expected), 'Nichtstun- und Mindesthandelsgründe bleiben erhalten');
        }
        const cash = { type: 'TRANSACTION', title: 'Cash', quellen: [{ kind: 'geldmarkt', brutto: 88.25, netto: 88.25 }], verwendungen: { liquiditaet: 88.25 } };
        renderer.renderAction(cash);
        const transferTable = nodes(host).find(node => node.tagName === 'table' && collectText(node).includes('Interne Umschichtung'));
        assertEqual(transferTable.children.at(-1).children[0].children.length, 2, 'Einzelprofiltransfer erhält keine leere Profilzelle');
        assert(collectText(transferTable).includes('Geldmarkt-ETF → Tagesgeld') && renderer.getActionCopyText().includes('88,25'), 'Cashrichtung und Transferbetrag bleiben unverändert');
        // Die bestehende Cashintegration ergänzt den Titel, kein zweiter Originaltitel.
        renderer.renderAction(action, { tagesgeld: 100000, geldmarktEtf: 0 }, { monatlicheEntnahme: 1000 });
        assertEqual(nodes(host).filter(node => node.className === 'balance-action-detail-title').length, 1, 'Cashintegration erzeugt nur eine Titelzeile');
        assertEqual(collectText(host).split(action.title).length - 1, 1, 'Cashergänzter Originaltitel steht genau einmal');
        assert(collectText(host).includes('Liquiditäts-Management & Geldmarkt-Opt.'), 'Vorhandene Cashergänzung bleibt im vollständigen Titel');
        globalThis.window.__profilverbundActionResults = [{ name: 'Haushalt A', action: { ...action, taxSettlement: { taxBeforeLossCarry: 75.35, taxAfterLossCarry: 50.25, taxSavedByLossCarry: 25.10 } } }, { name: 'Haushalt B', action: cash }];
        const householdBefore = JSON.stringify(globalThis.window);
        renderer.renderAction(action);
        const householdText = collectText(host), householdCopy = renderer.getActionCopyText();
        assert(householdText.includes('Profil') && householdText.includes('Haushalt A: Steuern vor Verlusttopf'), 'Haushalt erhält Profilzuordnung und relevante Settlementdetails');
        for (const value of ['75,35', '50,25', '25,10', '88,25']) assert(householdCopy.includes(value), 'Haushaltskopie erhält alle relevanten Steuer- und Cashdetails');
        assertEqual(JSON.stringify(globalThis.window), householdBefore, 'Haushaltsprojektion verändert keine Profilaktionsdaten');
    } finally { globalThis.window = previousWindow; }
}

// Einzelner Boxkopf, assistive Caption und aktueller Kontext bei erneuter Anzeige.
{
    const previousWindow = globalThis.window;
    globalThis.window = {};
    try {
        const outputs = Object.fromEntries(['handlungsanweisung', 'actionPurposeContent', 'balancePlanningYear',
            'balanceMarketDate', 'printFooter'].map(id => [id, new FakeElement()]));
        outputs.printFooter.dataset = { engineVersion: 'synthetic-api', versions: 'UI: veralteter technischer Block' };
        outputs.balancePlanningYear.textContent = '2031';
        outputs.balanceMarketDate.textContent = '31.12.2030';
        const source = { kind: 'aktien_alt', name: 'Synthetische Tranche', brutto: 1000.75, netto: 900.50, steuer: 100.25 };
        const action = { type: 'TRANSACTION', title: 'Liquiditäts-Management', quellen: [source],
            verwendungen: { liquiditaet: 900.50 }, steuer: 100.25, nettoErlös: 900.50 };
        const renderer = new ActionRenderer({ outputs });
        const flatten = node => [node, ...node.children.flatMap(flatten)];
        const captionRules = rules('css/balance.css', readSources()['css/balance.css']);
        const style = selector => Object.assign({}, ...captionRules.filter(rule => rule.selector === selector).map(rule => rule.declarations));
        renderer.renderAction(action, null, {}, undefined, { input: { profilName: 'Muster A' } });
        for (const [host, title] of [[outputs.handlungsanweisung, 'Woher das Geld kommt · Verkäufe'],
            [outputs.actionPurposeContent, 'Plan nach Zweck']]) {
            const nodes = flatten(host);
            const heads = nodes.filter(node => node.tagName === 'h3' && node.textContent === title);
            const captions = nodes.filter(node => node.tagName === 'caption' && node.textContent === title);
            assertEqual(heads.length, 1, `${title}: genau ein sichtbarer Kopf`);
            assertEqual(captions.length, 1, `${title}: benannte Tabelle bleibt erhalten`);
            assert(heads[0].parentNode.className === 'ds-table-box', 'Titel gehört zum Tabellenkasten');
            assertEqual(renderer.getActionCopyText().split(title).length - 1, 1, 'Kopie enthält jeden Abschnittstitel einmal');
        }
        const caption = style('.balance-action-table caption');
        assert(caption.position === 'absolute' && caption['clip-path'] === 'inset(50%)' && caption.width === '1px', 'Caption beansprucht keine sichtbare Fläche');
        assert(!caption.display && !caption.visibility, 'Tabellenname bleibt assistiv lesbar');
        assert(collectText(outputs.printFooter).includes('Planungsjahr 2031 · Muster A · Marktdaten 31.12.2030'), 'Fuß enthält vorhandenen Plan-/Profil-/Marktdatenkontext');
        assert(!collectText(outputs.printFooter).includes('UI:') && renderer.getActionCopyText().includes('100,25'), 'Technikblock entfällt, fachliche Kopie bleibt präzise');
        outputs.balancePlanningYear.textContent = '2032'; outputs.balanceMarketDate.textContent = '31.12.2031';
        globalThis.window.__profilverbundProfileSummaries = [{ name: 'Muster A' }, { name: 'Synthetischer langer Partnername' }];
        globalThis.window.__profilverbundActionResults = [{ name: 'Muster A', action }];
        renderer.renderAction(action, null, {}, undefined, { input: { profilName: 'Muster A' } });
        const footer = collectText(outputs.printFooter);
        assert(footer.includes('Planungsjahr 2032') && footer.includes('Haushalt · Muster A + Synthetischer langer Partnername')
            && footer.includes('31.12.2031') && !footer.includes('2030'), 'Erneutes Rendern ersetzt den Kontext nach Plan-/Haushaltswechsel');
        assertEqual(outputs.printFooter.children.length, 1, 'Optionale Engineversion wird nicht dupliziert');
        assertEqual(outputs.printFooter.children[0].tagName, 'small', 'Engineversion ist eine kleine Endnotiz');
        const cells = flatten(outputs.handlungsanweisung).filter(node => node.className === 'balance-action-profile');
        assert(cells.some(node => node.textContent === 'Muster A'), 'Materielle Profilzeile bleibt zugeordnet');
        assertEqual(style('.balance-action-table .balance-action-profile')['white-space'], 'nowrap', 'Profilnamen bleiben einzeilig im internen Tabellenüberlauf');
        renderer.clearAction();
        assertEqual(collectText(outputs.printFooter), '', 'Verworfene Aktion lässt keinen alten Kontext stehen');
    } finally { globalThis.window = previousWindow; }
}
