// One application process owns one SQLite database and the local inference queue.
export function createRateLimiter({ maximum = 240, windowMs = 60000, capacity = 10000 } = {}) {
  const buckets = new Map();
  return key => {
    const now = Date.now();
    if (buckets.size >= capacity) for (const [id, bucket] of buckets) if (bucket.until <= now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (!bucket && buckets.size >= capacity) return false;
      bucket = { count: 0, until: now + windowMs };buckets.set(key, bucket);
    }
    return ++bucket.count <= maximum;
  };
}
