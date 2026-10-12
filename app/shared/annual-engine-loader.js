import { createEngineHandshake } from '../balance/balance-update-pipeline.js';
import { REQUIRED_ENGINE_API_VERSION_PREFIX } from '../balance/balance-config.js';

/** Ein Ladeauftrag einschließlich fehlgeschlagenem Handshake je Dienstlebensdauer. */
export function createAnnualEngineLoader({ importEngine = () => import('../../engine/index.mjs'),
    readActiveApi = () => null } = {}) {
    let loading;
    const load = () => loading ||= Promise.resolve().then(async () => {
        const api = readActiveApi() || (await importEngine()).EngineAPI;
        createEngineHandshake(api, REQUIRED_ENGINE_API_VERSION_PREFIX);
        return api;
    });
    return { load, forOccasion: due => due ? load() : Promise.resolve(null) };
}

export const annualEngineLoader = createAnnualEngineLoader();
