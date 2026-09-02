#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API_VERSION = '2026-03-10';
const CSV_HEADER = 'date,stars,source,observed_at';
const GENERATED_FILES = ['README.md', 'stars.csv', 'star-history.svg'];
const HISTORY_TIME_ZONE = 'Asia/Shanghai';
const SVG_HEIGHT = 360;
const SVG_RENDER_HEIGHT = 480;
const SVG_RENDER_WIDTH = 960;
const SVG_WIDTH = 720;

const dateFormatter = new Intl.DateTimeFormat('en',
  {
    day: '2-digit',
    month: '2-digit',
    timeZone: HISTORY_TIME_ZONE,
    year: 'numeric',
  });

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[star-history] ${message}`);
  }
}

function validateDate(date, label = 'date')
{
  verify(/^\d{4}-\d{2}-\d{2}$/.test(date), `${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${date}T00:00:00.000Z`);

  verify(
    Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date,
    `${label} is not a valid calendar date: ${date}`,
  );
  return date;
}

function validateObservedAt(observedAt, date)
{
  const parsed = new Date(observedAt);

  verify(
    observedAt.length > 0 &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString() === observedAt,
    `observed_at must be an ISO timestamp: ${observedAt}`,
  );
  verify(
    formatHistoryDate(parsed) === date,
    `observed_at must belong to ${date} in ${HISTORY_TIME_ZONE}`,
  );
  return observedAt;
}

function addDays(date, days)
{
  const timestamp = Date.parse(`${validateDate(date)}T00:00:00.000Z`);

  return new Date(timestamp + days * 86400000).toISOString().slice(0, 10);
}

function compareDates(left, right)
{
  return left.localeCompare(right);
}

function escapeXml(value)
{
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatNumber(value)
{
  return Number(value.toFixed(2)).toString();
}

function renderDataReadme(repository)
{
  const escapedRepository = repository.replaceAll('`', '');

  return `# ${escapedRepository} Star history data

This orphan branch is maintained by GitHub Actions.

- \`stars.csv\` stores one Star-count point per Asia/Shanghai calendar day.
- \`star-history.svg\` is generated deterministically from the CSV data.
- \`reconstructed\` rows are derived from the \`starred_at\` timestamps of
  users who still star the repository at bootstrap time. They cannot recover
  removed Stars or historical decreases.
- \`observed\` rows are repository-count snapshots taken after tracking began.

Generated files should not be edited manually.
`;
}

function niceTickStep(maxStars)
{
  const roughStep = Math.max(1, maxStars / 5);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));

  for (const multiplier of [1, 2, 5, 10])
  {
    const candidate = multiplier * magnitude;

    if (candidate >= roughStep)
    {
      return Math.max(1, candidate);
    }
  }

  return 1;
}

function selectTickIndexes(length, maximumTicks)
{
  if (length <= maximumTicks)
  {
    return Array.from({ length }, (_, index) => index);
  }

  const indexes = new Set();

  for (let tick = 0; tick < maximumTicks; tick++)
  {
    indexes.add(Math.round(tick * (length - 1) / (maximumTicks - 1)));
  }

  return [...indexes].sort((left, right) => left - right);
}

function makePath(rows, pointForRow)
{
  return rows.map((row, index) =>
  {
    const point = pointForRow(row);

    return `${index === 0 ? 'M' : 'L'} ${formatNumber(point.x)} ${formatNumber(point.y)}`;
  }).join(' ');
}

function renderEmptySvg(repository)
{
  const title = escapeXml(`${repository} Star History`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_RENDER_WIDTH}" height="${SVG_RENDER_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">${title}</title>
  <desc id="desc">No Star history has been recorded yet.</desc>
  <rect x="0.5" y="0.5" width="719" height="359" rx="8" fill="#ffffff" stroke="#d0d7de"/>
  <text x="56" y="44" fill="#24292f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="26" font-weight="600">${title}</text>
  <text x="360" y="194" text-anchor="middle" fill="#57606a" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="22">No Star history yet</text>
</svg>
`;
}

export function formatHistoryDate(value)
{
  const date = value instanceof Date ? value : new Date(value);

  verify(Number.isFinite(date.getTime()), `invalid timestamp: ${value}`);
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );

  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseStarHistoryCsv(text)
{
  verify(typeof text === 'string', 'CSV input must be text');
  verify(!text.includes('\r'), 'CSV must use LF line endings');
  const lines = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');

  verify(lines[0] === CSV_HEADER, `CSV header must be ${CSV_HEADER}`);
  const rows = [];
  let previousDate = '';
  let previousRow;
  let observedStarted = false;

  for (let index = 1; index < lines.length; index++)
  {
    verify(lines[index].length > 0, `CSV row ${index + 1} is empty`);
    const fields = lines[index].split(',');

    verify(fields.length === 4, `CSV row ${index + 1} must have four fields`);
    const [date, starsText, source, observedAt] = fields;

    validateDate(date, `CSV row ${index + 1} date`);
    verify(/^\d+$/.test(starsText), `CSV row ${index + 1} stars must be a non-negative integer`);
    const stars = Number(starsText);

    verify(Number.isSafeInteger(stars), `CSV row ${index + 1} stars is too large`);
    verify(
      source === 'reconstructed' || source === 'observed',
      `CSV row ${index + 1} has an unknown source: ${source}`,
    );
    verify(
      previousDate.length === 0 || compareDates(previousDate, date) < 0,
      `CSV dates must be unique and strictly ascending at row ${index + 1}`,
    );

    if (source === 'reconstructed')
    {
      verify(!observedStarted, 'reconstructed rows cannot follow observed rows');
      verify(observedAt.length === 0, 'reconstructed rows cannot have observed_at');

      if (previousRow)
      {
        verify(
          date === addDays(previousRow.date, 1),
          `reconstructed rows must cover every date at row ${index + 1}`,
        );
        verify(
          stars >= previousRow.stars,
          `reconstructed stars cannot decrease at row ${index + 1}`,
        );
      }
    }
    else
    {
      observedStarted = true;
      validateObservedAt(observedAt, date);
    }

    rows.push({ date, stars, source, observedAt });
    previousDate = date;
    previousRow = rows.at(-1);
  }

  return rows;
}

export function serializeStarHistoryCsv(rows)
{
  const lines = rows.map((row) =>
    `${row.date},${row.stars},${row.source},${row.observedAt}`);
  const text = `${CSV_HEADER}\n${lines.length > 0 ? `${lines.join('\n')}\n` : ''}`;

  // Reuse the strict parser so generated data cannot bypass the storage contract.
  parseStarHistoryCsv(text);
  return text;
}

export function reconstructStarHistory(starredAtValues, observedDate)
{
  validateDate(observedDate, 'observed date');
  verify(Array.isArray(starredAtValues), 'stargazer timestamps must be an array');
  const countsByDate = new Map();

  for (const starredAt of starredAtValues)
  {
    const timestamp = new Date(starredAt);

    verify(Number.isFinite(timestamp.getTime()), `invalid starred_at timestamp: ${starredAt}`);
    const date = formatHistoryDate(timestamp);

    verify(
      compareDates(date, observedDate) <= 0,
      `starred_at cannot be later than the bootstrap date: ${starredAt}`,
    );

    if (date !== observedDate)
    {
      countsByDate.set(date, (countsByDate.get(date) ?? 0) + 1);
    }
  }

  const eventDates = [...countsByDate.keys()].sort(compareDates);

  if (eventDates.length === 0)
  {
    return [];
  }

  const rows = [];
  let stars = 0;

  for (let date = eventDates[0]; compareDates(date, observedDate) < 0; date = addDays(date, 1))
  {
    stars += countsByDate.get(date) ?? 0;
    rows.push(
      {
        date,
        stars,
        source: 'reconstructed',
        observedAt: '',
      },
    );
  }

  return rows;
}

export function upsertObservedStarCount(rows, observation)
{
  const date = validateDate(observation.date, 'observation date');
  const stars = Number(observation.stars);

  verify(Number.isSafeInteger(stars) && stars >= 0, 'observed stars must be a non-negative integer');
  const observedAt = validateObservedAt(observation.observedAt, date);
  const existingIndex = rows.findIndex((row) => row.date === date);

  if (existingIndex >= 0)
  {
    const existing = rows[existingIndex];

    if (existing.source === 'observed' && existing.stars === stars)
    {
      return { changed: false, rows: [...rows] };
    }

    const updatedRows = [...rows];

    updatedRows[existingIndex] = { date, stars, source: 'observed', observedAt };
    serializeStarHistoryCsv(updatedRows);
    return { changed: true, rows: updatedRows };
  }

  if (rows.length > 0)
  {
    verify(
      compareDates(rows.at(-1).date, date) < 0,
      `cannot insert a missing observation before ${rows.at(-1).date}`,
    );
  }

  const updatedRows = [
    ...rows,
    { date, stars, source: 'observed', observedAt },
  ];

  serializeStarHistoryCsv(updatedRows);
  return { changed: true, rows: updatedRows };
}

export function renderStarHistorySvg(rows, repository)
{
  verify(/^[^/\s]+\/[^/\s]+$/.test(repository), 'repository must use owner/name');
  serializeStarHistoryCsv(rows);

  if (rows.length === 0)
  {
    return renderEmptySvg(repository);
  }

  const margin = { bottom: 58, left: 70, right: 30, top: 82 };
  const plotWidth = SVG_WIDTH - margin.left - margin.right;
  const plotHeight = SVG_HEIGHT - margin.top - margin.bottom;
  const firstTime = Date.parse(`${rows[0].date}T00:00:00.000Z`);
  const lastTime = Date.parse(`${rows.at(-1).date}T00:00:00.000Z`);
  const timeSpan = Math.max(1, lastTime - firstTime);
  const maxStars = Math.max(...rows.map((row) => row.stars), 1);
  const tickStep = niceTickStep(maxStars);
  const yMaximum = Math.max(tickStep, Math.ceil(maxStars / tickStep) * tickStep);
  const pointForRow = (row) =>
  {
    const timestamp = Date.parse(`${row.date}T00:00:00.000Z`);
    const x = firstTime === lastTime
      ? margin.left + plotWidth / 2
      : margin.left + (timestamp - firstTime) / timeSpan * plotWidth;
    const y = margin.top + plotHeight - row.stars / yMaximum * plotHeight;

    return { x, y };
  };
  const observedStart = rows.findIndex((row) => row.source === 'observed');
  const reconstructedRows = observedStart < 0
    ? rows
    : rows.slice(0, observedStart + 1);
  const observedRows = observedStart < 0 ? [] : rows.slice(observedStart);
  const yGrid = [];

  for (let stars = 0; stars <= yMaximum; stars += tickStep)
  {
    const y = margin.top + plotHeight - stars / yMaximum * plotHeight;

    yGrid.push(`  <line x1="${margin.left}" y1="${formatNumber(y)}" x2="${SVG_WIDTH - margin.right}" y2="${formatNumber(y)}" stroke="#d8dee4" stroke-width="1"/>`);
    yGrid.push(`  <text x="${margin.left - 12}" y="${formatNumber(y + 7)}" text-anchor="end" fill="#57606a" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="20">${stars}</text>`);
  }

  const xLabels = selectTickIndexes(rows.length, 4).map((index) =>
  {
    const row = rows[index];
    const point = pointForRow(row);
    const textAnchor = index === 0
      ? 'start'
      : index === rows.length - 1 ? 'end' : 'middle';

    return `  <text x="${formatNumber(point.x)}" y="${SVG_HEIGHT - 22}" text-anchor="${textAnchor}" fill="#57606a" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="20">${row.date}</text>`;
  });
  const latest = rows.at(-1);
  const title = escapeXml(`${repository} Star History`);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_RENDER_WIDTH}" height="${SVG_RENDER_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" role="img" aria-labelledby="title desc">`,
    `  <title id="title">${title}</title>`,
    `  <desc id="desc">Star history through ${latest.date}. Reconstructed values are dashed and observed values are solid.</desc>`,
    '  <rect x="0.5" y="0.5" width="719" height="359" rx="8" fill="#ffffff" stroke="#d0d7de"/>',
    `  <text x="${margin.left}" y="38" fill="#24292f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="26" font-weight="600">${title}</text>`,
    `  <text x="${SVG_WIDTH - margin.right}" y="38" text-anchor="end" fill="#24292f" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="22" font-weight="600">${latest.stars} Stars</text>`,
    ...yGrid,
    `  <line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${SVG_WIDTH - margin.right}" y2="${margin.top + plotHeight}" stroke="#8c959f" stroke-width="1"/>`,
    ...xLabels,
  ];

  if (reconstructedRows.length > 0 && rows[0].source === 'reconstructed')
  {
    if (reconstructedRows.length > 1)
    {
      lines.push(`  <path data-source="reconstructed" d="${makePath(reconstructedRows, pointForRow)}" fill="none" stroke="#bf8700" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 6" vector-effect="non-scaling-stroke"/>`);
    }
    else
    {
      const reconstructedPoint = pointForRow(reconstructedRows[0]);

      lines.push(`  <circle data-source="reconstructed" cx="${formatNumber(reconstructedPoint.x)}" cy="${formatNumber(reconstructedPoint.y)}" r="4.5" fill="#bf8700" stroke="#ffffff" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    }

    lines.push(`  <line x1="${margin.left}" y1="61" x2="${margin.left + 28}" y2="61" stroke="#bf8700" stroke-width="3" stroke-dasharray="8 6"/>`);
    lines.push(`  <text x="${margin.left + 38}" y="68" fill="#57606a" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="20">API reconstruction</text>`);
  }

  if (observedRows.length > 0)
  {
    const legendX = rows[0].source === 'reconstructed' ? margin.left + 226 : margin.left;

    if (observedRows.length > 1)
    {
      lines.push(`  <path data-source="observed" d="${makePath(observedRows, pointForRow)}" fill="none" stroke="#0969da" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`);
    }

    const observedPoint = pointForRow(observedRows.at(-1));

    lines.push(`  <circle data-source="observed" cx="${formatNumber(observedPoint.x)}" cy="${formatNumber(observedPoint.y)}" r="4.5" fill="#0969da" stroke="#ffffff" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
    lines.push(`  <line x1="${legendX}" y1="61" x2="${legendX + 28}" y2="61" stroke="#0969da" stroke-width="3"/>`);
    lines.push(`  <text x="${legendX + 38}" y="68" fill="#57606a" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="20">Daily observations</text>`);
  }

  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}

function makeHeaders(token, accept)
{
  const headers =
  {
    Accept: accept,
    'X-GitHub-Api-Version': API_VERSION,
  };

  if (token)
  {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function readJsonResponse(response, label)
{
  verify(response && typeof response.ok === 'boolean', `${label} returned an invalid response`);

  if (!response.ok)
  {
    throw new Error(`[star-history] ${label} failed with HTTP ${response.status}`);
  }

  try
  {
    return await response.json();
  }
  catch (error)
  {
    throw new Error(`[star-history] ${label} returned invalid JSON`, { cause: error });
  }
}

function repositoryApiPath(repository)
{
  const [owner, name] = repository.split('/');

  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function validateRuntimeOptions(options)
{
  verify(/^[^/\s]+\/[^/\s]+$/.test(options.repository), 'GITHUB_REPOSITORY must use owner/name');
  const apiUrl = new URL(options.apiUrl);

  verify(apiUrl.protocol === 'https:', 'GITHUB_API_URL must use HTTPS');
  verify(options.now instanceof Date && Number.isFinite(options.now.getTime()), 'now must be a valid Date');
  verify(typeof options.fetchImpl === 'function', 'fetch implementation is required');
}

export async function fetchCurrentStargazerDates(options)
{
  validateRuntimeOptions(options);
  const uniqueStargazers = new Map();
  const basePath = repositoryApiPath(options.repository);

  for (let page = 1; page <= 10000; page++)
  {
    const url = new URL(`${basePath}/stargazers`, options.apiUrl);

    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '100');
    const response = await options.fetchImpl(url,
      {
        headers: makeHeaders(options.token, 'application/vnd.github.star+json'),
      });
    const payload = await readJsonResponse(response, `stargazers page ${page}`);

    verify(Array.isArray(payload), `stargazers page ${page} must be an array`);

    for (let index = 0; index < payload.length; index++)
    {
      const stargazer = payload[index];
      const starredAt = stargazer?.starred_at;

      verify(
        typeof starredAt === 'string' && Number.isFinite(new Date(starredAt).getTime()),
        `stargazers page ${page} contains an invalid starred_at`,
      );
      const identity = stargazer?.user?.id ?? stargazer?.user?.login ?? `anonymous:${page}:${index}`;

      uniqueStargazers.set(String(identity), starredAt);
    }

    if (payload.length < 100)
    {
      return [...uniqueStargazers.values()];
    }
  }

  throw new Error('[star-history] stargazer pagination exceeded 10000 pages');
}

export async function fetchRepositoryStarCount(options)
{
  validateRuntimeOptions(options);
  const url = new URL(repositoryApiPath(options.repository), options.apiUrl);
  const response = await options.fetchImpl(url,
    {
      headers: makeHeaders(options.token, 'application/vnd.github+json'),
    });
  const payload = await readJsonResponse(response, 'repository metadata');
  const stars = payload?.stargazers_count;

  verify(Number.isSafeInteger(stars) && stars >= 0, 'repository metadata has an invalid stargazers_count');
  return stars;
}

function writeChangedFiles(dataDir, files)
{
  const changedFiles = Object.entries(files)
    .filter(([name, content]) =>
      !existsSync(resolve(dataDir, name)) || readFileSync(resolve(dataDir, name), 'utf8') !== content)
    .map(([name]) => name);

  if (changedFiles.length === 0)
  {
    return [];
  }

  mkdirSync(dataDir, { recursive: true });

  for (const name of changedFiles)
  {
    writeFileSync(resolve(dataDir, name), files[name], 'utf8');
  }

  return changedFiles;
}

export async function updateStarHistory(options)
{
  const normalized =
  {
    apiUrl: options.apiUrl ?? 'https://api.github.com',
    bootstrap: options.bootstrap ?? false,
    dataDir: resolve(options.dataDir),
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? new Date(),
    repository: options.repository,
    token: options.token ?? '',
  };

  validateRuntimeOptions(normalized);
  const csvPath = resolve(normalized.dataDir, 'stars.csv');
  const date = formatHistoryDate(normalized.now);
  let rows;

  if (normalized.bootstrap)
  {
    for (const name of GENERATED_FILES)
    {
      verify(!existsSync(resolve(normalized.dataDir, name)), `bootstrap refuses to overwrite ${name}`);
    }

    const starredAtValues = await fetchCurrentStargazerDates(normalized);

    rows = reconstructStarHistory(starredAtValues, date);
  }
  else
  {
    verify(existsSync(csvPath), 'stars.csv is missing; bootstrap the data branch first');
    rows = parseStarHistoryCsv(readFileSync(csvPath, 'utf8'));
    const stars = await fetchRepositoryStarCount(normalized);
    const update = upsertObservedStarCount(rows,
      {
        date,
        observedAt: normalized.now.toISOString(),
        stars,
      });

    rows = update.rows;
  }

  const files =
  {
    'README.md': renderDataReadme(normalized.repository),
    'star-history.svg': renderStarHistorySvg(rows, normalized.repository),
    'stars.csv': serializeStarHistoryCsv(rows),
  };
  const changedFiles = writeChangedFiles(normalized.dataDir, files);

  return {
    changed: changedFiles.length > 0,
    changedFiles,
    date,
    latestStars: rows.at(-1)?.stars ?? 0,
    mode: normalized.bootstrap ? 'bootstrap' : 'observe',
    rows,
  };
}

function parseArguments(args)
{
  const parsed = { bootstrap: false, dataDir: '', help: false };

  for (let index = 0; index < args.length; index++)
  {
    const argument = args[index];

    if (argument === '--bootstrap')
    {
      parsed.bootstrap = true;
    }
    else if (argument === '--data-dir')
    {
      index++;
      verify(index < args.length && args[index].length > 0, '--data-dir requires a path');
      parsed.dataDir = args[index];
    }
    else if (argument === '--help')
    {
      parsed.help = true;
    }
    else
    {
      throw new Error(`[star-history] unknown argument: ${argument}`);
    }
  }

  if (!parsed.help)
  {
    verify(parsed.dataDir.length > 0, '--data-dir is required');
  }

  return parsed;
}

async function main()
{
  const args = parseArguments(process.argv.slice(2));

  if (args.help)
  {
    console.log('Usage: node scripts/update-star-history.mjs --data-dir <path> [--bootstrap]');
    return;
  }

  const result = await updateStarHistory(
    {
      bootstrap: args.bootstrap,
      dataDir: args.dataDir,
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
    });
  const status = result.changed
    ? `updated ${result.changedFiles.join(', ')}`
    : 'no file changes';

  console.log(`[star-history] ${result.mode} ${result.date}: ${result.latestStars} Stars; ${status}`);
}

const isDirectExecution = process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution)
{
  main().catch((error) =>
  {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
