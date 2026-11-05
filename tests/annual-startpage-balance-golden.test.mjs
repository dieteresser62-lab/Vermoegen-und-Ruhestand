// Die verteilte Matrix prüft: tatsächliche Binder erzeugen bytegleiche H3-Records.
import { runGoldenMatrix } from './annual-startpage-balance-golden-fixture.mjs';
import { STORAGE_FIXTURE_KINDS } from './helpers/balance-storage-fixtures.mjs';
await runGoldenMatrix(STORAGE_FIXTURE_KINDS[0]);
