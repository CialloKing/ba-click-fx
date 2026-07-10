#!/usr/bin/env node
/**
 * verify-sync.js
 * Check ba-click-fx demo page control 6-point sync completeness.
 *
 * Usage: run from project root
 *   node scripts/verify-sync.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX_PATH = path.join(ROOT, 'index.html');
const MAIN_PATH = path.join(ROOT, 'src', 'main.js');

let exitCode = 0;

function fail(section, msg) {
  console.error('  \u2718 [' + section + '] ' + msg);
  exitCode = 1;
}

function pass(section, msg) {
  console.log('  \u2714 [' + section + '] ' + msg);
}

// --- Read source files ---
const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
const mainJs = fs.readFileSync(MAIN_PATH, 'utf8');

// --- 1. Extract all ctrl* input IDs from index.html ---
const ctrlIdRegex = /id="(ctrl[^"]+)"/g;
const ctrlIds = new Set();
let m;
while ((m = ctrlIdRegex.exec(indexHtml)) !== null) {
  ctrlIds.add(m[1]);
}

const CONTROL_IDS = [...ctrlIds].sort();
console.log('\n\u627e\u5230 ' + CONTROL_IDS.length + ' \u4e2a\u63a7\u4ef6 ID\n');

// --- 2. Check labelMap ---
console.log('\u2014\u2014 labelMap \u68c0\u67e5 \u2014\u2014');
const labelMapSection = mainJs.match(/const\s+labelMap\s*=\s*\{([\s\S]*?)\};/);
if (!labelMapSection) {
  fail('labelMap', '\u672a\u627e\u5230 labelMap \u5bf9\u8c61');
} else {
  const labelMapText = labelMapSection[1];
  const labelMapKeys = [...labelMapText.matchAll(/(ctrl\w+)\s*:/g)].map(mm => mm[1]);
  const labelMapSet = new Set(labelMapKeys);

  // Controls whose labels are handled outside labelMap (e.g. customBgLabel)
  const nonLabelable = new Set(['ctrlCustomBg']);
  const labelableIds = CONTROL_IDS.filter(id => !nonLabelable.has(id));

  const missingInLabelMap = labelableIds.filter(id => !labelMapSet.has(id));
  if (missingInLabelMap.length === 0) {
    pass('labelMap', '\u5168\u90e8 ' + labelableIds.length + ' \u4e2a\u63a7\u4ef6\u5df2\u6620\u5c04');
  } else {
    missingInLabelMap.forEach(id => fail('labelMap', id + ' \u672a\u5728 labelMap \u4e2d\u6620\u5c04'));
  }

  // --- 3. Check I18N zh/en ---
  console.log('\n\u2014\u2014 I18N \u68c0\u67e5 \u2014\u2014');
  const labelValues = [...labelMapText.matchAll(/:\s*'(\w+)'/g)].map(mm => mm[1]);

  const zhSection = mainJs.match(/zh\s*:\s*\{([\s\S]*?)\n\s*\},?\s*\n\s*en\s*:/);
  const enSection = mainJs.match(/en\s*:\s*\{([\s\S]*?)\n\s*\},?\s*\n\s*\};/);

  const zhKeys = zhSection
    ? new Set([...zhSection[1].matchAll(/(\w+)\s*:/g)].map(mm => mm[1]))
    : new Set();
  const enKeys = enSection
    ? new Set([...enSection[1].matchAll(/(\w+)\s*:/g)].map(mm => mm[1]))
    : new Set();

  let i18nOk = true;
  labelValues.forEach(key => {
    if (!zhKeys.has(key)) { fail('I18N.zh', key + ' \u7f3a\u5c11\u4e2d\u6587\u7ffb\u8bd1'); i18nOk = false; }
    if (!enKeys.has(key)) { fail('I18N.en', key + ' \u7f3a\u5c11\u82f1\u6587\u7ffb\u8bd1'); i18nOk = false; }
  });
  if (i18nOk) {
    pass('I18N', '\u5168\u90e8 ' + labelValues.length + ' \u4e2a label key \u4e2d\u82f1\u6587\u7ffb\u8bd1\u5b8c\u6574');
  }
}

// --- 4. Check bindRange / addEventListener ---
console.log('\n\u2014\u2014 bindRange \u68c0\u67e5 \u2014\u2014');
const boundIds = new Set();

const bindRangeRegex = /bindRange\s*\(\s*'(ctrl[^']+)'/g;
while ((m = bindRangeRegex.exec(mainJs)) !== null) { boundIds.add(m[1]); }

const checkboxRegex = /(ctrl\w+)\.addEventListener\s*\(\s*['"]change['"]/g;
while ((m = checkboxRegex.exec(mainJs)) !== null) { boundIds.add(m[1]); }

const nonBindable = new Set(['ctrlColor', 'ctrlCustomBg']);
const bindableIds = CONTROL_IDS.filter(id => !nonBindable.has(id));

const missingBind = bindableIds.filter(id => !boundIds.has(id));
if (missingBind.length === 0) {
  pass('bindRange', '\u5168\u90e8 ' + bindableIds.length + ' \u4e2a\u53ef\u7ed1\u5b9a\u63a7\u4ef6\u5df2\u7ed1\u5b9a');
} else {
  missingBind.forEach(id => fail('bindRange', id + ' \u672a\u5728 bindRange \u6216 addEventListener \u4e2d\u7ed1\u5b9a'));
}

// --- 5. Check readDefaults ---
console.log('\n\u2014\u2014 readDefaults \u68c0\u67e5 \u2014\u2014');
const readDefaultsSection = mainJs.match(/function\s+readDefaults\s*\(\s*\)([\s\S]*?)const\s+DEFAULTS/);
if (!readDefaultsSection) {
  fail('readDefaults', '\u672a\u627e\u5230 readDefaults \u51fd\u6570');
} else {
  const defaultsText = readDefaultsSection[1];
  const defaultKeys = new Set([...defaultsText.matchAll(/^\s+(\w+)\s*:/gm)].map(mm => mm[1]));
  const defaultCount = defaultKeys.size;
  const expectedMin = CONTROL_IDS.length - nonBindable.size - 2;
  if (defaultCount >= expectedMin) {
    pass('readDefaults', defaultCount + ' \u4e2a\u9ed8\u8ba4\u503c key\uff08\u63a7\u4ef6\u6570 ' + CONTROL_IDS.length + '\uff09');
  } else {
    fail('readDefaults', '\u53ea\u6709 ' + defaultCount + ' \u4e2a\u9ed8\u8ba4\u503c key\uff0c\u9884\u671f\u81f3\u5c11 ' + expectedMin + ' \u4e2a');
  }
}

// --- 6. Check reset handler ---
console.log('\n\u2014\u2014 reset handler \u68c0\u67e5 \u2014\u2014');
const resetSection = mainJs.match(/getElementById\s*\(\s*['"]btnReset['"]\s*\)\.addEventListener[\s\S]*$/m);
if (!resetSection) {
  fail('reset', '\u672a\u627e\u5230 reset handler');
} else {
  const resetText = resetSection[0];
  const resetIds = new Set();

  const setValRegex = /setVal\s*\(\s*'(ctrl[^']+)'/g;
  while ((m = setValRegex.exec(resetText)) !== null) { resetIds.add(m[1]); }

  // Cached const variable pattern: ctrlXxx.checked =
  const checkResetRegex = /(ctrl\w+)\.checked\s*=/g;
  while ((m = checkResetRegex.exec(resetText)) !== null) { resetIds.add(m[1]); }

  // Direct getElementById pattern: getElementById('ctrlXxx').value =
  const directResetRegex = /getElementById\s*\(\s*'(ctrl[^']+)'\s*\)\.value\s*=/g;
  while ((m = directResetRegex.exec(resetText)) !== null) { resetIds.add(m[1]); }

  const resettableIds = bindableIds.filter(id => !nonBindable.has(id));
  const missingReset = resettableIds.filter(id => !resetIds.has(id));
  if (missingReset.length === 0) {
    pass('reset', '\u5168\u90e8 ' + resettableIds.length + ' \u4e2a\u53ef\u91cd\u7f6e\u63a7\u4ef6\u5df2\u8986\u76d6');
  } else {
    missingReset.forEach(id => fail('reset', id + ' \u672a\u5728 reset handler \u4e2d\u91cd\u7f6e'));
  }
}

// --- Summary ---
console.log('');
if (exitCode === 0) {
  console.log('\u2705 \u5168\u90e8\u540c\u6b65\u68c0\u67e5\u901a\u8fc7\uff01');
} else {
  console.log('\u274c \u5b58\u5728\u540c\u6b65\u9057\u6f0f\uff0c\u8bf7\u6839\u636e\u4e0a\u65b9\u8f93\u51fa\u4fee\u590d\u3002');
}

process.exit(exitCode);
