export class ObjectUrlRegistry {
  private readonly urls = new Set<string>()

  create(source: Blob): string {
    const url = URL.createObjectURL(source)
    this.urls.add(url)
    return url
  }

  release(url: string): void {
    if (!this.urls.delete(url)) return
    URL.revokeObjectURL(url)
  }

  releaseAll(): void {
    for (const url of this.urls) URL.revokeObjectURL(url)
    this.urls.clear()
  }

  get size(): number {
    return this.urls.size
  }
}
