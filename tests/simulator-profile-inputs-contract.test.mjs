import * as facade from '../app/simulator/simulator-profile-inputs.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs/profile.js';
import { combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs/household.js';
import { careTodaySources } from '../app/simulator/simulator-profile-inputs/care.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

assertEqual(JSON.stringify(Object.keys(facade).sort()),
    JSON.stringify(['buildSimulatorInputsFromProfileData', 'combineSimulatorProfiles']),
    'Die Fassade erhält beide öffentlichen Namen');
assert(facade.buildSimulatorInputsFromProfileData === buildSimulatorInputsFromProfileData,
    'Profilprojektion und Fassade teilen dieselbe Bindung');
assert(facade.combineSimulatorProfiles === combineSimulatorProfiles,
    'Haushaltsprojektion und Fassade teilen dieselbe Bindung');

const records = createMusterHaushaltRecords('2026-10-20');
const profiles = Object.entries(JSON.parse(records.rs_profiles_v1).profiles);
const options = { referenceYear: 2026, planValues: null, storage: { getItem: key => records[key] ?? null } };
const primary = facade.buildSimulatorInputsFromProfileData({ ...profiles[0][1].data,
    sim_pflegeKostenStaffelPreset: 'custom', sim_pflegeStufe2Form: 'home-support' }, options);
const secondaryData = { ...profiles[1][1].data, profile_care_grade_today: '2',
    sim_pflegeKostenStaffelPreset: 'custom', sim_pflegeStufe2Form: 'family' };
delete secondaryData.profile_care_form_today;
const secondary = buildSimulatorInputsFromProfileData(secondaryData, options);
assertEqual(secondary.careToday.form, 'family', 'Die Einzelprojektion liest die eigene Pflegeform');
assertEqual(careTodaySources.get(secondary.careToday)?.profile_care_grade_today, '2',
    'Die Profilprojektion registriert ihre Quelle im gemeinsamen WeakMap');
const result = combineSimulatorProfiles([
    { profileId: profiles[0][0], inputs: primary },
    { profileId: profiles[1][0], inputs: secondary }
], profiles[0][0], { planValues: null });
assertEqual(result.combined?.partner.careToday.form, 'home-support',
    'Die Haushaltsprojektion liest dieselbe Quelle und wendet die gemeinsame Pflegeform an');
assertEqual(secondary.careToday.form, 'family', 'Die Haushaltsprojektion verändert die Einzelprojektion nicht');
