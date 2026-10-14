import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';

const person = {
    profile_person_schema_version: '1',
    profile_geburtsdatum: '1960-01-01',
    profile_geschlecht: 'w',
    profile_rentenbeginn: '2026-01-01',
    profile_rente_monatlich: '1650'
};
const options = { referenceYear: 2026, planValues: null };
const withoutIncome = buildSimulatorInputsFromProfileData({ ...person, profile_sonstige_einkuenfte: '0' }, options);
const withIncome = buildSimulatorInputsFromProfileData({ ...person, profile_sonstige_einkuenfte: '750' }, options);

assertEqual(JSON.stringify(withIncome), JSON.stringify(withoutIncome), 'FR-7: Sonstige Einkünfte 0 und 750 ergeben identische Simulator-Eingaben');
assertEqual(withIncome.renteMonatlich, 1650, 'FR-7: Nur die Monatsrente erreicht die Simulator-Rechnung');
