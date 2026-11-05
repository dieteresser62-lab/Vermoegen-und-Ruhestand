import * as facade from '../engine/core.mjs';
import { EngineAPI, default as apiDefault } from '../engine/core/api.mjs';
import { _internal_calculateModel } from '../engine/core/annual-model.mjs';
import { _allocateFinalTaxToActionSources } from '../engine/core/action-source-tax.mjs';
import { EngineAPI as entryAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';

const expected = { EngineAPI, _internal_calculateModel, _allocateFinalTaxToActionSources, default: apiDefault };
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(expected).sort()),
    'Core-Fassade erhält genau die bisherigen öffentlichen Namen');
for (const [name, value] of Object.entries(expected)) {
    assert(facade[name] === value, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}
assert(facade.default.EngineAPI === facade.EngineAPI, 'Default-Objekt verwendet dieselbe API');
assert(facade.default._internal_calculateModel === facade._internal_calculateModel,
    'Default-Objekt verwendet dieselbe Jahresfunktion');
assert(entryAPI === facade.EngineAPI, 'Engine-Einstieg erhält dasselbe API-Objekt');
assert(facade.EngineAPI.getConfig() === CONFIG, 'API reicht dieselbe Konfiguration weiter');
