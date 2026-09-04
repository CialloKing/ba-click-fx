import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LanguageVariant, SyntaxKind } from 'typescript/unstable/ast';
import { createScanner } from 'typescript/unstable/ast/scanner';

import { UNITY_FX_TOUCH } from '../src/config.js';

const FLOAT_TOLERANCE = 1e-5;
const CURRENT_UI_ORTHOGRAPHIC_SIZE = 1;
// 历史值只用于明确拒绝错误基线；审计输入始终是新版工程。
const HISTORICAL_PREVIEW_ORTHOGRAPHIC_SIZE = 1.35;
const MATERIAL_RENDER_QUEUE_REFERENCES = [
  ['FX_MAT_Touch_Cross2.mat', 'FX_MAT_Touch_Cross2', 4499],
  ['FX_MAT_Touch_Tri 2.mat', 'FX_MAT_Touch_Tri 2', 4550],
  ['FX_MAT_Touch_Tri3.mat', 'FX_MAT_Touch_Tri3', 4499],
  ['FX_MAT_TouchFXTrail.mat', 'FX_MAT_TouchFXTrail', 4499],
];
const TOUCH_SHADER_REFERENCES = [
  ['BaTouchAdditive.shader', 'One One'],
  ['BaTouchAlphaBlendAdd.shader', 'One OneMinusSrcAlpha'],
  ['BaTouchDissolve.shader', 'SrcAlpha One, One One'],
];

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

function readShaderDirective(source, directive, label)
{
  const matches = [...source.matchAll(
    new RegExp(`^\\s*${directive}\\s+(.+?)\\s*$`, 'gm'),
  )];

  if (matches.length !== 1)
  {
    throw new Error(
      `${label} 应有且仅有一个 ${directive} 指令，实际为 ${matches.length}`,
    );
  }

  return matches[0][1];
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

function readNamedUnityComponent(
  documents,
  gameObjectNames,
  classId,
  componentType,
  gameObjectName,
)
{
  const matches = documents.filter((candidate) =>
  {
    if (candidate.classId !== classId)
    {
      return false;
    }

    const gameObjectId = readInlineFileId(candidate.source, 'm_GameObject');

    return gameObjectNames.get(gameObjectId) === gameObjectName;
  });

  if (matches.length !== 1)
  {
    throw new Error(
      `预期 ${gameObjectName} 有且仅有一个 ${componentType}，实际为 ${matches.length}`,
    );
  }

  return matches[0].source;
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

function assertCurrentUiProjection(actual, expected, label)
{
  assert.ok(
    Math.abs(actual - expected) <= FLOAT_TOLERANCE,
    `${label}: 当前值=${actual}，新版固定 UI Pass 基线必须为 ${expected}。` +
      `旧“提取资产2”的 ${HISTORICAL_PREVIEW_ORTHOGRAPHIC_SIZE} ` +
      '仅是较早预览相机值，不是新版候选基线',
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

function readCSharpInvocationArguments(source, callee)
{
  // 复用现有词法扫描器跳过注释和字符串，只在代码令牌中匹配调用。
  const scanner = createScanner(true, LanguageVariant.Standard, source);
  const tokens = [];

  for (let kind = scanner.scan();
    kind !== SyntaxKind.EndOfFile;
    kind = scanner.scan())
  {
    if (scanner.isUnterminated())
    {
      throw new Error('C# 源码包含未闭合令牌');
    }

    tokens.push({ kind, text: scanner.getTokenText() });
  }

  const calleeTokens = callee.split('.').flatMap((part, index) =>
    index === 0 ? [part] : ['.', part]);
  const invocationIndexes = [];

  for (let index = 0; index < tokens.length; index++)
  {
    const matchesCallee = calleeTokens.every(
      (expected, offset) => tokens[index + offset]?.text === expected,
    );

    if (matchesCallee &&
        tokens[index + calleeTokens.length]?.kind === SyntaxKind.OpenParenToken)
    {
      invocationIndexes.push(index + calleeTokens.length);
    }
  }

  if (invocationIndexes.length !== 1)
  {
    throw new Error(
      `预期有且仅有一个 ${callee} 调用，实际为 ${invocationIndexes.length}`,
    );
  }

  const closingByOpening = new Map([
    [SyntaxKind.OpenParenToken, SyntaxKind.CloseParenToken],
    [SyntaxKind.OpenBracketToken, SyntaxKind.CloseBracketToken],
    [SyntaxKind.OpenBraceToken, SyntaxKind.CloseBraceToken],
  ]);
  const closingTokens = new Set(closingByOpening.values());
  const closingStack = [SyntaxKind.CloseParenToken];
  const argumentsList = [];
  let argument = '';

  for (let index = invocationIndexes[0] + 1; index < tokens.length; index++)
  {
    const token = tokens[index];

    if (closingByOpening.has(token.kind))
    {
      closingStack.push(closingByOpening.get(token.kind));
      argument += token.text;
      continue;
    }

    if (closingTokens.has(token.kind))
    {
      if (closingStack.pop() !== token.kind)
      {
        throw new Error(`${callee} 参数括号不匹配`);
      }

      if (closingStack.length === 0)
      {
        argumentsList.push(argument);
        break;
      }

      argument += token.text;
      continue;
    }

    if (token.kind === SyntaxKind.CommaToken && closingStack.length === 1)
    {
      argumentsList.push(argument);
      argument = '';
      continue;
    }

    argument += token.text;
  }

  if (closingStack.length !== 0)
  {
    throw new Error(`${callee} 调用括号未闭合`);
  }

  if (argumentsList.some((item) => !item))
  {
    throw new Error(`${callee} 存在空参数`);
  }

  return argumentsList;
}

function readCSharpNumberLiteral(source, label)
{
  const match = source.match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?:[fFdDmM])?$/i,
  );

  if (!match)
  {
    throw new Error(`${label} 必须是可直接审计的 C# 数值字面量，实际为 ${source}`);
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
  const baselineScenePath = path.join(
    projectPath,
    'Assets',
    'Scenes',
    'BundleBaseline.unity',
  );
  const bloomRendererPath = path.join(
    projectPath,
    'Assets',
    'Scripts',
    'BaGameBloomRendererFeature.cs',
  );
  const materialDirectory = path.join(
    projectPath,
    'Assets',
    'Imported',
    'FX_Touch',
    'Materials',
  );
  const shaderDirectory = path.join(projectPath, 'Assets', 'Shaders');
  const bloomAuditPath = path.join(projectPath, 'Reference', '光晕还原审计.md');
  const [
    prefab,
    mesh,
    trailSource,
    captureSource,
    baselineScene,
    bloomRendererSource,
    bloomAudit,
    materialSources,
    touchShaderSources,
  ] =
    await Promise.all([
      readFile(prefabPath, 'utf8'),
      readFile(meshPath, 'utf8'),
      readFile(trailPath, 'utf8'),
      readFile(capturePath, 'utf8'),
      readFile(baselineScenePath, 'utf8'),
      readFile(bloomRendererPath, 'utf8'),
      readFile(bloomAuditPath, 'utf8'),
      Promise.all(MATERIAL_RENDER_QUEUE_REFERENCES.map(([fileName]) =>
        readFile(path.join(materialDirectory, fileName), 'utf8'))),
      Promise.all(TOUCH_SHADER_REFERENCES.map(([fileName]) =>
        readFile(path.join(shaderDirectory, fileName), 'utf8'))),
    ]);

  for (let index = 0; index < MATERIAL_RENDER_QUEUE_REFERENCES.length; index++)
  {
    const [, expectedName, expectedQueue] =
      MATERIAL_RENDER_QUEUE_REFERENCES[index];
    const materialSource = materialSources[index];

    assert.equal(
      readString(materialSource, 'm_Name'),
      expectedName,
      `${expectedName} 材质名称`,
    );
    assert.equal(
      readNumber(materialSource, 'm_CustomRenderQueue'),
      expectedQueue,
      `${expectedName} 渲染队列`,
    );
  }

  for (let index = 0; index < TOUCH_SHADER_REFERENCES.length; index++)
  {
    const [fileName, expectedBlend] = TOUCH_SHADER_REFERENCES[index];
    const shaderSource = touchShaderSources[index];

    assert.equal(
      readShaderDirective(shaderSource, 'Blend', fileName),
      expectedBlend,
      `${fileName} Blend`,
    );
    assert.equal(
      readShaderDirective(shaderSource, 'Cull', fileName),
      'Back',
      `${fileName} Cull`,
    );
    assert.equal(
      readShaderDirective(shaderSource, 'ZWrite', fileName),
      'Off',
      `${fileName} ZWrite`,
    );
    assert.equal(
      readShaderDirective(shaderSource, 'ZTest', fileName),
      'LEqual',
      `${fileName} ZTest`,
    );
  }

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
  const sceneDocuments = splitUnityDocuments(baselineScene);
  const sceneGameObjectNames = new Map(
    sceneDocuments
      .filter((document) => document.classId === 1)
      .map((document) => [document.fileId, readString(document.source, 'm_Name')]),
  );
  const baselineCamera = readNamedUnityComponent(
    sceneDocuments,
    sceneGameObjectNames,
    20,
    'Camera',
    'Main Camera',
  );
  const sceneOrthographicMode = readNumber(baselineCamera, 'orthographic');
  const sceneOrthographicSize = readNumber(
    baselineCamera,
    'orthographic size',
  );
  const uiProjectionArguments = readCSharpInvocationArguments(
    bloomRendererSource,
    'Matrix4x4.Ortho',
  );
  const renderStateBlockArguments = readCSharpInvocationArguments(
    bloomRendererSource,
    'RenderStateBlock',
  );
  const depthStateArguments = readCSharpInvocationArguments(
    bloomRendererSource,
    'DepthState',
  );

  if (uiProjectionArguments.length !== 6)
  {
    throw new Error(
      `Matrix4x4.Ortho 应有 6 个参数，实际为 ${uiProjectionArguments.length}`,
    );
  }

  const uiProjectionBottom = readCSharpNumberLiteral(
    uiProjectionArguments[2],
    '固定 UI Pass 正交投影下边界',
  );
  const uiProjectionTop = readCSharpNumberLiteral(
    uiProjectionArguments[3],
    '固定 UI Pass 正交投影上边界',
  );

  assertCurrentUiProjection(
    captureOrthographicSize,
    CURRENT_UI_ORTHOGRAPHIC_SIZE,
    'BaFxTouchPreviewCapture 捕获正交高度',
  );
  assertCurrentUiProjection(
    sceneOrthographicMode,
    1,
    'BundleBaseline Main Camera 必须启用正交投影',
  );
  assertCurrentUiProjection(
    sceneOrthographicSize,
    CURRENT_UI_ORTHOGRAPHIC_SIZE,
    'BundleBaseline Main Camera 正交高度',
  );
  assertCurrentUiProjection(
    uiProjectionBottom,
    -CURRENT_UI_ORTHOGRAPHIC_SIZE,
    'BaGameBloomRendererFeature 固定 UI Pass 下边界',
  );
  assertCurrentUiProjection(
    uiProjectionTop,
    CURRENT_UI_ORTHOGRAPHIC_SIZE,
    'BaGameBloomRendererFeature 固定 UI Pass 上边界',
  );
  assert.deepEqual(
    renderStateBlockArguments,
    ['RenderStateMask.Depth'],
    'BaGameBloomRendererFeature 必须启用 UI Pass 深度状态覆盖',
  );
  assert.deepEqual(
    depthStateArguments,
    ['false', 'CompareFunction.Always'],
    'BaGameBloomRendererFeature UI Pass 必须关闭深度写入并始终通过测试',
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

  console.log(
    'Unity 外部资源审计通过：共享渲染参数、材质队列、Shader 状态与固定 UI Pass 基线一致',
  );
  console.log(JSON.stringify(
    {
      project: projectPath,
      projection:
      {
        baseline: 'UnityMouseFxLab 新版固定 UI Pass',
        orthographicSize: captureOrthographicSize,
        sceneOrthographicSize,
        uiPassVerticalBounds:
        {
          bottom: uiProjectionBottom,
          top: uiProjectionTop,
        },
        referenceHeight: UNITY_FX_TOUCH.referenceHeight,
        worldToReferencePixels,
        excludedHistoricalPreview:
        {
          source: '提取资产2',
          orthographicSize: HISTORICAL_PREVIEW_ORTHOGRAPHIC_SIZE,
          reason: '较早预览相机，不参与新版机器码基线验证',
        },
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
