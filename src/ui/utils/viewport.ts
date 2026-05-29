import * as fs from 'fs';
import * as path from 'path';
import { Theme, UI } from '../../config';
import { FindBar, WebViewOptions } from '../components';
import type { FilterInfo } from '../components/WebViewOptions';
import type { ViewportConfig } from '../viewport/types';

export function renderBaseStyles(): string {
    return `<style>
    text {
        font-family: ${Theme.font.family};
    }

    body, #svgRoot {
        background: ${Theme.colors.background};
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
</style>`;
}

// Static-style hover/tooltip rules consumed by the bundled client script.
// Kept in this file (not the client) so they live alongside the other
// extension-side style strings; the client just wires up the behaviour.
function renderClientStyles(): string {
    return `<style>
  #find-bar button {
    background: transparent;
    border: 1px solid var(--pt-border);
    color: var(--pt-text);
    border-radius: 3px;
    cursor: pointer;
    padding: 2px 8px;
    font-size: 11px;
  }
  #find-bar button:hover { background: var(--pt-border); }
  #find-close { border: none !important; color: #888 !important; padding: 2px 5px !important; }
  #find-close:hover { color: var(--pt-text) !important; background: transparent !important; }
  #find-input:focus { outline: 1px solid #007acc; }
  #paths-toggle label { cursor: pointer; user-select: none; }
  #paths-toggle input { cursor: pointer; }
  .find-toggle.active { background: rgba(0,122,204,0.25) !important; border-color: #007acc !important; }
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
    background: var(--pt-panel-bg, #1e1e1e);
    border: 1px solid var(--pt-border, #444);
    color: var(--pt-text, #ccc);
    font-size: 12px;
    font-family: monospace;
    padding: 4px 8px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 2000;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
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
    } = {}
): string {
    const config: ViewportConfig = {
        initialScale: opts.initialScale ?? 1,
        focusNodeId: opts.focusNodeId,
        panSensitivity: UI.pan.sensitivity,
        zoomStep: UI.zoom.step,
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
${WebViewOptions(opts.filterInfo)}
${FindBar()}
<div id="edge-tooltip"></div>
<div id="nav-tooltip">Go to definition</div>
${configTag}
${clientScriptTag}
`;
}
