import { BUILD_TRAIL, BUILD_CLICK, BUILD_SHARDS, BUILD_BLOOM, BUILD_REFERENCE } from './build-capabilities.js';
import { resolveTriangleTextureFrame } from './triangle-texture.js';
import { RING_MESH_VERTICES, RING_MESH_INDICES, RING_MESH_UV_MIN, RING_MESH_UV_MAX, RING_MESH_OUTER_RADIUS } from './ring-mesh.js';

// 将 Unity 网格接缝和 Y 轴映射到屏幕坐标，两个后端必须使用相同运算顺序。
const ringSeamX = RING_MESH_VERTICES[129 * 5];

const ringSeamY = RING_MESH_VERTICES[129 * 5 + 1];

const ringSeamRadius = Math.hypot(ringSeamX, ringSeamY);

const ringSeamCosine = ringSeamX / ringSeamRadius;

const ringSeamSine = ringSeamY / ringSeamRadius;

const COMPONENTS_PER_VERTEX = 6;

const COMPONENTS_PER_DISK_VERTEX = 8;

const COMPONENTS_PER_RING_VERTEX = 9;

const COMPONENTS_PER_TRIANGLE_VERTEX = 9;

const COMPONENTS_PER_TRAIL_VERTEX = 9;

const INITIAL_VERTEX_CAPACITY = 4096;

const MAX_PYRAMID_LEVELS = 16;

const DISK_CENTER_RADIUS_EPSILON = 0.00001;

const DISK_TEXTURE_RADIAL_STOPS = Object.freeze(
  [
    // position, R_linear (Alpha), R_linear² (RGB energy)
    [0, 1, 1],
    [0.84, 1, 1],
    [0.88, 1, 1],
    [0.885, 0.356400144, 0.127021063],
    [0.89, 0.171441101, 0.029392051],
    [0.895, 0.102241733, 0.010453372],
    [0.9, 0.063010018, 0.003970262],
    [0.905, 0.015208514, 0.000231299],
    [0.91, 0.005181517, 0.000026848],
    [0.915, 0.001517635, 0.000002303],
    [0.92, 0, 0],
    [1, 0, 0],
  ],
);

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

export class EffectGeometry
{
  constructor(canvas)
  {
    this.canvas = canvas;
    // 两种 WebGL2 模式共享完整 Scene，避免清晰层和 Bloom 分层输出产生色差。
    this.sceneEnabled = true;
    this.gl = null;
    this.available = false;
    this.contextLost = false;
    this.displayWidth = 1;
    this.displayHeight = 1;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resolutionScale = 0;
    this.diffusion = 0;
    this.sampleScale = 1;
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.vertexCount = 0;
    this.vertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_VERTEX,
    );
    this.sceneDiskVertexCount = 0;
    this.sceneDiskVertexData = new Float32Array((BUILD_CLICK) ? INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_DISK_VERTEX : 0);
    this.ringVertexCount = 0;
    this.ringVertexData = new Float32Array((BUILD_CLICK) ? INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_RING_VERTEX : 0);
    this._ringCosine = null;
    this._ringSine = null;
    this.ringIndexCount = 0;
    this.ringIndexData = new Uint32Array(0);
    this._ringTopology = [];
    this._ringTopologyCount = 0;
    this._ringPreparedTopologyCount = 0;
    this._ringTopologyDirty = false;
    this._ringIndexVersion = 0;
    this._ringUploadedIndexVersion = -1;
    this.triangleVertexCount = 0;
    this.triangleVertexData = new Float32Array(BUILD_SHARDS ? INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_TRIANGLE_VERTEX : 0);
    this.trailVertexCount = 0;
    this.trailVertexData = new Float32Array((BUILD_TRAIL) ? INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_TRAIL_VERTEX : 0);
    this.sourceTarget = null;
    // 非默认点击辉光倍率需要与清晰 Scene 分离；默认值不额外占用显存。
    this.bloomSourceTarget = null;
    this.sceneOverlayTarget = null;
    this.levels = [];
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneOverlayFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.sceneBackgroundSource = null;
    this.sceneBackgroundWidth = 0;
    this.sceneBackgroundHeight = 0;
    this.sceneBackgroundUploadRetryPending = false;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundTarget = null;
    this.failedResizeSignature = null;
    this.programs = null;

    this.stats =
    {
      vertexCount: 0,
      sceneVertexCount: 0,
      sceneDiskVertexCount: 0,
      sceneRingVertexCount: 0,
      sceneTriangleVertexCount: 0,
      sceneTrailVertexCount: 0,
      diskVertexCount: 0,
      ringVertexCount: 0,
      triangleVertexCount: 0,
      trailVertexCount: 0,
      levelCount: 0,
      bloomPixels: 0,
    };


  }
  get hasSceneBackground()
  {
    return this.sceneBackgroundSource !== null;
  }

  beginFrame(options = {})
  {
    this.vertexCount = 0;
    this.sceneDiskVertexCount = 0;
    this.ringVertexCount = 0;
    this.ringIndexCount = 0;
    this._ringTopologyCount = 0;
    this.triangleVertexCount = 0;
    this.trailVertexCount = 0;
    this.stats.vertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
    this.stats.trailVertexCount = 0;

    if (options.preserveSceneStats !== true)
    {
      this.sceneFrameReady = false;
      this.bloomSourceFrameReady = false;
      this.sceneOverlayFrameReady = false;
      this.sceneBackgroundFrameReady = false;
      this.stats.sceneVertexCount = 0;
      this.stats.sceneDiskVertexCount = 0;
      this.stats.sceneRingVertexCount = 0;
      this.stats.sceneTriangleVertexCount = 0;
      this.stats.sceneTrailVertexCount = 0;
    }
  }

  _hasGeometry()
  {
    return this.vertexCount > 0 ||
      this.sceneDiskVertexCount > 0 ||
      this.ringVertexCount > 0 ||
      this.triangleVertexCount > 0 ||
      this.trailVertexCount > 0;
  }

  _ensureVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.vertexCount + additionalVertices
    ) * COMPONENTS_PER_VERTEX;

    if (requiredComponents <= this.vertexData.length)
    {
      return;
    }

    let nextLength = this.vertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.vertexData.subarray(
      0,
      this.vertexCount * COMPONENTS_PER_VERTEX,
    ));
    this.vertexData = next;
  }

  _appendVertex(x, y, red, green, blue, coverage)
  {
    const offset = this.vertexCount * COMPONENTS_PER_VERTEX;

    this.vertexData[offset] = x;
    this.vertexData[offset + 1] = y;
    this.vertexData[offset + 2] = Math.max(0, red);
    this.vertexData[offset + 3] = Math.max(0, green);
    this.vertexData[offset + 4] = Math.max(0, blue);
    this.vertexData[offset + 5] = clamp(coverage, 0, 1);
    this.vertexCount++;
  }

  _ensureSceneDiskVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.sceneDiskVertexCount + additionalVertices
    ) * COMPONENTS_PER_DISK_VERTEX;

    if (requiredComponents <= this.sceneDiskVertexData.length)
    {
      return;
    }

    let nextLength = this.sceneDiskVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.sceneDiskVertexData.subarray(
      0,
      this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX,
    ));
    this.sceneDiskVertexData = next;
  }

  _appendSceneDiskVertex(
    x,
    y,
    u,
    v,
    red,
    green,
    blue,
    particleAlpha,
  )
  {
    const offset = this.sceneDiskVertexCount *
      COMPONENTS_PER_DISK_VERTEX;

    this.sceneDiskVertexData[offset] = x;
    this.sceneDiskVertexData[offset + 1] = y;
    this.sceneDiskVertexData[offset + 2] = u;
    this.sceneDiskVertexData[offset + 3] = v;
    this.sceneDiskVertexData[offset + 4] = Math.max(0, red);
    this.sceneDiskVertexData[offset + 5] = Math.max(0, green);
    this.sceneDiskVertexData[offset + 6] = Math.max(0, blue);
    this.sceneDiskVertexData[offset + 7] = clamp(particleAlpha, 0, 1);
    this.sceneDiskVertexCount++;
  }

  _ensureRingVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.ringVertexCount + additionalVertices
    ) * COMPONENTS_PER_RING_VERTEX;

    if (requiredComponents <= this.ringVertexData.length)
    {
      return;
    }

    let nextLength = this.ringVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.ringVertexData.subarray(
      0,
      this.ringVertexCount * COMPONENTS_PER_RING_VERTEX,
    ));
    this.ringVertexData = next;
  }

  _prepareRingIndices()
  {
    if (!this._ringTopologyDirty && this._ringPreparedTopologyCount === this._ringTopologyCount)
    {
      return;
    }
    if (this.ringIndexData.length < this.ringIndexCount)
    {
      let capacity = Math.max(1, this.ringIndexData.length);
      while (capacity < this.ringIndexCount) capacity = Math.ceil(capacity * 1.5);
      this.ringIndexData = new Uint32Array(capacity);
    }
    let offset = 0;
    for (let ring = 0; ring < this._ringTopologyCount; ring++)
    {
      const { bands, segments, base, template } = this._ringTopology[ring];
      if (template)
      {
        for (const index of RING_MESH_INDICES) this.ringIndexData[offset++] = base + index;
        continue;
      }
      const stride = segments + 1;
      for (let band = 0; band < bands; band++)
      {
        for (let segment = 0; segment < segments; segment++)
        {
          const inner = base + band * stride + segment;
          const outer = inner + stride;
          // 展开后仍为原来的两个三角；接缝 U 不同的顶点分别保留。
          this.ringIndexData[offset++] = inner;
          this.ringIndexData[offset++] = inner + 1;
          this.ringIndexData[offset++] = outer + 1;
          this.ringIndexData[offset++] = inner;
          this.ringIndexData[offset++] = outer + 1;
          this.ringIndexData[offset++] = outer;
        }
      }
    }
    this._ringTopology.length = this._ringTopologyCount;
    this._ringPreparedTopologyCount = this._ringTopologyCount;
    this._ringTopologyDirty = false;
    this._ringIndexVersion++;
  }

  _appendRingVertex(
    x,
    y,
    u,
    v,
    red,
    green,
    blue,
    dissolveThreshold,
    coverageOpacity,
  )
  {
    const offset = this.ringVertexCount * COMPONENTS_PER_RING_VERTEX;

    this.ringVertexData[offset] = x;
    this.ringVertexData[offset + 1] = y;
    this.ringVertexData[offset + 2] = u;
    this.ringVertexData[offset + 3] = v;
    this.ringVertexData[offset + 4] = Math.max(0, red);
    this.ringVertexData[offset + 5] = Math.max(0, green);
    this.ringVertexData[offset + 6] = Math.max(0, blue);
    this.ringVertexData[offset + 7] = clamp(dissolveThreshold, 0, 1);
    this.ringVertexData[offset + 8] = clamp(coverageOpacity, 0, 1);
    this.ringVertexCount++;
  }

  _ensureTriangleVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.triangleVertexCount + additionalVertices
    ) * COMPONENTS_PER_TRIANGLE_VERTEX;

    if (requiredComponents <= this.triangleVertexData.length)
    {
      return;
    }

    let nextLength = this.triangleVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.triangleVertexData.subarray(
      0,
      this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX,
    ));
    this.triangleVertexData = next;
  }

  _appendTriangleVertex(
    x,
    y,
    u,
    v,
    red,
    green,
    blue,
    particleAlpha,
    roundness = 0,
  )
  {
    const offset = this.triangleVertexCount *
      COMPONENTS_PER_TRIANGLE_VERTEX;

    this.triangleVertexData[offset] = x;
    this.triangleVertexData[offset + 1] = y;
    this.triangleVertexData[offset + 2] = u;
    this.triangleVertexData[offset + 3] = v;
    this.triangleVertexData[offset + 4] = Math.max(0, red);
    this.triangleVertexData[offset + 5] = Math.max(0, green);
    this.triangleVertexData[offset + 6] = Math.max(0, blue);
    this.triangleVertexData[offset + 7] = clamp(particleAlpha, 0, 1);
    this.triangleVertexData[offset + 8] = clamp(roundness, 0, 1);
    this.triangleVertexCount++;
  }

  _ensureTrailVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.trailVertexCount + additionalVertices
    ) * COMPONENTS_PER_TRAIL_VERTEX;

    if (requiredComponents <= this.trailVertexData.length)
    {
      return;
    }

    let nextLength = this.trailVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.trailVertexData.subarray(
      0,
      this.trailVertexCount * COMPONENTS_PER_TRAIL_VERTEX,
    ));
    this.trailVertexData = next;
  }

  _appendTrailVertex(point, uv, color, particleAlpha, coverageFactor)
  {
    this._appendTrailVertexValues(point.x, point.y, uv.u, uv.v, color, particleAlpha, coverageFactor);
  }

  _appendTrailVertexValues(x, y, u, v, color, particleAlpha, coverageFactor)
  {
    const offset = this.trailVertexCount * COMPONENTS_PER_TRAIL_VERTEX;

    this.trailVertexData[offset] = x;
    this.trailVertexData[offset + 1] = y;
    this.trailVertexData[offset + 2] = u;
    this.trailVertexData[offset + 3] = v;
    this.trailVertexData[offset + 4] = Math.max(0, color[0]);
    this.trailVertexData[offset + 5] = Math.max(0, color[1]);
    this.trailVertexData[offset + 6] = Math.max(0, color[2]);
    this.trailVertexData[offset + 7] = clamp(particleAlpha, 0, 1);
    this.trailVertexData[offset + 8] = clamp(coverageFactor, 0, 1);
    this.trailVertexCount++;
  }

  _appendRadialDisk(
    x,
    y,
    radius,
    segmentCount,
    ensureCapacity,
    appendVertex,
  )
  {
    const segments = clamp(Math.round(segmentCount), 24, 128);
    const angleStep = Math.PI * 2 / segments;
    const cosineStep = Math.cos(angleStep);
    const sineStep = Math.sin(angleStep);
    let verticesPerSegment = 0;

    for (
      let ringIndex = 0;
      ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1;
      ringIndex++
    )
    {
      const innerRadius = radius * DISK_TEXTURE_RADIAL_STOPS[ringIndex][0];

      verticesPerSegment += innerRadius <= DISK_CENTER_RADIUS_EPSILON ? 3 : 6;
    }

    ensureCapacity(segments * verticesPerSegment);

    for (
      let ringIndex = 0;
      ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1;
      ringIndex++
    )
    {
      const inner = DISK_TEXTURE_RADIAL_STOPS[ringIndex];
      const outer = DISK_TEXTURE_RADIAL_STOPS[ringIndex + 1];
      const innerRadius = radius * inner[0];
      const outerRadius = radius * outer[0];
      let startCosine = 1;
      let startSine = 0;

      for (let segment = 0; segment < segments; segment++)
      {
        const lastSegment = segment === segments - 1;
        const endCosine = lastSegment
          ? 1
          : startCosine * cosineStep - startSine * sineStep;
        const endSine = lastSegment
          ? 0
          : startSine * cosineStep + startCosine * sineStep;
        const innerStartX = x + startCosine * innerRadius;
        const innerStartY = y + startSine * innerRadius;
        const innerEndX = x + endCosine * innerRadius;
        const innerEndY = y + endSine * innerRadius;
        const outerStartX = x + startCosine * outerRadius;
        const outerStartY = y + startSine * outerRadius;
        const outerEndX = x + endCosine * outerRadius;
        const outerEndY = y + endSine * outerRadius;

        if (innerRadius <= DISK_CENTER_RADIUS_EPSILON)
        {
          appendVertex(x, y, inner[1], inner[2]);
          appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
          appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
          startCosine = endCosine;
          startSine = endSine;
          continue;
        }

        appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
        appendVertex(innerEndX, innerEndY, inner[1], inner[2]);
        appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
        appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
        appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
        appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
        startCosine = endCosine;
        startSine = endSine;
      }
    }
  }

  addSolidDisk(x, y, radius, color, opacity = 1, segmentCount = 48)
  {
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (radius <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    const segments = clamp(Math.round(segmentCount), 16, 128);
    const angleStep = Math.PI * 2 / segments;

    this._ensureVertexCapacity(segments * 3);

    for (let segment = 0; segment < segments; segment++)
    {
      const startAngle = segment * angleStep;
      const endAngle = (segment + 1) * angleStep;

      this._appendVertex(x, y, red, green, blue, opacity);
      this._appendVertex(
        x + Math.cos(endAngle) * radius,
        y + Math.sin(endAngle) * radius,
        red,
        green,
        blue,
        opacity,
      );
      this._appendVertex(
        x + Math.cos(startAngle) * radius,
        y + Math.sin(startAngle) * radius,
        red,
        green,
        blue,
        opacity,
      );
    }
  }

  addDisk(x, y, radius, color, opacity = 1, segmentCount = 64)
  {
    if (!(BUILD_CLICK)) return false;

    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (radius <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    // 每对相邻 stop 都生成一条径向带；共享构建器保证 Scene 与 Bloom 纹理一致。
    this._appendRadialDisk(
      x,
      y,
      radius,
      segmentCount,
      (count) => this._ensureVertexCapacity(count),
      (vertexX, vertexY, textureAlpha, energy) =>
      {
        this._appendVertex(
          vertexX,
          vertexY,
          red * energy,
          green * energy,
          blue * energy,
          opacity * textureAlpha,
        );
      },
    );
  }

  addAlphaBlendDisk(
    x,
    y,
    radius,
    color,
    opacity = 1,
    particleAlpha = 1,
    rotation = 0,
    segmentCount = 64,
  )
  {
    if (!(BUILD_CLICK)) return false;

    // 解包 Shader 的 vertex.a 只进入输出 Alpha，不能削弱 HDR RGB 或 Bloom。
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;
    const coverageOpacity = opacity * particleAlpha;

    if (
      radius <= 0 ||
      Math.max(red, green, blue) <= 0
    )
    {
      return;
    }

    // segmentCount 仅为旧调用兼容保留；Unity Billboard 本身始终是一个 Quad。
    void segmentCount;

    const angle = Number.isFinite(rotation) ? rotation : 0;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const appendCorner = (localX, localY, u, v) =>
    {
      this._appendSceneDiskVertex(
        x + localX * cosine - localY * sine,
        y + localX * sine + localY * cosine,
        u,
        v,
        red,
        green,
        blue,
        coverageOpacity,
      );
    };

    // PNG 数据按顶行到末行保存，屏幕上边沿因此对应 V=0。
    this._ensureSceneDiskVertexCapacity(6);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, -radius, 1, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, radius, 0, 1);
  }

  addSceneDisk(
    x,
    y,
    radius,
    color,
    opacity = 1,
    particleAlpha = 1,
    rotation = 0,
    segmentCount = 64,
  )
  {
    if (!(BUILD_CLICK)) return false;

    // 保留旧名称供现有宿主适配；批次本身不再依赖完整 Scene 模式。
    this.addAlphaBlendDisk(
      x,
      y,
      radius,
      color,
      opacity,
      particleAlpha,
      rotation,
      segmentCount,
    );
  }

  addTriangle(
    x,
    y,
    size,
    rotation,
    color,
    opacity = 1,
    textureFrame = 0,
    roundness = 0,
  )
  {
    if (!BUILD_SHARDS) return false;

    const particleAlpha = Number.isFinite(opacity)
      ? clamp(opacity, 0, 1)
      : 0;
    const red = Math.max(0, color?.[0] ?? 0);
    const green = Math.max(0, color?.[1] ?? 0);
    const blue = Math.max(0, color?.[2] ?? 0);

    if (
      size <= 0 ||
      particleAlpha <= 0 ||
      Math.max(red, green, blue) <= 0
    )
    {
      return;
    }

    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const halfSize = size * 0.5;
    const rotatePoint = (localX, localY) =>
    ({
      x: x + localX * cosine - localY * sine,
      y: y + localX * sine + localY * cosine,
    });
    const topLeft = rotatePoint(-halfSize, -halfSize);
    const topRight = rotatePoint(halfSize, -halfSize);
    const bottomRight = rotatePoint(halfSize, halfSize);
    const bottomLeft = rotatePoint(-halfSize, halfSize);
    const frame = resolveTriangleTextureFrame(textureFrame);
    const topV = frame === 1 ? 1 : 0;
    const bottomV = frame === 1 ? 0 : 1;

    // 原始粒子使用完整方形 Mesh；透明轮廓完全由纹理 RGBA 决定。
    this._ensureTriangleVertexCapacity(6);
    this._appendTriangleVertex(
      topLeft.x,
      topLeft.y,
      0,
      topV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
    this._appendTriangleVertex(
      topRight.x,
      topRight.y,
      1,
      topV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
    this._appendTriangleVertex(
      bottomRight.x,
      bottomRight.y,
      1,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
    this._appendTriangleVertex(
      topLeft.x,
      topLeft.y,
      0,
      topV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
    this._appendTriangleVertex(
      bottomRight.x,
      bottomRight.y,
      1,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
    this._appendTriangleVertex(
      bottomLeft.x,
      bottomLeft.y,
      0,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
      roundness,
    );
  }

  addTexturedTrailTriangle(
    first,
    second,
    third,
    color,
    opacity = 1,
    coverageFactor = 1,
  )
  {
    if (!(BUILD_TRAIL)) return false;

    const perVertexColor = Array.isArray(color?.[0]);
    const firstColor = perVertexColor ? color[0] : color;
    const secondColor = perVertexColor ? color[1] : color;
    const thirdColor = perVertexColor ? color[2] : color;
    const particleAlpha = Number.isFinite(opacity)
      ? clamp(opacity, 0, 1)
      : 0;
    const perVertexCoverage = Array.isArray(coverageFactor);
    const firstCoverage = perVertexCoverage
      ? coverageFactor[0]
      : coverageFactor;
    const secondCoverage = perVertexCoverage
      ? coverageFactor[1]
      : coverageFactor;
    const thirdCoverage = perVertexCoverage
      ? coverageFactor[2]
      : coverageFactor;

    if (
      particleAlpha <= 0 ||
      Math.max(
        firstCoverage,
        secondCoverage,
        thirdCoverage,
      ) <= 0
    )
    {
      return;
    }

    this._ensureTrailVertexCapacity(3);
    this._appendTrailVertex(
      first,
      first,
      firstColor,
      particleAlpha,
      firstCoverage,
    );
    this._appendTrailVertex(
      second,
      second,
      secondColor,
      particleAlpha,
      secondCoverage,
    );
    this._appendTrailVertex(
      third,
      third,
      thirdColor,
      particleAlpha,
      thirdCoverage,
    );
  }

  _addTrailMeshTriangle(first, firstSample, firstV, second, secondSample, secondV,
    third, thirdSample, thirdV, opacity)
  {
    if (!(BUILD_TRAIL)) return false;

    const particleAlpha = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 0;
    if (particleAlpha <= 0 ||
      Math.max(firstSample.coverage, secondSample.coverage, thirdSample.coverage) <= 0)
    {
      return;
    }
    // 网格与逐点样本已经缓存，直接写入相同布局，避免逐三角包装位置、颜色和 Coverage。
    this._ensureTrailVertexCapacity(3);
    this._appendTrailVertexValues(first.x, first.y, firstSample.u, firstV,
      firstSample.color, particleAlpha, firstSample.coverage);
    this._appendTrailVertexValues(second.x, second.y, secondSample.u, secondV,
      secondSample.color, particleAlpha, secondSample.coverage);
    this._appendTrailVertexValues(third.x, third.y, thirdSample.u, thirdV,
      thirdSample.color, particleAlpha, thirdSample.coverage);
  }

  addTrailTriangle(first, second, third, color, opacity = 1)
  {
    if (!(BUILD_TRAIL)) return false;

    const perVertexColor = Array.isArray(color?.[0]);
    const firstColor = perVertexColor ? color[0] : color;
    const secondColor = perVertexColor ? color[1] : color;
    const thirdColor = perVertexColor ? color[2] : color;
    const firstRed = firstColor[0] * opacity;
    const firstGreen = firstColor[1] * opacity;
    const firstBlue = firstColor[2] * opacity;
    const secondRed = secondColor[0] * opacity;
    const secondGreen = secondColor[1] * opacity;
    const secondBlue = secondColor[2] * opacity;
    const thirdRed = thirdColor[0] * opacity;
    const thirdGreen = thirdColor[1] * opacity;
    const thirdBlue = thirdColor[2] * opacity;

    if (
      Math.max(
        firstRed,
        firstGreen,
        firstBlue,
        secondRed,
        secondGreen,
        secondBlue,
        thirdRed,
        thirdGreen,
        thirdBlue,
      ) <= 0
    )
    {
      return;
    }

    // 三顶点颜色让内外角 fan 延续横截面纹理插值，数值保持在线性空间。
    this._ensureVertexCapacity(3);
    this._appendVertex(
      first.x,
      first.y,
      firstRed,
      firstGreen,
      firstBlue,
      opacity,
    );
    this._appendVertex(
      second.x,
      second.y,
      secondRed,
      secondGreen,
      secondBlue,
      opacity,
    );
    this._appendVertex(
      third.x,
      third.y,
      thirdRed,
      thirdGreen,
      thirdBlue,
      opacity,
    );
  }

  addDissolveRing(
    x,
    y,
    radius,
    width,
    rotation,
    radialSamples,
    segmentCount,
    materialColor,
    opacity,
    dissolveThreshold,
    textureUvMin,
    textureUvMax,
    dissolveDirection,
  )
  {
    if (!(BUILD_CLICK)) return false;

    const red = materialColor[0] * opacity;
    const green = materialColor[1] * opacity;
    const blue = materialColor[2] * opacity;

    if (
      radius <= 0 ||
      width <= 0 ||
      Math.max(red, green, blue) <= 0
    )
    {
      return;
    }

    const bands = clamp(Math.round(radialSamples), 1, 32);
    const segments = clamp(Math.round(segmentCount), 32, 512);
    const template = bands === 1 && segments === 64;
    const innerEdge = Math.max(0, radius - width * 0.5);
    const bandWidth = width / bands;
    if (!this._ringCosine || this._ringCosine.length < segments + 1)
    {
      // 工作表只随采样容量增长；逐环复用，避免每帧产生短命 TypedArray。
      this._ringCosine = new Float64Array(segments + 1);
      this._ringSine = new Float64Array(segments + 1);
    }
    const cosine = this._ringCosine;
    const sine = this._ringSine;
    const coverageOpacity = clamp(opacity, 0, 1);
    const safeThreshold = Number.isFinite(dissolveThreshold)
      ? clamp(dissolveThreshold, 0, 1)
      : 1;
    const safeUvMin = Number.isFinite(textureUvMin)
      ? clamp(textureUvMin, 0, 1)
      : 0;
    const safeUvMax = Number.isFinite(textureUvMax)
      ? clamp(textureUvMax, 0, 1)
      : 1;
    const uvSpan = safeUvMax - safeUvMin;
    const direction = dissolveDirection >= 0 ? 1 : -1;

    for (let segment = 0; segment <= segments; segment++)
    {
      const angularProgress = segment / segments;
      const angle = rotation + angularProgress * Math.PI * 2;

      cosine[segment] = Math.cos(angle);
      sine[segment] = Math.sin(angle);
    }

    const base = this.ringVertexCount;
    const slot = this._ringTopologyCount++;
    const previous = this._ringTopology[slot];
    if (!previous || previous.bands !== bands || previous.segments !== segments || previous.base !== base || previous.template !== template)
    {
      this._ringTopology[slot] = { bands, segments, base, template };
      this._ringTopologyDirty = true;
    }
    this.ringIndexCount += bands * segments * 6;
    this._ensureRingVertexCapacity((bands + 1) * (segments + 1));

    if (template)
    {
      const rotationCosine = Math.cos(rotation);
      const rotationSine = Math.sin(rotation);
      const sourceUvSpan = RING_MESH_UV_MAX - RING_MESH_UV_MIN;
      for (let index = 0; index < RING_MESH_VERTICES.length; index += 5)
      {
        const sourceX = RING_MESH_VERTICES[index];
        const sourceY = RING_MESH_VERTICES[index + 1];
        const u = (RING_MESH_VERTICES[index + 3] - RING_MESH_UV_MIN) / sourceUvSpan;
        const v = (RING_MESH_VERTICES[index + 4] - RING_MESH_UV_MIN) / sourceUvSpan;
        const sourceRadius = v > 0.5 ? RING_MESH_OUTER_RADIUS : 1;
        const radialScale = (innerEdge + width * v) / sourceRadius;
        const localX = (sourceX * ringSeamCosine + sourceY * ringSeamSine) * radialScale;
        const localY = (sourceX * ringSeamSine - sourceY * ringSeamCosine) * radialScale;
        this._appendRingVertex(
          x + localX * rotationCosine - localY * rotationSine,
          y + localX * rotationSine + localY * rotationCosine,
          safeUvMin + uvSpan * (direction > 0 ? u : 1 - u),
          safeUvMin + uvSpan * v,
          red, green, blue, safeThreshold, coverageOpacity,
        );
      }
      return;
    }

    // 按径向行保存唯一顶点；每一行的末端仍单独计算原来的角度和 UV。
    for (let band = 0; band <= bands; band++)
    {
      const sampleRadius = innerEdge + bandWidth * band;
      const v = safeUvMin + uvSpan * band / bands;
      for (let segment = 0; segment <= segments; segment++)
      {
        const progress = segment / segments;
        const textureProgress = direction > 0 ? progress : 1 - progress;
        this._appendRingVertex(
          x + cosine[segment] * sampleRadius,
          y + sine[segment] * sampleRadius,
          safeUvMin + uvSpan * textureProgress,
          v,
          red,
          green,
          blue,
          safeThreshold,
          coverageOpacity,
        );
      }
    }
  }

  addRing(
    x,
    y,
    radius,
    width,
    rotation,
    radialSamples,
    segmentCount,
    materialColor,
    opacity,
    sampleLuminance,
  )
  {
    if (!(BUILD_CLICK)) return false;

    if (width <= 0 || opacity <= 0)
    {
      return;
    }

    const bands = clamp(Math.round(radialSamples), 1, 32);
    const segments = clamp(Math.round(segmentCount), 32, 512);
    const innerEdge = Math.max(0, radius - width * 0.5);
    const bandWidth = width / bands;
    const red = materialColor[0] * opacity;
    const green = materialColor[1] * opacity;
    const blue = materialColor[2] * opacity;
    const angleStep = Math.PI * 2 / segments;
    const cosineStep = Math.cos(angleStep);
    const sineStep = Math.sin(angleStep);
    const rotationCosine = Math.cos(rotation);
    const rotationSine = Math.sin(rotation);

    // 溶解会跳过部分片元，但按最坏情况预留可避免数万顶点时反复扩容。
    this._ensureVertexCapacity(bands * segments * 6);

    for (let band = 0; band < bands; band++)
    {
      const innerRadius = innerEdge + bandWidth * band;
      const outerRadius = innerEdge + bandWidth * (band + 1);
      const radialProgress = (band + 0.5) / bands;
      let startCosine = rotationCosine;
      let startSine = rotationSine;
      let startLuminance = sampleLuminance(0, radialProgress);

      for (let segment = 0; segment < segments; segment++)
      {
        const endProgress = (segment + 1) / segments;
        const endLuminance = sampleLuminance(
          endProgress,
          radialProgress,
        );
        const lastSegment = segment === segments - 1;
        const endCosine = lastSegment
          ? rotationCosine
          : startCosine * cosineStep - startSine * sineStep;
        const endSine = lastSegment
          ? rotationSine
          : startSine * cosineStep + startCosine * sineStep;

        if (startLuminance <= 0 && endLuminance <= 0)
        {
          startCosine = endCosine;
          startSine = endSine;
          startLuminance = endLuminance;
          continue;
        }

        const startRed = red * startLuminance;
        const startGreen = green * startLuminance;
        const startBlue = blue * startLuminance;
        const endRed = red * endLuminance;
        const endGreen = green * endLuminance;
        const endBlue = blue * endLuminance;
        const innerStartX = x + startCosine * innerRadius;
        const innerStartY = y + startSine * innerRadius;
        const innerEndX = x + endCosine * innerRadius;
        const innerEndY = y + endSine * innerRadius;
        const outerStartX = x + startCosine * outerRadius;
        const outerStartY = y + startSine * outerRadius;
        const outerEndX = x + endCosine * outerRadius;
        const outerEndY = y + endSine * outerRadius;

        this._appendVertex(
          innerStartX,
          innerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        this._appendVertex(
          innerEndX,
          innerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          innerStartX,
          innerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          outerStartX,
          outerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        startCosine = endCosine;
        startSine = endSine;
        startLuminance = endLuminance;
      }
    }
  }

  addTrailSegment(
    from,
    to,
    width,
    color,
    opacity = 1,
    transverseProfile = null,
    fromOffset = null,
    toOffset = null,
    capStart = false,
    capEnd = false,
  )
  {

    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const length = Math.hypot(deltaX, deltaY);
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (length <= 0 || width <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    const profile = Array.isArray(transverseProfile) &&
        transverseProfile.length >= 2
      ? transverseProfile
      : [[0, 1], [1, 1]];
    const halfWidth = width * 0.5;
    const defaultOffset =
    {
      x: -deltaY / length * halfWidth,
      y: deltaX / length * halfWidth,
    };
    const startOffset = fromOffset ?? defaultOffset;
    const endOffset = toOffset ?? defaultOffset;

    this._ensureVertexCapacity(
      (profile.length - 1) * 6 +
        (capStart ? 3 : 0) +
        (capEnd ? 3 : 0),
    );

    for (let index = 1; index < profile.length; index++)
    {
      const previous = profile[index - 1];
      const current = profile[index];
      const previousOffsetScale = 1 - previous[0] * 2;
      const currentOffsetScale = 1 - current[0] * 2;
      const previousFromX = from.x +
        startOffset.x * previousOffsetScale;
      const previousFromY = from.y +
        startOffset.y * previousOffsetScale;
      const previousToX = to.x + endOffset.x * previousOffsetScale;
      const previousToY = to.y + endOffset.y * previousOffsetScale;
      const currentFromX = from.x + startOffset.x * currentOffsetScale;
      const currentFromY = from.y + startOffset.y * currentOffsetScale;
      const currentToX = to.x + endOffset.x * currentOffsetScale;
      const currentToY = to.y + endOffset.y * currentOffsetScale;
      const previousRed = red * previous[1];
      const previousGreen = green * previous[1];
      const previousBlue = blue * previous[1];
      const currentRed = red * current[1];
      const currentGreen = green * current[1];
      const currentBlue = blue * current[1];

      this._appendVertex(
        previousFromX,
        previousFromY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        previousToX,
        previousToY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
      this._appendVertex(
        previousFromX,
        previousFromY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
      this._appendVertex(
        currentFromX,
        currentFromY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
    }

    if (!capStart && !capEnd)
    {
      return;
    }

    const tangentX = deltaX / length;
    const tangentY = deltaY / length;
    const centerIntensity = profile.reduce(
      (maximum, [, intensity]) => Math.max(maximum, intensity),
      0,
    );
    const centerRed = red * centerIntensity;
    const centerGreen = green * centerIntensity;
    const centerBlue = blue * centerIntensity;

    if (capStart)
    {
      this._appendVertex(
        from.x + startOffset.x,
        from.y + startOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        from.x - startOffset.x,
        from.y - startOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        from.x - tangentX * halfWidth,
        from.y - tangentY * halfWidth,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
    }

    if (capEnd)
    {
      this._appendVertex(
        to.x + endOffset.x,
        to.y + endOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        to.x + tangentX * halfWidth,
        to.y + tangentY * halfWidth,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        to.x - endOffset.x,
        to.y - endOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
    }
  }

  _releaseRingScratch()
  {
    this._ringCosine = null;
    this._ringSine = null;
    this.ringIndexData = new Uint32Array(0);
    this.ringIndexCount = 0;
    this._ringTopology = [];
    this._ringTopologyCount = 0;
    this._ringPreparedTopologyCount = 0;
    this._ringTopologyDirty = false;
    this._ringIndexVersion = 0;
    this._ringUploadedIndexVersion = -1;
  }
}
export function calculatePyramidSettings(
  displayWidth,
  displayHeight,
  resolutionScale,
  diffusion,
)
{
  const safeScale = clamp(resolutionScale, 0.1, 0.75);
  const maxSize = Math.max(
    1,
    Math.floor(displayWidth * safeScale),
    Math.floor(displayHeight * safeScale),
  );
  const logIterations = Math.log2(maxSize) +
    Math.min(Math.max(0, diffusion), 10) - 10;

  return {
    levelCount: clamp(
      Math.floor(logIterations),
      1,
      MAX_PYRAMID_LEVELS,
    ),
    sampleScale: 0.5 + logIterations - Math.floor(logIterations),
  };
}
