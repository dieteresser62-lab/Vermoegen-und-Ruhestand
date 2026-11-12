import { musterHaushalt, musterVariante } from './muster-haushalte.js';
import { assertHouseholdPlanRecord } from '../profile/household-plan.js';
import { projectPerson, personDisplayAge } from '../profile/profile-person-data.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { incomeFromRecord, fixedMonthlyIncome } from '../profile/profile-income.js';
import { readPartnership, inheritancePercent, inheritancePreview } from '../profile/household-partnership.js';
import { readImmobilien, IMMOBILIEN_KEY } from '../profile/profile-immobilien.js';
import { PLANNED_EXPENSES_KEY, isFixedExpense, plannedExpensesForYear } from '../profile/household-planned-expenses.js';
import { readBalancePersonStatus } from '../shared/person-data-status.js';
import { projectBalanceCareNeeds } from '../balance/balance-care.js';

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
            return [`Personen & Vermögen → Erika → Einkünfte: Rente, Feld „ab“, von ${pensionStart ? month(pensionStart) : 'ihrem Rentenbeginn'} auf ${shiftMonth(pensionStart, 1)} verschieben. Vergleiche im Simulator → Annahmen → „Einkünfte, Ausgaben und Bedarf“ ${years}, Spalte „Ergebnis“ (aus Vermögen). Ohne Erikas Rente steigt die Entnahme in diesen Jahren.`, 'Personen & Vermögen → Haushalt & Plan → Bedarf pro Jahr: Wunschbedarf um 300 € im Monat erhöhen. Vergleiche Balance → Dein Monatsbudget, Zeile „aus dem Vermögen“. Übersicht: In der Variante „Haus und vermietete Wohnung“ stehen Gesamtvermögen und „davon Geldvermögen“ auf der Vermögenskarte; öffne das ⓘ für die Aufteilung.', 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: Güterstand zwischen „Zugewinngemeinschaft (gesetzlich)“ und „Gütertrennung“ umstellen. Rechne im Simulator mit demselben Seed neu und vergleiche die Erbschaftsteuer in einem Todesjahr mit realem Vermögenszuwachs.',
                'Balance → Deine Reserven: Das Ziel steht im Grundfall gerundet bei 165.000 € (gerechnet 162.000 €); Ziele und Verkäufe rundet die App auf, Verfügbares ab. Was zu tun ist → „Details & Drucken“ zeigt den Plan genau mit Cent.'];
        },
        observe: 'Übung 1: Simulator → Annahmen → „Einkünfte, Ausgaben und Bedarf“, Spalte „Ergebnis“. Übung 2: Balance → Dein Monatsbudget, Zeile „aus dem Vermögen“. Übung 4: Balance → Deine Reserven und „Details & Drucken“.'
    },
    renate: {
        question: 'Welche Ausgaben kann ich mir dauerhaft leisten, und wo wird mein Plan empfindlich?',
        exercises: ['Personen & Vermögen → Haushalt & Plan → Bedarf pro Jahr: Wunschbedarf in Schritten von 100 € im Monat ändern.', variantExercise('renate', ['grund', 'klein']),
            'Personen & Vermögen → Renate → Einkünfte: Rentenanpassung der Rente von „wie Inflation“ auf „wie Löhne“ stellen und die Deckung vergleichen.',
            'Simulator → Annahmen → Alle Parameter: „Nur hier ausprobieren“, dann unter Fondskosten „Laufende Kosten Aktien-ETF“ auf 0 % setzen und vergleichen. Dauerhaft änderst du den Wert in Personen & Vermögen → Haushalt & Plan → Weitere Planwerte.'],
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
        exercises: [`Personen & Vermögen → Werner → Person & Steuern: Pflegegrad heute 3 eintragen. Der Grundbedarf bleibt bei ${euro(musterVariante('helga-werner', 'haus-pg3').floorBedarf)} im Jahr: Die App rechnet die Pflege selbst und zeigt den Hinweis dazu. Balance → Dein Bedarf zeigt die Zeile „Pflege Werner“ mit 1.500 €/Monat.`, 'Personen & Vermögen → Werner → Person & Steuern: Pflegeform heute auf „zu Hause durch Angehörige“ stellen. Vergleiche Balance → Dein Monatsbudget → Einkünfte: Pflegegeld 599 €/Monat kommt dazu. Öffne danach ein Szenario, in dem Helga stirbt oder selbst Grad 3 erreicht: Werners Angehörigenpflege wechselt im selben Jahr zu externer Unterstützung; das Protokoll-ⓘ erklärt den Grund.', 'Personen & Vermögen → Werner → Person & Steuern: Pflegegrad heute 4, Pflegeform heute „im Heim“, im Heim seit 01/2023. Balance → Dein Bedarf zeigt die Zeile „Heim Werner“ mit 2.611 €/Monat (Heimjahr 4) und den Grundbedarf zu Hause mit 2.250 €/Monat für Helga; im Simulator-Protokoll steht Werner im Heimjahr 4.', 'Beide Grad 4 im Heim: Personen & Vermögen → Helga und danach Werner → Person & Steuern: jeweils Pflegegrad heute 4 und Pflegeform „im Heim“, „Im Heim seit“ leer. Balance → Dein Bedarf zeigt zwei Zeilen „Heim …“ mit je 3.864 €/Monat und keinen Grundbedarf zu Hause: zusammen 92.736 € im Jahr. Rechne Monte Carlo und öffne ein Szenario: Das ⓘ bei „Ausgaben“ zeigt ab dem ersten Jahr keinen Grundbedarf zu Hause; die Heimkosten je Person sinken von Heimjahr 1 bis 4 mit dem Zuschuss der Kasse, die eigenen Ausgaben im Heim kommen dazu.'],
        observe: 'Übung 1: Balance → Dein Bedarf und Simulator → Szenario-Protokoll, Pflege. Übung 2: Balance → Dein Monatsbudget → Einkünfte. Übung 3: Balance → Dein Bedarf, ⓘ der Heimzeile. Übung 4: Szenario-Protokoll, ⓘ bei „Ausgaben“.'
    },
    'martin-petra': {
        question: 'Ist der überlebende Partner abgesichert, und steht dafür genug verfügbares Geld bereit?',
        exercises: [variantExercise('martin-petra', ['grund', 'hundert', 'ehe', 'testament']), 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: Erbanteile ändern. Danach Simulator → Monte Carlo rechnen → Szenarien: ein Protokoll mit Todesfall öffnen.', 'Öffne in der Todesjahrzeile das Erbe-ⓘ: Vergleiche Erbschaftsteuer, Kapitalertragsteuer und Herkunft aus Verkauf oder Liquidität mit der Liquidität am Jahresende.'],
        observe: 'Personen & Vermögen → Haushalt & Plan → Partnerschaft und Todesfall: „bleibt im Haushalt / verlässt den Haushalt / Erbschaftsteuer“. Nach jeder Variante Monte Carlo neu rechnen → „Grundbedarf gedeckt“.',
        note: 'Die Erbregeln zeigen Modellwirkungen, keine Empfehlung für eine rechtliche Gestaltung.'
    },
    sophie: {
        question: 'Kann ich mir Teilzeit vor der Rente leisten?',
        exercises: ['Personen & Vermögen → Sophie → Einkünfte: Gehalt ändern. Vergleiche Balance → Dein Monatsbudget, Zeile „angelegt“.', variantExercise('sophie', ['grund', 'teilzeit']),
            'Personen & Vermögen → Haushalt & Plan → Geplante Ausgaben: Ratenkredit ändern oder löschen. Vergleiche Simulator → Planübersicht, Spalte „Bedarf (Grund + Flex)“, und Balance → Dein Monatsbudget.'],
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
        exercises: ['Spielbereichsband → „Datum wählen …“: 02.01.2027 und den Jahresabschluss 2026 öffnen. Im Reiter „Plan 2027“ steht „Bärenmarkt, den die Jahresregel nicht sieht“: Nach Kursen zum Jahresende wäre es kein Bärenmarkt, gemessen am Jahreshoch vom 15.06. schon. Wähle, welcher Plan gilt, und vergleiche danach Monatsbudget und „Was zu tun ist“.',
            'Vorher Balance → Was zu tun ist: Denselben Block zeigt die Karte nur, solange der Kurs gemessen am Jahreshoch einen Bärenmarkt ergibt. Ein kleiner Abstand zum Hoch bleibt unsichtbar.'],
        observe: 'Übung 1: Jahresabschluss → Reiter Plan 2027. Übung 2: Balance → Was zu tun ist → Kursverlauf.',
        note: 'Die Aktienkurse dieser Variante steigen 2026 bis zum 15.06. auf das Doppelte des Vorjahresendes und fallen bis Ende 2026 auf das 1,25-Fache. Geldmarkt, Anleihen und Gold verlaufen wie im Grundfall.'
    },
    teilweise: {
        question: 'Wie zeigt die App, was vom Jahresplan schon umgesetzt ist?',
        exercises: ['Balance → Überblick → „Was zu tun ist“: Max hat seine Planzeile verkauft, Erika erst einen Teil. Lies „… von … verkauft“, den Stand je Zeile und den Hinweis „Gutschrift nachtragen“.',
            'Hinweis „Gutschrift nachtragen“ → „Tagesgeld nachtragen“: In Personen & Vermögen die offene Cashbuchung von Erika bestätigen. Zurück in der Balance ist der Hinweis weg, und „Deine Reserven“ zeigt den Erlös im Tagesgeld.',
            'Balance → „Verkauf eintragen“: Der Verkaufsdialog öffnet sich für Erikas Aktien-ETF. Trag den offenen Rest ein; die Karte zeigt danach „Erledigt“.'],
        observe: 'Balance → Was zu tun ist und Deine Reserven.',
        note: 'Die Verkäufe dieser Variante sind Beispieldaten. Die App bucht nichts selbst; sie liest nur die eingetragenen Verkäufe.'
    },
    halten: { question: 'Was kostet es, den Lebensstandard fast nie zu senken?' },
    'haus-pg3': {
        question: 'Was finanziert die Pflege heute, und wann hilft das Haus?',
        exercises: ['Personen & Vermögen → Werner → Person & Steuern: Pflegeform heute auf „zu Hause mit externer Unterstützung“ stellen. Vergleiche Balance: Pflegegeld fällt weg, die Zeile „Pflege Werner“ mit 1.500 €/Monat bleibt. Mit Werners ursprünglicher Angehörigenpflege zeigt ein Szenario mit Helgas Tod oder Grad 3 den automatischen Wechsel zu externer Unterstützung im selben Jahr.', 'Personen & Vermögen → Helga und danach Werner → Person & Steuern: jeweils Pflegegrad heute 4 und Pflegeform „im Heim“ wählen. Die App rechnet Heimkosten und eigene Ausgaben selbst, der Grundbedarf zu Hause entfällt. Danach Simulator neu rechnen: Weil alle im Heim leben, verkauft das Modell das Haus schon im ersten Jahr; das Szenario-Protokoll zeigt den Erlös von 405.000 €.'],
        observe: 'Übung 1: Balance → Dein Monatsbudget → Einkünfte und Dein Bedarf. Übung 2: Simulator → Szenario-Protokoll, Spalte „Immobilienverkauf“.',
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

/** Heutige Pflegekosten des Haushalts (€/Jahr, erstes Jahr ohne Flex) aus derselben Bedarfsfunktion wie Balance und
 * Simulator; 0 ohne Pflegegrad heute. Die Records werden nur gelesen. */
function careTodayAnnual(records, values, year, now) {
    const storage = { getItem: key => records[key] ?? null };
    const status = readBalancePersonStatus({ storage, win: null, referenceYear: year });
    if (!status.ready || status.status === 'demo') return 0;
    const needs = projectBalanceCareNeeds({ status, storage, values, referenceYear: year, now });
    return needs ? needs.current.homeCareAddition + needs.current.residentialCosts + needs.current.residentialOwnExpenses : 0;
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
    const plannedItems = records[PLANNED_EXPENSES_KEY] ? Object.values(JSON.parse(records[PLANNED_EXPENSES_KEY]).entries)[0]?.items || [] : [];
    // FR-43: Feste geplante Ausgaben zählen zum Grundbedarf ihres Jahres.
    const fixedExpense = plannedExpensesForYear(plannedItems.filter(isFixedExpense), partTime ? Number(partTime.ab.slice(0, 4)) : year);
    const displaySurplus = displaySalary * 12 + pension - totalNeed - fixedExpense;
    const base = baseRecords ? musterSteckbrief(baseRecords, householdId, testDate) : null;
    const careToday = careTodayAnnual(records, plan, year, date);
    const gap = totalNeed - pension, surplus = salary * 12 + pension - totalNeed - plannedExpensesForYear(plannedItems.filter(isFixedExpense), year);
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
        metrics[2] = { label: 'Heutige Pflegekosten', value: `${euro(careToday)} / Jahr`, sub: 'rechnet die App selbst dazu' };
    }
    const details = [Object.entries(assets).filter(([, v]) => v > 0).map(([key, value]) =>
        `${{ cash: 'Tagesgeld', depot: 'Depot', bonds: 'Anleihen', gold: 'Gold' }[key]} ${euro(value)}`).join(', '),
    `Grundbedarf ${euro(plan.floorBedarf)}${careToday ? ' ohne Pflege' : ''} · Wunschbedarf ${euro(plan.flexBedarf)} · Gesamtbedarf ${euro(totalNeed)}`,
    `Mindest-Flex ${euro(plan.minimumFlexAnnual)}`];
    if (householdId === 'renate') details.push(`${euro(totalNeed)} Bedarf − 12 × ${rentText} Rente = ${euro(gap)} aus dem Vermögen, vor Erträgen und Steuern`);
    if (householdId === 'sophie') {
        details.push(`12 × ${euro(displaySalary)} − ${euro(totalNeed)}${fixedExpense ? ` − ${euro(fixedExpense)} feste Ausgaben` : ''} = ${euro(displaySurplus)} zum Anlegen${partTime ? ' ab ' + partTime.ab.slice(0, 4) : ''}, vor der Autoausgabe`);
        for (const expense of plannedItems) details.push(isFixedExpense(expense)
            ? `${expense.bezeichnung} ${euro(expense.betragMonat)} im Monat${expense.bis ? ` bis ${month(expense.bis)}` : ''}, zählt zum Grundbedarf`
            : `${expense.bezeichnung} ${euro(expense.betrag)} im ${month(expense.monat)}`);
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
        if (variantId === 'teilweise') changes = 'Planwerte und Jahresplan wie im Grundfall. Max hat seine Planzeile am 12.03. verkauft und gutgeschrieben; Erika hat am 02.09. ein gutes Drittel ihrer Zeile verkauft, die Gutschrift aufs Tagesgeld ist noch offen.';
        if (variantId === 'halten') changes = `Mindest-Flex ${euro(plan.minimumFlexAnnual)} statt ${euro(base.numbers.minimumFlexAnnual)}: Der Flex darf in schlechten Jahren kaum sinken.`;
        if (variantId === 'haus-pg3') changes = `Selbst genutztes Haus ${euro(propertyValue)}, je zur Hälfte. ${second.name} hat heute Pflegegrad ${second.data.profile_care_grade_today} und wird zu Hause durch Angehörige gepflegt. Der Grundbedarf bleibt ${euro(plan.floorBedarf)} ohne Pflege: Die App rechnet ${euro(careToday)} heutige Pflegekosten im Jahr selbst dazu und zeigt sie in Balance als Zeile „Pflege ${second.name}“.`;
        if (partTime) changes = `Gehalt ${euro(partTime.betragMonat)} statt ${euro(incomeFromRecord(first.data)[0].betragMonat)} in den letzten ${Number(partTime.bis.slice(0, 4)) - Number(partTime.ab.slice(0, 4)) + 1} Jahren (${partTime.ab.slice(0, 4)}–${partTime.bis.slice(0, 4)}).`;
        if (variantId === 'hundert') changes = `Wer stirbt, vererbt dem Partner alles: Immobilien und Geld (${inheritancePercent(readPartnership(records.household_partnership_v1), profiles[0].meta.id)} %).`;
        if (variantId === 'ehe') changes = `Verheiratet, gegenseitig ${inheritancePercent(readPartnership(records.household_partnership_v1), profiles[0].meta.id)} %: Steuerklasse I mit ${euro(wealth - inheritancePreview(wealth, 0, 100, { status: 'married' }).taxable)} Freibetrag, Witwenrente nach Modellannahme.`;
    }
    if (variantId === 'testament') changes = 'Martin vererbt Petra ein Drittel seines Geldvermögens, mindestens 200.000 € in Kaufkraft 10/2026, höchstens 50 %. Für sein Haus gilt Wohnrecht auf Lebenszeit. Petra vererbt weiterhin 0 %; ihre Wohnung bleibt eigenes Vermögen.';
    const lesson = musterLesson(householdId, variantId, second?.data.profile_rentenbeginn, first?.data.profile_rentenbeginn);
    const note = partTime ? `Weniger Arbeit senkt meist auch die Rente. Sie bleibt hier ${rentText}: Passe sie selbst an.` : lesson.note;
    return { ...household, ...lesson, note, variant, changes, situation, metrics, details, restart: MUSTER_RESTART, discard: MUSTER_DISCARD,
        numbers: { ...assets, wealth, propertyValue, careToday, displaySalary, displaySurplus, floor: plan.floorBedarf, flex: plan.flexBedarf, totalNeed, minimumFlexAnnual: plan.minimumFlexAnnual, pension, salary, gap, surplus, reserve } };
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
