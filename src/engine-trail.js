import { evaluateNumber, evaluateColor } from './engine-math.js';
import { clamp, clamp01, lerp, releaseTrailGradients } from './engine-shared.js';
import { UNITY_FX_TOUCH } from './config.js';
import { evaluateTrailLongitudinalCoverage, evaluateTrailTextureCoverageProfile } from './trail-coverage.js';
import { themeHueShift, relativeOklchTheme } from './engine-render-state.js';
import { colorToLinearEnergy, linearEnergyToAdditiveCss, linearEnergyToHostAdditiveCss, linearEnergyToOverlayCss, linearEnergyToNativeTrailBloomCss, linearEnergyToEmissionCss } from './engine-materials.js';
import { MIN_TRAIL_SEGMENT_LENGTH, measureTrail, getTrailMesh } from './engine-trail-geometry.js';

const TRAIL_GRADIENT_CACHE_CAPACITY = 8;

function hasVisibleTrailPoints(points)
{
  for (let index = 1; index < points.length; index++)
  {
    if (
      points[index].x !== points[index - 1].x ||
      points[index].y !== points[index - 1].y
    )
    {
      return true;
    }
  }

  return false;
}

function interpolateTrailColor(progress, trailCfg = UNITY_FX_TOUCH.trail)
{
  return evaluateColor(trailCfg.gradient, progress);
}

function createTrailFrameData(
  points,
  trailCfg,
  materialIntensity = null,
  cacheSegmentLengths = materialIntensity !== null,
  sharedData = null,
  workspace = null,
)
{
  if (!sharedData)
  {
    sharedData = workspace ?? {};
    releaseTrailGradients(sharedData);
    sharedData.version = (sharedData.version ?? 0) + 1;
    sharedData.materialReady = false;
    // 容量与可用结果分离：GPU 帧的 Canvas 辅助绘制不能读到上一帧材质。
    sharedData.pointEnergies = sharedData.segmentEnergies = sharedData.segmentMaximumEnergies = null;
    sharedData.pointTransverseProfiles = sharedData.pointCoverageProfiles = null;
    sharedData.segmentTransverseProfiles = sharedData.segmentCoverageProfiles = null;
    sharedData.pointCount = points.length;
    sharedData.segmentCount = Math.max(0, points.length - 1);
    // 数组长度保留工作容量；消费者只读取本次有效点/段，维持原求和顺序。
    const measurement = measureTrail(points, cacheSegmentLengths, sharedData.measurement ??= {});
    const pointProgresses = sharedData.pointProgresses ??= [];
    const segmentProgresses = sharedData.segmentProgresses ??= [];
    const pointCoverageFactors = sharedData.pointCoverageFactors ??= [];
    const segmentCoverageFactors = sharedData.segmentCoverageFactors ??= [];
    const coverageKeys = trailCfg.coverageLongitudinalKeys;
    for (let index = 0; index < points.length; index++)
    {
      const progress = measurement.totalLength > 0 ? measurement.distances[index] / measurement.totalLength : 0;
      pointProgresses[index] = progress;
      pointCoverageFactors[index] = evaluateTrailLongitudinalCoverage(coverageKeys, progress);
    }
    for (let index = 1; index < points.length; index++)
    {
      const progress = measurement.totalLength > 0
        ? (measurement.distances[index - 1] + measurement.distances[index]) * 0.5 / measurement.totalLength : 0;
      segmentProgresses[index - 1] = progress;
      segmentCoverageFactors[index - 1] = evaluateTrailLongitudinalCoverage(coverageKeys, progress);
    }
  }
  if (materialIntensity === null) return sharedData;

  const { measurement, pointProgresses, segmentProgresses } = sharedData;
  const materialWork = sharedData.materialWork ??= {};
  const pointEnergies = sharedData.pointEnergies = materialWork.pointEnergies ??= [];
  const segmentEnergies = sharedData.segmentEnergies = materialWork.segmentEnergies ??= [];
  const segmentMaximumEnergies = sharedData.segmentMaximumEnergies = materialWork.segmentMaximumEnergies ??= [];
  const segmentTransverseProfiles = sharedData.segmentTransverseProfiles = materialWork.segmentTransverseProfiles ??= [];
  const segmentCoverageProfiles = sharedData.segmentCoverageProfiles = materialWork.segmentCoverageProfiles ??= [];
  sharedData.pointTransverseProfiles = materialWork.pointTransverseProfiles ??= [];
  sharedData.pointCoverageProfiles = materialWork.pointCoverageProfiles ??= [];
  sharedData.pointTransverseVersions ??= [];
  sharedData.pointCoverageVersions ??= [];
  sharedData.materialVersion = (sharedData.materialVersion ?? 0) + 1;
  sharedData.materialReady = true;
  const textureLongitudinalKeys = sharedData.textureLongitudinalKeys = trailCfg.textureLongitudinalKeys;
  if (measurement.totalLength <= 0) return sharedData;

  for (let index = 0; index < points.length; index++)
  {
    evaluateTrailLinearEnergy(pointProgresses[index], trailCfg, materialIntensity,
      textureLongitudinalKeys, pointEnergies[index] ??= [0, 0, 0]);
  }
  for (let index = 1; index < points.length; index++)
  {
    const offset = index - 1;
    const progress = segmentProgresses[offset];
    const energy = evaluateTrailLinearEnergy(progress, trailCfg, materialIntensity,
      textureLongitudinalKeys, segmentEnergies[offset] ??= [0, 0, 0]);
    segmentMaximumEnergies[offset] = Math.max(...pointEnergies[offset], ...energy, ...pointEnergies[index]);
    segmentTransverseProfiles[offset] = evaluateTrailTransverseProfile(progress, trailCfg,
      textureLongitudinalKeys, segmentTransverseProfiles[offset]);
    segmentCoverageProfiles[offset] = evaluateTrailTextureCoverageProfile(progress, undefined, segmentCoverageProfiles[offset]);
  }
  return sharedData;
}

function evaluateTrailLinearEnergy(
  progress,
  trailCfg,
  materialIntensity,
  textureLongitudinalKeys = trailCfg.textureLongitudinalKeys,
  output = [0, 0, 0],
)
{
  const textureIntensity = evaluateNumber(
    textureLongitudinalKeys,
    progress,
  );
  const materialColor = evaluateTrailMaterialColor(
    progress,
    trailCfg,
    materialIntensity,
    output,
  );

  // 原 Shader 先将线性顶点色与已解码的 Stretch 纹理相乘，再施加 _Intensity。
  for (let index = 0; index < 3; index++) output[index] = materialColor[index] * textureIntensity;
  return output;
}

function evaluateTrailMaterialColor(progress, trailCfg, materialIntensity, output = [0, 0, 0])
{
  // Gradient 已按网页的旧点到新点顺序反转；纹理 U 的反向由 WebGL 顶点处理。
  return colorToLinearEnergy(
    evaluateColor(trailCfg.gradient, progress, output),
    materialIntensity,
    false,
    output,
  );
}

function writeTrailProfilePoint(profile, index, position, value)
{
  const pair = (profile.pairs ??= [])[index] ??= [0, 0];
  pair[0] = position; pair[1] = value; profile[index] = pair;
}

function evaluateTrailTransverseProfile(
  progress,
  trailCfg,
  textureLongitudinalKeys = trailCfg.textureLongitudinalKeys,
  profile = [],
)
{
  const keys = trailCfg.textureTransverseProfileKeys;

  if (!Array.isArray(keys) || keys.length === 0)
  {
    writeTrailProfilePoint(profile, 0, 0, 1); writeTrailProfilePoint(profile, 1, 1, 1); profile.length = 2;
    return profile;
  }

  const t = clamp01(progress);
  let previous = keys[0];
  let current = keys[0];
  let localProgress = 0;

  for (let index = 1; index < keys.length; index++)
  {
    current = keys[index];

    if (t <= current[0])
    {
      previous = keys[index - 1];
      const span = current[0] - previous[0];

      localProgress = span > 0 ? (t - previous[0]) / span : 1;
      break;
    }

    previous = current;
    localProgress = 0;
  }

  const previousCenter = evaluateNumber(
    textureLongitudinalKeys,
    previous[0],
  );
  const currentCenter = evaluateNumber(
    textureLongitudinalKeys,
    current[0],
  );
  const interpolatedCenter = evaluateNumber(
    textureLongitudinalKeys,
    t,
  );
  const centerToEdge = profile.centerToEdge ??= [];
  centerToEdge.length = previous[1].length;
  for (let index = 0; index < previous[1].length; index++)
  {
    const value = previous[1][index];
    const previousEnergy = value * previousCenter;
    const currentEnergy = current[1][index] * currentCenter;
    const absoluteEnergy = lerp(
      previousEnergy,
      currentEnergy,
      clamp01(localProgress),
    );

    // 分别插值绝对纹理能量，最后再恢复相对中心值，等价于二维双线性采样。
    centerToEdge[index] = interpolatedCenter > 0.0000001
      ? clamp01(absoluteEnergy / interpolatedCenter)
      : 0;
  }
  const edgeIndex = centerToEdge.length - 1;
  let count = 0;

  for (let index = edgeIndex; index >= 0; index--)
  {
    writeTrailProfilePoint(profile, count++, (edgeIndex - index) / (edgeIndex * 2), centerToEdge[index]);
  }

  for (let index = 1; index <= edgeIndex; index++)
  {
    writeTrailProfilePoint(profile, count++, 0.5 + index / (edgeIndex * 2), centerToEdge[index]);
  }
  profile.length = count;

  return profile;
}

function getTrailGradientGroup(mesh, context, data, trailCfg, layer, opacity)
{
  // 未知变换的轻量 Context 保持原路径；真实 Canvas 以当前变换和尺寸识别渐变。
  if (!layer.gradientPurpose || typeof context.getTransform !== 'function') return null;
  const transform = context.getTransform();
  const signature = [data.version, data.materialVersion, data.pointEnergies, data.segmentEnergies, data.pointTransverseProfiles,
    data.segmentTransverseProfiles, data.pointCoverageProfiles, data.segmentCoverageProfiles,
    trailCfg, themeHueShift, relativeOklchTheme, opacity, layer.alpha, layer.materialIntensity,
    layer.outputCompositing, layer.overlayColorCompensation, layer.overlayAlphaLimit,
    layer.globalOpacity, context.canvas.width, context.canvas.height,
    transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
    ...(layer.gradientParameters ?? [])];
  const groups = mesh.canvasGradientCache ??= [];
  const index = groups.findIndex(group => group.context === context && group.purpose === layer.gradientPurpose);
  let group = index < 0 ? null : groups.splice(index, 1)[0];
  if (!group || !group.signature.every((value, i) => Object.is(value, signature[i]))
    || group.signature.length !== signature.length)
  {
    if (group) { group.segments.clear(); group.caps.clear(); }
    group = { context, purpose: layer.gradientPurpose, signature, segments: new Map(), caps: new Map() };
  }
  groups.push(group);
  if (groups.length > TRAIL_GRADIENT_CACHE_CAPACITY)
  {
    const expired = groups.shift();
    expired.segments.clear(); expired.caps.clear();
    expired.context = null; expired.signature = null;
  }
  return group;
}

function cachedTrailGradient(records, key, context, from, to, profile, colorAtIntensity)
{
  const record = records?.get(key);
  if (record && record.x1 === from.x && record.y1 === from.y && record.x2 === to.x && record.y2 === to.y)
    return record.gradient;
  const gradient = createTrailCrossSectionGradient(context, from, to, profile, colorAtIntensity);
  // 只有完整写入所有 stop 的渐变才能成为下一帧可复用资源。
  records?.set(key, { gradient, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  return gradient;
}

function resolveTrailTransverseProfile(profile)
{
  return Array.isArray(profile) && profile.length >= 2
    ? profile
    : [[0, 1], [1, 1]];
}

function createTrailCrossSectionGradient(
  context,
  from,
  to,
  transverseProfile,
  colorAtIntensity,
)
{
  const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);

  for (const [position, intensity] of resolveTrailTransverseProfile(
    transverseProfile,
  ))
  {
    gradient.addColorStop(
      clamp01(position),
      colorAtIntensity(intensity, position),
    );
  }

  return gradient;
}

function fillTrailMeshSegment(
  context,
  segment,
  endJoin,
  transverseProfile,
  colorAtIntensity,
  records = null,
)
{
  const gradient = cachedTrailGradient(
    records,
    segment,
    context,
    segment.fromLeft,
    segment.fromRight,
    transverseProfile,
    colorAtIntensity,
  );

  // CanvasGradient 只有一个插值轴；使用段中点能量保留横截面，避免每段拆成 16 次填充。
  context.beginPath();
  context.moveTo(segment.fromLeft.x, segment.fromLeft.y);

  if (!endJoin)
  {
    context.lineTo(segment.toLeft.x, segment.toLeft.y);
    context.lineTo(segment.toRight.x, segment.toRight.y);
  }
  else if (endJoin.innerSide === 'left')
  {
    context.lineTo(endJoin.inner.x, endJoin.inner.y);

    for (let index = endJoin.outerArc.length - 1; index >= 0; index--)
    {
      const point = endJoin.outerArc[index];

      context.lineTo(point.x, point.y);
    }
  }
  else
  {
    for (const point of endJoin.outerArc)
    {
      context.lineTo(point.x, point.y);
    }

    context.lineTo(endJoin.inner.x, endJoin.inner.y);
  }

  // fan 与前一段共享一条边，将外轮廓并入同一路径不会改变覆盖区域。
  context.lineTo(segment.fromRight.x, segment.fromRight.y);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

function fillTrailMeshCap(
  context,
  cap,
  transverseProfile,
  colorAtIntensity,
  records = null,
)
{
  const left = cap.points[0];
  const right = cap.position === 'start' ? cap.points[1] : cap.points[2];
  const gradient = cachedTrailGradient(
    records,
    cap,
    context,
    left,
    right,
    transverseProfile,
    colorAtIntensity,
  );

  context.beginPath();
  context.moveTo(cap.points[0].x, cap.points[0].y);
  context.lineTo(cap.points[1].x, cap.points[1].y);
  context.lineTo(cap.points[2].x, cap.points[2].y);
  context.closePath();
  // numCapVertices=1 对应三角端帽，端点颜色不能复用段中点。
  context.fillStyle = gradient;
  context.fill();
}

function resolveTrailPointEnergy(
  trailData,
  pointIndex,
  trailCfg,
  materialIntensity,
)
{
  if (trailData.pointEnergies?.[pointIndex])
  {
    return trailData.pointEnergies[pointIndex];
  }

  return evaluateTrailLinearEnergy(
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength,
    trailCfg,
    materialIntensity,
  );
}

function resolveTrailPointTransverseProfile(
  trailData,
  pointIndex,
  trailCfg,
)
{
  const profiles = trailData.pointTransverseProfiles;

  if (profiles?.[pointIndex] && trailData.pointTransverseVersions?.[pointIndex] === trailData.materialVersion)
  {
    return profiles[pointIndex];
  }

  const profile = evaluateTrailTransverseProfile(
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength,
    trailCfg,
    trailData.textureLongitudinalKeys,
    profiles?.[pointIndex],
  );

  // 端帽可能被 Native 与清晰层重复使用；按实际点索引只求值一次。
  if (profiles)
  {
    profiles[pointIndex] = profile;
    (trailData.pointTransverseVersions ??= [])[pointIndex] = trailData.materialVersion;
  }

  return profile;
}

function resolveTrailPointCoverageFactor(trailData, pointIndex, trailCfg)
{
  const cached = trailData.pointCoverageFactors?.[pointIndex];

  if (Number.isFinite(cached))
  {
    return cached;
  }

  const progress = trailData.pointProgresses?.[pointIndex] ??
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength;

  return evaluateTrailLongitudinalCoverage(
    trailCfg.coverageLongitudinalKeys,
    progress,
  );
}

function resolveTrailPointCoverageProfile(trailData, pointIndex)
{
  const profiles = trailData.pointCoverageProfiles;

  if (profiles?.[pointIndex] && trailData.pointCoverageVersions?.[pointIndex] === trailData.version)
  {
    return profiles[pointIndex];
  }

  const progress = trailData.pointProgresses?.[pointIndex] ??
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength;
  const profile = evaluateTrailTextureCoverageProfile(progress, undefined, profiles?.[pointIndex]);

  if (profiles)
  {
    profiles[pointIndex] = profile;
    (trailData.pointCoverageVersions ??= [])[pointIndex] = trailData.version;
  }

  return profile;
}

function drawTrailLayer(
  context,
  points,
  trailData,
  scale,
  opacity,
  trailCfg,
  layer,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const measurement = trailData.measurement;

  if (measurement.totalLength <= 0)
  {
    return;
  }

  context.save();
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  const width = layer.scaledWidth ?? layer.width * scale;
  const mesh = getTrailMesh(trailData, points, width, trailCfg);
  const gradientGroup = getTrailGradientGroup(mesh, context, trailData, trailCfg, layer, opacity);
  const firstSegment = clamp(
    Math.floor(segmentStart),
    1,
    points.length - 1,
  );
  const lastSegment = clamp(
    Math.floor(segmentEnd),
    firstSegment,
    points.length - 1,
  );
  const resolveCss = layer.colorAtIntensity ??
    ((color, intensity, textureCoverage, longitudinalCoverage) =>
    {
      const contribution = layer.alpha * opacity * intensity;
      const coverage = layer.alpha * opacity * textureCoverage *
        longitudinalCoverage;

      return layer.outputCompositing === 'browser-overlay'
        ? linearEnergyToOverlayCss(
            color,
            contribution,
            coverage,
            layer.overlayColorCompensation,
            layer.overlayAlphaLimit,
            layer.globalOpacity ?? opacity,
          )
        : layer.outputCompositing === 'host-additive'
          ? linearEnergyToHostAdditiveCss(
              color,
              contribution,
              coverage,
            )
          : linearEnergyToAdditiveCss(color, contribution);
    });

  for (let index = firstSegment; index <= lastSegment; index++)
  {
    const segment = mesh.segments[index];

    if (!segment)
    {
      continue;
    }

    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const color = trailData.segmentEnergies?.[index - 1] ??
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        layer.materialIntensity,
      );
    const transverseProfile =
      trailData.segmentTransverseProfiles?.[index - 1] ??
        evaluateTrailTransverseProfile(progress, trailCfg);
    const coverageProfile =
      trailData.segmentCoverageProfiles?.[index - 1] ??
        evaluateTrailTextureCoverageProfile(progress);
    const longitudinalCoverage =
      trailData.segmentCoverageFactors?.[index - 1] ??
        evaluateTrailLongitudinalCoverage(
          trailCfg.coverageLongitudinalKeys,
          progress,
        );

    fillTrailMeshSegment(
      context,
      segment,
      segment.endJoin?.nextSegmentIndex <= lastSegment
        ? segment.endJoin
        : null,
      transverseProfile,
      (intensity, position) => resolveCss(
        color,
        intensity,
        evaluateNumber(coverageProfile, position),
        longitudinalCoverage,
      ),
      gradientGroup?.segments,
    );
  }

  for (const cap of mesh.caps)
  {
    if (
      cap.segmentIndex < firstSegment ||
      cap.segmentIndex > lastSegment
    )
    {
      continue;
    }

    const color = resolveTrailPointEnergy(
      trailData,
      cap.pointIndex,
      trailCfg,
      layer.materialIntensity,
    );
    const transverseProfile = resolveTrailPointTransverseProfile(
      trailData,
      cap.pointIndex,
      trailCfg,
    );
    const coverageProfile = resolveTrailPointCoverageProfile(
      trailData,
      cap.pointIndex,
    );
    const longitudinalCoverage = resolveTrailPointCoverageFactor(
      trailData,
      cap.pointIndex,
      trailCfg,
    );

    fillTrailMeshCap(
      context,
      cap,
      transverseProfile,
      (intensity, position) => resolveCss(
        color,
        intensity,
        evaluateNumber(coverageProfile, position),
        longitudinalCoverage,
      ),
      gradientGroup?.caps,
    );
  }

  context.restore();
}

function hasPositiveTrailEnergy(energy)
{
  return Array.isArray(energy) && energy.some((channel) => channel > 0);
}

function hasDrawableNativeTrailEnergy(trailData, trailCfg)
{
  const segmentLengths = trailData.measurement.segmentLengths;
  const segmentEnergies = trailData.segmentEnergies;
  const pointCount = trailData.pointCount ?? segmentLengths?.length;

  if (
    !segmentLengths ||
    !Array.isArray(segmentEnergies) ||
    segmentLengths.length < pointCount || segmentEnergies.length < pointCount - 1
  )
  {
    // 缓存不完整时无法证明透明，继续绘制以兼容外部传入的帧数据。
    return true;
  }

  let startCapPointIndex = null;
  let endCapPointIndex = null;

  for (let index = 1; index < pointCount; index++)
  {
    if (segmentLengths[index] <= MIN_TRAIL_SEGMENT_LENGTH)
    {
      continue;
    }

    if (startCapPointIndex === null)
    {
      startCapPointIndex = index - 1;
    }

    endCapPointIndex = index;
    const energy = segmentEnergies[index - 1];

    if (!Array.isArray(energy) || hasPositiveTrailEnergy(energy))
    {
      return true;
    }
  }

  if (
    startCapPointIndex === null ||
    !(Math.floor(trailCfg.numCapVertices ?? 0) > 0)
  )
  {
    return false;
  }

  const startCapEnergy = trailData.pointEnergies?.[startCapPointIndex];
  const endCapEnergy = trailData.pointEnergies?.[endCapPointIndex];

  if (!Array.isArray(startCapEnergy) || !Array.isArray(endCapEnergy))
  {
    // 端帽可按需求值；缺少缓存时必须保守保留 Native 绘制。
    return true;
  }

  // 端帽绑定到首尾真实网格段，退化短段对应的全局端点不会参与绘制。
  return hasPositiveTrailEnergy(startCapEnergy) ||
    hasPositiveTrailEnergy(endCapEnergy);
}

/**
 * 将按真实弧长着色的发射带绘入局部缓冲，再整体模糊一次。
 * 不能使用首尾弦线性渐变：回环轨迹会把暗尾投影到高亮区，产生异常光晕。
 */
function drawNativeTrailBloom(
  context,
  points,
  trailData,
  scale,
  opacity,
  trailCfg,
  bloomCfg,
  surface,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const measurement = trailData.measurement;

  if (
    measurement.totalLength <= 0 ||
    opacity <= 0 ||
    bloomCfg.trailAlpha <= 0 ||
    bloomCfg.trailEmission <= 0 ||
    bloomCfg.trailEmissionAlpha <= 0 ||
    bloomCfg.intensity <= 0 ||
    typeof context.filter !== 'string' ||
    !surface?.context ||
    !hasDrawableNativeTrailEnergy(trailData, trailCfg)
  )
  {
    return;
  }

  // 只裁剪 Unity Stretch 的零能量前缀；宿主自定义可见 start cap 时保留完整范围。
  let firstVisibleSegmentOffset = -1;
  for (let index = 0; index < (trailData.segmentCount ?? trailData.segmentEnergies.length); index++)
  {
    if (trailData.segmentEnergies[index].some(channel => channel !== 0))
    {
      firstVisibleSegmentOffset = index;
      break;
    }
  }
  const startCapIsTransparent = trailData.pointEnergies[0]?.every(
    (channel) => channel === 0,
  ) === true;
  const firstVisibleSegment =
    startCapIsTransparent && firstVisibleSegmentOffset >= 0
      ? firstVisibleSegmentOffset + 1
      : 1;
  // 与 WebGL Bloom 的覆盖宽度保持一致；Native 直接模糊过窄几何会
  // 形成中心亮线和两侧断裂的光晕，尤其在低 DPR 下更明显。
  const bloomWidth = Math.max(0.5,
    trailCfg.geometryWidth * bloomCfg.trailCoverageScale);
  // GPU 金字塔的近场半径约为几何外扩的一半；过大的 Canvas blur
  // 会在高能量尾端叠成椭圆光斑，和 WebGL2/WebGPU 的细长拖尾不一致。
  const blurRadius = Math.max(0, trailCfg.outerGlowWidth * scale * 0.65);
  const halfWidth = bloomWidth * scale * 0.5;
  const margin = Math.ceil(blurRadius * 3 + halfWidth + 2);
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  const firstBoundPointIndex = firstVisibleSegment - 1;

  // 首个可见段仍需要前一个端点；更早的零能量点不应扩大局部模糊缓冲。
  for (let index = firstBoundPointIndex; index < points.length; index++)
  {
    const point = points[index];

    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }

  const originX = Math.floor(minimumX - margin);
  const originY = Math.floor(minimumY - margin);
  const regionWidth = Math.max(1, Math.ceil(maximumX + margin) - originX);
  const regionHeight = Math.max(1, Math.ceil(maximumY + margin) - originY);
  const dpr = Math.max(1, surface.dpr || 1);
  const requiredWidth = Math.max(1, Math.ceil(regionWidth * dpr));
  const requiredHeight = Math.max(1, Math.ceil(regionHeight * dpr));
  const canvas = surface.canvas;
  const bufferContext = surface.context;
  const capacityWidth = Math.max(
    canvas.width,
    2 ** Math.ceil(Math.log2(requiredWidth)),
  );
  const capacityHeight = Math.max(
    canvas.height,
    2 ** Math.ceil(Math.log2(requiredHeight)),
  );

  if (canvas.width !== capacityWidth || canvas.height !== capacityHeight)
  {
    canvas.width = capacityWidth;
    canvas.height = capacityHeight;
  }

  bufferContext.setTransform(1, 0, 0, 1, 0, 0);
  bufferContext.clearRect(0, 0, requiredWidth, requiredHeight);
  bufferContext.setTransform(
    dpr,
    0,
    0,
    dpr,
    -originX * dpr,
    -originY * dpr,
  );
  bufferContext.globalCompositeOperation = 'lighter';
  bufferContext.filter = 'none';
  drawTrailLayer(
    bufferContext,
    points,
    trailData,
    scale,
    opacity,
    trailCfg,
    {
      width: bloomWidth,
      gradientPurpose: 'native-bloom',
      gradientParameters: [bloomCfg, outputCompositing, overlayColorCompensation, overlayAlphaLimit],
      materialIntensity: bloomCfg.trailEmission,
      colorAtIntensity: (
        color,
        intensity,
        textureCoverage,
        longitudinalCoverage,
      ) =>
        linearEnergyToNativeTrailBloomCss(
          color,
          opacity,
          intensity,
          bloomCfg,
          outputCompositing,
          opacity * textureCoverage * longitudinalCoverage,
          overlayColorCompensation,
          overlayAlphaLimit,
        ),
    },
    firstVisibleSegment,
  );

  context.save();
  // Canvas filter 的 px 位于输出位图空间，不会随主 Context 的 DPR 变换放大。
  context.filter = `blur(${blurRadius * dpr}px)`;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.drawImage(
    canvas,
    0,
    0,
    requiredWidth,
    requiredHeight,
    originX,
    originY,
    regionWidth,
    regionHeight,
  );
  context.restore();
}

/**
 * main 分支风格的拖尾层：普通 Canvas 使用 sRGB，Final Pass 使用线性能量。
 * layer.color 为固定颜色时整条一次描边（round cap）；
 * 无 color 时按路径距离采样 gradient（butt cap 逐段）。
 */
function drawTrail(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  nativeBloomSurface = null,
  sharedTrailData = null,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );

  if (useNativeBloom)
  {
    drawNativeTrailBloom(
      context,
      points,
      trailData,
      scale,
      trailOpacity,
      trailCfg,
      bloomCfg,
      nativeBloomSurface,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  // Unity 只绘制一条 2px HDR 几何带；可见宽度由后续 Bloom 自然扩张。
  drawTrailLayer(context, points, trailData, scale, trailOpacity, trailCfg,
    {
      width: trailCfg.width,
      alpha: 1,
      gradientPurpose: 'clear',
      materialIntensity: bloomCfg.trailEmission,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    },
  );
}

function drawTrailCoverage(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const trailCfg = fxConfig.trail;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    1,
  );

  if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  drawTrailLayer(
    context,
    points,
    trailData,
    scale,
    1,
    trailCfg,
    {
      width: trailCfg.width,
      // Additive Shader 的目标 Alpha 固定为 1；透明适配层只保留实际
      gradientPurpose: 'coverage',
      gradientParameters: [trailOpacity],
      // TrailRenderer 几何与全局透明度，不混入材质 HDR 发射倍率。
      colorAtIntensity: (
        _color,
        _intensity,
        textureCoverage,
        longitudinalCoverage,
      ) => `rgba(255, 255, 255, ${clamp01(
        trailOpacity * textureCoverage * longitudinalCoverage,
      )})`,
    },
    segmentStart,
    segmentEnd,
  );
}

function drawTrailEmission(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0) *
    bloomCfg.trailEmissionAlpha;
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );
  const measurement = trailData.measurement;

  if (measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  const width = Math.max(
    0.5,
    trailCfg.geometryWidth * scale * bloomCfg.trailCoverageScale,
  );

  const firstSegment = clamp(
    Math.floor(segmentStart),
    1,
    points.length - 1,
  );
  const lastSegment = clamp(
    Math.floor(segmentEnd),
    firstSegment,
    points.length - 1,
  );

  drawTrailLayer(
    context,
    points,
    trailData,
    scale,
    1,
    trailCfg,
    {
      scaledWidth: width,
      alpha: 1,
      gradientPurpose: 'emission',
      gradientParameters: [trailOpacity, bloomCfg.emissionRange],
      materialIntensity: bloomCfg.trailEmission,
      colorAtIntensity: (color, intensity) =>
        linearEnergyToEmissionCss(
          color,
          trailOpacity * intensity,
          bloomCfg.emissionRange,
        ),
    },
    firstSegment,
    lastSegment,
  );
}

function appendTexturedTrailMeshSegment(
  renderer,
  segment,
  fromSample,
  toSample,
  opacity,
)
{
  // Unity BakeMesh 的屏幕下侧为语义 V=0；嵌入字节保持 PNG 顶行优先，
  // WebGL typed-array 上传不会代替图片源翻行，因此下侧需补偿到采样 v=1。
  renderer._addTrailMeshTriangle(
    segment.fromLeft, fromSample, 1,
    segment.toLeft, toSample, 1,
    segment.toRight, toSample, 0,
    opacity,
  );
  renderer._addTrailMeshTriangle(
    segment.fromLeft, fromSample, 1,
    segment.toRight, toSample, 0,
    segment.fromRight, fromSample, 0,
    opacity,
  );
}

function appendTexturedTrailMeshJoin(
  renderer,
  join,
  sample,
  opacity,
)
{
  const innerV = join.innerSide === 'left' ? 1 : 0;
  const outerV = 1 - innerV;
  for (let arcIndex = 1; arcIndex < join.outerArc.length; arcIndex++)
  {
    // Unity 的圆角插入点只细分几何；同一折点的 Stretch U 必须保持不变。
    renderer._addTrailMeshTriangle(
      join.inner, sample, innerV,
      join.outerArc[arcIndex - 1], sample, outerV,
      join.outerArc[arcIndex], sample, outerV,
      opacity,
    );
  }
}

function appendTexturedTrailMeshCaps(
  renderer,
  mesh,
  visibleSegments,
  pointSamples,
  opacity,
)
{
  for (const cap of mesh.caps)
  {
    if (!visibleSegments.has(cap.segmentIndex))
    {
      continue;
    }

    const sample = pointSamples[cap.pointIndex];
    // numCapVertices=1 形成一个三角端帽；尖端位于纹理横截面中心。
    renderer._addTrailMeshTriangle(
      cap.points[0], sample, 1,
      cap.points[1], sample, cap.position === 'start' ? 0 : 0.5,
      cap.points[2], sample, cap.position === 'start' ? 0.5 : 0,
      opacity,
    );
  }
}

function appendTexturedTrailMeshJoins(
  renderer,
  mesh,
  visibleSegments,
  pointSamples,
  opacity,
)
{
  for (let segmentIndex = 1; segmentIndex < mesh.segments.length; segmentIndex++)
  {
    const join = mesh.segments[segmentIndex]?.endJoin;

    if (
      !join ||
      !visibleSegments.has(segmentIndex) ||
      !visibleSegments.has(join.nextSegmentIndex)
    )
    {
      continue;
    }

    appendTexturedTrailMeshJoin(
      renderer,
      join,
      pointSamples[segmentIndex],
      opacity,
    );
  }
}

function getTrailGpuPointSamples(trailData, points, trailCfg, materialIntensity)
{
  const cached = trailData.gpuPointCache;
  if (cached && cached.version === trailData.version && cached.trailCfg === trailCfg && cached.materialIntensity === materialIntensity &&
    cached.hueShift === themeHueShift && cached.relativeTheme === relativeOklchTheme)
  {
    return cached.samples;
  }

  const work = cached ?? { samples: [], pool: [] };
  const samples = work.samples;
  samples.length = points.length;
  for (let index = 0; index < points.length; index++)
  {
    const progress = trailData.pointProgresses?.[index] ??
      trailData.measurement.distances[index] / trailData.measurement.totalLength;
    const sample = work.pool[index] ??= { color: [0, 0, 0] };
    samples[index] = sample;
    // 点集版本由 trailData 管理；保持先插值再映射主题，不能插值已映射的关键帧。
    // Unity 的 U=0 位于最新点，项目点序则是旧点到新点。
    sample.u = 1 - progress;
    evaluateTrailMaterialColor(progress, trailCfg, materialIntensity, sample.color);
    sample.coverage = resolveTrailPointCoverageFactor(trailData, index, trailCfg);
  }
  work.version = trailData.version;
  work.trailCfg = trailCfg; work.materialIntensity = materialIntensity;
  work.hueShift = themeHueShift; work.relativeTheme = relativeOklchTheme;
  trailData.gpuPointCache = work;
  return samples;
}

function appendTrailWebGLScene(
  renderer,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );
  const width = trailCfg.width * scale;

  if (
    trailData.measurement.totalLength <= 0 ||
    trailOpacity <= 0 ||
    width <= 0
  )
  {
    return;
  }

  const mesh = getTrailMesh(trailData, points, width, trailCfg);
  if (!mesh.visibleSegments)
  {
    // 可见段只依赖该宽度的网格；缩放或端帽配置改变时由网格缓存选择新对象。
    mesh.visibleSegments = new Set();
    for (let index = 1; index < points.length; index++)
    {
      if (mesh.segments[index])
      {
        mesh.visibleSegments.add(index);
      }
    }
  }
  const visibleSegments = mesh.visibleSegments;
  const pointSamples = getTrailGpuPointSamples(trailData, points, trailCfg, bloomCfg.trailEmission);

  for (const index of visibleSegments)
  {
    const segment = mesh.segments[index];
    appendTexturedTrailMeshSegment(
      renderer,
      segment,
      pointSamples[index - 1],
      pointSamples[index],
      trailOpacity,
    );
  }

  appendTexturedTrailMeshJoins(
    renderer,
    mesh,
    visibleSegments,
    pointSamples,
    trailOpacity,
  );
  appendTexturedTrailMeshCaps(
    renderer,
    mesh,
    visibleSegments,
    pointSamples,
    trailOpacity,
  );
}

function appendTrailWebGLBloom(
  renderer,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0) *
    bloomCfg.trailEmissionAlpha;
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );

  if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  const width = Math.max(
    0.5,
    trailCfg.geometryWidth * scale * bloomCfg.trailCoverageScale,
  );
  const emissionQuantizationScale = trailOpacity /
    Math.max(1, bloomCfg.emissionRange) * 255;

  for (let index = 1; index < points.length; index++)
  {
    // Software 参考实现先经过 8-bit Canvas 发射遮罩；保留相同的半量化裁剪，
    // 避免 WebGL2 在轨迹尾端额外显示参考实现中不存在的微弱光晕。
    if (
      trailData.segmentMaximumEnergies[index - 1] *
        emissionQuantizationScale < 0.5
    )
    {
      continue;
    }

    const energy = trailData.segmentEnergies[index - 1];

    renderer.addTrailSegment(
      points[index - 1],
      points[index],
      width,
      energy,
      trailOpacity,
      trailData.segmentTransverseProfiles[index - 1],
    );
  }
}

export { TRAIL_GRADIENT_CACHE_CAPACITY, hasVisibleTrailPoints, interpolateTrailColor, createTrailFrameData, evaluateTrailLinearEnergy, evaluateTrailMaterialColor, writeTrailProfilePoint, evaluateTrailTransverseProfile, getTrailGradientGroup, cachedTrailGradient, resolveTrailTransverseProfile, createTrailCrossSectionGradient, fillTrailMeshSegment, fillTrailMeshCap, resolveTrailPointEnergy, resolveTrailPointTransverseProfile, resolveTrailPointCoverageFactor, resolveTrailPointCoverageProfile, drawTrailLayer, hasPositiveTrailEnergy, hasDrawableNativeTrailEnergy, drawNativeTrailBloom, drawTrail, drawTrailCoverage, drawTrailEmission, appendTexturedTrailMeshSegment, appendTexturedTrailMeshJoin, appendTexturedTrailMeshCaps, appendTexturedTrailMeshJoins, getTrailGpuPointSamples, appendTrailWebGLScene, appendTrailWebGLBloom };
