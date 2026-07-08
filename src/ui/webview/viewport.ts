import * as fs from 'fs';
import * as path from 'path';
import { Theme, UI } from '../../config';
import { FindBar, WebViewOptions } from '../components';
import type { FilterInfo } from '../components/WebViewOptions';
import type { ViewportConfig } from '../viewport/types';

export function renderBaseStyles(): string {
    // Gradient defs live inside the SVG document so they travel with the
    // exported clone. Stops reference the theme CSS vars, which the SVG export
    // path bakes into a :root block (see viewport client `export-as-svg`).
    const defs = `<defs>
    <linearGradient id="pt-header-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--pt-header-bg-top)"/>
        <stop offset="100%" stop-color="var(--pt-header-bg-bot)"/>
    </linearGradient>
    <linearGradient id="pt-abstract-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--pt-abstract-bg-top)"/>
        <stop offset="100%" stop-color="var(--pt-abstract-bg-bot)"/>
    </linearGradient>
</defs>`;

    return `${defs}<style>
    text {
        font-family: ${Theme.font.family};
    }

    body, #svgRoot {
        background: ${Theme.colors.background};
    }

    /* Soft elevation on every class box; dropped while actively zooming so the
       wheel stays smooth, and on huge (lazy) trees where hundreds of filters
       would jank the pan. */
    [data-pt-box] {
        filter: drop-shadow(0 2px 5px rgba(0,0,0,0.32));
        transition: filter 0.12s ease;
    }
    [data-pt-box]:hover {
        filter: drop-shadow(0 5px 13px rgba(0,0,0,0.45));
    }
    #svgRoot.zooming [data-pt-box],
    #svgRoot.lazy-tree [data-pt-box] {
        filter: none;
    }

    [data-pt-role="class"]:hover text {
        text-decoration: underline;
        text-decoration-color: var(--pt-hover-underline);
    }

    .file-path-section {
        opacity: 0;
        transition: opacity 0.15s ease;
    }
    [data-pt-box]:hover .file-path-section,
    #svgRoot.show-paths .file-path-section {
        opacity: 1;
    }

    #svgRoot.zooming text {
        visibility: hidden;
    }

    /* Collapse: the two panel variants (full box vs. small collapsed panel)
       toggle on data-pt-collapsed, set by a data-pt-collapse-toggle click.
       .pt-collapsed-title gets a counter-scale transform from the client so
       its text stays legible when zoomed out. */
    [data-pt-box][data-pt-collapsed] .pt-panel-expanded {
        display: none;
    }
    [data-pt-box][data-pt-collapsed] .pt-box-body {
        display: none;
    }
    [data-pt-box]:not([data-pt-collapsed]) .pt-panel-collapsed {
        display: none;
    }
    [data-pt-collapse-toggle],
    [data-pt-hide-descendants],
    [data-pt-hide-ancestors] {
        cursor: pointer !important;
        opacity: 0.75;
    }
    [data-pt-collapse-toggle]:hover,
    [data-pt-hide-descendants]:hover,
    [data-pt-hide-ancestors]:hover {
        opacity: 1;
    }
    .pt-collapsed-title {
        transform-box: fill-box;
        transform-origin: center;
    }

    /* Hide descendants/ancestors: the target boxes get data-pt-hidden; the
       triggering box gets data-pt-descendants-hidden / -ancestors-hidden so
       its own button can highlight while active. */
    [data-pt-box][data-pt-hidden] {
        display: none;
    }
    [data-pt-box][data-pt-descendants-hidden] [data-pt-hide-descendants] circle {
        fill: var(--pt-accent);
    }
    [data-pt-box][data-pt-ancestors-hidden] [data-pt-hide-ancestors] circle {
        fill: var(--pt-accent);
    }

    /* "Show collapse tools" checkbox: hides the collapse/hide-subtree
       buttons on every box (they stay functionally inert since they're not
       clickable while hidden). */
    #svgRoot.hide-collapse-tools [data-pt-collapse-toggle],
    #svgRoot.hide-collapse-tools [data-pt-hide-descendants],
    #svgRoot.hide-collapse-tools [data-pt-hide-ancestors] {
        display: none;
    }
</style>`;
}

// Static-style hover/tooltip rules consumed by the bundled client script.
// Kept in this file (not the client) so they live alongside the other
// extension-side style strings; the client just wires up the behaviour.
function renderClientStyles(): string {
    return `<style>
  #find-bar button {
    background: transparent;
    border: 1px solid var(--pt-glass-border);
    color: var(--pt-text);
    border-radius: 6px;
    cursor: pointer;
    padding: 3px 8px;
    font-size: 11px;
    transition: background 0.12s ease, border-color 0.12s ease;
  }
  #find-bar button:hover { background: var(--pt-glass-hover); }
  #find-close { border: none !important; color: #888 !important; padding: 2px 5px !important; }
  #find-close:hover { color: var(--pt-text) !important; background: transparent !important; }
  #find-input:focus { outline: none; border-color: var(--pt-accent) !important; box-shadow: 0 0 0 3px var(--pt-focus-ring); }
  #svgRoot.drag-unlocked [data-pt-component-id] [data-pt-box] {
    cursor: grab;
  }
  .find-toggle.active { background: var(--pt-accent-soft) !important; border-color: var(--pt-accent) !important; color: var(--pt-accent) !important; }
  [data-pt-edge-role="tip"]:hover polygon[fill="none"] {
    transform-box: fill-box;
    transform-origin: top center;
    transform: scale(1.5);
  }
  .pt-edge-body-vis { transition: stroke-width 0.1s ease; }
  [data-pt-edge-role="body"]:hover .pt-edge-body-vis { stroke-width: 2.5; }
  #edge-tooltip, #nav-tooltip {
    position: fixed;
    display: none;
    background: var(--pt-glass-bg, #1e1e1e);
    -webkit-backdrop-filter: blur(12px) saturate(150%);
    backdrop-filter: blur(12px) saturate(150%);
    border: 1px solid var(--pt-glass-border, #444);
    color: var(--pt-text, #ccc);
    font-size: 12px;
    font-family: monospace;
    padding: 5px 9px;
    border-radius: 7px;
    pointer-events: none;
    z-index: 2000;
    white-space: nowrap;
    box-shadow: var(--pt-shadow-float);
  }
</style>`;
}

// The bundled client JS lives at dist/viewport.client.js (see esbuild.js).
// We read it once and reuse; the bundle is small and the extension process
// is long-lived, so caching keeps repeated webview opens fast.
let _cachedClientJs: string | null = null;
function loadClientJs(): string {
    if (_cachedClientJs !== null) {
        return _cachedClientJs;
    }
    // After esbuild bundles src/extension.ts, __dirname resolves to the
    // dist/ directory at runtime; the viewport client bundle sits alongside.
    const filePath = path.join(__dirname, 'viewport.client.js');
    _cachedClientJs = fs.readFileSync(filePath, 'utf-8');
    return _cachedClientJs;
}

function escapeScriptJson(json: string): string {
    // Escape `</` so a body containing literal "</script>" (e.g. a default
    // value with a fragment) can't terminate the script tag early.
    return json.replace(/<\//g, '<\\/');
}

export function renderViewportScript(
    opts: {
        initialScale?: number;
        focusNodeId?: string;
        filterInfo?: FilterInfo;
        // When provided, the script wires up viewport-driven body hydration:
        // each box's heavy content is parked in this map and only injected
        // into its <g data-pt-lazy-body> slot when the box (or a generous
        // margin around it) intersects the visible viewport.
        lazyBodies?: Array<[string, string]>;
        // Project Tree only, for now: wires up the "Unlock class dragging"
        // checkbox + drag interactions for whole connected-component trees.
        dragEnabled?: boolean;
    } = {}
): string {
    const config: ViewportConfig = {
        initialScale: opts.initialScale ?? 1,
        focusNodeId: opts.focusNodeId,
        panSensitivity: UI.pan.sensitivity,
        zoomStep: UI.zoom.step,
        dragEnabled: opts.dragEnabled,
    };

    const configTag = `<script type="application/json" id="pt-viewport-config">${escapeScriptJson(
        JSON.stringify(config)
    )}</script>`;

    const lazyDataTag = opts.lazyBodies
        ? `<script type="application/json" id="pt-lazy-bodies">${escapeScriptJson(
              JSON.stringify(opts.lazyBodies)
          )}</script>`
        : '';

    const clientScriptTag = `<script>${loadClientJs()}</script>`;

    return `
${lazyDataTag}
${renderClientStyles()}
${WebViewOptions(opts.filterInfo, opts.dragEnabled)}
${FindBar()}
<div id="edge-tooltip"></div>
<div id="nav-tooltip">Go to definition</div>
${configTag}
${clientScriptTag}
`;
}
