// Shared between the extension-side renderer (which serialises this into a
// `<script type="application/json">` tag) and the bundled browser client
// (which parses it back into a typed config object).

export interface ViewportConfig {
    /** Initial zoom factor used when no persisted state exists. */
    initialScale: number;
    /** When set, the initial centre is computed from this class box. */
    focusNodeId?: string;
    /** Multiplier applied to pointermove deltas while panning. */
    panSensitivity: number;
    /** Per-wheel-tick scale factor (1 + step). */
    zoomStep: number;
}
