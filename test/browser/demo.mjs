import { runBrowserSuite } from './run-suite.mjs';
import { runDemoSuite } from './demo-suite.mjs';

await runBrowserSuite('demo', runDemoSuite);
