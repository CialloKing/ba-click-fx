const suiteArgument = process.argv.find((argument) =>
  argument.startsWith('--suite='),
);
const suite = suiteArgument?.slice('--suite='.length);
const supportedSuites = new Set(['core', 'lifecycle', 'demo', 'unity']);

if (!supportedSuites.has(suite))
{
  throw new Error(
    `必须通过 --suite 指定浏览器专项 (${[...supportedSuites].join(', ')})`,
  );
}

await import(`./${suite}.mjs`);
