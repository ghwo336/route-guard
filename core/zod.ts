import { z } from 'zod';

// zod 4 probes `Function('')` when building z.object to decide on JIT parsing. In the MAIN world
// that probe hits page CSP / Trusted Types (e.g. google.com logs "requires 'TrustedScript'
// assignment"), and MV3 extension pages forbid eval anyway. Our schemas are tiny, so skip it.
// Every schema module must import `z` from here so the config runs before any z.object().
z.config({ jitless: true });

export { z };
