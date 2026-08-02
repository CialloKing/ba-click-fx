import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { UNITY_FX_TOUCH } from '../src/config.js';

const FLOAT_TOLERANCE = 1e-5;

function parseArguments(argv)
{
  const projectIndex = argv.indexOf('--project');
  const projectPath = projectIndex >= 0 ? argv[projectIndex + 1] : null;

  if (!projectPath)
  {
    throw new Error(
      '用法: node scripts/verify-unity-reference.mjs --project <Unity工程路径>',
    );
  }

  return path.resolve(projectPath);
}

function splitUnityDocuments(source)
{
  const matches = [...source.matchAll(/^--- !u!(\d+) &(\d+)\s*$/gm)];

  return matches.map((match, index) =>
  {
    const start = match.index;
    const end = matches[index + 1]?.index ?? source.length;

    return {
      classId: Number(match[1]),
      fileId: match[2],
      source: source.slice(start, end),
    };
  });
}

function readInlineFileId(source, field)
{
  const match = source.match(
    new RegExp(`^\\s*${field}: \\{fileID: (\\d+)\\}`, 'm'),
  );

  if (!match)
  {
    throw new Error(`Unity 文档缺少 ${field} fileID`);
  }

  return match[1];
}

function readString(source, field)
{
  const match = source.match(new RegExp(`^\\s*${field}: (.+)$`, 'm'));

  if (!match)
  {
    throw new Error(`Unity 文档缺少 ${field}`);
  }

  return match[1].trim();
}

function readNumber(source, field)
{
  const match = source.match(
    new RegExp(`^\\s*${field}: (-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?)$`, 'im'),
  );

  if (!match)
  {
    throw new Error(`Unity 文档缺少数值 ${field}`);
  }

  return Number(match[1]);
}

function readVector(source, field)
{
  const match = source.match(
    new RegExp(
      `^\\s*${field}: \\{x: ([^,]+), y: ([^,]+), z: ([^}]+)\\}$`,
      'm',
    ),
  );

  if (!match)
  {
    throw new Error(`Unity 文档缺少向量 ${field}`);
  }

  return {
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  };
}

function readBlock(source, header)
{
  const lines = source.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === `${header}:`);

  if (startIndex < 0)
  {
    throw new Error(`Unity 文档缺少区块 ${header}`);
  }

  const indent = lines[startIndex].length - lines[startIndex].trimStart().length;
  let endIndex = lines.length;

  for (let index = startIndex + 1; index < lines.length; index++)
  {
    const line = lines[index];

    if (!line.trim())
    {
      continue;
    }

    const nextIndent = line.length - line.trimStart().length;

    if (nextIndent <= indent)
    {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join('\n');
}

function readMinMaxCurve(moduleSource, field)
{
  const curve = readBlock(moduleSource, field);
  const state = readNumber(curve, 'minMaxState');
  const scalar = readNumber(curve, 'scalar');
  const minScalar = readNumber(curve, 'minScalar');

  if (state === 0)
  {
    return { state, minimum: scalar, maximum: scalar };
  }

  if (state === 3)
  {
    return {
      state,
      minimum: Math.min(scalar, minScalar),
      maximum: Math.max(scalar, minScalar),
    };
  }

  throw new Error(`${field} 使用了尚未纳入审计的 MinMaxCurve 状态 ${state}`);
}

function readParticleSystem(documents, gameObjectNames, name)
{
  const document = documents.find((candidate) =>
  {
    if (candidate.classId !== 198)
    {
      return false;
    }

    const gameObjectId = readInlineFileId(candidate.source, 'm_GameObject');

    return gameObjectNames.get(gameObjectId) === name;
  });

  if (!document)
  {
    throw new Error(`Prefab 缺少 ParticleSystem: ${name}`);
  }

  return document.source;
}

function readTransformScale(documents, gameObjectNames, name)
{
  const document = documents.find((candidate) =>
  {
    if (candidate.classId !== 4)
    {
      return false;
    }

    const gameObjectId = readInlineFileId(candidate.source, 'm_GameObject');

    return gameObjectNames.get(gameObjectId) === name;
  });

  if (!document)
  {
    throw new Error(`Prefab 缺少 Transform: ${name}`);
  }

  return readVector(document.source, 'm_LocalScale');
}

function readBurstCount(particleSystem)
{
  const emission = readBlock(particleSystem, 'EmissionModule');
  const burstCount = readNumber(emission, 'm_BurstCount');

  if (burstCount !== 1)
  {
    throw new Error(`预期一个 Burst，实际为 ${burstCount}`);
  }

  return readMinMaxCurve(emission, 'countCurve').maximum;
}

function readParticleReference(documents, gameObjectNames, name)
{
  const source = readParticleSystem(documents, gameObjectNames, name);
  const initial = readBlock(source, 'InitialModule');
  const shape = readBlock(source, 'ShapeModule');
  const emission = readBlock(source, 'EmissionModule');

  return {
    source,
    duration: readNumber(source, 'lengthInSec'),
    loop: readNumber(source, 'looping') === 1,
    lifetime: readMinMaxCurve(initial, 'startLifetime'),
    speed: readMinMaxCurve(initial, 'startSpeed'),
    size: readMinMaxCurve(initial, 'startSize'),
    maximumParticles: readNumber(initial, 'maxNumParticles'),
    shapeScale: readVector(shape, 'm_Scale'),
    rateOverDistance: readMinMaxCurve(emission, 'rateOverDistance').maximum,
  };
}

function assertClose(actual, expected, label)
{
  assert.ok(
    Math.abs(actual - expected) <= FLOAT_TOLERANCE,
    `${label}: Web=${actual}, Unity=${expected}`,
  );
}

function readCSharpConstant(source, type, name)
{
  const match = source.match(
    new RegExp(
      `private const ${type} ${name} = (-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))f?;`,
    ),
  );

  if (!match)
  {
    throw new Error(`捕获脚本缺少常量 ${name}`);
  }

  return Number(match[1]);
}

function readMarkdownNumber(source, label)
{
  const match = source.match(
    new RegExp(`\\| ${label} \\| \\x60(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))\\x60 \\|`),
  );

  if (!match)
  {
    throw new Error(`Bloom 审计缺少 ${label}`);
  }

  return Number(match[1]);
}

async function main()
{
  const projectPath = parseArguments(process.argv.slice(2));
  const prefabPath = path.join(
    projectPath,
    'Assets',
    'Imported',
    'FX_Touch',
    'FX_Touch.prefab',
  );
  const meshPath = path.join(
    projectPath,
    'Assets',
    'Imported',
    'FX_Touch',
    'Meshes',
    'Cylinder002.asset',
  );
  const trailPath = prefabPath;
  const capturePath = path.join(
    projectPath,
    'Assets',
    'Editor',
    'BaFxTouchPreviewCapture.cs',
  );
  const bloomAuditPath = path.join(projectPath, 'Reference', '光晕还原审计.md');
  const [prefab, mesh, trailSource, captureSource, bloomAudit] =
    await Promise.all([
      readFile(prefabPath, 'utf8'),
      readFile(meshPath, 'utf8'),
      readFile(trailPath, 'utf8'),
      readFile(capturePath, 'utf8'),
      readFile(bloomAuditPath, 'utf8'),
    ]);
  const documents = splitUnityDocuments(prefab);
  const gameObjectNames = new Map(
    documents
      .filter((document) => document.classId === 1)
      .map((document) => [document.fileId, readString(document.source, 'm_Name')]),
  );
  const root = readParticleReference(documents, gameObjectNames, 'FX_Touch');
  const rings = readParticleReference(documents, gameObjectNames, 'MeshTri');
  const disk = readParticleReference(documents, gameObjectNames, 'ring');
  const clickShards = readParticleReference(
    documents,
    gameObjectNames,
    'Ring (3)',
  );
  const trailShards = readParticleReference(
    documents,
    gameObjectNames,
    'Ring (4)',
  );
  const shardScale = readTransformScale(documents, gameObjectNames, 'Ring (3)');
  const trailShardScale = readTransformScale(
    documents,
    gameObjectNames,
    'Ring (4)',
  );
  const trailDocument = splitUnityDocuments(trailSource).find((document) =>
    document.classId === 96);

  if (!trailDocument)
  {
    throw new Error('Prefab 缺少 TrailRenderer');
  }

  const captureOrthographicSize = readCSharpConstant(
    captureSource,
    'float',
    'CaptureOrthographicSize',
  );
  const worldToReferencePixels = UNITY_FX_TOUCH.referenceHeight /
    (captureOrthographicSize * 2);
  const meshExtent = readVector(mesh, 'm_Extent').x;
  const diskSizeMultiplier = readNumber(
    readBlock(readBlock(disk.source, 'SizeModule'), 'curve'),
    'scalar',
  );
  const trailTime = readNumber(trailDocument.source, 'm_Time');
  const trailParameters = readBlock(trailDocument.source, 'm_Parameters');

  assert.equal(root.loop, false, 'FX_Touch 根粒子必须非循环');
  assertClose(
    UNITY_FX_TOUCH.rootDurationMs,
    root.duration * 1000,
    'FX_Touch 根持续时间',
  );
  assertClose(
    UNITY_FX_TOUCH.disk.lifetimeMs,
    disk.lifetime.maximum * 1000,
    '中心光盘寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.disk.radius,
    disk.size.maximum * diskSizeMultiplier * 0.5 * worldToReferencePixels,
    '中心光盘基准半径',
  );
  assertClose(UNITY_FX_TOUCH.rings.count, readBurstCount(rings.source), '圆环数量');
  assertClose(
    UNITY_FX_TOUCH.rings.lifetimeMs,
    rings.lifetime.maximum * 1000,
    '圆环寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.rings.radiusMin,
    rings.size.minimum * meshExtent * worldToReferencePixels,
    '圆环最小半径',
  );
  assertClose(
    UNITY_FX_TOUCH.rings.radiusMax,
    rings.size.maximum * meshExtent * worldToReferencePixels,
    '圆环最大半径',
  );
  assertClose(
    UNITY_FX_TOUCH.rings.angularVelocityMultiplier,
    readNumber(
      readBlock(readBlock(rings.source, 'RotationModule'), 'curve'),
      'scalar',
    ),
    '圆环旋转倍率',
  );

  assertClose(shardScale.x, trailShardScale.x, '两类碎片局部缩放');
  const shardUnitToReferencePixels = worldToReferencePixels * shardScale.x;

  assertClose(
    UNITY_FX_TOUCH.shards.clickCount,
    readBurstCount(clickShards.source),
    '点击碎片数量',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.clickLifetimeMinMs,
    clickShards.lifetime.minimum * 1000,
    '点击碎片最短寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.clickLifetimeMaxMs,
    clickShards.lifetime.maximum * 1000,
    '点击碎片最长寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.clickSpeedMin,
    clickShards.speed.minimum * shardUnitToReferencePixels,
    '点击碎片最低速度',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.clickSpeedMax,
    clickShards.speed.maximum * shardUnitToReferencePixels,
    '点击碎片最高速度',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.clickRadius,
    clickShards.shapeScale.x * shardUnitToReferencePixels,
    '点击碎片发射半径',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailLifetimeMinMs,
    trailShards.lifetime.minimum * 1000,
    '拖尾碎片最短寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailLifetimeMaxMs,
    trailShards.lifetime.maximum * 1000,
    '拖尾碎片最长寿命',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailSpeedMin,
    trailShards.speed.minimum * shardUnitToReferencePixels,
    '拖尾碎片最低速度',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailSpeedMax,
    trailShards.speed.maximum * shardUnitToReferencePixels,
    '拖尾碎片最高速度',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailRadius,
    trailShards.shapeScale.x * shardUnitToReferencePixels,
    '拖尾碎片发射半径',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.sizeMin,
    clickShards.size.minimum * shardUnitToReferencePixels,
    '碎片最小尺寸',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.sizeMax,
    clickShards.size.maximum * shardUnitToReferencePixels,
    '碎片最大尺寸',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.trailSpacing,
    worldToReferencePixels / trailShards.rateOverDistance,
    '拖尾碎片发射间距',
  );
  assertClose(
    UNITY_FX_TOUCH.shards.maxCount,
    trailShards.maximumParticles,
    '拖尾碎片实例上限',
  );

  assertClose(UNITY_FX_TOUCH.trail.lifetimeMs, trailTime * 1000, '拖尾寿命');
  assertClose(
    UNITY_FX_TOUCH.trail.geometryWidth,
    readNumber(trailParameters, 'widthMultiplier') * worldToReferencePixels,
    '拖尾几何宽度',
  );
  assertClose(
    UNITY_FX_TOUCH.trail.minVertexDistance,
    readNumber(trailDocument.source, 'm_MinVertexDistance') *
      worldToReferencePixels,
    '拖尾最小顶点距离',
  );
  assertClose(
    UNITY_FX_TOUCH.trail.numCornerVertices,
    readNumber(trailParameters, 'numCornerVertices'),
    '拖尾圆角顶点数',
  );
  assertClose(
    UNITY_FX_TOUCH.trail.numCapVertices,
    readNumber(trailParameters, 'numCapVertices'),
    '拖尾端帽顶点数',
  );

  const bloomChecks = [
    ['Intensity', 'intensity'],
    ['Threshold', 'threshold'],
    ['Soft Knee', 'softKnee'],
    ['Clamp', 'clamp'],
    ['Diffusion', 'diffusion'],
  ];

  for (const [auditLabel, configField] of bloomChecks)
  {
    assertClose(
      UNITY_FX_TOUCH.bloom[configField],
      readMarkdownNumber(bloomAudit, auditLabel),
      `Bloom ${auditLabel}`,
    );
  }

  console.log('Unity 外部资源审计通过：33 项共享渲染参数与游戏工程一致');
  console.log(JSON.stringify(
    {
      project: projectPath,
      projection:
      {
        orthographicSize: captureOrthographicSize,
        referenceHeight: UNITY_FX_TOUCH.referenceHeight,
        worldToReferencePixels,
      },
      particles:
      {
        disk: 1,
        rings: UNITY_FX_TOUCH.rings.count,
        clickShards: UNITY_FX_TOUCH.shards.clickCount,
        trailShardLimit: UNITY_FX_TOUCH.shards.maxCount,
      },
    },
    null,
    2,
  ));
}

main().catch((error) =>
{
  console.error(`Unity 外部资源审计失败: ${error.message}`);
  process.exitCode = 1;
});
