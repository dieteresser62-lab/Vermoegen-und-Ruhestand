// @ts-check

import { CONFIG } from '../app/balance/balance-config.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';

console.log('--- Profilverbund Profile Gold Overrides ---');

const store = new Map();
const localStorageMock = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
        store.set(key, String(value));
    },
    removeItem: (key) => {
        store.delete(key);
    },
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] || null,
    get length() {
        return store.size;
    }
};

global.localStorage = localStorageMock;

const PROFILE_STORAGE_KEY = 'rs_profiles_v1';

const registry = {
    version: 1,
    profiles: {
        musterA: {
            meta: {
                id: 'musterA',
                name: 'Muster A',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                belongsToHousehold: true
            },
            data: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({
                    inputs: {
                        goldAktiv: true,
                        goldZielProzent: 12,
                        goldFloorProzent: 3,
                        goldSteuerfrei: true,
                        rebalancingBand: 10
                    }
                }),
                profile_gold_aktiv: 'false',
                profile_gold_ziel_pct: '5',
                profile_gold_floor_pct: '1',
                profile_gold_steuerfrei: 'false',
                profile_gold_rebal_band: '20'
            }
        },
        musterB: {
            meta: {
                id: 'musterB',
                name: 'Muster B',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                belongsToHousehold: true
            },
            data: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({
                    inputs: {
                        goldAktiv: true,
                        goldZielProzent: 8,
                        goldFloorProzent: 2,
                        goldSteuerfrei: false,
                        rebalancingBand: 15
                    }
                })
            }
        },
        petra: {
            meta: {
                id: 'petra',
                name: 'Petra',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                belongsToHousehold: true
            },
            data: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({
                    inputs: {
                        goldAktiv: false,
                        goldZielProzent: 6,
                        goldFloorProzent: 1,
                        goldSteuerfrei: false,
                        rebalancingBand: 12
                    }
                }),
                profile_gold_aktiv: 'true',
                profile_gold_ziel_pct: '7,5',
                profile_gold_floor_pct: '2,5',
                profile_gold_steuerfrei: 'true',
                profile_gold_rebal_band: '18'
            }
        },
        lone: {
            meta: {
                id: 'lone',
                name: 'Lone',
                createdAt: '2024-01-01T00:00:00.000Z',
                updatedAt: '2024-01-01T00:00:00.000Z',
                belongsToHousehold: false
            },
            data: {
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({
                    inputs: {
                        goldAktiv: true,
                        goldZielProzent: 9,
                        goldFloorProzent: 2,
                        goldSteuerfrei: true,
                        rebalancingBand: 11
                    }
                })
            }
        }
    }
};

for (const profile of Object.values(registry.profiles)) Object.assign(profile.data, { profile_person_schema_version: '1', profile_aktuelles_alter: '67' });

// Registry in localStorage injizieren, damit loadProfilverbundProfiles darauf zugreift.
localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(registry));

const profiles = loadProfilverbundProfiles();
const musterA = profiles.find(entry => entry.profileId === 'musterA');
const musterB = profiles.find(entry => entry.profileId === 'musterB');
const petra = profiles.find(entry => entry.profileId === 'petra');
const lone = profiles.find(entry => entry.profileId === 'lone');

assert(!!musterA, 'Muster A profile should be loaded');
assert(!!musterB, 'Muster B profile should be loaded');
assert(!!petra, 'Petra profile should be loaded');
assertEqual(lone, undefined, 'Profiles excluded from profilverbund should not be loaded');

assertEqual(musterA.inputs.goldAktiv, false, 'Muster A should use profile gold aktiv override');
assertEqual(musterA.inputs.goldZielProzent, 5, 'Muster A gold target should use profile override');
assertEqual(musterA.inputs.goldFloorProzent, 1, 'Muster A gold floor should use profile override');
assertEqual(musterA.inputs.goldSteuerfrei, false, 'Muster A gold steuerfrei should use profile override');
assertEqual(musterA.inputs.rebalancingBand, 20, 'Muster A rebalancing band should use profile override');

assertEqual(musterB.inputs.goldAktiv, true, 'Muster B should keep input gold aktiv when no override');
assertEqual(musterB.inputs.goldZielProzent, 8, 'Muster B gold target should stay from inputs');
assertEqual(musterB.inputs.goldFloorProzent, 2, 'Muster B gold floor should stay from inputs');
assertEqual(musterB.inputs.goldSteuerfrei, false, 'Muster B gold steuerfrei should stay from inputs');
assertEqual(musterB.inputs.rebalancingBand, 15, 'Muster B rebalancing band should stay from inputs');

assertEqual(petra.inputs.goldAktiv, true, 'Petra should honor gold aktiv override true');
assertClose(petra.inputs.goldZielProzent, 7.5, 0.0001, 'Petra gold target should parse comma override');
assertClose(petra.inputs.goldFloorProzent, 2.5, 0.0001, 'Petra gold floor should parse comma override');
assertEqual(petra.inputs.goldSteuerfrei, true, 'Petra gold steuerfrei should honor override');
assertEqual(petra.inputs.rebalancingBand, 18, 'Petra rebalancing band should honor override');
