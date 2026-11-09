/**
 * MarbleRunTrackGeometry — pure geometry for marble channels.
 *
 * Owns: centripetal Catmull-Rom path sampling, polyline resampling/smoothing,
 * banked path frames, and building a thick U-channel mesh via MeshBuilder.
 * No scene access beyond returning a RenderMesh.
 *
 * Profile (cross-section) space: x = sideways, y = channel "up". The arc centre
 * sits on the path, so the channel floor is `innerRadiusCm` below the path.
 */

export interface TrackProfile {
  innerRadiusCm: number
  lipHeightCm: number
  wallThicknessCm: number
  arcSegments: number
}

export interface PathFrame {
  p: vec3
  t: vec3
  n: vec3 // channel "up", banked toward the inside of curves
  s: vec3 // sideways
}

/** Centripetal Catmull-Rom through `control`, sampled at about `spacingCm`. */
export function catmullRomPath(control: vec3[], spacingCm: number): vec3[] {
  if (control.length < 2) return control.slice()
  const n = control.length
  const pts = [control[0].add(control[0].sub(control[1]))]
  for (const p of control) pts.push(p)
  pts.push(control[n - 1].add(control[n - 1].sub(control[n - 2])))

  const out: vec3[] = []
  const interpolate = (a: vec3, b: vec3, u: number): vec3 => a.add(b.sub(a).uniformScale(u))
  for (let i = 1; i < pts.length - 2; i++) {
    const p0 = pts[i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2]
    const t0 = 0
    const t1 = t0 + Math.pow(p1.distance(p0), 0.5)
    const t2 = t1 + Math.pow(p2.distance(p1), 0.5)
    const t3 = t2 + Math.pow(p3.distance(p2), 0.5)
    const steps = Math.max(4, Math.ceil(p1.distance(p2) / (spacingCm * 0.5)))
    for (let k = 0; k < steps; k++) {
      const t = t1 + ((t2 - t1) * k) / steps
      const a1 = interpolate(p0, p1, (t - t0) / (t1 - t0))
      const a2 = interpolate(p1, p2, (t - t1) / (t2 - t1))
      const a3 = interpolate(p2, p3, (t - t2) / (t3 - t2))
      const b1 = interpolate(a1, a2, (t - t0) / (t2 - t0))
      const b2 = interpolate(a2, a3, (t - t1) / (t3 - t1))
      out.push(interpolate(b1, b2, (t - t1) / (t2 - t1)))
    }
  }
  out.push(control[n - 1])
  return resamplePolyline(out, spacingCm)
}

/** Resample a polyline to (approximately) uniform spacing, keeping both ends. */
export function resamplePolyline(points: vec3[], spacingCm: number): vec3[] {
  if (points.length < 2) return points.slice()
  const out: vec3[] = [points[0]]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const seg = points[i].sub(a)
    const len = seg.length
    if (len < 1e-4) continue
    let d = spacingCm - carry
    while (d <= len) {
      out.push(a.add(seg.uniformScale(d / len)))
      d += spacingCm
    }
    carry = len - (d - spacingCm)
  }
  const last = points[points.length - 1]
  if (out[out.length - 1].distance(last) > spacingCm * 0.3) out.push(last)
  else out[out.length - 1] = last
  return out
}

/** Laplacian smoothing that keeps both endpoints fixed. */
export function smoothPolyline(points: vec3[], passes: number): vec3[] {
  let pts = points.slice()
  for (let p = 0; p < passes; p++) {
    const next = pts.slice()
    for (let i = 1; i < pts.length - 1; i++) {
      next[i] = pts[i - 1].add(pts[i].uniformScale(2)).add(pts[i + 1]).uniformScale(0.25)
    }
    pts = next
  }
  return pts
}

export function polylineLength(points: vec3[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) len += points[i].distance(points[i - 1])
  return len
}

/**
 * Path frames with banking: curves lean the channel toward their centre by
 * `bankGain * curvature` (degrees), clamped to maxBankDeg and smoothed along the path.
 */
export function computeFrames(points: vec3[], bankGain: number, maxBankDeg: number): PathFrame[] {
  const n = points.length
  const tangents: vec3[] = []
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]
    const b = points[Math.min(n - 1, i + 1)]
    let t = b.sub(a)
    if (t.length < 1e-5) t = i > 0 ? tangents[i - 1] : vec3.forward()
    tangents.push(t.normalize())
  }
  // Base up: world up perpendicular to the tangent, falling back to the previous one on verticals.
  const ups: vec3[] = []
  let prevUp = vec3.up()
  for (let i = 0; i < n; i++) {
    let u = vec3.up().sub(tangents[i].uniformScale(vec3.up().dot(tangents[i])))
    if (u.length < 0.15) u = prevUp.sub(tangents[i].uniformScale(prevUp.dot(tangents[i])))
    u = u.normalize()
    ups.push(u)
    prevUp = u
  }
  // Signed bank angle from curvature; positive leans up toward +side.
  const bank = new Array<number>(n).fill(0)
  const maxBank = (maxBankDeg * Math.PI) / 180
  for (let i = 1; i < n - 1; i++) {
    const ds = Math.max(points[i + 1].distance(points[i - 1]), 1e-4)
    const curv = tangents[i + 1].sub(tangents[i - 1]).uniformScale(1 / ds)
    const s = tangents[i].cross(ups[i])
    const sideways = curv.dot(s)
    const angle = (bankGain * Math.abs(sideways) * Math.PI) / 180
    bank[i] = Math.sign(sideways) * Math.min(angle, maxBank)
  }
  // Smooth the bank angle so curve entries transition gently.
  const R = 4
  const frames: PathFrame[] = []
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let k = Math.max(0, i - R); k <= Math.min(n - 1, i + R); k++) {
      sum += bank[k]
      count++
    }
    const b = sum / count
    const baseSide = tangents[i].cross(ups[i]).normalize()
    const up = ups[i].uniformScale(Math.cos(b)).add(baseSide.uniformScale(Math.sin(b))).normalize()
    frames.push({p: points[i], t: tangents[i], n: up, s: tangents[i].cross(up).normalize()})
  }
  return frames
}

function innerProfile(pr: TrackProfile): {pts: vec2[]; nrm: vec2[]} {
  const pts: vec2[] = []
  const nrm: vec2[] = []
  const r = pr.innerRadiusCm
  pts.push(new vec2(-r, pr.lipHeightCm))
  nrm.push(new vec2(1, 0))
  for (let k = 0; k <= pr.arcSegments; k++) {
    const a = Math.PI + (Math.PI * k) / pr.arcSegments
    pts.push(new vec2(r * Math.cos(a), r * Math.sin(a)))
    nrm.push(new vec2(-Math.cos(a), -Math.sin(a)))
  }
  pts.push(new vec2(r, pr.lipHeightCm))
  nrm.push(new vec2(-1, 0))
  return {pts, nrm}
}

/** A path frame `d` cm along `frames`, given their cumulative arc lengths. */
function frameAt(frames: PathFrame[], arc: number[], d: number): PathFrame {
  let i = 0
  while (i < frames.length - 2 && arc[i + 1] < d) i++
  const span = Math.max(arc[i + 1] - arc[i], 1e-4)
  const u = Math.min(1, Math.max(0, (d - arc[i]) / span))
  const a = frames[i]
  const b = frames[i + 1]
  const t = vec3.lerp(a.t, b.t, u).normalize()
  const n = vec3.lerp(a.n, b.n, u).normalize()
  return {p: vec3.lerp(a.p, b.p, u), t, n, s: t.cross(n).normalize()}
}

/**
 * Raised connector bands clamped around the outside of a channel, like the joints
 * between the sections of a real toy run. Visual only: they sit outside the wall,
 * clear of the marble's path. Shoulders slope to the wall so no end caps are needed.
 */
export function buildCollarMesh(frames: PathFrame[], pr: TrackProfile, spacingCm: number): RenderMesh | null {
  if (frames.length < 2) return null
  const arc = [0]
  for (let i = 1; i < frames.length; i++) arc.push(arc[i - 1] + frames[i].p.distance(frames[i - 1].p))
  const total = arc[arc.length - 1]
  const margin = 5
  if (total < margin * 2 + 2) return null
  const count = Math.max(1, Math.floor((total - margin * 2) / spacingCm))
  const step = (total - margin * 2) / count

  const inner = innerProfile(pr)
  const P = inner.pts.length
  const wall = pr.innerRadiusCm + pr.wallThicknessCm
  const thick = 0.42
  const halfWidth = 0.95
  const shoulder = 0.3
  const lipTop = pr.lipHeightCm + 0.3
  // Each ring: offset along the path, band radius, and how far its normal leans along the path.
  const rings = [
    {d: -halfWidth, r: wall, lean: -0.7},
    {d: -halfWidth + shoulder, r: wall + thick, lean: -0.25},
    {d: halfWidth - shoulder, r: wall + thick, lean: 0.25},
    {d: halfWidth, r: wall, lean: 0.7},
  ]
  const columns = (r: number): {x: number; y: number; nx: number; ny: number}[] => {
    const out = [{x: -wall, y: lipTop, nx: 0, ny: 1}]
    for (let k = 0; k < P; k++) {
      const p = inner.pts[k]
      const q = k === 0 || k === P - 1 ? new vec2(Math.sign(p.x) * r, lipTop) : p.uniformScale(r / pr.innerRadiusCm)
      const edge = k === 0 || k === P - 1
      out.push({x: q.x, y: q.y, nx: edge ? -inner.nrm[k].x * 0.7 : -inner.nrm[k].x, ny: edge ? 0.7 : -inner.nrm[k].y})
    }
    out.push({x: wall, y: lipTop, nx: 0, ny: 1})
    return out
  }

  const verts: number[] = []
  const idx: number[] = []
  let base = 0
  const cols = P + 2
  for (let c = 0; c <= count; c++) {
    const centre = margin + c * step
    for (let ring = 0; ring < rings.length; ring++) {
      const f = frameAt(frames, arc, centre + rings[ring].d)
      const col = columns(rings[ring].r)
      for (let k = 0; k < cols; k++) {
        const pos = f.p.add(f.s.uniformScale(col[k].x)).add(f.n.uniformScale(col[k].y))
        const nrm = f.s.uniformScale(col[k].nx).add(f.n.uniformScale(col[k].ny)).add(f.t.uniformScale(rings[ring].lean)).normalize()
        verts.push(pos.x, pos.y, pos.z, nrm.x, nrm.y, nrm.z, k / (cols - 1), ring / (rings.length - 1))
      }
    }
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let k = 0; k < cols - 1; k++) {
        const a = base + ring * cols + k
        const b = base + (ring + 1) * cols + k
        idx.push(a, b + 1, b, a, a + 1, b + 1)
      }
    }
    base += rings.length * cols
  }
  if (base > 65000) return null
  const builder = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
    {name: "texture0", components: 2},
  ])
  builder.topology = MeshTopology.Triangles
  builder.indexType = MeshIndexType.UInt16
  builder.appendVerticesInterleaved(verts)
  builder.appendIndices(idx)
  if (!builder.isValid()) return null
  builder.updateMesh()
  return builder.getMesh()
}

/**
 * Build a thick U-channel mesh along `frames` (points in the owner's local space).
 * The start of the path gets a closed back wall when `capStart` is set.
 * `innerOnly` omits the outer shell (collision only needs the surfaces a marble touches).
 */
export function buildChannelMesh(
  frames: PathFrame[],
  pr: TrackProfile,
  capStart: boolean,
  innerOnly: boolean = false
): RenderMesh | null {
  if (frames.length < 2) return null
  const inner = innerProfile(pr)
  const outerR = pr.innerRadiusCm + pr.wallThicknessCm
  const outerPts: vec2[] = inner.pts.map((p, i) => {
    if (i === 0) return new vec2(-outerR, pr.lipHeightCm)
    if (i === inner.pts.length - 1) return new vec2(outerR, pr.lipHeightCm)
    return p.uniformScale(outerR / pr.innerRadiusCm)
  })
  const P = inner.pts.length

  const builder = new MeshBuilder([
    {name: "position", components: 3},
    {name: "normal", components: 3, normalized: true},
    {name: "texture0", components: 2},
  ])
  builder.topology = MeshTopology.Triangles
  builder.indexType = MeshIndexType.UInt16

  const verts: number[] = []
  const idx: number[] = []
  let vCount = 0
  const toLocal = (f: PathFrame, x: number, y: number): vec3 => f.p.add(f.s.uniformScale(x)).add(f.n.uniformScale(y))
  const toDir = (f: PathFrame, x: number, y: number): vec3 => f.s.uniformScale(x).add(f.n.uniformScale(y)).normalize()
  const pushV = (pos: vec3, n: vec3, u: number, v: number): number => {
    verts.push(pos.x, pos.y, pos.z, n.x, n.y, n.z, u, v)
    return vCount++
  }

  // Extrude a 2D strip along all frames; `flip` reverses winding so the CCW
  // front face agrees with the supplied normals.
  const extrude = (pts: vec2[], nrm: vec2[], flip: boolean): void => {
    const base = vCount
    const cols = pts.length
    for (let i = 0; i < frames.length; i++) {
      for (let k = 0; k < cols; k++) {
        pushV(toLocal(frames[i], pts[k].x, pts[k].y), toDir(frames[i], nrm[k].x, nrm[k].y), k / (cols - 1), i)
      }
    }
    for (let i = 0; i < frames.length - 1; i++) {
      for (let k = 0; k < cols - 1; k++) {
        const a = base + i * cols + k
        const b = base + (i + 1) * cols + k
        if (flip) idx.push(a, b + 1, b, a, a + 1, b + 1)
        else idx.push(a, b, b + 1, a, b + 1, a + 1)
      }
    }
  }

  extrude(inner.pts, inner.nrm, true)
  if (!innerOnly) extrude(outerPts, inner.nrm.map((n) => n.uniformScale(-1)), false)
  extrude([outerPts[0], inner.pts[0]], [new vec2(0, 1), new vec2(0, 1)], true)
  extrude([inner.pts[P - 1], outerPts[P - 1]], [new vec2(0, 1), new vec2(0, 1)], true)

  if (capStart) {
    const f = frames[0]
    const back = f.t.uniformScale(-1)
    const centre = pushV(toLocal(f, 0, (pr.lipHeightCm - pr.innerRadiusCm) * 0.3), back, 0.5, 0)
    const ring: number[] = []
    for (let k = 0; k < P; k++) ring.push(pushV(toLocal(f, outerPts[k].x, outerPts[k].y), back, 0, 0))
    for (let k = 0; k < P - 1; k++) idx.push(centre, ring[k], ring[k + 1])
    idx.push(centre, ring[P - 1], ring[0])
  }

  if (vCount > 65000) return null
  builder.appendVerticesInterleaved(verts)
  builder.appendIndices(idx)
  if (!builder.isValid()) return null
  builder.updateMesh()
  return builder.getMesh()
}
