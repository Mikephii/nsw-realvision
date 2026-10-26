/**
 * Custom IDW renderer using MapLibre CustomLayerInterface.
 *
 * Multi-pass architecture: N draw calls (one per data point) with additive
 * blending into a downsampled offscreen FBO, then a single display pass
 * that divides accumulated (wi*vi)/(wi) and maps through a color ramp.
 *
 * This is mathematically identical to the previous per-pixel loop approach
 * but dramatically faster because:
 * - Computation happens at reduced resolution (framebufferFactor)
 * - Each fragment shader is trivial (single distance calc, no texture fetches)
 * - GPU additive blending hardware accumulates instead of a shader loop
 *
 * Features:
 * - Configurable framebuffer resolution (0.25x to 1.0x)
 * - Dynamic color ramp texture (supports color range slider)
 * - Animated transitions via dual FBOs + mix uniform
 * - Configurable IDW power exponent and color stops
 * - Viewport culling to skip off-screen data points
 *
 * ─── Critical WebGL Constraints ─────────────────────────────────────────
 *
 * These constraints were discovered through painful debugging. Violating
 * any of them produces silent failures that are extremely hard to diagnose.
 *
 * 1. NEAREST filtering on RGBA32F textures (NOT LINEAR)
 *    LINEAR filtering on float textures requires the OES_texture_float_linear
 *    extension. Without it, texture() silently returns (0,0,0,0) for ALL
 *    samples. readPixels() still works (bypasses the texture sampler), so
 *    FBO diagnostics show valid data while the shader reads all zeros.
 *    The library uses NEAREST — we must do the same.
 *
 * 2. No VAOs — bare vertex attribute pointers only
 *    MapLibre manages its own VAO state internally. Using our own VAOs in
 *    custom layer callbacks causes the display pass to silently produce no
 *    output. Must use gl.bindVertexArray(null) then set up vertex attributes
 *    with enableVertexAttribArray + vertexAttribPointer each frame. This
 *    matches the maplibre-gl-interpolate-heatmap library's approach exactly.
 *
 * 3. GL state guards in renderFrame()
 *    MapLibre may leave depth test, stencil test, or scissor test enabled
 *    when calling the custom layer's render() callback. Must explicitly
 *    disable all three before drawing, or our full-screen quad fragments
 *    may be silently discarded.
 *
 * 4. NaN poisoning from uninitialized RGBA32F textures
 *    On some GPU/driver combinations, RGBA32F textures created with null
 *    data may contain NaN values despite the WebGL2 spec requiring zeros.
 *    mix(NaN, validValue, 1.0) = NaN because IEEE 754 defines NaN * 0 = NaN.
 *    The display shader must avoid sampling uninitialized FBO textures.
 *    We handle this by branching on u_transition and by explicitly clearing
 *    both FBOs to zero during initialization.
 */

import {
  GROWTH_COLOR_STOPS,
  STOP_RGBS_NORM,
  interpolateStopRgbs,
} from '../color-scale'
import { LAYER_IDS } from '../map-layers'
import type maplibregl from 'maplibre-gl'
import type { HeatmapRenderer } from './types'
import type { HeatmapDataPoint } from '@/lib/heatmap-queries'

/**
 * Shape of the args object passed to MapLibre's CustomLayerInterface
 * render() and prerender() callbacks. Not exported by MapLibre's types,
 * so we define it locally based on observed runtime structure.
 */
interface MapLibreRenderArgs {
  defaultProjectionData?: {
    mainMatrix: Float64Array
  }
}

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Duration of cross-fade transition between resolution changes (ms). */
const TRANSITION_MS = 400

/**
 * Zoom-invariant weight thresholds for full opacity, per H3 resolution.
 *
 * The shader computes a zoom-invariant metric by working in log space:
 *   `zoomInvariant = log2(avgWeight) + zoom * 3`
 *
 * Why this works: IDW weight wi = 1/d_screen^3, and d_screen = d_merc * 2^zoom.
 * So log2(wi) = -3*log2(d_merc) - 3*zoom. Adding 3*zoom cancels the zoom term,
 * leaving only the Mercator distance — which doesn't change when you pan/zoom.
 *
 * The fade uses smoothstep over a transition band:
 *   `smoothstep(threshold - FALLOFF_BAND, threshold, zoomInvariant)`
 *
 * Different resolutions need different thresholds because their inter-centroid
 * spacing differs. Res 7 hexes (~5km) have centroids much farther apart than
 * res 9 hexes (~350m), so the threshold must be lower to let color extend
 * across the larger gaps.
 *
 * - Lower values → more of the map is colored (sparse areas stay visible)
 * - Higher values → only dense clusters are fully colored, edges fade sooner
 */
const WEIGHT_FALLOFF: Record<7 | 8 | 9, number> = {
  7: 34.0,
  8: 38.0,
  9: 42.0,
}

/** Width of the smoothstep transition band (in log2 units). */
const FALLOFF_BAND = 8.0

/** Width of the 1D color ramp texture (number of color samples). */
const COLOR_RAMP_SIZE = 256

/**
 * Viewport cull margin in clip-space units.
 * Points projected more than this distance outside [-1, 1] are skipped.
 * 1.5 = keep points up to 1.5 viewport-widths beyond each edge, ensuring
 * smooth IDW gradients at edges while eliminating far-off points whose
 * collective weight averages the interpolation toward the global mean.
 */
const CULL_MARGIN = 1.5

// ─── Computation Shaders ────────────────────────────────────────────────────────

/**
 * Computation vertex shader.
 *
 * For each data point, a full-screen clip-space quad is drawn. The vertex
 * shader projects the data point's Mercator position through the map matrix
 * to get its NDC position, then passes it as a smooth varying to all
 * fragments of the quad.
 *
 * The quad itself is in clip space [-1,1] (NOT projected through u_matrix).
 * Only the data point position is projected — this is how the library works.
 */
const COMP_VERT_SRC = `#version 300 es
precision highp float;

in vec2 a_position;
uniform mat4 u_matrix;
uniform vec2 u_pointMerc;
uniform float u_pointValue;

out vec2 v_pointNdc;
out float v_value;

void main() {
  vec4 projected = u_matrix * vec4(u_pointMerc, 0.0, 1.0);
  v_pointNdc = projected.xy / projected.w;
  v_value = u_pointValue;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * Computation fragment shader.
 *
 * Each fragment computes its IDW weight contribution from the current data
 * point: wi = 1 / distance^power. The output (wi * value, wi, 0, 1) is
 * accumulated via additive blending (gl.ONE, gl.ONE) across all data points.
 *
 * Distance is computed in normalized [0,1] screen space, converting both
 * the fragment position and the data point NDC to the same coordinate space.
 * This matches the library's exact distance calculation pattern.
 *
 * After all N draw calls, each FBO texel contains:
 *   R = sum(wi * vi)  — weighted value accumulator
 *   G = sum(wi)        — weight accumulator
 *   B = 0              — unused
 *   A = N_contributing  — count of contributing draw calls (unused)
 */
const COMP_FRAG_SRC = `#version 300 es
precision highp float;

uniform float u_power;
uniform vec2 u_framebufferSize;

in vec2 v_pointNdc;
in float v_value;
out vec4 fragColor;

void main() {
  vec2 fragScreen = gl_FragCoord.xy / u_framebufferSize;
  vec2 pointScreen = (v_pointNdc + 1.0) * 0.5;
  float dist = distance(fragScreen, pointScreen);
  float wi = 1.0 / pow(dist, u_power);
  fragColor = vec4(v_value * wi, wi, 0.0, 1.0);
}
`

// ─── Display Shaders ────────────────────────────────────────────────────────────

/**
 * Display vertex shader.
 *
 * Simple pass-through for the full-screen clip-space quad.
 * The quad covers [-1,1] in both axes, filling the entire viewport.
 */
const DISP_VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * Display fragment shader.
 *
 * Samples the computation FBO to retrieve accumulated (wi*vi, wi),
 * divides to get the IDW interpolated value, then maps through the
 * color ramp texture for visualization.
 *
 * The u_transition >= 1.0 branch is NOT just an optimization — it prevents
 * NaN poisoning. On first data load, compTexPrevious may be uninitialized.
 * mix(NaN, x, 1.0) = NaN because IEEE 754 defines NaN * 0 = NaN.
 * See "Critical WebGL Constraints" in the module header.
 */
const DISP_FRAG_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_compTexCurrent;
uniform sampler2D u_compTexPrevious;
uniform float u_transition;
uniform sampler2D u_colorRamp;
uniform float u_colorMin;
uniform float u_colorMax;
uniform float u_opacity;
uniform float u_weightFalloff;
uniform float u_falloffBand;
uniform float u_numPoints;
uniform float u_zoom;
uniform vec2 u_screenSize;

out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / u_screenSize;

  // Branch on transition to avoid sampling potentially uninitialized
  // previous FBO texture. See NaN poisoning note in module header.
  vec4 comp;
  if (u_transition >= 1.0) {
    comp = texture(u_compTexCurrent, uv);
  } else {
    vec4 compCurrent = texture(u_compTexCurrent, uv);
    vec4 compPrevious = texture(u_compTexPrevious, uv);
    comp = mix(compPrevious, compCurrent, u_transition);
  }

  // comp.r = sum(wi * vi), comp.g = sum(wi)
  float totalWeight = comp.g;
  if (totalWeight < 1e-6) discard;

  // Zoom-invariant falloff using log-space compensation.
  // IDW weight wi = 1/d_screen^3 where d_screen = d_merc * 2^zoom.
  // log2(wi) = -3*log2(d_merc) - 3*zoom, so adding 3*zoom cancels the
  // zoom term, leaving only Mercator distance — truly zoom-independent.
  // Dividing by numPoints removes the point-count dependency (resolution changes).
  float avgWeight = totalWeight / max(u_numPoints, 1.0);
  float zoomInvariant = log2(max(avgWeight, 1e-20)) + u_zoom * 3.0;
  float fade = smoothstep(u_weightFalloff - u_falloffBand, u_weightFalloff, zoomInvariant);

  float value = comp.r / totalWeight;

  // Map growth value to [0, 1] range for color ramp lookup
  float t = clamp((value - u_colorMin) / (u_colorMax - u_colorMin), 0.0, 1.0);
  vec3 color = texture(u_colorRamp, vec2(t, 0.5)).rgb;

  // Mix color toward white (1.0) based on opacity and proximity fade.
  // White in multiply = no effect, so low opacity*fade = basemap shows through.
  // Pure multiply (alpha=1.0) ensures the blend factor never exceeds 1.0.
  vec3 tint = mix(vec3(1.0), color, u_opacity * fade);
  fragColor = vec4(tint, 1.0);
}
`

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convert lng/lat to Web Mercator [0,1] coordinates (same as MapLibre internal). */
function toMercator(lng: number, lat: number): [number, number] {
  const x = (lng + 180) / 360
  const latRad = (lat * Math.PI) / 180
  const y =
    (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2
  return [x, y]
}

/**
 * Build a 256x1 RGBA color ramp texture from pre-parsed color stops.
 *
 * Uses raw interpolated colors without any boost or gamma correction.
 * The color stops already have appropriate lightness (42-50%) for multiply
 * blend — the premultiplied shader output handles intensity control.
 *
 * Uses the shared `interpolateStopRgbs` from color-scale.ts with
 * pre-parsed `STOP_RGBS_NORM` to avoid re-parsing HSL strings per texel.
 */
function buildColorRamp(
  stops: Array<[number, string]>,
  rgbs: Array<[number, number, number]>,
  colorMin: number,
  colorMax: number,
): Uint8Array {
  const data = new Uint8Array(COLOR_RAMP_SIZE * 4)
  for (let i = 0; i < COLOR_RAMP_SIZE; i++) {
    const growth =
      colorMin + ((colorMax - colorMin) * i) / (COLOR_RAMP_SIZE - 1)
    const [r, g, b] = interpolateStopRgbs(stops, rgbs, growth)
    data[i * 4] = Math.round(Math.max(0, Math.min(1, r)) * 255)
    data[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255)
    data[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255)
    data[i * 4 + 3] = 255
  }
  return data
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile error: ${log}`)
  }
  return shader
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram {
  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`Program link error: ${log}`)
  }
  return prog
}

// ─── Renderer ───────────────────────────────────────────────────────────────────

export interface CustomIDWOptions {
  colorStops?: Array<[number, string]>
  /** Pre-parsed normalised RGB for each color stop. Must match colorStops length. */
  stopsRgbs?: Array<[number, number, number]>
  power?: number
  /** Resolution factor for offscreen FBO (0.25-1.0). Default: 0.5 */
  framebufferFactor?: number
}

interface CompUniformLocs {
  u_matrix: WebGLUniformLocation | null
  u_pointMerc: WebGLUniformLocation | null
  u_pointValue: WebGLUniformLocation | null
  u_power: WebGLUniformLocation | null
  u_framebufferSize: WebGLUniformLocation | null
}

interface DispUniformLocs {
  u_compTexCurrent: WebGLUniformLocation | null
  u_compTexPrevious: WebGLUniformLocation | null
  u_transition: WebGLUniformLocation | null
  u_colorRamp: WebGLUniformLocation | null
  u_colorMin: WebGLUniformLocation | null
  u_colorMax: WebGLUniformLocation | null
  u_opacity: WebGLUniformLocation | null
  u_weightFalloff: WebGLUniformLocation | null
  u_falloffBand: WebGLUniformLocation | null
  u_numPoints: WebGLUniformLocation | null
  u_zoom: WebGLUniformLocation | null
  u_screenSize: WebGLUniformLocation | null
}

export class CustomIDWRenderer implements HeatmapRenderer {
  readonly id = LAYER_IDS.IDW_CUSTOM

  private map: maplibregl.Map | null = null
  private layerAdded = false

  // GL resources
  private gl: WebGL2RenderingContext | null = null
  private compProgram: WebGLProgram | null = null
  private dispProgram: WebGLProgram | null = null
  private compLocs: CompUniformLocs = {
    u_matrix: null,
    u_pointMerc: null,
    u_pointValue: null,
    u_power: null,
    u_framebufferSize: null,
  }
  private dispLocs: DispUniformLocs = {
    u_compTexCurrent: null,
    u_compTexPrevious: null,
    u_transition: null,
    u_colorRamp: null,
    u_colorMin: null,
    u_colorMax: null,
    u_opacity: null,
    u_weightFalloff: null,
    u_falloffBand: null,
    u_numPoints: null,
    u_zoom: null,
    u_screenSize: null,
  }

  /** Shared full-screen quad vertex buffer (6 verts, 2 triangles). */
  private quadBuffer: WebGLBuffer | null = null

  /** 256x1 RGBA8 texture mapping growth values to colors. */
  private colorRampTex: WebGLTexture | null = null

  /**
   * Dual offscreen FBOs for computation + transition animation.
   *
   * Each FBO has a permanently-attached RGBA32F texture. The JS references
   * (compFBOCurrent/compTexCurrent) swap on data updates, but the WebGL
   * FBO->texture attachment never changes. renderComputationPass renders
   * into compFBOCurrent; the display shader samples compTexCurrent.
   */
  private compFBOCurrent: WebGLFramebuffer | null = null
  private compFBOPrevious: WebGLFramebuffer | null = null
  private compTexCurrent: WebGLTexture | null = null
  private compTexPrevious: WebGLTexture | null = null
  private fboWidth = 0
  private fboHeight = 0

  /**
   * CPU-side point data as a packed Float32Array (3 floats per point).
   * Layout: [mercX0, mercY0, growth0, mercX1, mercY1, growth1, ...]
   */
  private currentPoints: Float32Array | null = null
  private previousPoints: Float32Array | null = null
  private numCurrentPoints = 0
  private numPreviousPoints = 0
  private hasInitialData = false
  private pendingPoints: Array<HeatmapDataPoint> | null = null
  private opacity = 0.55
  private resolution: 7 | 8 | 9 = 7

  // Transition state
  private transitionStart = 0
  private isTransitioning = false

  // Config
  private colorStops: Array<[number, string]>
  private stopsRgbs: Array<[number, number, number]>
  private power: number
  private colorMin: number
  private colorMax: number
  private framebufferFactor: number

  constructor(options?: CustomIDWOptions) {
    this.colorStops = options?.colorStops ?? GROWTH_COLOR_STOPS
    this.stopsRgbs = options?.stopsRgbs ?? STOP_RGBS_NORM
    this.power = options?.power ?? 3
    this.colorMin = this.colorStops[0][0]
    this.colorMax = this.colorStops[this.colorStops.length - 1][0]
    this.framebufferFactor = options?.framebufferFactor ?? 0.5
  }

  // ─── HeatmapRenderer interface ───────────────────────────────────────

  attach(map: maplibregl.Map): void {
    this.map = map
    const self = this
    const layer: maplibregl.CustomLayerInterface = {
      id: this.id,
      type: 'custom',
      renderingMode: '2d',
      onAdd(
        _map: maplibregl.Map,
        gl: WebGLRenderingContext | WebGL2RenderingContext,
      ) {
        self.initGL(gl as WebGL2RenderingContext)
      },
      prerender(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        args: unknown,
      ) {
        self.prerenderFrame(gl as WebGL2RenderingContext, args)
      },
      render(
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        args: unknown,
      ) {
        self.renderFrame(gl as WebGL2RenderingContext, args)
      },
      onRemove() {
        self.destroyGL()
      },
    }
    // Insert below water-mask so the heatmap renders before the water mask covers it.
    // Without beforeId, addLayer puts the custom layer at the top of the stack,
    // which means the multiply blend would tint the water mask's solid fill.
    const beforeId = map.getLayer(LAYER_IDS.WATER_MASK)
      ? LAYER_IDS.WATER_MASK
      : undefined
    map.addLayer(layer as unknown as maplibregl.LayerSpecification, beforeId)
    this.layerAdded = true
    map.on('resize', this.onMapResize)
  }

  setData(points: Array<HeatmapDataPoint>): void {
    if (!this.gl) {
      this.pendingPoints = points
      return
    }
    this.pendingPoints = null
    this.uploadData(points)
    if (this.map) this.map.triggerRepaint()
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity
    if (this.map) this.map.triggerRepaint()
  }

  setColorRange(min: number, max: number): void {
    this.colorMin = min
    this.colorMax = max
    if (this.gl) this.uploadColorRamp()
    if (this.map) this.map.triggerRepaint()
  }

  updateColorRange(min: number, max: number): void {
    this.setColorRange(min, max)
  }

  setColorStops(
    stops: Array<[number, string]>,
    rgbs: Array<[number, number, number]>,
  ): void {
    this.colorStops = stops
    this.stopsRgbs = rgbs
    this.colorMin = stops[0][0]
    this.colorMax = stops[stops.length - 1][0]
    if (this.gl) this.uploadColorRamp()
    if (this.map) this.map.triggerRepaint()
  }

  /** Update the H3 resolution so the falloff threshold matches the cell spacing. */
  setResolution(res: 7 | 8 | 9): void {
    this.resolution = res
  }

  detach(): void {
    if (this.map) {
      this.map.off('resize', this.onMapResize)
      if (this.layerAdded) {
        try {
          if (this.map.getLayer(this.id)) this.map.removeLayer(this.id)
        } catch {
          /* may already be removed */
        }
        this.layerAdded = false
      }
    }
    this.map = null
  }

  // ─── GL lifecycle ─────────────────────────────────────────────────────

  private initGL(gl: WebGL2RenderingContext): void {
    this.gl = gl

    // Required extensions for rendering to RGBA32F with additive blending
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float required for IDW computation FBO')
    }
    if (!gl.getExtension('EXT_float_blend')) {
      throw new Error(
        'EXT_float_blend required for additive blending on float FBO',
      )
    }

    // ─── Computation program ───
    const compVS = compileShader(gl, gl.VERTEX_SHADER, COMP_VERT_SRC)
    const compFS = compileShader(gl, gl.FRAGMENT_SHADER, COMP_FRAG_SRC)
    this.compProgram = linkProgram(gl, compVS, compFS)
    gl.deleteShader(compVS)
    gl.deleteShader(compFS)

    this.compLocs = {
      u_matrix: gl.getUniformLocation(this.compProgram, 'u_matrix'),
      u_pointMerc: gl.getUniformLocation(this.compProgram, 'u_pointMerc'),
      u_pointValue: gl.getUniformLocation(this.compProgram, 'u_pointValue'),
      u_power: gl.getUniformLocation(this.compProgram, 'u_power'),
      u_framebufferSize: gl.getUniformLocation(
        this.compProgram,
        'u_framebufferSize',
      ),
    }

    // ─── Display program ───
    const dispVS = compileShader(gl, gl.VERTEX_SHADER, DISP_VERT_SRC)
    const dispFS = compileShader(gl, gl.FRAGMENT_SHADER, DISP_FRAG_SRC)
    this.dispProgram = linkProgram(gl, dispVS, dispFS)
    gl.deleteShader(dispVS)
    gl.deleteShader(dispFS)

    this.dispLocs = {
      u_compTexCurrent: gl.getUniformLocation(
        this.dispProgram,
        'u_compTexCurrent',
      ),
      u_compTexPrevious: gl.getUniformLocation(
        this.dispProgram,
        'u_compTexPrevious',
      ),
      u_transition: gl.getUniformLocation(this.dispProgram, 'u_transition'),
      u_colorRamp: gl.getUniformLocation(this.dispProgram, 'u_colorRamp'),
      u_colorMin: gl.getUniformLocation(this.dispProgram, 'u_colorMin'),
      u_colorMax: gl.getUniformLocation(this.dispProgram, 'u_colorMax'),
      u_opacity: gl.getUniformLocation(this.dispProgram, 'u_opacity'),
      u_weightFalloff: gl.getUniformLocation(
        this.dispProgram,
        'u_weightFalloff',
      ),
      u_falloffBand: gl.getUniformLocation(this.dispProgram, 'u_falloffBand'),
      u_numPoints: gl.getUniformLocation(this.dispProgram, 'u_numPoints'),
      u_zoom: gl.getUniformLocation(this.dispProgram, 'u_zoom'),
      u_screenSize: gl.getUniformLocation(this.dispProgram, 'u_screenSize'),
    }

    // ─── Shared full-screen quad ───
    // Two triangles covering [-1,1] clip space. Used by both passes.
    // NOTE: No VAOs — we use bare vertex attribute pointers each frame.
    // See "Critical WebGL Constraints" #2 in module header.
    const quadVerts = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ])
    this.quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW)

    // ─── Offscreen FBOs ───
    const canvas = this.map!.getCanvas()
    this.fboWidth = Math.ceil(canvas.width * this.framebufferFactor)
    this.fboHeight = Math.ceil(canvas.height * this.framebufferFactor)

    const fboCurrent = this.createComputationFBO(gl)
    this.compFBOCurrent = fboCurrent.fbo
    this.compTexCurrent = fboCurrent.texture

    const fboPrevious = this.createComputationFBO(gl)
    this.compFBOPrevious = fboPrevious.fbo
    this.compTexPrevious = fboPrevious.texture

    // Explicitly clear both FBOs to zero. RGBA32F textures created with null
    // data may contain NaN/garbage on some GPU/driver combos despite the spec.
    // See "Critical WebGL Constraints" #4 in module header.
    for (const fbo of [this.compFBOCurrent, this.compFBOPrevious]) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // ─── Color ramp texture ───
    this.colorRampTex = gl.createTexture()
    this.uploadColorRamp()

    // Process any data that arrived before GL was ready
    if (this.pendingPoints) {
      this.uploadData(this.pendingPoints)
      this.pendingPoints = null
    }
  }

  /**
   * Create an RGBA32F offscreen framebuffer for IDW computation.
   *
   * CRITICAL: Must use NEAREST filtering, not LINEAR.
   * LINEAR filtering on RGBA32F requires the OES_texture_float_linear
   * extension. Without it, texture() silently returns (0,0,0,0).
   * See "Critical WebGL Constraints" #1 in module header.
   */
  private createComputationFBO(gl: WebGL2RenderingContext): {
    fbo: WebGLFramebuffer
    texture: WebGLTexture
  } {
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST) // NOT LINEAR — see above
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST) // NOT LINEAR — see above
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fboWidth,
      this.fboHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      null,
    )

    const fbo = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    )

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    return { fbo, texture }
  }

  /** Upload the color ramp texture from current color stops and range. */
  private uploadColorRamp(): void {
    const gl = this.gl!
    const rampData = buildColorRamp(
      this.colorStops,
      this.stopsRgbs,
      this.colorMin,
      this.colorMax,
    )
    gl.bindTexture(gl.TEXTURE_2D, this.colorRampTex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      COLOR_RAMP_SIZE,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rampData,
    )
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  }

  /**
   * Convert incoming data points to Mercator coordinates and trigger
   * a transition animation from previous to current data.
   *
   * The FBO swap here only swaps JS references — the WebGL FBO->texture
   * attachments are permanent. After the swap, compFBOCurrent points to
   * the FBO that was previously "previous", and vice versa. The next
   * renderComputationPass will render new data into compFBOCurrent,
   * while the display shader can still sample compTexPrevious for
   * the transition cross-fade.
   */
  private uploadData(points: Array<HeatmapDataPoint>): void {
    // Swap current → previous
    this.previousPoints = this.currentPoints
    this.numPreviousPoints = this.numCurrentPoints

    const tmpTex = this.compTexPrevious
    const tmpFBO = this.compFBOPrevious
    this.compTexPrevious = this.compTexCurrent
    this.compFBOPrevious = this.compFBOCurrent
    this.compTexCurrent = tmpTex
    this.compFBOCurrent = tmpFBO

    this.numCurrentPoints = points.length

    if (points.length === 0) {
      this.currentPoints = null
      this.hasInitialData = false
      this.isTransitioning = false
      return
    }

    // Convert to Mercator: 3 floats per point (mx, my, growth)
    this.currentPoints = new Float32Array(points.length * 3)
    for (let i = 0; i < points.length; i++) {
      const [mx, my] = toMercator(points[i].lng, points[i].lat)
      this.currentPoints[i * 3] = mx
      this.currentPoints[i * 3 + 1] = my
      this.currentPoints[i * 3 + 2] = points[i].growth
    }

    // Start transition animation (skip on first load — no previous data)
    if (this.hasInitialData) {
      this.isTransitioning = true
      this.transitionStart = performance.now()
    }
    this.hasInitialData = true
  }

  // ─── Rendering ────────────────────────────────────────────────────────

  /**
   * Extract the 4x4 projection matrix from MapLibre's render callback args.
   *
   * MapLibre passes a `defaultProjectionData.mainMatrix` (Float64Array) in
   * recent versions. Older versions passed the matrix directly as the args
   * object. We try the new path first and fall back to the old one.
   */
  private extractMatrix(args: unknown): Float32Array | null {
    const a = args as MapLibreRenderArgs | null
    const matrix =
      a?.defaultProjectionData?.mainMatrix ?? (args as Float64Array | Array<number>)
    if (!matrix || !('length' in matrix) || matrix.length !== 16) return null
    return new Float32Array(matrix)
  }

  /**
   * Prerender callback: run IDW computation into offscreen FBO(s).
   *
   * Called by MapLibre before render() each frame. Renders N full-screen
   * quads (one per visible data point) with additive blending into the
   * computation FBO. During transitions, also re-renders the previous
   * dataset with the current projection matrix.
   *
   * Restores MapLibre's framebuffer and viewport before returning.
   */
  private prerenderFrame(gl: WebGL2RenderingContext, args: unknown): void {
    if (this.numCurrentPoints === 0 || !this.compProgram || !this.currentPoints)
      return

    const matrixF32 = this.extractMatrix(args)
    if (!matrixF32) return

    this.updateFBOSize(gl)

    // Always recompute current data (projection changes on pan/zoom)
    this.renderComputationPass(
      gl,
      matrixF32,
      this.currentPoints,
      this.numCurrentPoints,
      this.compFBOCurrent!,
    )

    // During transitions, also recompute previous data with current projection
    if (
      this.isTransitioning &&
      this.previousPoints &&
      this.numPreviousPoints > 0
    ) {
      this.renderComputationPass(
        gl,
        matrixF32,
        this.previousPoints,
        this.numPreviousPoints,
        this.compFBOPrevious!,
      )
    }

    // Restore MapLibre's framebuffer, viewport, and blend state.
    // prerender sets additive blend (gl.ONE, gl.ONE) for IDW accumulation —
    // must restore to premultiplied alpha before MapLibre renders other layers.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const canvas = this.map!.getCanvas()
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  /**
   * Render N full-screen quads (one per data point) into the given FBO
   * with additive blending to accumulate IDW weight contributions.
   *
   * Uses CPU-side viewport culling to skip points projected outside the
   * visible area (with CULL_MARGIN padding for smooth edge gradients).
   *
   * CRITICAL: Uses bare vertex attribute pointers, NOT VAOs.
   * See "Critical WebGL Constraints" #2 in module header.
   */
  private renderComputationPass(
    gl: WebGL2RenderingContext,
    matrix: Float32Array,
    points: Float32Array,
    numPoints: number,
    fbo: WebGLFramebuffer,
  ): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.viewport(0, 0, this.fboWidth, this.fboHeight)

    // Clear to zero — additive blending accumulates from here
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Additive blending: sum all (wi*vi, wi) contributions
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.disable(gl.DEPTH_TEST)

    gl.useProgram(this.compProgram)
    gl.uniformMatrix4fv(this.compLocs.u_matrix, false, matrix)
    gl.uniform1f(this.compLocs.u_power, this.power)
    gl.uniform2f(
      this.compLocs.u_framebufferSize,
      this.fboWidth,
      this.fboHeight,
    )

    // Unbind any MapLibre VAO, set up bare vertex attribute pointers.
    // See "Critical WebGL Constraints" #2 in module header.
    gl.bindVertexArray(null)
    const posLoc = gl.getAttribLocation(this.compProgram!, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // CPU-side viewport culling using column-major 4x4 matrix components.
    // Naming convention: m{col}{row} where matrix[col*4 + row].
    // Full transform: clip = matrix * vec4(mx, my, 0, 1)
    // Since z=0, column 2 is unused — we only need columns 0, 1, and 3.
    const m00 = matrix[0],
      m01 = matrix[4],
      m03 = matrix[12] // row 0: clipX
    const m10 = matrix[1],
      m11 = matrix[5],
      m13 = matrix[13] // row 1: clipY
    const m30 = matrix[3],
      m31 = matrix[7],
      m33 = matrix[15] // row 3: clipW
    const cullBound = 1 + CULL_MARGIN

    for (let i = 0; i < numPoints; i++) {
      const offset = i * 3
      const mx = points[offset]
      const my = points[offset + 1]

      // Project to clip space (mirrors vertex shader math)
      const clipW = m30 * mx + m31 * my + m33
      const clipX = (m00 * mx + m01 * my + m03) / clipW
      const clipY = (m10 * mx + m11 * my + m13) / clipW

      // Skip points far outside the viewport
      if (
        clipX < -cullBound ||
        clipX > cullBound ||
        clipY < -cullBound ||
        clipY > cullBound
      ) {
        continue
      }

      gl.uniform2f(this.compLocs.u_pointMerc, mx, my)
      gl.uniform1f(this.compLocs.u_pointValue, points[offset + 2])
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
  }

  /**
   * Render callback: composite the computation FBO onto the map.
   *
   * Samples the IDW accumulation texture, divides to get interpolated
   * values, maps through the color ramp, and draws with alpha blending.
   *
   * CRITICAL: Must disable depth/stencil/scissor tests and use bare
   * vertex attribute pointers. See "Critical WebGL Constraints" #2 and #3
   * in module header.
   */
  private renderFrame(gl: WebGL2RenderingContext, _args: unknown): void {
    if (this.numCurrentPoints === 0 || !this.dispProgram) return

    // Transition progress
    let transition = 1.0
    if (this.isTransitioning) {
      const elapsed = performance.now() - this.transitionStart
      transition = Math.min(1.0, elapsed / TRANSITION_MS)
      if (transition >= 1.0) this.isTransitioning = false
    }

    gl.useProgram(this.dispProgram)

    // Save GL state that we modify. MapLibre relies on stencil test for
    // vector tile fill clipping — if we leave it disabled, subsequent fill
    // layers (water-mask) won't render correctly.
    const savedStencilTest = gl.isEnabled(gl.STENCIL_TEST)
    const savedDepthTest = gl.isEnabled(gl.DEPTH_TEST)
    const savedScissorTest = gl.isEnabled(gl.SCISSOR_TEST)

    // Must disable these for our full-screen quad.
    // See "Critical WebGL Constraints" #3 in module header.
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.STENCIL_TEST)
    gl.disable(gl.SCISSOR_TEST)
    gl.colorMask(true, true, true, true)

    // Multiply blend: tints the basemap so roads/labels remain readable.
    // R_out = R_dst * (R_src + 1 - A_src) — darkens and colorizes the map.
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)

    // Bare vertex attribute pointers — no VAOs.
    // See "Critical WebGL Constraints" #2 in module header.
    gl.bindVertexArray(null)
    const posLoc = gl.getAttribLocation(this.dispProgram, 'a_position')
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    // Bind computation FBO textures
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.compTexCurrent)
    gl.uniform1i(this.dispLocs.u_compTexCurrent, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.compTexPrevious)
    gl.uniform1i(this.dispLocs.u_compTexPrevious, 1)

    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.colorRampTex)
    gl.uniform1i(this.dispLocs.u_colorRamp, 2)

    // Uniforms
    const canvas = this.map!.getCanvas()
    gl.uniform2f(this.dispLocs.u_screenSize, canvas.width, canvas.height)
    gl.uniform1f(this.dispLocs.u_transition, transition)
    gl.uniform1f(this.dispLocs.u_colorMin, this.colorMin)
    gl.uniform1f(this.dispLocs.u_colorMax, this.colorMax)
    gl.uniform1f(this.dispLocs.u_opacity, this.opacity)
    gl.uniform1f(
      this.dispLocs.u_weightFalloff,
      WEIGHT_FALLOFF[this.resolution],
    )
    gl.uniform1f(this.dispLocs.u_falloffBand, FALLOFF_BAND)
    gl.uniform1f(this.dispLocs.u_numPoints, this.numCurrentPoints)
    gl.uniform1f(this.dispLocs.u_zoom, this.map!.getZoom())

    // Draw full-screen quad
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    // Clean up vertex attributes
    gl.disableVertexAttribArray(posLoc)

    // Restore GL state so subsequent MapLibre layers render correctly.
    // Stencil test is critical — MapLibre uses it for vector tile fill clipping.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    if (savedStencilTest) gl.enable(gl.STENCIL_TEST)
    if (savedDepthTest) gl.enable(gl.DEPTH_TEST)
    if (savedScissorTest) gl.enable(gl.SCISSOR_TEST)
    gl.activeTexture(gl.TEXTURE0)

    // Keep animating during transition
    if (this.isTransitioning && this.map) {
      this.map.triggerRepaint()
    }
  }

  // ─── FBO management ───────────────────────────────────────────────────

  private onMapResize = (): void => {
    if (this.gl && this.map) {
      this.updateFBOSize(this.gl)
    }
  }

  /** Resize FBO textures if the canvas size changed. */
  private updateFBOSize(gl: WebGL2RenderingContext): void {
    if (!this.map) return
    const canvas = this.map.getCanvas()
    const newWidth = Math.ceil(canvas.width * this.framebufferFactor)
    const newHeight = Math.ceil(canvas.height * this.framebufferFactor)
    if (newWidth === this.fboWidth && newHeight === this.fboHeight) return

    this.fboWidth = newWidth
    this.fboHeight = newHeight

    for (const tex of [this.compTexCurrent, this.compTexPrevious]) {
      if (!tex) continue
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        this.fboWidth,
        this.fboHeight,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      )
    }
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  /** Delete all GL resources. Called by MapLibre's onRemove callback. */
  private destroyGL(): void {
    const gl = this.gl
    if (!gl) return

    if (this.compProgram) gl.deleteProgram(this.compProgram)
    if (this.dispProgram) gl.deleteProgram(this.dispProgram)
    if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer)
    if (this.compTexCurrent) gl.deleteTexture(this.compTexCurrent)
    if (this.compTexPrevious) gl.deleteTexture(this.compTexPrevious)
    if (this.compFBOCurrent) gl.deleteFramebuffer(this.compFBOCurrent)
    if (this.compFBOPrevious) gl.deleteFramebuffer(this.compFBOPrevious)
    if (this.colorRampTex) gl.deleteTexture(this.colorRampTex)

    this.compProgram = null
    this.dispProgram = null
    this.quadBuffer = null
    this.compTexCurrent = null
    this.compTexPrevious = null
    this.compFBOCurrent = null
    this.compFBOPrevious = null
    this.colorRampTex = null
    this.gl = null
  }
}
