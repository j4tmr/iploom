import { GlobalRegistrator } from "@happy-dom/global-registrator";

// bun:test has no DOM. Registering happy-dom before the component modules load
// gives them document/window/localStorage; React portals and the capture-phase
// window listener the overlay stack relies on both need a real DOM.
//
// This file is wired as `[test].preload` in bunfig.toml, not just imported by
// the component tests, because react-dom computes its browser capabilities
// once, at import time. Loaded without a DOM it concludes the platform has no
// `input` event support and takes its legacy fallback, where a controlled
// input's `onChange` never fires — while `onInput` still does, so the failure
// looks like a broken component instead of a broken environment.
if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register();
}
