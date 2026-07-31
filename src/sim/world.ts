// Minimal deterministic entity store. Backed by a Map (never a plain object
// keyed by numeric-like strings — JS silently reorders those ascending,
// which would break deterministic iteration order across runs/speeds).

export class World<T> {
  private entities = new Map<string, T>();

  addEntity(id: string, data: T): void {
    this.entities.set(id, data);
  }

  getEntity(id: string): T | undefined {
    return this.entities.get(id);
  }

  has(id: string): boolean {
    return this.entities.has(id);
  }

  // Always walks in insertion order, regardless of when entities were
  // added relative to each other — Map guarantees this per spec.
  *values(): IterableIterator<T> {
    yield* this.entities.values();
  }

  *entries(): IterableIterator<[string, T]> {
    yield* this.entities.entries();
  }

  get size(): number {
    return this.entities.size;
  }
}
