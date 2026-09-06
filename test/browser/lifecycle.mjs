import { runBrowserSuite } from './run-suite.mjs';
import { runLifecycleSuite } from './lifecycle-suite.mjs';

await runBrowserSuite('lifecycle', runLifecycleSuite);
