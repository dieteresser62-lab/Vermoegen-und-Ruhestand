import { testamentEstate, inheritancePreview, inheritanceTaxRate } from '../app/profile/household-partnership.js';
import { payResidenceTaxForYear } from '../app/simulator/simulator-residence-tax.js';
import { beginPersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
const annual = { home: 'residence', residenceTax: 'annual' };

if (!process.env.H1_CASE || process.env.H1_CASE === '5a') {
    for (const status of ['married', 'unmarried']) {
        const estate = testamentEstate(0, 10000, 10000, 100, annual, { status, partnerAge: 90 });
        assertEqual(estate.residenceTax.immediateComparison, 0, 'H-1 Gesamterwerb liegt unter dem Freibetrag');
        assertEqual(estate.residenceTax.annualTax, 0, 'H-1 Steuerfreier Gesamterwerb erzeugt keine Jahressteuer');
        assertEqual(inheritanceTaxRate(0, status), 0, 'H-1 Kein steuerpflichtiger Gesamterwerb bedeutet Satz null');
        assertEqual(inheritanceTaxRate(-1, status), 0, 'H-1 Negativer steuerpflichtiger Gesamterwerb bedeutet Satz null');
    }
}
if (!process.env.H1_CASE || process.env.H1_CASE === '5b') {
    const row = { jahr: 1, abgang_erben: 0, erbschaftsteuer: 0, inheritance: { assets: 0, inherited: 0, inheritedHome: 0, tax: 0, leaves: 0,
        residenceTax: { annualValue: 10000, rate: .07, annualTax: 700, allowanceRemaining: 0, immediateComparison: 0 } } };
    for (const source of ['mc']) {
        const html = renderProtocolTable([source === 'mc' ? row : { jahr: 2026, row }], { source, logDetailLevel: 'detailed' });
        assert(!html.includes('7.000000000000001'), 'H-1 Todesjahr-Protokoll zeigt keinen Gleitkomma-Steuersatz');
        assert(html.includes('7,0\u00a0%'), 'H-1 Todesjahr-Protokoll nutzt den Prozentformatierer');
    }
}
if (!process.env.H1_CASE || process.env.H1_CASE === '5c') {
    const portfolio = { personAccounts: [{ profileId: 'a', tagesgeld: 10000, geldmarktEtf: 0, sparerPauschbetrag: 0, taxState: { lossCarry: 0 } }],
        tagesgeld: 10000, geldmarktEtf: 0, liquiditaet: 10000, depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [],
        residenceTax: { profileId: 'a', annualValue: 1000, rate: .3, annualTax: 300, allowanceRemaining: 0 },
        homeInheritance: { home: { mode: 'residence', residenceActive: true } } };
    for (const simulationPeople of [[], [{ profileId: 'b' }, { profileId: 'c' }], [{ profileId: 'a' }, { profileId: 'a' }]]) {
        const current = structuredClone(portfolio);
        beginPersonalTaxYear(current);
        const result = payResidenceTaxForYear(current, { simulationPeople }, { survivorProfileId: 'a' }, { p1Alive: true, p2Alive: false, care: { p2: { active: true, grade: 4 } } });
        assertEqual(result?.wohnrechtsteuer, 300, 'H-1 Nicht eindeutig zugeordneter Zahler wird nicht als Person 2 behandelt');
        assert(result.residenceTaxPayment.note.includes('nicht eindeutig'), 'H-1 Fehlende Zahlerzuordnung wird protokolliert');
        const html = renderProtocolTable([{ jahr: 2, ...result }], { source: 'mc', logDetailLevel: 'detailed' });
        assert(html.includes(result.residenceTaxPayment.note), 'H-1 Hinweis zur fortgesetzten Zahlung ist im Protokoll sichtbar');
    }
    for (const [index, alive] of [[0, false], [1, false], [0, true], [1, true]]) {
        const current = structuredClone(portfolio); beginPersonalTaxYear(current);
        const simulationPeople = index === 0 ? [{ profileId: 'a' }, { profileId: 'b' }] : [{ profileId: 'b' }, { profileId: 'a' }];
        const result = payResidenceTaxForYear(current, { simulationPeople }, { survivorProfileId: 'a' }, { p1Alive: index === 0 ? alive : true, p2Alive: index === 1 ? alive : true });
        assertEqual(result?.wohnrechtsteuer ?? null, alive ? 300 : null, 'H-1 Bekannter Zahler verwendet seinen eigenen Lebendstatus');
    }
}
// 5d: Der Produktionsaufrufer übergab bereits den Selbstnutzungswert, auch ohne Ehe.
if (!process.env.H1_CASE || process.env.H1_CASE === '5d') {
    for (const status of ['married', 'unmarried']) {
        const options = { status, partnerAge: 60, residenceValue: 12000, testament: annual };
        const legacy = inheritancePreview(100000, 600000, 50, { ...options, exemptHome: 600000 });
        const explicit = inheritancePreview(100000, 600000, 50, { ...options, selfUsedHome: 600000 });
        assert(legacy.residenceCapital > 0, 'H-1 Bestehender Vorschauaufruf setzt den Wohnrechtswert auch ohne Ehe an');
        assertEqual(JSON.stringify(explicit), JSON.stringify(legacy), 'H-1 Eindeutiger Selbstnutzungsparameter und bisheriger Aufruf liefern identische Vorschau');
    }
}
