import { runBrowserSuite } from './run-suite.mjs';
import { runCoreSuite } from './core-suite.mjs';

await runBrowserSuite('core', runCoreSuite);
