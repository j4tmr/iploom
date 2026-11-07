/**
 * Tracks open overlays (modals, the command palette) in the order they were
 * opened so that only the topmost one reacts to Escape or a backdrop click.
 *
 * The stack is deliberately pure: the React layer registers layers and the app
 * installs one capture-phase key listener, which keeps every overlay from
 * racing every other one for the same key press.
 */
export interface OverlayLayer {
  /** Called on Escape while this layer is topmost. */
  onEscape?: () => void;
  /** Called when this layer's backdrop is clicked while it is topmost. */
  onBackdrop?: () => void;
}

export interface OverlayKeyEvent {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  preventDefault?: () => void;
  stopPropagation?: () => void;
}

/**
 * While an IME candidate window is open, Escape cancels the composition rather
 * than the dialog. Safari reports this through `isComposing`; Chrome/Electron
 * may report keyCode 229 with `isComposing` false.
 */
export function isComposingEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

export class OverlayStack {
  private layers: OverlayLayer[] = [];

  push(layer: OverlayLayer): () => void {
    this.layers.push(layer);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = this.layers.indexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
    };
  }

  get size(): number {
    return this.layers.length;
  }

  hasLayers(): boolean {
    return this.layers.length > 0;
  }

  top(): OverlayLayer | undefined {
    return this.layers.at(-1);
  }

  isTop(layer: OverlayLayer): boolean {
    return this.top() === layer;
  }

  /**
   * Route Escape to the topmost layer. Returns true when the event belonged to
   * an overlay (and was therefore consumed).
   */
  handleKeydown(event: OverlayKeyEvent): boolean {
    if (event.key !== "Escape") return false;
    const layer = this.top();
    if (!layer) return false;
    if (isComposingEvent(event)) return true;
    event.preventDefault?.();
    event.stopPropagation?.();
    layer.onEscape?.();
    return true;
  }

  /** Route a backdrop click to a layer when it is the topmost one. */
  handleBackdrop(layer: OverlayLayer): boolean {
    if (!this.isTop(layer)) return false;
    layer.onBackdrop?.();
    return true;
  }

  /** Test helper: drop every registered layer. */
  clear(): void {
    this.layers = [];
  }
}

export const overlayStack = new OverlayStack();

/**
 * Install the single window-level Escape listener for the stack. Capture phase
 * lets the top overlay win before controls (textareas, selects) handle the key.
 */
export function attachOverlayKeyboard(
  stack: OverlayStack,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    stack.handleKeydown(event);
  };
  target.addEventListener("keydown", onKeyDown, true);
  return () => target.removeEventListener("keydown", onKeyDown, true);
}
