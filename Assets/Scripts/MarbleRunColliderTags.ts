/**
 * MarbleRunColliderTags — tiny shared registry mapping physics colliders to a
 * surface kind, so collision handlers can pick the right sound and identify marbles.
 *
 * Owns: the tag map only. Must not hold game state.
 */
export type SurfaceKind = "track" | "floor" | "cup" | "marble" | "domino" | "shelf"

const tags = new Map<ColliderComponent, SurfaceKind>()

export function tagCollider(c: ColliderComponent, kind: SurfaceKind): void {
  tags.set(c, kind)
}

export function untagCollider(c: ColliderComponent): void {
  tags.delete(c)
}

export function surfaceKindOf(c: ColliderComponent): SurfaceKind | null {
  return tags.get(c) ?? null
}

/** Recursively toggle collider wireframes under `root` (debug). */
export function setColliderDebugAll(root: SceneObject, on: boolean): void {
  const cols = root.getComponents("Physics.ColliderComponent") as ColliderComponent[]
  for (const c of cols) c.debugDrawEnabled = on
  const bodies = root.getComponents("Physics.BodyComponent") as BodyComponent[]
  for (const b of bodies) b.debugDrawEnabled = on
  for (let i = 0; i < root.getChildrenCount(); i++) setColliderDebugAll(root.getChild(i), on)
}
