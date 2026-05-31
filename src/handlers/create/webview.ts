// Self-contained interactive board for PyTree: Create.
//
// The board is rendered as plain HTML (not SVG) so boxes can host real
// <input>/<select> controls for editing. Edges are drawn in an SVG layer
// behind the boxes. All state lives in the webview; the extension is only
// involved when the user clicks "Create" (and when listing existing modules
// for the module-name autocomplete).

import { Messages } from '../../config';
import { renderRootStyles } from '../../ui/components/HtmlRoot';

const PY_BUILTIN_TYPES = [
    'int',
    'str',
    'float',
    'bool',
    'bytes',
    'bytearray',
    'list',
    'tuple',
    'dict',
    'set',
    'frozenset',
    'None',
    'NoneType',
    'object',
    'type',
    'complex',
    'Any',
    'Optional',
    'Union',
    'List',
    'Tuple',
    'Dict',
    'Set',
    'FrozenSet',
    'Iterable',
    'Iterator',
    'Generator',
    'Callable',
    'Sequence',
    'Mapping',
    'MutableMapping',
    'MutableSequence',
    'AbstractSet',
    'Awaitable',
    'Coroutine',
    'AsyncIterator',
    'AsyncIterable',
    'Self',
    'ClassVar',
    'Final',
    'Literal',
    'Type',
    'TypeVar',
    'Annotated',
    'Protocol',
    'TypedDict',
    'NamedTuple',
    'Hashable',
    'Sized',
    'Iterator',
];

const toolsMessages = Messages.webView.create.tools;
export interface ExistingModuleInfo {
    name: string;
    relativePath: string;
    fileUri: string;
}

export function renderCreateBoard(
    workspaceClassNames: string[],
    existingModules: ExistingModuleInfo[],
    edgeLayoutScript: string,
    clientScript: string
): string {
    const knownTypes = [
        ...new Set([...PY_BUILTIN_TYPES, ...workspaceClassNames]),
    ];

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
${renderRootStyles()}
<style>
  :root {
    --pt-canvas-bg: var(--pt-bg);
    --pt-toolbar-fg: var(--pt-text);
    --pt-btn-active: var(--pt-accent-soft);
    --pt-btn-hover: var(--pt-glass-hover);
    --pt-module-bg: rgba(78, 201, 176, 0.08);
    --pt-module-border: rgba(78, 201, 176, 0.55);
  }
  html, body { margin:0; padding:0; height:100%; overflow:hidden; background: var(--pt-canvas-bg); color: var(--pt-text); font-family: var(--vscode-editor-font-family, monospace); }
  /* Subtle dotted grid on the canvas to make it read as an editable surface. */
  #canvas-host {
    background-image: radial-gradient(var(--pt-glass-border) 1px, transparent 1px);
    background-size: 26px 26px;
  }
  #toolbar {
    position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
    height: 48px;
    display: flex; align-items: center; gap: 4px;
    padding: 0 8px;
    background: var(--pt-glass-bg); color: var(--pt-toolbar-fg);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    backdrop-filter: blur(18px) saturate(160%);
    border: 1px solid var(--pt-glass-border);
    border-radius: 14px;
    box-shadow: var(--pt-shadow-float);
    z-index: 1000;
    user-select: none;
  }
  #toolbar button {
    background: transparent; color: inherit;
    border: 1px solid transparent; border-radius: 9px;
    padding: 7px 12px; cursor: pointer; font: inherit; font-size: 13px;
    display: inline-flex; align-items: center; gap: 6px;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  #toolbar button:hover { background: var(--pt-btn-hover); }
  #toolbar button.active { background: var(--pt-btn-active); border-color: var(--pt-accent); color: var(--pt-accent); }
  #toolbar .sep { width: 1px; align-self: stretch; margin: 8px 6px; background: var(--pt-glass-border); }
  #toolbar .pill {
    background: var(--pt-accent-soft);
    color: var(--pt-accent);
    border-radius: 99px; padding: 5px 12px;
    font-size: 12px; font-weight: 600;
    letter-spacing: 0.2px;
  }
  #toolbar .icon { font-size: 14px; line-height: 1; }
  #toolbar button.primary {
    background: linear-gradient(180deg, var(--pt-accent) 0%, var(--pt-accent-2) 100%);
    color: var(--pt-accent-contrast); border-color: transparent; font-weight: 600;
  }
  #toolbar button.primary:hover { filter: brightness(1.07); background: linear-gradient(180deg, var(--pt-accent) 0%, var(--pt-accent-2) 100%); }
  #canvas-host { position: fixed; top: 0; left: 0; right: 0; bottom: 0; overflow: hidden; cursor: default; }
  #canvas-host.tool-box { cursor: crosshair; }
  #canvas-host.tool-edge { cursor: copy; }
  #canvas-host.tool-module { cursor: cell; }
  #canvas-host.tool-erase { cursor: not-allowed; }
  #canvas-host.tool-erase .box { cursor: not-allowed; }
  #canvas-host.tool-erase .edge-path,
  #canvas-host.tool-erase .edge-hit { cursor: not-allowed; }
  #viewport { position: absolute; top: 0; left: 0; transform-origin: 0 0; will-change: transform; }
  #edge-svg { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
  #edge-svg g[data-edge-idx] { pointer-events: auto; cursor: pointer; }
  #edge-svg g[data-edge-idx] .hit { pointer-events: stroke; }
  #edge-svg g[data-edge-idx] .vis { pointer-events: none; }
  #edge-svg g[data-edge-idx] polygon { pointer-events: visiblePainted; }
  #edge-svg g[data-edge-idx]:hover .vis { stroke-width: 2.5; }
  #edge-svg g[data-edge-idx]:hover polygon { transform-box: fill-box; transform-origin: top center; transform: scale(1.4); }
  .module-overlay {
    position: absolute;
    background: var(--pt-module-bg);
    border: 1.5px dashed var(--pt-module-border);
    border-radius: 14px;
    pointer-events: none;
  }
  .module-label {
    position: absolute;
    background: var(--pt-glass-bg);
    -webkit-backdrop-filter: blur(14px) saturate(150%);
    backdrop-filter: blur(14px) saturate(150%);
    color: var(--pt-toolbar-fg);
    padding: 4px 10px;
    border: 1px solid var(--pt-module-border);
    border-radius: 8px;
    font-size: 12px;
    box-shadow: var(--pt-shadow-float);
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
  }
  .box {
    position: absolute;
    background: var(--pt-panel-bg);
    border: 1px solid var(--pt-border);
    border-radius: var(--pt-radius);
    min-width: 260px;
    max-width: 480px;
    box-shadow: var(--pt-shadow-box);
    overflow: hidden;
    transition: box-shadow 0.14s ease, outline-color 0.12s ease;
  }
  .box:hover { box-shadow: var(--pt-shadow-hover); }
  .box.selected { outline: 2px solid var(--pt-accent); outline-offset: 1px; box-shadow: var(--pt-shadow-hover), 0 0 0 4px var(--pt-focus-ring); }
  .box.edge-target { outline: 2px dashed var(--pt-edge-target); outline-offset: 1px; }
  .box.invalid-edge { outline: 2px dashed var(--pt-invalid); outline-offset: 1px; }
  .box .header {
    background: linear-gradient(180deg, var(--pt-header-bg-top) 0%, var(--pt-header-bg-bot) 100%);
    color: var(--pt-header-text);
    padding: 9px 10px;
    text-align: center;
    font-weight: bold;
    font-size: 15px;
    cursor: move;
    user-select: none;
    border-bottom: 1px solid rgba(0,0,0,0.18);
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .box.abstract .header { background: linear-gradient(180deg, var(--pt-abstract-bg-top) 0%, var(--pt-abstract-bg-bot) 100%); }
  .box .header input.title-input {
    background: transparent; border: none; outline: none;
    color: inherit; font: inherit; text-align: center;
    width: 100%;
  }
  .box .header .abc-badge {
    font-size: 11px; font-style: italic; font-weight: bold;
    color: #fff;
    background: rgba(0,0,0,0.25);
    padding: 1px 5px; border-radius: 3px;
  }
  .box .section { padding: 6px 10px; }
  .box .section-label {
    color: var(--pt-section-label);
    font-style: italic; font-size: 12px;
    margin: 4px 0 2px;
    user-select: none;
  }
  .box .add-btn {
    background: transparent; color: var(--pt-section-label);
    border: 1px dashed var(--pt-border); border-radius: 4px;
    padding: 2px 8px; cursor: pointer; font-size: 11px;
    margin-top: 4px;
  }
  .box .add-btn:hover { color: var(--pt-text); border-color: var(--pt-text); }
  .box .divider {
    height: 1px; background: var(--pt-border); margin: 6px 0;
  }
  .member-row {
    display: flex; align-items: flex-start; gap: 4px;
    padding: 2px 0;
    line-height: 20px; font-size: 14px;
  }
  .member-row .grip { cursor: pointer; opacity: 0.3; padding: 0 4px; user-select: none; }
  .member-row:hover .grip { opacity: 0.7; }
  .member-row .grip:hover { opacity: 1; }
  .member-text { flex: 1; min-width: 0; word-wrap: break-word; }
  .member-text.editing { outline: 1px solid var(--pt-accent); outline-offset: 1px; border-radius: 4px; background: var(--pt-accent-soft); }
  .tok-text { color: var(--pt-text); }
  .tok-attr { color: var(--pt-attribute); }
  .tok-method { color: var(--pt-method); }
  .tok-type { color: var(--pt-type); }
  .tok-type-unknown { color: var(--pt-text); }
  .tok-string { color: var(--pt-string); }
  .tok-number { color: var(--pt-number); }
  .tok-bool { color: var(--pt-bool); }
  .tok-punct { color: var(--pt-text); }
  .abc-prefix { color: #fff; font-style: italic; font-weight: bold; margin-right: 4px; }
  .member-edit {
    width: 100%; box-sizing: border-box;
    background: var(--pt-bg);
    color: var(--pt-text); border: 1px solid var(--pt-accent); outline: none;
    border-radius: 5px; padding: 2px 6px;
    box-shadow: 0 0 0 3px var(--pt-focus-ring);
    font: inherit; font-family: var(--vscode-editor-font-family, monospace);
  }
  .method-row { align-items: center !important; }
  .method-text { cursor: pointer; }
  .method-decorator {
    color: var(--pt-method);
    font-style: italic;
    font-size: 12px;
    margin-right: 4px;
    opacity: 0.85;
    user-select: none;
  }
  .icon-btn {
    background: transparent;
    border: none;
    color: var(--pt-section-label);
    cursor: pointer;
    padding: 2px 4px;
    font-size: 13px;
    line-height: 1;
    border-radius: 3px;
    opacity: 0.5;
  }
  .icon-btn:hover { opacity: 1; background: var(--pt-glass-hover); color: var(--pt-text); }
  .abc-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    font-size: 11px;
    font-style: italic;
    font-weight: bold;
    padding: 1px 6px;
    border: 1px solid var(--pt-border);
    border-radius: 10px;
    cursor: pointer;
    user-select: none;
    color: var(--pt-section-label);
    background: transparent;
    line-height: 14px;
  }
  .abc-toggle:hover { color: var(--pt-text); border-color: var(--pt-text); }
  .abc-toggle.on {
    background: var(--pt-abstract-header-bg);
    border-color: var(--pt-abstract-header-bg);
    color: #000;
    opacity: 1;
  }
  #drag-rect {
    /* fixed (not absolute) so the JS can use clientX/clientY directly without
       subtracting any host offset on every pointermove. The toolbar floats
       above the full-bleed canvas, so the canvas already starts at the top. */
    position: fixed;
    background: rgba(78, 201, 176, 0.10);
    border: 1.5px dashed var(--pt-module-border);
    border-radius: 6px;
    pointer-events: none;
    display: none;
    z-index: 500;
  }
  #edge-ghost {
    position: absolute; pointer-events: none; overflow: visible;
    display: none;
  }
  .dialog-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center;
    z-index: 5000;
  }
  .dialog {
    background: var(--pt-panel-bg);
    border: 1px solid var(--pt-glass-border);
    border-radius: 14px;
    padding: 20px 22px; min-width: 360px; max-width: 500px;
    color: var(--pt-text);
    box-shadow: var(--pt-shadow-float);
  }
  .dialog h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .dialog label { display: block; font-size: 12px; margin: 8px 0 4px; color: var(--pt-section-label); }
  .dialog input, .dialog select {
    width: 100%; box-sizing: border-box;
    background: var(--pt-bg); color: var(--pt-text);
    border: 1px solid var(--pt-border); border-radius: 7px;
    padding: 7px 9px; font: inherit; font-family: var(--vscode-editor-font-family, monospace);
    transition: border-color 0.12s ease, box-shadow 0.12s ease;
  }
  .dialog input:focus, .dialog select:focus { outline: none; border-color: var(--pt-accent); box-shadow: 0 0 0 3px var(--pt-focus-ring); }
  .dialog .actions {
    display: flex; justify-content: flex-end; gap: 8px;
    margin-top: 18px;
  }
  .dialog .actions button {
    background: transparent; color: var(--pt-text);
    border: 1px solid var(--pt-border); border-radius: 8px;
    padding: 7px 16px; cursor: pointer; font: inherit; font-size: 12px;
    transition: background 0.12s ease, filter 0.12s ease;
  }
  .dialog .actions button.primary {
    background: linear-gradient(180deg, var(--pt-accent) 0%, var(--pt-accent-2) 100%);
    border-color: transparent; color: var(--pt-accent-contrast); font-weight: 600;
  }
  .dialog .actions button:hover { background: var(--pt-btn-hover); }
  .dialog .actions button.primary:hover { background: linear-gradient(180deg, var(--pt-accent) 0%, var(--pt-accent-2) 100%); filter: brightness(1.07); }
  .dialog .hint { font-size: 11px; color: var(--pt-section-label); margin-top: 6px; }
  .dialog datalist { color: var(--pt-text); }
  .toast {
    position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%);
    background: var(--pt-glass-bg); color: var(--pt-text);
    -webkit-backdrop-filter: blur(16px) saturate(150%);
    backdrop-filter: blur(16px) saturate(150%);
    border: 1px solid var(--pt-glass-border); border-radius: 10px;
    padding: 9px 16px; font-size: 13px;
    box-shadow: var(--pt-shadow-float);
    z-index: 6000;
  }
  .toast.error { border-color: var(--pt-invalid); }
</style>
</head>
<body>
<div id="toolbar">
  <button data-tool="cursor" class="active" title=${toolsMessages.cursor.title}><span class="icon">↖</span>Cursor</button>
  <button data-tool="box" title=${toolsMessages.addBox.title}><span class="icon">▭</span>Box</button>
  <button data-tool="edge" title=${toolsMessages.addEdge.title}><span class="icon">↘</span>Edge</button>
  <button data-tool="module" title=${toolsMessages.module.title}><span class="icon">▦</span>Module</button>
  <button data-tool="erase" title=${toolsMessages.erase.title}><span class="icon">⌫</span>Erase</button>
  <div class="sep"></div>
  <span id="status" class="pill">Cursor</span>
  <button id="btn-arrange" title=${toolsMessages.arrange}><span class="icon">⤧</span>Arrange</button>
  <button id="btn-create" class="primary" title=${toolsMessages.confirm}><span class="icon">⏵</span>Create</button>
</div>

<div id="canvas-host">
  <div id="viewport">
    <svg id="edge-svg"></svg>
    <div id="modules-layer"></div>
    <div id="boxes-layer"></div>
  </div>
  <div id="drag-rect"></div>
  <svg id="edge-ghost"></svg>
</div>

<script type="application/json" id="pt-known-types">${JSON.stringify(
        knownTypes
    )}</script>
<script type="application/json" id="pt-existing-modules">${JSON.stringify(
        existingModules
    )}</script>

<!-- Shared edge-geometry module (same algorithm the auto-tree SVG renderer
     uses; bundled by esbuild from src/ui/utils/edgeLayout.ts). -->
<script>
${edgeLayoutScript}
</script>

<script>
${clientScript}
</script>
</body>
</html>`;
}
