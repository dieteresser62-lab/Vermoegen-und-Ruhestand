import { musterHaushalt, musterVariante } from './muster-haushalte.js';
import { assertHouseholdPlanRecord } from '../profile/household-plan.js';
import { projectPerson, personDisplayAge } from '../profile/profile-person-data.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { incomeFromRecord, fixedMonthlyIncome } from '../profile/profile-income.js';
import { readPartnership, inheritancePercent, inheritancePreview } from '../profile/household-partnership.js';
import { readImmobilien, IMMOBILIEN_KEY } from '../profile/profile-immobilien.js';
import { PLANNED_EXPENSES_KEY } from '../profile/household-planned-expenses.js';

const euro = value => `${Math.round(value).toLocaleString('de-DE')} €`;
const month = value => `${value.slice(5, 7)}/${value.slice(0, 4)}`;
export const MUSTER_RESTART = 'Unverändert neu starten: „Beispiel neu starten“ im Spielbereichsband wählen.';
export const MUSTER_DISCARD = 'Änderungen an diesem Beispiel werden beim Beenden verworfen.';
const variantExercise = (householdId, ids) => `Steckbrief → „Variante wechseln …“: ${ids.map(id => `„${musterVariante(householdId, id).name}“`).join(' und ')} vergleichen. Dabei starten die Beispieldaten neu.`;
const shiftMonth = (value, years) => value ? month(`${Number(value.slice(0, 4)) + years}${value.slice(4)}`) : 'den neuen Rentenbeginn';
const lessons = {
    'max-erika': {
        question: 'Wie verändert sich unsere Entnahme, sobald die zweite Rente beginnt?',
        exercises: pensionStart => {
            const year = pensionStart && Number(pensionStart.slice(0, 4));
            const years = year ? `die Jahre ${year} und ${year + 1}` : 'das Jahr ihres Rentenbeginns und das Folgejahr';
            return [`Personen & Vermögen → Erika → Einkünfte: Rente, Feld „ab“, von ${pensionStart ? month(pensionStart) : 'ihrem Rentenbeginn'} auf ${shiftMonth(pensionStart, 1)} verschieben. Vergleiche im Simulator → Annahmen → „Einkünfte, Ausgaben und Bedarf“ ${years}, Spalte „Ergebnis“ (aus Vermögen). Ohne Erikas Rente steigt die Entnahme in diesen Jahren.`, 'Personen & Vermögen → Haushalt & Plan → Bedarf pro Jahr: Wunschbedarf um 300 € im Monat erhöhen. Vergleiche Balance → Dein Monatsbudget, Zeile „aus dem Vermögen“. Übersicht: In der Variante „Haus und vermietete Wohnung“ stehen Gesamtvermögen und „davon Geldvermögen“ auf der Vermögenskarte; öffne das ⓘ für die Aufteilung.', 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: Güterstand zwischen „Zugewinngemeinschaft (gesetzlich)“ und „Gütertrennung“ umstellen. Rechne im Simulator mit demselben Seed neu und vergleiche die Erbschaftsteuer in einem Todesjahr mit realem Vermögenszuwachs.'];
        },
        observe: 'Übung 1: Simulator → Annahmen → „Einkünfte, Ausgaben und Bedarf“, Spalte „Ergebnis“. Übung 2: Balance → Dein Monatsbudget, Zeile „aus dem Vermögen“.'
    },
    renate: {
        question: 'Welche Ausgaben kann ich mir dauerhaft leisten, und wo wird mein Plan empfindlich?',
        exercises: ['Personen & Vermögen → Haushalt & Plan → Bedarf pro Jahr: Wunschbedarf in Schritten von 100 € im Monat ändern.', variantExercise('renate', ['grund', 'klein'])],
        observe: 'Nach jeder Änderung Monte Carlo neu rechnen → „Grundbedarf gedeckt“.'
    },
    'jan-lena': {
        question: 'Wie viel früherer Ruhestand ist möglich, wenn wir Ausgaben anpassen können?',
        exercises: (_, pensionStart) => [`Personen & Vermögen → Jan → Einkünfte: Rente, Feld „ab“, von ${pensionStart ? month(pensionStart) : 'seinem Rentenbeginn'} auf ${shiftMonth(pensionStart, -2)} vorziehen.`, variantExercise('jan-lena', ['grund', 'halten'])],
        observe: 'Nach jeder Änderung Monte Carlo neu rechnen → „Läufe mit Jahren unter Mindest-Flex“.',
        note: 'Die Nettozahlung aus vereinbartem Verkauf ist eine feste Zahlung. Die App modelliert dafür keinen Immobilienverkauf.'
    },
    'helga-werner': {
        question: 'Was finanziert eine spätere Pflege, und wie hilft die Pflegereserve?',
        exercises: [`Personen & Vermögen → Werner → Person & Steuern: Pflegegrad heute 3 eintragen. Unter Haushalt & Plan → Bedarf den Grundbedarf auf ${euro(musterVariante('helga-werner', 'haus-pg3').floorBedarf)} im Jahr erhöhen. Die App zählt heutige Pflegekosten nicht von selbst dazu.`, 'Personen & Vermögen → Werner → Person & Steuern: Pflegeform heute auf „zu Hause durch Angehörige“ stellen. Vergleiche Balance → Dein Monatsbudget → Einkünfte: Pflegegeld 599 €/Monat kommt dazu. Öffne danach ein Szenario, in dem Helga stirbt oder selbst Grad 3 erreicht: Werners Angehörigenpflege wechselt im selben Jahr zu externer Unterstützung; das Protokoll-ⓘ erklärt den Grund.'],
        observe: 'Übung 1: Simulator neu rechnen → Szenario-Protokoll, Pflege. Übung 2: Balance → Dein Monatsbudget → Einkünfte.'
    },
    'martin-petra': {
        question: 'Ist der überlebende Partner abgesichert, und steht dafür genug verfügbares Geld bereit?',
        exercises: [variantExercise('martin-petra', ['grund', 'hundert', 'ehe', 'testament']), 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: Erbanteile ändern. Danach Simulator → Monte Carlo rechnen → Szenarien: ein Protokoll mit Todesfall öffnen.', 'Öffne in der Todesjahrzeile das Erbe-ⓘ: Vergleiche Erbschaftsteuer, Kapitalertragsteuer und Herkunft aus Verkauf oder Liquidität mit der Liquidität am Jahresende.'],
        observe: 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: „bleibt im Haushalt / verlässt den Haushalt / Erbschaftsteuer“. Nach jeder Variante Monte Carlo neu rechnen → „Grundbedarf gedeckt“.',
        note: 'Die Erbregeln zeigen Modellwirkungen, keine Empfehlung für eine rechtliche Gestaltung.'
    },
    sophie: {
        question: 'Kann ich mir Teilzeit vor der Rente leisten?',
        exercises: ['Personen & Vermögen → Sophie → Einkünfte: Gehalt ändern. Vergleiche Balance → Dein Monatsbudget, Zeile „angelegt“.', variantExercise('sophie', ['grund', 'teilzeit'])],
        observe: 'Nach jeder Änderung Balance → Dein Monatsbudget, Zeile „angelegt“.',
        note: 'Weniger Arbeit senkt meist auch die Rente. Passe sie selbst an.'
    }
};

const variantLessons = {
    testament: {
        exercises: ['Simulator → Monte Carlo rechnen → Szenarien: einen Pfad mit Martins Tod öffnen. Im Todesjahr zeigt das Erbe-ⓘ Geldanteil, Kapitalwert des Wohnrechts und Steuer. Martins Haus verlässt den Haushalt; Petras eigene Wohnung bleibt, bis sie verkauft wird. Bei bereits verkaufter Wohnung steht „Immobilien 0 €“.', 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: Mindestbetrag, Höchstanteil und Immobilienregel vergleichen. Danach Monte Carlo neu rechnen.', 'Bei Martin die Steuer auf das Wohnrecht von sofort auf jährlich (§ 23 ErbStG) umstellen. Vergleiche die Vorschau und rechne mit demselben Seed neu. Im Todesjahr fällt weniger Steuer an; ab dem Folgejahr steht Steuer Wohnrecht (§ 23) im Protokoll. Prüfe auch 1.500 € ortsübliche Miete pro Monat am Haus. Die Muster-Variante startet weiter mit sofort.'],
        observe: 'Wohnrecht schafft verfügbares Geld nur durch den Geldanteil. Das Haus kann weder im Notfall noch für Heimpflege verkauft werden; dauerhafte Heimpflege beendet das Wohnrecht und weitere Jahreszahlungen ohne Auszahlung.'
    },
    klein: { note: 'Diese Variante darf schlecht ausgehen: Hier siehst du, wann ein Plan kippt.' },
    kurssturz: {
        question: 'Was zeigt die App, wenn der Markt im Jahr erst stark steigt und dann wieder fällt?',
        exercises: ['Spielbereichsband → „Datum wählen …“: 02.01.2027 und den Jahresabschluss 2026 öffnen. Im Reiter Marktdaten zeigt die App, dass der Markt im Jahr schon viel heißer war, und lässt dich zwischen Jahresendregel und Jahreshoch wählen. Vergleiche danach Monatsbudget und Handlungsanweisung.',
            'Vorher Balance → Budgetprüfung: Ab Juli 2026 wächst der Abstand zum Jahreshoch vom 15.06.; unter 10 % bleibt es beim Hinweis.'],
        observe: 'Übung 1: Jahresabschluss → Reiter Marktdaten und Plan 2027. Übung 2: Balance → Budgetprüfung → Jahresverlauf.',
        note: 'Die Aktienkurse dieser Variante steigen 2026 bis zum 15.06. auf das Doppelte des Vorjahresendes und fallen bis Ende 2026 auf das 1,25-Fache. Geldmarkt, Anleihen und Gold verlaufen wie im Grundfall.'
    },
    halten: { question: 'Was kostet es, den Lebensstandard fast nie zu senken?' },
    'haus-pg3': {
        question: 'Was finanziert die Pflege heute, und wann hilft das Haus?',
        exercises: ['Personen & Vermögen → Werner → Person & Steuern: Pflegeform heute auf „zu Hause mit externer Unterstützung“ stellen. Vergleiche Balance: Pflegegeld fällt weg. Mit Werners ursprünglicher Angehörigenpflege zeigt ein Szenario mit Helgas Tod oder Grad 3 den automatischen Wechsel zu externer Unterstützung im selben Jahr.', 'Personen & Vermögen → Helga und danach Werner → Person & Steuern: jeweils Pflegegrad heute 4 und Pflegeform „im Heim“ wählen. Danach Simulator neu rechnen und im Szenario-Protokoll das Verkaufsjahr suchen.'],
        observe: 'Übung 1: Balance → Dein Monatsbudget → Einkünfte. Übung 2: Simulator → Szenario-Protokoll, Spalte „Immobilienverkauf“.',
        note: 'Der Gesamtbedarf ist dein gewünschter Bedarf. Das finanzierte Monatsbudget liegt darunter, weil Balance den Wunsch-Flex nach den Entnahmeregeln kürzt. Den Grund zeigt Balance → Dein Monatsbudget → „Warum?“. Der Verkauf folgt einer Modellregel der App, keiner Pflicht zum Hausverkauf.'
    }
};
/**
 * @param householdId Wert für den bestehenden Aufrufvertrag.
 * @param {string} variantId Wert für den bestehenden Aufrufvertrag.
 * @param pensionStart Wert für den bestehenden Aufrufvertrag.
 * @param firstPensionStart Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function musterLesson(householdId, variantId = 'grund', pensionStart = null, firstPensionStart = null) {
    musterVariante(householdId, variantId);
    const lesson = { ...lessons[householdId], ...variantLessons[variantId] };
    const exercises = typeof lesson.exercises === 'function' ? lesson.exercises(pensionStart, firstPensionStart) : lesson.exercises;
    return { ...lesson, exercises: householdId === 'max-erika' ? [...exercises,
        'Floor über Plan erkennen: Öffne Ausgaben → Haushalt und lies die Karte „Floor und Flex“. Der Grundbedarf liegt im Jahresmittel leicht über Plan, der Flex darunter. Wähle im Spielbereich das Testdatum 02.01.2027. Öffne auf der Übersicht den Jahresabschluss → „Bedarf und Plan“. Wähle beim Grundbedarf „Ist 2026 + Inflation“. Schließe das Jahr ab und sieh dir das neue Monatsbudget an.'] : exercises };
}

/** Alle Bestands-, Bedarfs- und Einkunftszahlen stammen aus den geladenen Records.
 *
 * @param records Serialisierte Speicherrecords.
 * @param householdId Wert für den bestehenden Aufrufvertrag.
 * @param testDate Wert für den bestehenden Aufrufvertrag.
 * @param {string} variantId Wert für den bestehenden Aufrufvertrag.
 * @param baseRecords Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function musterSteckbrief(records, householdId, testDate, variantId = 'grund', baseRecords = null) {
    const household = musterHaushalt(householdId), variant = musterVariante(householdId, variantId), year = Number(testDate.slice(0, 4));
    const profiles = Object.values(JSON.parse(records.rs_profiles_v1).profiles);
    const date = parseCalendarDate(testDate);
    const people = profiles.map(({ meta, data }) => ({ name: meta.name, data, ...projectPerson(data, year), displayAge: personDisplayAge(data, date).age }));
    const plan = Object.values(assertHouseholdPlanRecord(records.household_plan_v1).entries)[0].values;
    const properties = people.flatMap(p => readImmobilien(p.data[IMMOBILIEN_KEY]));
    const propertyValue = properties.reduce((sum, p) => sum + p.wert, 0);
    const assets = { cash: 0, depot: 0, bonds: 0, gold: 0 };
    for (const { data } of people) {
        assets.cash += Number(data.profile_tagesgeld);
        for (const lot of JSON.parse(data.depot_tranchen)) {
            assets[lot.category === 'gold' ? 'gold' : lot.category === 'bonds' ? 'bonds' : 'depot'] += lot.shares * lot.currentPrice;
        }
    }
    const wealth = Object.values(assets).reduce((sum, value) => sum + value, 0);
    const totalNeed = plan.floorBedarf + plan.flexBedarf;
    const pension = people.reduce((sum, p) => sum + p.renteImJahr, 0);
    const salary = people.reduce((sum, p) => sum + fixedMonthlyIncome(incomeFromRecord(p.data), testDate.slice(0, 7)), 0);
    const partTime = householdId === 'sophie' && variantId === 'teilzeit' ? incomeFromRecord(people[0].data).find(e => e.id === 'muster-teilzeit') : null;
    const displaySalary = partTime?.betragMonat ?? salary;
    const displaySurplus = displaySalary * 12 + pension - totalNeed;
    const base = baseRecords ? musterSteckbrief(baseRecords, householdId, testDate) : null;
    const careIncluded = variantId === 'haus-pg3' && base ? plan.floorBedarf - base.numbers.floor : 0;
    const gap = totalNeed - pension, surplus = salary * 12 + pension - totalNeed;
    const rentText = people.map(p => euro(Number(p.data.profile_rente_monatlich))).join(' + ');
    const ages = people.map(p => p.displayAge).join(' und ');
    const [first, second] = people;
    let situation;
    if (householdId === 'max-erika') situation = `Paar. ${first.name} (${first.displayAge}) bekommt seit ${first.data.profile_rentenbeginn.slice(0, 4)} Rente, ${second.name} (${second.displayAge}) erst ab ${month(second.data.profile_rentenbeginn)}.`;
    if (householdId === 'renate') situation = `Allein, ${ages}, Rente ${rentText} netto im Monat. Das Vermögen schließt die Lücke zum Bedarf.`;
    if (householdId === 'jan-lena') situation = `Paar, ${ages}, ohne Erwerbseinkommen. Renten erst ab ${people.map(p => p.data.profile_rentenbeginn.slice(0, 4)).join(' und ')}, bis dahin lebt der Haushalt vom Vermögen.`;
    if (householdId === 'helga-werner') situation = `Paar, ${ages}, beide seit Jahren in Rente. Vorsichtige Anlage mit Pflegereserve.`;
    if (householdId === 'sophie') situation = `Allein, ${ages}, berufstätig bis Ende ${incomeFromRecord(first.data).filter(e => e.art).at(-1)?.bis.slice(0, 4)}. Danach Rente ${rentText} netto im Monat.`;
    if (householdId === 'helga-werner' && variantId === 'haus-pg3') situation = `Paar, ${ages}. ${second.name} wird heute schon gepflegt, das Haus ist schuldenfrei.`;
    if (householdId === 'martin-petra') situation = `${readPartnership(records.household_partnership_v1).status === 'married' ? 'Verheiratet' : 'Unverheiratet'}. ${first.name} (${first.displayAge}) ist in Rente und besitzt das Haus, ${second.name} (${second.displayAge}) arbeitet noch und besitzt eine vermietete Wohnung.`;
    const reserve = people.reduce((sum, p) => {
        const bucket = p.data.profile_health_bucket && JSON.parse(p.data.profile_health_bucket);
        return sum + (bucket?.enabled ? bucket.initialAmount : 0);
    }, 0);
    const metrics = [{ label: 'Gesamtvermögen', value: euro(wealth + propertyValue), ...(propertyValue ? { sub: `davon Geldvermögen ${euro(wealth)} · Immobilien ${euro(propertyValue)}` } : {}) },
        { label: people.length === 1 ? 'Rente netto' : householdId === 'jan-lena' ? 'Renten später' : 'Renten netto', value: rentText, sub: 'im Monat' },
        { label: 'Bedarf im Jahr', value: euro(totalNeed) }];
    if (householdId === 'renate') metrics[2] = { label: 'Lücke im Jahr', value: euro(gap) };
    if (householdId === 'helga-werner') metrics[2] = { label: 'Pflegereserve', value: euro(reserve), sub: 'zusammen' };
    if (householdId === 'sophie') {
        metrics[1] = { label: partTime ? `Gehalt ab ${partTime.ab.slice(0, 4)}` : 'Gehalt netto', value: euro(displaySalary), sub: 'im Monat' };
        metrics[2] = { label: partTime ? `Überschuss ab ${partTime.ab.slice(0, 4)}` : 'Überschuss im Jahr', value: euro(displaySurplus) };
    }
    if (householdId === 'martin-petra') metrics[1] = { label: 'Immobilien', value: euro(propertyValue) };
    if (variantId === 'haus-pg3') {
        metrics[1] = { label: 'Haus', value: euro(propertyValue) };
        metrics[2] = { label: 'Heutige Pflegekosten', value: `${euro(careIncluded)} / Jahr`, sub: 'im Grundbedarf enthalten' };
    }
    const details = [Object.entries(assets).filter(([, v]) => v > 0).map(([key, value]) =>
        `${{ cash: 'Tagesgeld', depot: 'Depot', bonds: 'Anleihen', gold: 'Gold' }[key]} ${euro(value)}`).join(', '),
    `Grundbedarf ${euro(plan.floorBedarf)}${careIncluded ? ' einschließlich heutiger Pflegekosten' : ''} · Wunschbedarf ${euro(plan.flexBedarf)} · Gesamtbedarf ${euro(totalNeed)}`,
    `Mindest-Flex ${euro(plan.minimumFlexAnnual)}`];
    if (householdId === 'renate') details.push(`${euro(totalNeed)} Bedarf − 12 × ${rentText} Rente = ${euro(gap)} aus dem Vermögen, vor Erträgen und Steuern`);
    if (householdId === 'sophie') {
        details.push(`12 × ${euro(displaySalary)} − ${euro(totalNeed)} = ${euro(displaySurplus)} zum Anlegen${partTime ? ' ab ' + partTime.ab.slice(0, 4) : ''}, vor der Autoausgabe`);
        const expense = Object.values(JSON.parse(records[PLANNED_EXPENSES_KEY]).entries)[0].items[0];
        details.push(`${expense.bezeichnung} ${euro(expense.betrag)} im ${month(expense.monat)}`);
    }
    if (householdId === 'jan-lena') details.push(people.flatMap(p => incomeFromRecord(p.data).filter(e => !e.art))
        .map(e => `${e.bezeichnung} ${euro(e.betrag)} (${e.monat.slice(0, 4)})`).join(', '));
    if (householdId === 'max-erika') {
        const partnership = readPartnership(records.household_partnership_v1);
        details.push(`Es gilt: ${partnership.status === 'married' ? 'verheiratet' : 'nicht verheiratet'}, Erbanteile ${profiles.map(p => inheritancePercent(partnership, p.meta.id) + ' %').join(' / ')}; siehe Haushalt & Plan`);
    }
    if (householdId === 'martin-petra') for (const person of people) {
        const lots = JSON.parse(person.data.depot_tranchen), properties = readImmobilien(person.data[IMMOBILIEN_KEY]);
        const salary = incomeFromRecord(person.data).find(e => e.art), property = properties[0];
        details.push(`${person.name}: Tagesgeld ${euro(Number(person.data.profile_tagesgeld))}, ETF ${euro(lots.reduce((sum, l) => sum + l.shares * l.currentPrice, 0))}, ${property.bezeichnung} ${euro(property.wert)}${property.mieteNetto ? ` mit ${euro(property.mieteNetto)} Miete netto im Monat` : ''}, ${salary ? `Gehalt ${euro(salary.betragMonat)} bis ${month(salary.bis)}, dann ` : ''}Rente ${euro(Number(person.data.profile_rente_monatlich))}${salary ? ' ab ' + month(person.data.profile_rentenbeginn) : ''}`);
    }
    let changes = '';
    if (base) {
        if (variantId === 'immobilien') changes = `Zusätzlich Haus 450.000 € bei Max und vermietete Wohnung 210.000 € bei Erika, mit 650 € Nettomiete im Monat. Gesamtvermögen ${euro(wealth + propertyValue)}, davon Geldvermögen ${euro(wealth)}.`;
        if (variantId === 'klein') changes = `Geldvermögen ${euro(wealth)} statt ${euro(base.numbers.wealth)}: Tagesgeld ${euro(assets.cash)}, Depot ${euro(assets.depot)}, keine Anleihen. Strategie Standard.`;
        if (variantId === 'kurssturz') changes = 'Planwerte wie im Grundfall. Die Spielkurse der Aktien steigen 2026 bis zum 15.06. auf das Doppelte des Vorjahresendes und fallen bis Ende 2026 auf das 1,25-Fache; Geldmarkt, Anleihen und Gold wie im Grundfall.';
        if (variantId === 'halten') changes = `Mindest-Flex ${euro(plan.minimumFlexAnnual)} statt ${euro(base.numbers.minimumFlexAnnual)}: Der Flex darf in schlechten Jahren kaum sinken.`;
        if (variantId === 'haus-pg3') changes = `Selbst genutztes Haus ${euro(propertyValue)}, je zur Hälfte. ${second.name} hat heute Pflegegrad ${second.data.profile_care_grade_today} und wird zu Hause durch Angehörige gepflegt. Grundbedarf ${euro(plan.floorBedarf)} statt ${euro(base.numbers.floor)}: Die heutigen Pflegekosten von ${euro(careIncluded)} stecken darin und werden nicht doppelt gezählt.`;
        if (partTime) changes = `Gehalt ${euro(partTime.betragMonat)} statt ${euro(incomeFromRecord(first.data)[0].betragMonat)} in den letzten ${Number(partTime.bis.slice(0, 4)) - Number(partTime.ab.slice(0, 4)) + 1} Jahren (${partTime.ab.slice(0, 4)}–${partTime.bis.slice(0, 4)}).`;
        if (variantId === 'hundert') changes = `Wer stirbt, vererbt dem Partner alles: Immobilien und Geld (${inheritancePercent(readPartnership(records.household_partnership_v1), profiles[0].meta.id)} %).`;
        if (variantId === 'ehe') changes = `Verheiratet, gegenseitig ${inheritancePercent(readPartnership(records.household_partnership_v1), profiles[0].meta.id)} %: Steuerklasse I mit ${euro(wealth - inheritancePreview(wealth, 0, 100, { status: 'married' }).taxable)} Freibetrag, Witwenrente nach Modellannahme.`;
    }
    if (variantId === 'testament') changes = 'Martin vererbt Petra ein Drittel seines Geldvermögens, mindestens 200.000 € in Kaufkraft 10/2026, höchstens 50 %. Für sein Haus gilt Wohnrecht auf Lebenszeit. Petra vererbt weiterhin 0 %; ihre Wohnung bleibt eigenes Vermögen.';
    const lesson = musterLesson(householdId, variantId, second?.data.profile_rentenbeginn, first?.data.profile_rentenbeginn);
    const note = partTime ? `Weniger Arbeit senkt meist auch die Rente. Sie bleibt hier ${rentText}: Passe sie selbst an.` : lesson.note;
    return { ...household, ...lesson, note, variant, changes, situation, metrics, details, restart: MUSTER_RESTART, discard: MUSTER_DISCARD,
        numbers: { ...assets, wealth, propertyValue, careIncluded, displaySalary, displaySurplus, floor: plan.floorBedarf, flex: plan.flexBedarf, totalNeed, minimumFlexAnnual: plan.minimumFlexAnnual, pension, salary, gap, surplus, reserve } };
}

const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** Gemeinsamer Inhalt für Startdialog und generierten Handbuchabschnitt.
 *
 * @param brief Wert für den bestehenden Aufrufvertrag.
 * @returns {string} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function musterSteckbriefHtml(brief) {
    return `<header><h3>${escape(brief.name)}</h3><p class="muster-subtitle">${escape(brief.title)}</p></header>
${brief.variant.id !== 'grund' ? `<p class="muster-details">Variante: ${escape(brief.variant.name)}</p>` : ''}
${brief.changes ? `<div class="household-plan-group muster-changes"><strong>Anders als im Grundfall: </strong>${escape(brief.changes)}</div>` : ''}
<p>${escape(brief.situation)}</p>
<div class="muster-metrics">${brief.metrics.map(m => `<div class="household-plan-group"><span>${escape(m.label)}</span><strong>${escape(m.value)}</strong>${m.sub ? `<small>${escape(m.sub)}</small>` : ''}</div>`).join('')}</div>
<p class="muster-details">${brief.details.map(escape).join(' · ')}</p>
<div class="household-plan-group muster-lesson"><div><span class="muster-caption">Die Frage</span><p class="muster-question">${escape(brief.question)}</p></div><div><span class="muster-caption">Erste Übungen</span><ol>${brief.exercises.map(e => `<li>${escape(e)}</li>`).join('')}</ol></div><p><span class="muster-caption">Beobachte: </span>${escape(brief.observe)}</p></div>
${brief.note ? `<p class="muster-details">${escape(brief.note)}</p>` : ''}
<p class="muster-details">${escape(brief.discard)}<br>${escape(brief.restart)}</p>`;
}
