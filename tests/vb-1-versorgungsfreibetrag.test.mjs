// VB-1 (FR-51, Ergänzung 19.11.2026): Versorgungsfreibetrag nach § 17 ErbStG für den überlebenden Ehe- oder Lebenspartner.
// Sollfall: auftrag/VB-1-sollfall.md, hergeleitet aus Gesetz, R E 17 ErbStR und BMF-Tabelle 2026. Seit HP-4 rundet die App den
// steuerpflichtigen Erwerb auf volle 100 € ab (§ 10 Abs. 1 Satz 6 ErbStG); Erwerb und Steuer sind abgerundet, alte Werte im HP-4-Beleg.
import { pensionAllowance, inheritanceTax, inheritanceTaxable, inheritanceTariff, testamentEstate } from '../app/profile/household-partnership.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio-init.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { calculateHouseholdPensionForYear } from '../app/simulator/simulator-household-pension.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { readFileSync } from 'node:fs';

const married = 'married', PERSONAL = 500000, cent = .005;
const { pensionA2: { nachher: a2 } } = JSON.parse(readFileSync(new URL('./fixtures/ja-1-expectation-deltas.json', import.meta.url), 'utf8'));
// Fall, Monatsrente, Alter, Geschlecht, Erwerb vor § 17 (nach persönlichem Freibetrag), Einmalbetrag, Freibetrag, Erwerb, Steuer.
const cases = [
    ['A', 300, 70, 'w', 750000, 0, 216014.80, 533900, 80085],
    ['A2', 300, 70, 'w', 750000, 1650, 214364.80, 535600, 80340],
    ['B', 0, 70, 'w', 750000, 0, 256000, 494000, 74100],
    ['C', 1500, 75, 'm', 400000, 0, 106924, 293000, 32230],
    ['C′', 2600, 75, 'm', 400000, 0, 0, 400000, 60000],
    ['D', 825, 68, 'w', 750000, 0, 139922.50, 610000, 95000]
];
for (const [name, monthly, age, gender, before, lumpSum, allowance, taxable, tax] of cases) {
    const relief = pensionAllowance(married, { annualPension: monthly * 12, lumpSum, age, gender });
    assertClose(relief.amount, allowance, cent, `Fall ${name}: Versorgungsfreibetrag`);
    const options = { status: married, pensionAllowance: relief.amount };
    assertClose(inheritanceTaxable(before + PERSONAL, options), taxable, cent, `Fall ${name}: steuerpflichtiger Erwerb`);
    assertClose(inheritanceTax(before + PERSONAL, options), tax, cent, `Fall ${name}: Erbschaftsteuer`);
}
{
    const tariff = inheritanceTariff(610077.50, married);
    assert(tariff.effectiveRate < .19 && tariff.effectiveRate > .15, 'Fall D: Härteausgleich nach § 19 Abs. 3 greift');
    assertClose(pensionAllowance(married, { annualPension: 31200, age: 75, gender: 'm' }).capital, 258398.40, cent, 'Fall C′: Kapitalwert über 256.000 €');
    assertEqual(pensionAllowance(married, { annualPension: 1e7, lumpSum: 1e6, age: 60, gender: 'w' }).amount, 0, 'Freibetrag ist nie negativ');
    assertEqual(pensionAllowance(married, { annualPension: 3600, age: 70 }).amount, pensionAllowance(married, { annualPension: 3600, age: 70, gender: 'w' }).amount,
        'Ohne Geschlecht gilt wie beim Wohnrecht der Frauenwert');
}
for (const status of ['unmarried', undefined]) {
    const relief = pensionAllowance(status, { annualPension: 0, age: 70, gender: 'w' });
    assertEqual(relief.amount, 0, `${status ?? 'ohne Status'}: kein Versorgungsfreibetrag`);
    assertEqual(inheritanceTax(1250000, { status, pensionAllowance: 256000 }), inheritanceTax(1250000, { status }),
        `${status ?? 'ohne Status'}: Steuerklasse III bleibt ohne Versorgungsfreibetrag`);
}
{
    // Ohne Rente kein Tabellenaufruf; fehlt bei positiver Rente das Alter, gilt vorsichtig 0 und kein Wohnrechtfehler.
    assertEqual(pensionAllowance(married, { annualPension: 0, age: undefined }).amount, 256000, 'Ohne Rente: voller Freibetrag auch ohne Alter');
    let missing;
    try { missing = pensionAllowance(married, { annualPension: 3600, age: undefined, gender: 'w' }); } catch (error) { missing = error; }
    assert(!(missing instanceof Error), 'Fehlendes Alter wirft keinen Wohnrechtfehler');
    assertEqual(missing.amount, 0, 'Fehlendes Alter bei positiver Rente: kein Versorgungsfreibetrag');
    assertEqual(missing.missingAge, true, 'Fehlendes Alter wird gemeldet');
}
{
    // § 23 jährlich: Der Freibetrag mindert Satz, Sofortsteuer und Freibetragsrest wie der Zugewinnabzug.
    const rule = { home: 'residence', residenceTax: 'annual' };
    const estate = (money, value, relief) => testamentEstate(money, 600000, 600000, 100, rule,
        { status: married, partnerAge: 70, partnerGender: 'w', residenceValue: value, ...(relief ? { pensionAllowance: relief } : {}) });
    // Geld 300.000 €, Wohnrecht 60.000 € × 11,107 = 666.420 €: mit Freibetrag 266.420 € (11 %), ohne 466.420 € (15 %).
    const small = estate(300000, 60000, 200000), smallWithout = estate(300000, 60000);
    assertClose(small.residenceTax.allowanceRemaining, smallWithout.residenceTax.allowanceRemaining + 200000, 1e-7, '§ 23: Freibetragsrest wächst um den Versorgungsfreibetrag');
    assertEqual(small.residenceTax.rate, .11, '§ 23: Satz nach dem Gesamterwerb abzüglich Versorgungsfreibetrag');
    assertEqual(smallWithout.residenceTax.rate, .15, '§ 23: ohne Versorgungsfreibetrag höhere Stufe');
    // Geld 900.000 €, Wohnrecht 222.140 €: Gesamterwerb 422.140 € (15 %), sofort steuerpflichtig 200.000 €.
    assertClose(estate(900000, 20000, 200000).tax, 200000 * .15, 1e-7, '§ 23: Sofortsteuer nach beiden Freibeträgen');
}

// Simulatorweg: Erika (Witwe) erbt 100 % von Max, Gütertrennung, ohne Immobilien; Erwerb vor § 17 = 750.000 €.
function deathYear({ status = married, birth = '1966-01-01', pension, startAge = 60, cash = 1250000 }) {
    const inputs = { partnership: { schemaVersion: 1, status, maritalPropertyRegime: 'separation', inheritance: { max: 100 }, marriedInheritance: { max: 100 } },
        tagesgeld: cash + 10000, detailledTranches: [], residenceReferenceYear: 2026, referenceYear: 2026,
        simulationPeople: [{ profileId: 'max', tagesgeld: cash, geburtsdatum: '1960-01-01' }, { profileId: 'erika', tagesgeld: 10000, ...(birth ? { geburtsdatum: birth } : {}) }],
        startAlter: 66, geschlecht: 'm', partner: { aktiv: true, ...(startAge === null ? {} : { startAlter: startAge }), geschlecht: 'w' } };
    const portfolio = initializePortfolio(inputs);
    portfolio.personAccounts[0].tagesgeld = cash; portfolio.personAccounts[1].tagesgeld = 10000;
    syncPersonalLiquidity(portfolio);
    return applyUnmarriedInheritance({ portfolio, inputs, inflationFactor: 1,
        transition: { deathThisYear: true, survivor: { deceasedProfileId: 'max', survivorProfileId: 'erika', deathYearIndex: 10 } },
        pension, personalInterest: { items: [] }, actionResult: { steuer: 0 }, household: { p1Alive: false, p2Alive: true } });
}
// Max: 550 €/Monat; Erika: Witwenrente 300 €/Monat, keine eigene Rente. Sterbevierteljahr 3 × 550 € = 1.650 € (Fall A2).
const widowPension = (overrides = {}) => calculateHouseholdPensionForYear({ inputs: { renteMonatlich: 550, partner: { aktiv: true, monatsrente: 0 }, partnership: { status: married }, ...overrides.inputs },
    yearIndex: 10, currentAnnualPension: 6600, currentAnnualPension2: overrides.ownPension ?? 0, widowPensionP2: 3600, p1Alive: false, p2Alive: true,
    widowBenefits: { p2FromP1: true, p2FromP1Percent: .55 }, deathThisYear: true });
{
    const pension = widowPension();
    assertClose(pension.bereavementQuarterP2, 1650, 1e-9, 'Sterbevierteljahr: Summe der drei Monate nach dem Tod');
    const result = deathYear({ pension });
    assertClose(result.erbschaftsteuer, a2.steuer, cent, 'Simulator Fall A2: Witwe 70, 300 €/Monat, Einmalbetrag 1.650 €');
    assertClose(result.inheritance.pensionAllowance.amount, a2.freibetrag, cent, 'Simulator Fall A2: Freibetrag im Protokoll');
    assertClose(result.inheritance.pensionAllowance.capital, a2.kapitalwert, cent, 'Simulator Fall A2: Kapitalwert mit Sterbevierteljahr');
    // Vollendetes Alter am modellierten Todestag (1. Juli des Todesjahrs 2036).
    assertClose(deathYear({ pension, birth: '1966-07-01' }).inheritance.pensionAllowance.amount, a2.freibetrag, cent, 'Geburtstag am Todestag: 70 vollendet');
    assertClose(deathYear({ pension, birth: '1966-07-02' }).inheritance.pensionAllowance.amount, 256000 - 3600 * 11.490 - 1650, cent, 'Ein Tag später: erst 69 vollendet');
    assertEqual(deathYear({ pension, status: 'unmarried' }).inheritance.pensionAllowance, undefined, 'Unverheiratet: kein Versorgungsfreibetrag im Nachlass');
    const html = renderProtocolTable([{ jahr: 11, erbschaftsteuer: result.erbschaftsteuer, abgang_erben: result.abgang_erben, inheritance: result.inheritance,
        inflation_factor_cum: 1, inflation: 0 }], { source: 'mc', inputs: { partnership: { status: married }, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }] } });
    assert(html.includes('Versorgungsfreibetrag (§ 17 ErbStG)'), 'Protokoll nennt den Versorgungsfreibetrag');
    assert(html.includes('256.000 € minus Kapitalwert der Hinterbliebenenrente 41.894 €'), 'Protokoll nennt die Kürzung');
    assert(!html.includes('Ohne Versorgungsfreibetrag'), 'Alter Hinweis auf die Modellgrenze entfällt');
    // HP-2: Das Erbschaftsteuer-ⓘ nennt den Versorgungsfreibetrag genau einmal, mit Betrag (Zugewinngemeinschaft und Gütertrennung).
    for (const maritalPropertyRegime of ['community', 'separation']) {
        const table = renderProtocolTable([{ jahr: 11, erbschaftsteuer: result.erbschaftsteuer, abgang_erben: result.abgang_erben, inheritance: result.inheritance,
            inflation_factor_cum: 1, inflation: 0 }], { source: 'mc', inputs: { partnership: { status: married, maritalPropertyRegime }, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }] } });
        const info = /Vereinfachte Steuerklasse I:[^<]*Steuerberater fragen\./.exec(table)?.[0] ?? '';
        assertEqual(info.match(/Versorgungsfreibetrag/g)?.length, 1, `HP-2 ${maritalPropertyRegime}: Versorgungsfreibetrag genau einmal`);
        assert(info.includes('Versorgungsfreibetrag (§ 17 ErbStG) 214.106 €'), `HP-2 ${maritalPropertyRegime}: der eine Satz nennt den Betrag`);
    }
}
{
    // Ohne Witwenrente (Tod vor Rentenbeginn, 0 % oder keine Angabe): Jahreswert 0, voller Freibetrag.
    const none = deathYear({ pension: { rente1BruttoEigen: 0 } });
    assertClose(none.erbschaftsteuer, 74100, cent, 'Simulator Fall B: ohne Hinterbliebenenrente voller Freibetrag');
    const startAge = deathYear({ pension: widowPension(), birth: null });
    assertEqual(startAge.inheritance.pensionAllowance.missingAge, undefined, 'Startalter ersetzt das fehlende Geburtsdatum');
    assertClose(startAge.inheritance.pensionAllowance.amount, a2.freibetrag, cent, 'Startalter 60 + 10 Jahre: 70');
    let noAge;
    try { noAge = deathYear({ pension: widowPension(), birth: null, startAge: null }); } catch (error) { noAge = error; }
    assert(!(noAge instanceof Error), 'Simulator ohne Alter: kein Wohnrechtfehler');
    assertEqual(noAge.inheritance.pensionAllowance.missingAge, true, 'Simulator ohne Alter: gemeldet');
    assertClose(noAge.erbschaftsteuer, inheritanceTax(1250000, { status: married }), cent, 'Simulator ohne Alter: Steuer ohne Versorgungsfreibetrag');
    const html = renderProtocolTable([{ jahr: 11, erbschaftsteuer: noAge.erbschaftsteuer, abgang_erben: noAge.abgang_erben, inheritance: noAge.inheritance,
        inflation_factor_cum: 1, inflation: 0 }], { source: 'mc', inputs: { partnership: { status: married }, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }] } });
    assert(html.includes('ohne Alter kein Versorgungsfreibetrag'), 'Protokoll: ohne Alter kein Versorgungsfreibetrag');
    // Erwerb unter dem persönlichen Freibetrag: Steuer 0 wie bisher, keine neuen Nachlassfelder.
    const small = deathYear({ pension: widowPension(), cash: 400000 });
    assertEqual(small.erbschaftsteuer, 0, 'Kleiner Erwerb: steuerfrei');
    assertEqual(small.inheritance.pensionAllowance, undefined, 'Kleiner Erwerb: Nachlass ohne Versorgungsfreibetragsfeld');
}
{
    // Volle Anrechnung auf Jahresbasis, auch wenn die eigene Rente erst im Todesjahr beginnt (Nachtrag 4).
    const pension = widowPension({ ownPension: 1500 * 12, inputs: { partner: { aktiv: true, monatsrente: 1500, startInJahren: 10, renteStartMonate: 6 } } });
    const offset = Math.max(0, 1500 - 26.4 * 42.52) * .4 * 12;
    assert(offset > 0 && offset < 3600, 'Teilweise Anrechnung');
    assertClose(pension.survivorAnnualP2, 3600 - offset, 1e-7, 'Jahreswert nach voller Anrechnung der eigenen Rente');
    const full = widowPension({ ownPension: 10000 * 12, inputs: { partner: { aktiv: true, monatsrente: 10000 } } });
    assertEqual(full.survivorAnnualP2, 0, 'Volle Anrechnung: Jahreswert 0');
}
