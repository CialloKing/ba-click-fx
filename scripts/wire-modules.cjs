const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'src', 'main.js');
let src = fs.readFileSync(filePath, 'utf8');

// Step 1: Remove the CONFIG object block
src = src.replace(/const CONFIG = \{[\s\S]*?\n\};/, '');

// Step 2: Remove each utility function declaration (function name(...) { ... })
const funcNames = [
  'clamp01', 'rand', 'pick', 'easeOutCubic', 'smoothstep',
  'distance', 'lerp', 'rgbToCss', 'mixColor',
  'getArcWeight', 'getClickScale', 'getClickRingEndColor',
  'getTrailColor', 'getTrailCoreColor', 'getTrailHotColor',
];
for (const name of funcNames) {
  // Match "function name(...) { ... }" including comments before it
  const re = new RegExp(
    '(?:\\/\\/[^\\n]*\\n)?' +              // optional single-line comment
    'function ' + name + '\\(' +           // function name(
    '[\\s\\S]*?' +                          // body (non-greedy)
    '\\n\\}',                               // closing }
    'g'
  );
  src = src.replace(re, '');
}

// Step 3: Add imports after the style import
const imports = [
  "import { clamp01, rand, pick, easeOutCubic, smoothstep, distance, lerp, rgbToCss, mixColor, getArcWeight } from './utils.js';",
  "import { CONFIG, getClickScale, getClickRingEndColor, getTrailColor, getTrailCoreColor, getTrailHotColor } from './config.js';",
].join('\n');
src = src.replace("import './style.css';", "import './style.css';\n" + imports);

// Step 4: Collapse multiple blank lines
src = src.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(filePath, src);
console.log('Done. New size:', src.length, 'bytes');
