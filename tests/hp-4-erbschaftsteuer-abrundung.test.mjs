// HP-4 Teil 2 (H-ERBST-ABRUNDUNG-100, § 10 Abs. 1 Satz 6 ErbStG): Der steuerpflichtige Erwerb wird nach allen Freibeträgen
// auf volle 100 € abgerundet, an einer Stelle (inheritanceTaxable). Nur erfundene Zahlen.
import { inheritanceTax, inheritanceTaxable, inheritancePreview, testamentEstate, homeAndTaxEstate, readPartnership } from '../app/profile/household-partnership.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { beginPersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';

const clean = text => String(text).replaceAll(' ', ' ').replaceAll(' ', ' ');

// Sollfall: 123.456 € steuerpflichtig → 123.400 €; Steuer nach dem Satz der Steuerklasse.
assertEqual(inheritanceTaxable(500000 + 123456, { status: 'married' }), 123400, 'Ehe: 123.456 € steuerpflichtig werden 123.400 €');
assertClose(inheritanceTax(500000 + 123456, { status: 'married' }), 123400 * .11, 1e-9, 'Ehe: Steuer 11 % von 123.400 € = 13.574 €');
assertEqual(inheritanceTaxable(20000 + 123456, { status: 'unmarried' }), 123400, 'Ohne Ehe: 123.456 € steuerpflichtig werden 123.400 €');
assertClose(inheritanceTax(20000 + 123456, { status: 'unmarried' }), 123400 * .3, 1e-9, 'Ohne Ehe: Steuer 30 % von 123.400 € = 37.020 €');
// Die Abrundung kommt nach allen Abzügen, auch nach dem Versorgungsfreibetrag.
assertEqual(inheritanceTaxable(1000000, { status: 'married', exemptHome: 200000, exemptGain: 100000.5, pensionAllowance: 76543.21 }), 123400,
    'Ehe: Abrundung nach Familienheim, Zugewinnausgleich und Versorgungsfreibetrag');

// Grenzfall: 99 € steuerpflichtig → 0 € Steuer.
assertEqual(inheritanceTaxable(20099, { status: 'unmarried' }), 0, 'Grenzfall: 99 € steuerpflichtig werden 0 €');
assertEqual(inheritanceTax(20099, { status: 'unmarried' }), 0, 'Grenzfall: 99 € steuerpflichtig, keine Steuer');
assertEqual(inheritanceTax(500099, { status: 'married' }), 0, 'Grenzfall Ehe: 99 € steuerpflichtig, keine Steuer');

// Vorschau in Haushalt & Plan rechnet über dieselbe Stelle.
const preview = inheritancePreview(143456, 0, 100, { status: 'unmarried' });
assertEqual(preview.taxable, 123400, 'Vorschau: steuerpflichtiger Erwerb abgerundet');
assertClose(preview.tax, 37020, 1e-9, 'Vorschau: Steuer auf den abgerundeten Erwerb');
const homeAndTax = inheritancePreview(150000.37, 200000, 0, { status: 'unmarried', homeAndTax: true, cash: 150000.37 });
assertEqual(homeAndTax.taxable % 100, 0, `Vorschau „Immobilien und Steuergeld“: steuerpflichtiger Erwerb auf volle 100 € (${homeAndTax.taxable})`);
assertClose(homeAndTax.tax, homeAndTax.taxable * .3, 1e-6, 'Vorschau „Immobilien und Steuergeld“: Steuer auf den abgerundeten Erwerb');
const special = homeAndTaxEstate(150000.37, 200000, 0);
assertClose(special.tax, inheritanceTax(special.home + special.inherited), 1e-9, 'Immobilien und Steuergeld: Steuer über dieselbe Stelle');

// § 23 ErbStG: Die Sofortsteuer-Basis im Todesjahr wird abgerundet, der Jahreswert der laufenden Versteuerung nicht.
const residence = testamentEstate(143456, 300050, 300050, 100, { home: 'residence', residenceTax: 'annual' }, { partnerAge: 70, partnerGender: 'w' });
assert(residence.residenceTax, '§ 23: Wohnrecht mit jährlicher Steuer');
assertClose(residence.tax, 123400 * residence.residenceTax.rate, 1e-9, '§ 23: Sofortsteuer auf 123.400 € statt 123.456 €');
assertClose(residence.residenceTax.annualTax, residence.residenceTax.annualValue * residence.residenceTax.rate, 1e-12, '§ 23: Jahressteuer bleibt ungerundet');
assert(residence.residenceTax.annualValue % 100 !== 0, '§ 23: Jahreswert bleibt ungerundet');

// Simulator: Todesjahr mit 143.456 € Tagesgeld ohne Ehe, Erbteil 100 %; Steuer und Protokolleintrag über dieselbe Stelle.
for (const partnership of [{ status: 'unmarried', inheritance: { a: 100 } },
    undefined, readPartnership({ schemaVersion: 1, inheritance: { a: 100 } })]) {
    const account = (profileId, tagesgeld) => ({ profileId, tagesgeld, sparerPauschbetrag: 0, taxState: { lossCarry: 0 }, kirchensteuerSatz: 0 });
    const portfolio = { simulationSourceProfileId: 'a', personAccounts: [account('a', 143456), account('b', 10000)], depotTranchesAktien: [],
        depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [], healthBucketCashOwners: [] };
    beginPersonalTaxYear(portfolio);
    const log = applyUnmarriedInheritance({ portfolio, transition: { deathThisYear: true, survivor: { deceasedProfileId: 'a', survivorProfileId: 'b' } },
        inputs: { simulationPeople: [{ profileId: 'a' }, { profileId: 'b' }], referenceYear: 2026, partnership,
            home: [{ profileId: 'a', nutzung: 'selbst', wert: 100000, stand: '2026-01' }] },
        inflationFactor: 1, pension: { rente1BruttoEigen: 12000, survivorAnnualP2: 6000 }, personalInterest: { items: [] }, actionResult: { steuer: 0 } });
    assertClose(log.erbschaftsteuer, 67020, 1e-9, 'JA-1: Simulator rechnet bei fehlendem Status ebenso 30 % von 223.400 €');
    assertEqual(log.inheritance.taxable, 223400, 'Protokolleintrag nennt den abgerundeten steuerpflichtigen Erwerb');
    assert(!log.inheritance.exemptHome && !log.inheritance.pensionAllowance, 'JA-1: Kein Familienheim- oder Versorgungsfreibetrag');
}

// Protokoll-ⓘ: Zeile zum steuerpflichtigen Erwerb mit dem Hinweis auf die Abrundung.
const inheritance = { deceasedProfileId: 'martin', survivorProfileId: 'petra', assets: 143456, inherited: 143456, inheritedHome: 0, percent: 100,
    tax: 37020, taxable: 123400, leaves: 0, pensionEnds: 0 };
const html = clean(renderProtocolTable([{ jahr: 12, erbschaftsteuer: 37020, abgang_erben: 0, inheritance, inflation_factor_cum: 1, inflation: 2 }],
    { source: 'mc', moneyBasis: 'nominal', inputs: { partnership: { status: 'unmarried' }, simulationPeople: [{ profileId: 'martin' }, { profileId: 'petra' }] } }));
const taxInfo = /Vereinfachte Steuerklasse III:[^<]*/.exec(html)?.[0] ?? '';
assert(taxInfo.includes('Steuerpflichtiger Erwerb 123.400 € (auf volle 100 € abgerundet).'), `Protokoll-ⓘ nennt den abgerundeten Erwerb (${taxInfo})`);
