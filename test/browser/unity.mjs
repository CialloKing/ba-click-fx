import { runBrowserSuite } from './run-suite.mjs';
import { runUnitySuite } from './unity-suite.mjs';

await runBrowserSuite('unity', runUnitySuite);
