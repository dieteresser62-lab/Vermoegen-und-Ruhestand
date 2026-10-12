import { appNow } from '../shared/app-clock.js';
// Reine Kalender- und Personenprojektion; keine lokalen Date-Parser und keine Writes.
export const PERSON_VALUE_KEYS = Object.freeze({
    geburtsdatum: 'profile_geburtsdatum', geschlecht: 'profile_geschlecht',
    rentenbeginn: 'profile_rentenbeginn', rentenanpassungArt: 'profile_rentenanpassung_art',
    rentenanpassungPct: 'profile_rentenanpassung_pct', kirchensteuerPct: 'profile_kirchensteuer_pct',
    sparerPauschbetrag: 'profile_sparer_pauschbetrag', renteSteuerquotePct: 'profile_rente_steuerquote_pct',
    personSchemaVersion: 'profile_person_schema_version', personMigration: 'profile_person_migration_v1'
});

export function validateIsoDate(raw) {
    if (raw === null || raw === undefined || raw === '') return { status: 'missing', value: null };
    if (typeof raw !== 'string') return { status: 'invalid', value: null };
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return { status: 'invalid', value: null };
    const [year, month, day] = match.slice(1).map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return { status: 'invalid', value: null };
    return { status: 'valid', value: String(raw), year, month, day };
}

/** Kalenderanteil einschließlich Beginnmonat, unabhängig von Tag und Zeitzone. */
export function deriveAnnualPension(rentenbeginn, jahr, monatsbetrag) {
    const beginning = validateIsoDate(rentenbeginn);
    if (beginning.status === 'invalid' || !Number.isInteger(jahr) || jahr < 1 || jahr > 9999
        || typeof monatsbetrag !== 'number' || !Number.isFinite(monatsbetrag) || monatsbetrag < 0) {
        throw new Error('Ungültiger Rentenbeginn, Planungsjahr oder Monatsbetrag.');
    }
    const monateImJahr = beginning.status === 'missing' || beginning.year < jahr ? 12
        : beginning.year > jahr ? 0 : 13 - beginning.month;
    const renteImJahr = monatsbetrag * monateImJahr;
    if (!Number.isFinite(renteImJahr)) throw new Error('Ungültiger Jahresrentenbetrag.');
    return { monateImJahr, renteImJahr };
}

export function alterAmStichtag(geburtsdatum, jahr) {
    const date = validateIsoDate(geburtsdatum);
    if (date.status !== 'valid') return { status: date.status, age: null };
    if (!Number.isInteger(jahr) || jahr < 1 || jahr > 9999) return { status: 'invalid-year', age: null };
    const age = jahr - date.year - (date.month === 1 && date.day === 1 ? 0 : 1);
    return age < 0 ? { status: 'future', age: null } : { status: 'valid', age };
}

export function personReferenceYear(metadata, now = appNow()) {
    const period = metadata?.pendingCommit?.periodId || metadata?.lastCommittedPeriod;
    const match = /^calendar-year:(\d{4})$/.exec(period || '');
    const year = typeof now === 'number' ? now : now.getFullYear();
    return match ? Math.max(year, Number(match[1]) + 1) : year;
}

export function personAge(data, year) {
    const result = alterAmStichtag(data?.[PERSON_VALUE_KEYS.geburtsdatum], year);
    if (result.status !== 'missing') return result;
    const raw = data?.profile_aktuelles_alter;
    if (raw === null || raw === undefined || raw === '') return result;
    const age = typeof raw === 'boolean' ? NaN : Number(raw);
    return Number.isSafeInteger(age) && age >= 0
        ? { status: 'fallback', age, suggestedBirthYear: year - age - 1 }
        : { status: 'invalid', age: null };
}

/** Nur Anzeige: vollendete Jahre am lokalen App-Kalendertag, ohne Writes. */
export function personDisplayAge(data, now = appNow()) {
    const birth = validateIsoDate(data?.[PERSON_VALUE_KEYS.geburtsdatum]);
    if (birth.status === 'invalid') return { status: 'invalid', age: null };
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return { status: 'invalid-date', age: null };
    const year = now.getFullYear();
    if (birth.status === 'missing') {
        const fallback = personAge(data, year);
        return { status: fallback.status, age: fallback.age };
    }
    const month = now.getMonth() + 1, day = now.getDate();
    // In Nichtschaltjahren ist der Jahrestag des 29.02. der 01.03.
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const birthdayMonth = birth.month === 2 && birth.day === 29 && !leap ? 3 : birth.month;
    const birthdayDay = birth.month === 2 && birth.day === 29 && !leap ? 1 : birth.day;
    const age = year - birth.year - (month < birthdayMonth || month === birthdayMonth && day < birthdayDay ? 1 : 0);
    return age < 0 ? { status: 'future', age: null } : { status: 'valid', age };
}

export function validatePersonValues(values = {}) {
    const errors = [];
    const out = { ...values };
    for (const field of ['geburtsdatum', 'rentenbeginn']) {
        const result = validateIsoDate(values[field]);
        if (result.status === 'invalid') errors.push({ field, message: 'Bitte ein vollständiges gültiges Kalenderdatum eingeben.' });
        out[field] = result.value || '';
    }
    out.geschlecht = values.geschlecht ?? 'm';
    out.rentenanpassungArt = values.rentenanpassungArt ?? 'wage';
    if (!['m', 'w', 'd'].includes(out.geschlecht)) errors.push({ field: 'geschlecht', message: 'Ungültige Auswahl.' });
    if (!['wage', 'cpi', 'fix'].includes(out.rentenanpassungArt)) errors.push({ field: 'rentenanpassungArt', message: 'Ungültige Auswahl.' });
    for (const field of ['rentenanpassungPct', 'kirchensteuerPct', 'sparerPauschbetrag', 'renteSteuerquotePct']) {
        const raw = values[field] ?? 0;
        const value = typeof raw === 'boolean' ? NaN : Number(raw);
        const max = field === 'kirchensteuerPct' || field === 'renteSteuerquotePct' ? 100 : Infinity;
        if (raw === '' || !Number.isFinite(value) || value < (field === 'rentenanpassungPct' ? -100 : 0) || value > max) {
            errors.push({ field, message: 'Ungültiger Zahlenwert.' });
        }
        out[field] = value;
    }
    if (errors.length) {
        const error = new Error('Personendaten sind ungültig.');
        error.code = 'PROFILE_PERSON_INVALID'; error.errors = errors; throw error;
    }
    return out;
}

/** Datierter Altbeginn; Vorschläge sind keine bestätigten Kalenderdaten. */
function migrationPensionStart(migration) {
    if (!migration || typeof migration !== 'object' || Array.isArray(migration)) throw new Error('Ungültige Herkunft der Rentenangaben.');
    const offset = migration.renteStartOffsetJahre ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Ungültige Herkunft des Rentenbeginns.');
    if (offset === 0) return null;
    const year = migration.referenceYear;
    if (!Number.isInteger(year) || year < 1 || year + offset > 9999) throw new Error('Datierte Herkunft des Rentenbeginns fehlt oder ist ungültig.');
    return year + offset;
}

/** Altersunabhängige, lesende Rentenableitung mit demselben Altbeginnvertrag. */
export function projectPersonPension(data = {}, year) {
    let migration = {};
    if (data[PERSON_VALUE_KEYS.personMigration]) migration = JSON.parse(data[PERSON_VALUE_KEYS.personMigration]);
    const beginning = validateIsoDate(data[PERSON_VALUE_KEYS.rentenbeginn]);
    const legacyStart = beginning.status === 'missing' ? migrationPensionStart(migration) : null;
    const offset = Math.max(0, (beginning.status === 'valid' ? beginning.year : legacyStart ?? year) - year);
    const income = key => {
        const raw = data[key];
        const value = typeof raw === 'boolean' ? NaN : raw === null || raw === undefined || raw === '' ? 0 : Number(raw);
        if (!Number.isFinite(value) || value < 0) throw new Error('Ungültiges Profileinkommen.');
        return value;
    };
    const monthlyPension = income('profile_rente_monatlich');
    const annual = deriveAnnualPension(data[PERSON_VALUE_KEYS.rentenbeginn], year, monthlyPension);
    const startMonths = deriveAnnualPension(data[PERSON_VALUE_KEYS.rentenbeginn],
        beginning.status === 'valid' ? Math.max(year, beginning.year) : year, monthlyPension).monateImJahr;
    // Vor dem datierten Altbeginn keine Budgetrente; ab Beginn zwölf Monate.
    if (beginning.status === 'missing' && offset > 0) {
        annual.monateImJahr = 0;
        annual.renteImJahr = 0;
    }
    return { beginning, legacyStart, renteMonatlich: monthlyPension,
        sonstigeEinkuenfte: income('profile_sonstige_einkuenfte'), ...annual,
        renteStartMonate: startMonths,
        renteKalenderbeginn: beginning.status === 'valid' && (beginning.year > year || (beginning.year === year && beginning.month > 1)),
        renteStartOffsetJahre: offset };
}

export function projectPerson(data = {}, year) {
    if (String(data[PERSON_VALUE_KEYS.personSchemaVersion]) !== '1') throw new Error('Personendaten müssen zuerst sicher umgestellt werden.');
    const age = personAge(data, year);
    if (!['valid', 'fallback'].includes(age.status)) throw new Error('Geburtsdatum fehlt oder ist für dieses Planungsjahr ungültig. Bitte zentral ergänzen.');
    const values = validatePersonValues(Object.fromEntries(Object.entries(PERSON_VALUE_KEYS).map(([field, key]) => [field, data[key]])));
    const { beginning, legacyStart, ...pension } = projectPersonPension(data, year);
    return { referenceYear: year, ageStatus: age.status, startAlter: age.age, geschlecht: values.geschlecht,
        startSPB: values.sparerPauschbetrag, kirchensteuerSatz: values.kirchensteuerPct / 100,
        ...pension, rentAdjMode: values.rentenanpassungArt, rentAdjPct: values.rentenanpassungPct,
        renteIndexierungsart: values.rentenanpassungArt === 'fix' ? 'fest' : values.rentenanpassungArt,
        renteFesterSatz: values.rentenanpassungPct, steuerquotePct: values.renteSteuerquotePct };
}

export function stripBalancePersonInputs(state) {
    if (!state?.inputs) return state;
    const inputs = { ...state.inputs };
    for (const field of BALANCE_PERSON_FIELDS) delete inputs[field];
    const evidence = Object.fromEntries(BALANCE_PERSON_FIELDS.filter(field => Object.hasOwn(state.inputs, field)).map(field => [field, state.inputs[field]]));
    return { ...state, inputs, ...(Object.keys(evidence).length ? { personInputEvidence: evidence } : {}) };
}

export const BALANCE_PERSON_FIELDS = Object.freeze(['aktuellesAlter', 'renteMonatlich', 'sonstigeEinkuenfte', 'renteAktiv', 'sparerPauschbetrag', 'kirchensteuerSatz']);

// Personenidentität zeigt heute; Detailhinweise erklären die unveränderte Januarplanung.
export function describePersonDates(data, year, now = appNow()) {
    const age = personAge(data, year), birth = validateIsoDate(data?.profile_geburtsdatum);
    const today = personDisplayAge(data, now);
    const formatted = date => `${String(date.day).padStart(2, '0')}.${String(date.month).padStart(2, '0')}.${date.year}`;
    let identity, hint;
    identity = today.status === 'valid' ? `geb. ${formatted(birth)} · ${today.age} Jahre`
        : today.status === 'fallback' ? `${today.age} Jahre · Altalter, Geburtsdatum fehlt`
            : today.status === 'future' ? `geb. ${formatted(birth)} · Geburtsdatum liegt in der Zukunft` : 'Geburtsdatum fehlt oder ist ungültig';
    if (birth.status === 'valid' && age.status === 'valid') {
        hint = `Für die Planung ${year} zählt das Alter am 01.01.: ${age.age} Jahre (ab Planung ${year + 1}: ${age.age + 1}).`;
        if (birth.month === 1 && birth.day === 1) hint += ' Geburtstag am Stichtag, bereits in diesem Planungsjahr berücksichtigt.';
    } else hint = age.status === 'fallback' ? `Für die Planung ${year}: ${age.age} Jahre als festes Altalter · Geburtsdatum einmal ergänzen; keine jährliche Erhöhung` : 'Bitte ein vollständiges gültiges Geburtsdatum ergänzen.';
    const pension = validateIsoDate(data?.profile_rentenbeginn);
    const pensionStatus = pension.status === 'valid'
        ? pension.year > year ? `Rente ab ${formatted(pension)} · in ${pension.year - year} ${pension.year - year === 1 ? 'Jahr' : 'Jahren'}`
            : pension.year === year && pension.month > 1 ? `Rente ab ${formatted(pension)} · ${deriveAnnualPension(pension.value, year, 0).monateImJahr} von 12 Monaten im Budget`
                : `Rente läuft seit ${formatted(pension)}`
        : Number(data?.profile_rente_monatlich) > 0
            ? 'Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch nicht, bitte Beginn eintragen.' : '';
    const legacyStart = pension.status === 'missing' && data?.profile_person_migration_v1
        ? migrationPensionStart(JSON.parse(data.profile_person_migration_v1)) : null;
    const balancePensionStatus = pension.status === 'valid'
        ? pensionStatus + (pension.year < year || pension.month === 1 && pension.year === year ? ' · im Budget' : pension.year > year ? ' · noch nicht im Budget' : '')
        : legacyStart && legacyStart > year ? `Rente ab 01.01.${legacyStart} · noch nicht im Budget` : 'Rente läuft · im Budget';
    return { identity, hint, pensionStatus, balancePensionStatus, age: age.age, todayAge: today.age, todayAgeStatus: today.status, birthMissing: birth.status === 'missing', suggestedBirthYear: age.suggestedBirthYear ?? null };
}

/** Reine Formulargrenze: deutsche Kalendertexte hinein, ISO in den Speicher. */
export function personDateInputToIso(raw) {
    if (raw == null || raw === '') return '';
    const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(raw));
    if (!match) return null;
    const iso = `${match[3]}-${match[2]}-${match[1]}`;
    return validateIsoDate(iso).status === 'valid' ? iso : null;
}
export function personDateDisplay(raw) {
    return validateIsoDate(raw).status === 'valid' ? raw.split('-').reverse().join('.') : raw || '';
}
export function personGenderAssumed(data) {
    const raw = data?.profile_person_migration_v1;
    return data?.profile_geschlecht == null || data.profile_geschlecht === '' || Boolean(raw && JSON.parse(raw).sources?.geschlecht?.includes('angenommen'));
}
