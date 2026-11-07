export interface SaveRetryOptions {
  attempts?: number;
  delayMs?: number;
  /** Stop retrying once a newer save has superseded this one. */
  isCurrent?: () => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Retry a save a few times with backoff so a transient filesystem error does
 * not leave the document dirty until the user happens to type again.
 */
export async function retrySave<T>(
  operation: () => Promise<T>,
  options: SaveRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 500;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.isCurrent && !options.isCurrent())
      throw new Error("Save superseded by a newer edit");
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (options.isCurrent && !options.isCurrent()) throw error;
      if (attempt < attempts - 1) await sleep(delayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
