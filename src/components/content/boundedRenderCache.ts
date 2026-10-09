export function estimateTextBytes(value: unknown): number {
  if (typeof value === 'string') return value.length * 2
  if (Array.isArray(value)) return value.reduce((total, entry) => total + estimateTextBytes(entry), 0)
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((total, [key, entry]) => total + key.length * 2 + estimateTextBytes(entry), 0)
  }
  return 8
}

export class BoundedRenderCache<K, V> extends Map<K, V> {
  private weights = new Map<K, number>()
  private bytes = 0

  constructor(private readonly byteLimit = 2 * 1024 * 1024, private readonly entryLimit = 256 * 1024) {
    super()
  }

  get estimatedBytes(): number { return this.bytes }

  touch(key: K): void {
    if (!this.has(key)) return
    const value = super.get(key) as V
    super.delete(key)
    super.set(key, value)
  }

  override set(key: K, value: V): this {
    this.delete(key)
    const weight = estimateTextBytes(key) + estimateTextBytes(value)
    if (weight > this.entryLimit || weight > this.byteLimit) return this
    while (this.bytes + weight > this.byteLimit && this.size > 0) {
      this.delete(this.keys().next().value as K)
    }
    this.weights.set(key, weight)
    this.bytes += weight
    return super.set(key, value)
  }

  override delete(key: K): boolean {
    this.bytes -= this.weights.get(key) ?? 0
    this.weights.delete(key)
    return super.delete(key)
  }

  override clear(): void {
    this.bytes = 0
    this.weights.clear()
    super.clear()
  }
}
