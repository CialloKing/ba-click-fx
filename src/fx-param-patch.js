import {
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
} from './config.js';

const FX_PARAM_DESCRIPTORS = new Map(
  FX_PARAM_SCHEMA.map((descriptor) => [descriptor.path, descriptor]),
);

function isConfigObject(value)
{
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneConfig(config)
{
  return structuredClone(config);
}

function setConfigValue(config, path, value)
{
  const keys = path.split('.');
  let target = config;

  for (let index = 0; index < keys.length - 1; index++)
  {
    const key = keys[index];

    if (!isConfigObject(target[key]))
    {
      // Schema 已验证路径；缺失分组时只补建所需对象，避免复制整份默认配置。
      target[key] = {};
    }

    target = target[key];
  }

  target[keys[keys.length - 1]] = value;
}

function createRejected(path, value, reason, details = {})
{
  return (
    {
      path,
      value,
      reason,
      ...details,
    }
  );
}

function resolveMigration(path, schemaVersion)
{
  let currentVersion = schemaVersion;
  let resolvedPath = path;
  const normalized = [];

  while (currentVersion < FX_PARAM_SCHEMA_VERSION)
  {
    const migration = FX_PARAM_MIGRATIONS.find(
      (candidate) => candidate.fromVersion === currentVersion,
    );

    if (!migration || migration.toVersion <= currentVersion)
    {
      return (
        {
          error: 'missing-migration',
          path: resolvedPath,
          normalized,
        }
      );
    }

    for (const change of migration.changes)
    {
      if (change.kind === 'rename' && resolvedPath === change.from)
      {
        normalized.push(
          {
            path: resolvedPath,
            from: resolvedPath,
            to: change.to,
            reason: 'renamed',
          },
        );
        resolvedPath = change.to;
      }
    }

    currentVersion = migration.toVersion;
  }

  return (
    {
      error: null,
      path: resolvedPath,
      normalized,
    }
  );
}

function normalizeParamValue(descriptor, path, value)
{
  if (descriptor.type === 'boolean')
  {
    if (typeof value === 'boolean')
    {
      return (
        {
          accepted: true,
          normalized: [],
          value,
        }
      );
    }

    if (typeof value === 'number' && Number.isFinite(value))
    {
      const normalizedValue = !!value;

      return (
        {
          accepted: true,
          normalized:
          [
            {
              path,
              from: value,
              to: normalizedValue,
              reason: 'boolean-coercion',
            },
          ],
          value: normalizedValue,
        }
      );
    }

    return (
      {
        accepted: false,
        reason: typeof value === 'number'
          ? 'non-finite-number'
          : 'invalid-type',
      }
    );
  }

  if (descriptor.type !== 'number' || typeof value !== 'number')
  {
    return (
      {
        accepted: false,
        reason: 'invalid-type',
      }
    );
  }

  if (!Number.isFinite(value))
  {
    return (
      {
        accepted: false,
        reason: 'non-finite-number',
      }
    );
  }

  const normalizedValue = Math.min(
    descriptor.max,
    Math.max(descriptor.min, value),
  );

  if (normalizedValue === value)
  {
    return (
      {
        accepted: true,
        normalized: [],
        value,
      }
    );
  }

  return (
    {
      accepted: true,
      normalized:
      [
        {
          path,
          from: value,
          to: normalizedValue,
          reason: 'clamped',
        },
      ],
      value: normalizedValue,
    }
  );
}

function createResult(
  baseline,
  applied,
  normalized,
  rejected,
  committed,
  nextConfig,
)
{
  return (
    {
      applied,
      normalized,
      rejected,
      committed,
      schemaVersion: FX_PARAM_SCHEMA_VERSION,
      // 集成层使用候选树做一次原子替换，公开 API 可剥离该内部字段。
      nextConfig: committed ? nextConfig : cloneConfig(baseline),
    }
  );
}

/**
 * 根据公开 Schema 构造一次参数补丁的候选配置，不接触渲染实例或 DOM。
 *
 * patch 使用点号路径记录；baseline 表示当前配置，resetBaseline 由调用方按
 * 当前渲染模式提供。strict 拒绝整批时，nextConfig 会回到 baseline 的副本。
 */
export function applyFxParamPatch(
  patch,
  {
    baseline,
    reset = false,
    resetBaseline = baseline,
    strict = false,
    schemaVersion = FX_PARAM_SCHEMA_VERSION,
  } = {},
)
{
  if (!isConfigObject(baseline))
  {
    throw new TypeError('baseline must be a configuration object');
  }

  if (reset && !isConfigObject(resetBaseline))
  {
    throw new TypeError('resetBaseline must be a configuration object');
  }

  const applied = [];
  const normalized = [];
  const rejected = [];

  if (!Number.isInteger(schemaVersion) ||
      schemaVersion < 0 ||
      schemaVersion > FX_PARAM_SCHEMA_VERSION)
  {
    rejected.push(
      createRejected(
        '$schemaVersion',
        schemaVersion,
        'unsupported-schema-version',
      ),
    );

    return createResult(
      baseline,
      applied,
      normalized,
      rejected,
      false,
      baseline,
    );
  }

  if (!isConfigObject(patch))
  {
    rejected.push(createRejected('$patch', patch, 'invalid-patch'));

    return createResult(
      baseline,
      applied,
      normalized,
      rejected,
      false,
      baseline,
    );
  }

  const entries = [];

  for (const [sourcePath, value] of Object.entries(patch))
  {
    const migration = resolveMigration(sourcePath, schemaVersion);

    if (migration.error)
    {
      rejected.push(
        createRejected(sourcePath, value, migration.error),
      );
      continue;
    }

    entries.push(
      {
        sourcePath,
        path: migration.path,
        value,
        migrations: migration.normalized,
      },
    );
  }

  const groupedEntries = new Map();

  for (const entry of entries)
  {
    const group = groupedEntries.get(entry.path) ?? [];
    group.push(entry);
    groupedEntries.set(entry.path, group);
  }

  const selectedEntries = [];

  for (const group of groupedEntries.values())
  {
    // 新 Schema 的显式路径优先，避免旧别名覆盖用户已经迁移的新值。
    const selected = group.find((entry) => entry.sourcePath === entry.path) ??
      group[0];
    selectedEntries.push(selected);

    for (const entry of group)
    {
      if (entry !== selected)
      {
        rejected.push(
          createRejected(
            entry.sourcePath,
            entry.value,
            entry.migrations.length > 0
              ? 'migration-conflict'
              : 'duplicate-path',
            { targetPath: entry.path },
          ),
        );
      }
    }
  }

  selectedEntries.sort((left, right) =>
  {
    const leftOrder = FX_PARAM_DESCRIPTORS.get(left.path)?.order ?? Infinity;
    const rightOrder = FX_PARAM_DESCRIPTORS.get(right.path)?.order ?? Infinity;
    return leftOrder - rightOrder || left.sourcePath.localeCompare(right.sourcePath);
  });

  for (const entry of selectedEntries)
  {
    const descriptor = FX_PARAM_DESCRIPTORS.get(entry.path);

    if (!descriptor)
    {
      rejected.push(
        createRejected(entry.sourcePath, entry.value, 'unknown-path'),
      );
      continue;
    }

    const valueResult = normalizeParamValue(
      descriptor,
      entry.path,
      entry.value,
    );

    if (!valueResult.accepted)
    {
      rejected.push(
        createRejected(entry.sourcePath, entry.value, valueResult.reason),
      );
      continue;
    }

    applied.push(
      {
        path: entry.path,
        value: valueResult.value,
      },
    );
    normalized.push(...entry.migrations, ...valueResult.normalized);
  }

  if (strict && rejected.length > 0)
  {
    return createResult(
      baseline,
      [],
      normalized,
      rejected,
      false,
      baseline,
    );
  }

  const committed = reset || applied.length > 0;
  const nextConfig = cloneConfig(reset ? resetBaseline : baseline);

  for (const entry of applied)
  {
    setConfigValue(nextConfig, entry.path, entry.value);
  }

  return createResult(
    baseline,
    applied,
    normalized,
    rejected,
    committed,
    nextConfig,
  );
}
