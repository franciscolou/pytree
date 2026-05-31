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

const toolsMessages = Messages.webView.create.tools
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
    --pt-toolbar-bg: var(--vscode-titleBar-activeBackground, #2d2d2d);
    --pt-toolbar-fg: var(--vscode-titleBar-activeForeground, #cccccc);
    --pt-btn-active: var(--vscode-list-activeSelectionBackground, #094771);
    --pt-btn-hover: rgba(255,255,255,0.08);
    --pt-module-bg: rgba(78, 201, 176, 0.08);
    --pt-module-border: rgba(78, 201, 176, 0.6);
  }
  html, body { margin:0; padding:0; height:100%; overflow:hidden; background: var(--pt-canvas-bg); color: var(--pt-text); font-family: var(--vscode-editor-font-family, monospace); }
  #toolbar {
    position: fixed; top: 0; left: 0; right: 0; height: 44px;
    display: flex; align-items: center; gap: 6px;
    padding: 0 12px;
    background: var(--pt-toolbar-bg); color: var(--pt-toolbar-fg);
    border-bottom: 1px solid var(--pt-border);
    z-index: 1000;
    user-select: none;
  }
  #toolbar button {
    background: transparent; color: inherit;
    border: 1px solid transparent; border-radius: 4px;
    padding: 6px 12px; cursor: pointer; font: inherit; font-size: 13px;
    display: inline-flex; align-items: center; gap: 6px;
  }
  #toolbar button:hover { background: var(--pt-btn-hover); }
  #toolbar button.active { background: var(--pt-btn-active); border-color: var(--pt-border); }
  #toolbar .sep { flex: 1; }
  #toolbar .pill {
    background: rgba(255,255,255,0.06);
    border-radius: 99px; padding: 4px 10px;
    font-size: 12px; color: #aaa;
  }
  #toolbar .icon { font-size: 14px; line-height: 1; }
  #canvas-host { position: fixed; top: 44px; left: 0; right: 0; bottom: 0; overflow: hidden; cursor: default; }
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
    border-radius: 10px;
    pointer-events: none;
  }
  .module-label {
    position: absolute;
    background: var(--pt-toolbar-bg);
    color: var(--pt-toolbar-fg);
    padding: 3px 8px;
    border: 1px solid var(--pt-module-border);
    border-radius: 4px;
    font-size: 12px;
    pointer-events: auto;
    cursor: pointer;
    user-select: none;
  }
  .box {
    position: absolute;
    background: var(--pt-panel-bg);
    border: 1px solid var(--pt-border);
    border-radius: 6px;
    min-width: 260px;
    max-width: 480px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
    overflow: hidden;
  }
  .box.selected { outline: 2px solid #007acc; outline-offset: -1px; }
  .box.edge-target { outline: 2px dashed #f5c542; outline-offset: -1px; }
  .box.invalid-edge { outline: 2px dashed #c2402e; outline-offset: -1px; }
  .box .header {
    background: var(--pt-header-bg);
    color: var(--pt-header-text);
    padding: 8px 10px;
    text-align: center;
    font-weight: bold;
    font-size: 15px;
    cursor: move;
    user-select: none;
    display: flex; align-items: center; justify-content: center; gap: 6px;
  }
  .box.abstract .header { background: var(--pt-abstract-header-bg); }
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
  .member-text.editing { outline: 1px solid #007acc; outline-offset: 1px; border-radius: 3px; background: rgba(0,122,204,0.06); }
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
    color: var(--pt-text); border: 1px solid #007acc; outline: none;
    border-radius: 3px; padding: 2px 6px;
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
  .icon-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); color: var(--pt-text); }
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
    /* fixed (not absolute) so the JS can use clientX/clientY directly —
       canvas-host starts 44px below the window top because of the toolbar,
       and we don't want to subtract that offset on every pointermove. */
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
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 5000;
  }
  .dialog {
    background: var(--pt-panel-bg);
    border: 1px solid var(--pt-border);
    border-radius: 6px;
    padding: 18px 20px; min-width: 360px; max-width: 500px;
    color: var(--pt-text);
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }
  .dialog h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .dialog label { display: block; font-size: 12px; margin: 8px 0 4px; color: var(--pt-section-label); }
  .dialog input, .dialog select {
    width: 100%; box-sizing: border-box;
    background: var(--pt-bg); color: var(--pt-text);
    border: 1px solid var(--pt-border); border-radius: 3px;
    padding: 6px 8px; font: inherit; font-family: var(--vscode-editor-font-family, monospace);
  }
  .dialog input:focus, .dialog select:focus { outline: 1px solid #007acc; }
  .dialog .actions {
    display: flex; justify-content: flex-end; gap: 8px;
    margin-top: 16px;
  }
  .dialog .actions button {
    background: transparent; color: var(--pt-text);
    border: 1px solid var(--pt-border); border-radius: 3px;
    padding: 6px 14px; cursor: pointer; font: inherit; font-size: 12px;
  }
  .dialog .actions button.primary {
    background: #094771; border-color: #094771; color: #fff;
  }
  .dialog .actions button:hover { background: var(--pt-btn-hover); }
  .dialog .actions button.primary:hover { background: #0a5a8a; }
  .dialog .hint { font-size: 11px; color: var(--pt-section-label); margin-top: 6px; }
  .dialog datalist { color: var(--pt-text); }
  .toast {
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    background: var(--pt-panel-bg); color: var(--pt-text);
    border: 1px solid var(--pt-border); border-radius: 4px;
    padding: 8px 14px; font-size: 13px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    z-index: 6000;
  }
  .toast.error { border-color: #c2402e; }
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
  <button id="btn-create" title=${toolsMessages.confirm} style="background:#0e639c;color:#fff;border-color:#0e639c;"><span class="icon">⏵</span>Create</button>
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
