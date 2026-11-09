/**
 * MarbleRunPrims — shared procedural meshes, tinted materials and small scene helpers.
 *
 * Owns: lazily built unit box / cylinder / lathe meshes, material clones cached
 * by colour, and helpers that place a visual on a SceneObject. All visuals live on
 * leaf children so their scale never touches a collider (Hard Rule 6.2).
 * Must not: hold game state or know about tools.
 */
import {PathFrame, TrackProfile, buildCollarMesh} from "./MarbleRunTrackGeometry"

const PBR_BASE = requireAsset("../Materials/TrackGlossMaterial.mat") as Material
const GLOSS_BASE = requireAsset("../Materials/MarbleGlossMaterial.mat") as Material
const UNLIT_BASE = requireAsset("../Materials/ReticleMaterial.mat") as Material
const IMAGE_BASE = requireAsset("../Materials/ImageMaterial.mat") as Material
const SPHERE_MESH = requireAsset("../Meshes/MarbleSphere.mesh") as RenderMesh

/**
 * Slow-motion factor for capturing demo footage (the footage is sped back up in the edit,
 * so a slow preview still records smoothly). Must be 1 in the shipped Lens.
 */
export const RECORDING_SLOWMO = 1

/** Frame time for game logic, matching the physics during slow-motion capture. */
export function gameDelta(): number { return getDeltaTime() / RECORDING_SLOWMO }

export const PIPE_COLOR = new vec4(0.07, 0.36, 0.92, 1)
export const COLLAR_COLOR = new vec4(1.25, 0.72, 0.1, 1)
const COLLAR_SPACING_CM = 13
const GLASS_RENDER_ORDER = 20 // after everything else, so the shell and its reflections sit over the vane

type Layout = {name: string; components: number; normalized?: boolean}
const LAYOUT: Layout[] = [
  {name: "position", components: 3},
  {name: "normal", components: 3, normalized: true},
  {name: "texture0", components: 2},
]

function newBuilder(): MeshBuilder {
  const b = new MeshBuilder(LAYOUT)
  b.topology = MeshTopology.Triangles
  b.indexType = MeshIndexType.UInt16
  return b
}

/** Appends two triangles a,b,c,d (quad corners in order) so the front face points along `n`. */
function pushQuad(idx: number[], a: number, b: number, c: number, d: number, verts: number[], n: vec3): void {
  const pa = new vec3(verts[a * 8], verts[a * 8 + 1], verts[a * 8 + 2])
  const pb = new vec3(verts[b * 8], verts[b * 8 + 1], verts[b * 8 + 2])
  const pc = new vec3(verts[c * 8], verts[c * 8 + 1], verts[c * 8 + 2])
  const face = pb.sub(pa).cross(pc.sub(pa))
  if (face.dot(n) >= 0) idx.push(a, b, c, a, c, d)
  else idx.push(a, c, b, a, d, c)
}

let unitBoxMesh: RenderMesh | null = null
/** Axis-aligned cube, 1 cm on each side, centred on the origin. */
export function unitBox(): RenderMesh {
  if (unitBoxMesh) return unitBoxMesh
  const verts: number[] = []
  const idx: number[] = []
  const faces: [number[], number[][]][] = [
    [[1, 0, 0], [[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]]],
    [[-1, 0, 0], [[-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-.5, -.5, -.5]]],
    [[0, 1, 0], [[-.5, .5, -.5], [-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5]]],
    [[0, -1, 0], [[-.5, -.5, .5], [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5]]],
    [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
    [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]],
  ]
  let base = 0
  for (const [n, c] of faces) {
    const uv = [[0, 0], [1, 0], [1, 1], [0, 1]]
    for (let i = 0; i < 4; i++) verts.push(c[i][0], c[i][1], c[i][2], n[0], n[1], n[2], uv[i][0], uv[i][1])
    pushQuad(idx, base, base + 1, base + 2, base + 3, verts, new vec3(n[0], n[1], n[2]))
    base += 4
  }
  const b = newBuilder()
  b.appendVerticesInterleaved(verts)
  b.appendIndices(idx)
  b.updateMesh()
  unitBoxMesh = b.getMesh()
  return unitBoxMesh
}

let unitCylinderMesh: RenderMesh | null = null
/** Cylinder of diameter 1 and height 1, centred on the origin, along +Y, with caps. */
export function unitCylinder(): RenderMesh {
  if (unitCylinderMesh) return unitCylinderMesh
  const segs = 16
  const verts: number[] = []
  const idx: number[] = []
  let count = 0
  const push = (p: vec3, n: vec3, u: number, v: number): number => {
    verts.push(p.x, p.y, p.z, n.x, n.y, n.z, u, v)
    return count++
  }
  for (let j = 0; j <= segs; j++) {
    const a = (j / segs) * Math.PI * 2
    const n = new vec3(Math.cos(a), 0, Math.sin(a))
    push(new vec3(n.x * 0.5, 0.5, n.z * 0.5), n, j / segs, 1)
    push(new vec3(n.x * 0.5, -0.5, n.z * 0.5), n, j / segs, 0)
  }
  for (let j = 0; j < segs; j++) {
    const a = j * 2
    const a2 = (j + 1) * 2
    const dir = (j / segs) * Math.PI * 2 + Math.PI / segs
    pushQuad(idx, a, a + 1, a2 + 1, a2, verts, new vec3(Math.cos(dir), 0, Math.sin(dir)))
  }
  for (const sign of [1, -1]) {
    const n = new vec3(0, sign, 0)
    const c = push(new vec3(0, sign * 0.5, 0), n, 0.5, 0.5)
    const ring: number[] = []
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2
      ring.push(push(new vec3(Math.cos(a) * 0.5, sign * 0.5, Math.sin(a) * 0.5), n, 0.5, 0.5))
    }
    for (let j = 0; j < segs; j++) {
      const a = ring[j]
      const b = ring[(j + 1) % segs]
      const pa = new vec3(verts[a * 8], verts[a * 8 + 1], verts[a * 8 + 2])
      const pb = new vec3(verts[b * 8], verts[b * 8 + 1], verts[b * 8 + 2])
      const pc = new vec3(0, sign * 0.5, 0)
      if (pb.sub(pa).cross(pc.sub(pa)).dot(n) >= 0) idx.push(a, b, c)
      else idx.push(a, c, b)
    }
  }
  const b = newBuilder()
  b.appendVerticesInterleaved(verts)
  b.appendIndices(idx)
  b.updateMesh()
  unitCylinderMesh = b.getMesh()
  return unitCylinderMesh
}

/** Solid of revolution around +Y from a closed profile of (radius, height) points. */
export function latheMesh(profile: vec2[], segments: number): RenderMesh {
  const verts: number[] = []
  const idx: number[] = []
  const P = profile.length
  // Per-profile-segment normals, then averaged to smooth vertices.
  const segNormals: vec2[] = []
  for (let i = 0; i < P; i++) {
    const a = profile[i]
    const b = profile[(i + 1) % P]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1e-5)
    segNormals.push(new vec2(dy / len, -dx / len))
  }
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * Math.PI * 2
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    for (let i = 0; i < P; i++) {
      const prev = segNormals[(i - 1 + P) % P]
      const next = segNormals[i]
      let nx = prev.x + next.x
      let ny = prev.y + next.y
      const len = Math.max(Math.sqrt(nx * nx + ny * ny), 1e-5)
      nx /= len
      ny /= len
      verts.push(profile[i].x * ca, profile[i].y, profile[i].x * sa, nx * ca, ny, nx * sa, j / segments, i / (P - 1))
    }
  }
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < P; i++) {
      const a = j * P + i
      const b = j * P + ((i + 1) % P)
      const c = (j + 1) * P + ((i + 1) % P)
      const d = (j + 1) * P + i
      const n = new vec3(verts[a * 8 + 3], verts[a * 8 + 4], verts[a * 8 + 5])
      pushQuad(idx, a, b, c, d, verts, n)
    }
  }
  const b = newBuilder()
  b.appendVerticesInterleaved(verts)
  b.appendIndices(idx)
  b.updateMesh()
  return b.getMesh()
}

let bellMeshCached: RenderMesh | null = null
/** A hollow-looking bell, top at y = 0, rim at y = -5, rim radius 2.7 cm. */
export function bellMesh(): RenderMesh {
  if (bellMeshCached) return bellMeshCached
  const outer = [
    new vec2(0.0, 0.0), new vec2(0.45, 0.02), new vec2(0.75, -0.25), new vec2(1.0, -0.8),
    new vec2(1.25, -1.6), new vec2(1.4, -2.5), new vec2(1.6, -3.3), new vec2(2.0, -4.1),
    new vec2(2.5, -4.75), new vec2(2.7, -5.0),
  ]
  const inner = [
    new vec2(2.4, -5.0), new vec2(2.1, -4.6), new vec2(1.6, -3.9), new vec2(1.2, -3.1),
    new vec2(1.0, -2.3), new vec2(0.8, -1.4), new vec2(0.4, -0.9), new vec2(0.0, -0.8),
  ]
  bellMeshCached = latheMesh(outer.concat(inner), 28)
  return bellMeshCached
}

let funnelMeshCached: RenderMesh | null = null
/** A flared funnel, throat at y = 0, rim at y = 4.5, axis along Y. */
export function funnelMesh(): RenderMesh {
  if (funnelMeshCached) return funnelMeshCached
  const profile = [
    new vec2(3.4, 0), new vec2(3.5, 1.2), new vec2(4.3, 2.8), new vec2(5.6, 4.1), new vec2(6.2, 4.5),
    new vec2(5.8, 4.7), new vec2(5.0, 4.4), new vec2(3.9, 3.0), new vec2(3.1, 1.3), new vec2(3.0, 0),
  ]
  funnelMeshCached = latheMesh(profile, 32)
  return funnelMeshCached
}

let vaneMeshCached: RenderMesh | null = null
/** Three twisted leaves around +Y inside a unit sphere: the coloured core of a cat's-eye marble. */
function catsEyeVaneMesh(): RenderMesh {
  if (vaneMeshCached) return vaneMeshCached
  const blades = 3
  const rows = 28
  const cols = 6
  const twist = 0.9
  const point = (blade: number, u: number, v: number): vec3 => {
    const y = -0.96 + 1.92 * u
    const limit = Math.sqrt(Math.max(0, 1 - y * y)) * 0.74 * Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.6)
    const r = 0.04 + v * Math.max(0, limit - 0.04)
    const a = (blade * Math.PI * 2) / blades + twist * y
    return new vec3(Math.cos(a) * r, y, Math.sin(a) * r)
  }
  const verts: number[] = []
  const idx: number[] = []
  const eps = 0.01
  for (let blade = 0; blade < blades; blade++) {
    const base = blade * (rows + 1) * (cols + 1)
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const u = i / rows
        const v = j / cols
        const p = point(blade, u, v)
        const du = point(blade, Math.min(1, u + eps), v).sub(point(blade, Math.max(0, u - eps), v))
        const dv = point(blade, u, Math.min(1, v + eps)).sub(point(blade, u, Math.max(0, v - eps)))
        let n = du.cross(dv)
        n = n.length > 1e-7 ? n.normalize() : vec3.up()
        verts.push(p.x, p.y, p.z, n.x, n.y, n.z, u, v)
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j
        const b = a + cols + 1
        idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
  }
  const b = newBuilder()
  b.appendVerticesInterleaved(verts)
  b.appendIndices(idx)
  b.updateMesh()
  vaneMeshCached = b.getMesh()
  return vaneMeshCached
}

let shadowQuadCached: RenderMesh | null = null
/** Unit quad on XZ (normal +Y), 1 cm square, for contact shadows. */
function shadowQuad(): RenderMesh {
  if (shadowQuadCached) return shadowQuadCached
  const b = newBuilder()
  b.appendVerticesInterleaved([
    -0.5, 0, -0.5, 0, 1, 0, 0, 0,
    0.5, 0, -0.5, 0, 1, 0, 1, 0,
    0.5, 0, 0.5, 0, 1, 0, 1, 1,
    -0.5, 0, 0.5, 0, 1, 0, 0, 1,
  ])
  // CCW seen from above.
  b.appendIndices([0, 2, 1, 0, 3, 2])
  b.updateMesh()
  shadowQuadCached = b.getMesh()
  return shadowQuadCached
}

/** Tinted material clones, cached by colour so identical pieces share one material. */
export class Mats {
  private cache = new Map<string, Material>()
  private shadowMat: Material | null = null
  private glossMat: Material | null = null

  private tinted(base: Material, kind: string, c: vec4): Material {
    const key = kind + ":" + c.x.toFixed(3) + "," + c.y.toFixed(3) + "," + c.z.toFixed(3) + "," + c.w.toFixed(3)
    let m = this.cache.get(key)
    if (!m) {
      m = base.clone()
      m.mainPass.baseColor = c
      this.cache.set(key, m)
    }
    return m
  }

  /** Matte plastic/wood (the track's PBR material, tinted). */
  pbr(c: vec4): Material {
    const m = this.tinted(PBR_BASE, "pbr", c)
    m.mainPass.roughness = 0.68
    return m
  }

  /** Glossy (marbles, bell). */
  gloss(c: vec4): Material { return this.tinted(GLOSS_BASE, "gloss", c) }

  /** Shiny injection-moulded plastic: the pipes, funnel and connector collars. */
  plastic(c: vec4): Material {
    const m = this.tinted(PBR_BASE, "plastic", c)
    m.mainPass.roughness = 0.13
    return m
  }

  /** The coloured twisted core of a cat's-eye marble. */
  vane(c: vec4): Material {
    const m = this.tinted(PBR_BASE, "vane", c)
    m.mainPass.roughness = 0.45
    return m
  }

  /** The clear outer shell of a glass marble, tinted toward its core colour. */
  glass(c: vec4): Material {
    const tint = new vec4(0.12 + c.x * 0.88, 0.12 + c.y * 0.88, 0.12 + c.z * 0.88, 0.5)
    const m = this.tinted(GLOSS_BASE, "glass", tint)
    m.mainPass.blendMode = BlendMode.Normal
    m.mainPass.depthWrite = false
    m.mainPass.roughness = 0.03
    m.mainPass.metallic = 0
    return m
  }

  /** A reflection-only layer over the glass: adds sharp highlights without hiding what is inside. */
  glassGloss(): Material {
    if (this.glossMat) return this.glossMat
    const m = GLOSS_BASE.clone()
    m.mainPass.baseColor = new vec4(0.3, 0.3, 0.3, 1)
    m.mainPass.blendMode = BlendMode.Add
    m.mainPass.depthWrite = false
    m.mainPass.roughness = 0.02
    m.mainPass.metallic = 1
    this.glossMat = m
    return m
  }

  /** Unlit, fully bright (confetti, ghosts). */
  unlit(c: vec4): Material { return this.tinted(UNLIT_BASE, "unlit", c) }

  /** Soft contact shadow (invisible on the additive display; shapes the preview). */
  shadow(): Material {
    if (this.shadowMat) return this.shadowMat
    const size = 64
    const tex = ProceduralTextureProvider.createWithFormat(size, size, TextureFormat.RGBA8Unorm)
    const data = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x + 0.5) / size * 2 - 1
        const dy = (y + 0.5) / size * 2 - 1
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy))
        const fall = 1 - r * r * (3 - 2 * r)
        const i = (y * size + x) * 4
        data[i] = 0
        data[i + 1] = 0
        data[i + 2] = 0
        data[i + 3] = Math.round(fall * 255)
      }
    }
    ;(tex.control as ProceduralTextureProvider).setPixels(0, 0, size, size, data)
    const m = IMAGE_BASE.clone()
    m.mainPass.baseTex = tex
    m.mainPass.baseColor = new vec4(0, 0, 0, 0.42)
    m.mainPass.depthTest = true
    m.mainPass.depthWrite = false
    this.shadowMat = m
    return m
  }
}

/** Create a child SceneObject with a local position. */
export function makeNode(parent: SceneObject, name: string, pos?: vec3, rot?: quat): SceneObject {
  const so = global.scene.createSceneObject(name)
  so.setParent(parent)
  const t = so.getTransform()
  if (pos) t.setLocalPosition(pos)
  if (rot) t.setLocalRotation(rot)
  return so
}

export function addVisual(parent: SceneObject, name: string, mesh: RenderMesh, mat: Material, pos: vec3, scale: vec3, rot?: quat): RenderMeshVisual {
  const so = makeNode(parent, name, pos, rot)
  so.getTransform().setLocalScale(scale)
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  rmv.mainMaterial = mat
  return rmv
}

/** A visual box of `size` centred at `pos` in `parent` space. */
export function addBox(parent: SceneObject, name: string, size: vec3, pos: vec3, rot: quat | undefined, mat: Material): RenderMeshVisual {
  return addVisual(parent, name, unitBox(), mat, pos, size, rot)
}

/** A visual cylinder between two points in `parent` space. */
export function addCylinderBetween(parent: SceneObject, name: string, a: vec3, b: vec3, radius: number, mat: Material): RenderMeshVisual {
  const mid = a.add(b).uniformScale(0.5)
  const axis = b.sub(a)
  const length = axis.length
  const rot = quat.rotationFromTo(vec3.up(), axis.normalize())
  return addVisual(parent, name, unitCylinder(), mat, mid, new vec3(radius * 2, length, radius * 2), rot)
}

/** A sphere visual of `radius` in `parent` space. */
export function addSphere(parent: SceneObject, name: string, radius: number, pos: vec3, mat: Material): RenderMeshVisual {
  const ext = SPHERE_MESH.aabbMax.sub(SPHERE_MESH.aabbMin)
  const k = radius / (Math.max(ext.x, ext.y, ext.z) / 2 || 1)
  return addVisual(parent, name, SPHERE_MESH, mat, pos, new vec3(k, k, k))
}

/** A soft contact shadow on the table under (x, z) of `parent` (y = 0 is the table). */
export function addShadow(parent: SceneObject, mats: Mats, x: number, z: number, radius: number, sizeZ?: number): RenderMeshVisual {
  const zSize = sizeZ !== undefined ? sizeZ : radius
  return addVisual(parent, "ContactShadow", shadowQuad(), mats.shadow(), new vec3(x, 0.06, z), new vec3(radius * 2, 1, zSize * 2))
}

export function sphereMesh(): RenderMesh { return SPHERE_MESH }

/** Turn a sphere visual into a clear glass marble shell with a coloured twisted core inside. */
export function makeCatsEye(shell: RenderMeshVisual, mats: Mats, core: vec4): RenderMeshVisual {
  shell.mainMaterial = mats.glass(core)
  shell.setRenderOrder(GLASS_RENDER_ORDER)
  const ext = SPHERE_MESH.aabbMax.sub(SPHERE_MESH.aabbMin)
  const k = (Math.max(ext.x, ext.y, ext.z) / 2 || 1) * 0.94
  const gloss = addVisual(shell.getSceneObject(), "GlassGloss", SPHERE_MESH, mats.glassGloss(), vec3.zero(), vec3.one())
  gloss.setRenderOrder(GLASS_RENDER_ORDER + 1)
  return addVisual(shell.getSceneObject(), "CatsEyeVane", catsEyeVaneMesh(), mats.vane(core), vec3.zero(), new vec3(k, k, k))
}

/** Add the orange connector collars around a channel built from `frames`. */
export function addChannelCollars(parent: SceneObject, frames: PathFrame[], profile: TrackProfile, mats: Mats): void {
  const mesh = buildCollarMesh(frames, profile, COLLAR_SPACING_CM)
  if (!mesh) return
  const so = makeNode(parent, "Collars")
  const rmv = so.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
  rmv.mesh = mesh
  rmv.mainMaterial = mats.plastic(COLLAR_COLOR)
}
