/**
 * Persist pending edits, then store a snapshot outside the rotating `.bak`
 * slot. Returns false when no snapshot was stored. A null snapshot (missing or
 * unhealthy primary workspace file) is a failure, not a success: the caller
 * must abort the destructive action or the deleted content would have no
 * recoverable copy.
 */
export async function prepareSnapshot(
  saveNow: () => Promise<void>,
  createSnapshot: (reason: string) => Promise<string | null>,
  reason: string,
): Promise<boolean> {
  await saveNow();
  return (await createSnapshot(reason)) !== null;
}
