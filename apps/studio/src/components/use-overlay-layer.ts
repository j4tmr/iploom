import { useEffect, useMemo, useRef } from "react";
import { overlayStack, type OverlayLayer } from "../core/overlay-stack.ts";

export interface OverlayHandlers {
  onEscape?: () => void;
  onBackdrop?: () => void;
}

/**
 * Register a React overlay on the shared stack while it is open. The layer
 * object is stable for the lifetime of the component, so re-rendering (or a
 * handler identity change) never moves it above a newer overlay.
 */
export function useOverlayLayer(
  open: boolean,
  handlers: OverlayHandlers,
): OverlayLayer {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const layer = useMemo<OverlayLayer>(
    () => ({
      onEscape: () => latest.current.onEscape?.(),
      onBackdrop: () => latest.current.onBackdrop?.(),
    }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    return overlayStack.push(layer);
  }, [layer, open]);
  return layer;
}
