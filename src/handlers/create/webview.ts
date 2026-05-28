// Self-contained interactive board for PyTree: Create.
//
// The board is rendered as plain HTML (not SVG) so boxes can host real
// <input>/<select> controls for editing. Edges are drawn in an SVG layer
// behind the boxes. All state lives in the webview; the extension is only
// involved when the user clicks "Create" (and when listing existing modules
// for the module-name autocomplete).

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

export interface ExistingModuleInfo {
    name: string;
    relativePath: string;
    fileUri: string;
}

export function renderCreateBoard(
    workspaceClassNames: string[],
    existingModules: ExistingModuleInfo[],
    edgeLayoutScript: string
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
  <button data-tool="cursor" class="active" title="Cursor (V)"><span class="icon">↖</span>Cursor</button>
  <button data-tool="box" title="Add Box (B)"><span class="icon">▭</span>Box</button>
  <button data-tool="edge" title="Add Edge (E)"><span class="icon">↘</span>Edge</button>
  <button data-tool="module" title="Module (M)"><span class="icon">▦</span>Module</button>
  <button data-tool="erase" title="Erase (X)"><span class="icon">⌫</span>Erase</button>
  <div class="sep"></div>
  <span id="status" class="pill">Cursor</span>
  <button id="btn-arrange" title="Arrange layout"><span class="icon">⤧</span>Arrange</button>
  <button id="btn-create" title="Create Python files" style="background:#0e639c;color:#fff;border-color:#0e639c;"><span class="icon">⏵</span>Create</button>
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
${webviewScript()}
</script>
</body>
</html>`;
}

function webviewScript(): string {
    // The whole script is one giant template. It owns the state, rendering,
    // and all tool interactions. Designed to be fully self-contained — the
    // extension is only contacted on "Create" and (for completeness) when the
    // user picks an existing module via the autocomplete.
    return `
const vscode = acquireVsCodeApi();
const knownTypes = new Set(JSON.parse(document.getElementById('pt-known-types').textContent));
const existingModules = JSON.parse(document.getElementById('pt-existing-modules').textContent);

// --- State -----------------------------------------------------------------
const state = {
  boxes: new Map(),        // id -> BoxData
  edges: [],               // { id, childId, parentId }
  modules: new Map(),      // id -> { id, relativePath, existingFileUri }
  tool: 'cursor',
  edgeFirst: null,
  selected: null,
  pan: { x: 200, y: 80, scale: 1 },
  nextBoxId: 1,
  nextEdgeId: 1,
  nextModuleId: 1,
};

const persisted = vscode.getState();
if (persisted) {
  try {
    state.boxes = new Map(persisted.boxes ?? []);
    state.edges = persisted.edges ?? [];
    state.modules = new Map(persisted.modules ?? []);
    state.pan = persisted.pan ?? state.pan;
    state.nextBoxId = persisted.nextBoxId ?? 1;
    state.nextEdgeId = persisted.nextEdgeId ?? 1;
    state.nextModuleId = persisted.nextModuleId ?? 1;
  } catch (e) {
    console.error('Failed to restore state', e);
  }
}

function saveState() {
  vscode.setState({
    boxes: [...state.boxes.entries()],
    edges: state.edges,
    modules: [...state.modules.entries()],
    pan: state.pan,
    nextBoxId: state.nextBoxId,
    nextEdgeId: state.nextEdgeId,
    nextModuleId: state.nextModuleId,
  });
}

function newBox(x, y) {
  const id = 'b' + state.nextBoxId++;
  const box = {
    id,
    name: 'NewClass' + (state.boxes.size + 1),
    x, y,
    isAbstract: false,
    attributes: [],
    methods: [],
    moduleId: null,
  };
  state.boxes.set(id, box);
  return box;
}

// --- DOM refs --------------------------------------------------------------
const host = document.getElementById('canvas-host');
const viewport = document.getElementById('viewport');
const edgeSvg = document.getElementById('edge-svg');
const boxesLayer = document.getElementById('boxes-layer');
const modulesLayer = document.getElementById('modules-layer');
const dragRect = document.getElementById('drag-rect');
const edgeGhost = document.getElementById('edge-ghost');
const statusEl = document.getElementById('status');

function setTool(tool) {
  state.tool = tool;
  state.edgeFirst = null;
  document.querySelectorAll('#toolbar button[data-tool]').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === tool);
  });
  host.classList.remove('tool-box', 'tool-edge', 'tool-module', 'tool-cursor', 'tool-erase');
  host.classList.add('tool-' + tool);
  statusEl.textContent = tool === 'cursor'
    ? 'Cursor: drag boxes, click header to toggle abstract, double-click name to rename'
    : tool === 'box'
      ? 'Click on the canvas to add a class box'
      : tool === 'edge'
        ? 'Click first box (child), then second box (parent) to connect'
        : tool === 'module'
          ? 'Drag a rectangle around classes to group them in a module'
          : 'Erase: click a box or edge to delete it';
  // Clear any visual hint of an edge in progress.
  document.querySelectorAll('.box.edge-target,.box.invalid-edge').forEach(b => {
    b.classList.remove('edge-target', 'invalid-edge');
  });
  render();
}

document.querySelectorAll('#toolbar button[data-tool]').forEach(b => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});

document.getElementById('btn-arrange').addEventListener('click', arrangeLayout);
document.getElementById('btn-create').addEventListener('click', emitCreate);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'v' || e.key === 'V') setTool('cursor');
  else if (e.key === 'b' || e.key === 'B') setTool('box');
  else if (e.key === 'e' || e.key === 'E') setTool('edge');
  else if (e.key === 'm' || e.key === 'M') setTool('module');
  else if (e.key === 'x' || e.key === 'X') setTool('erase');
  else if (e.key === 'Escape') setTool('cursor');
});

// --- Pan / zoom ------------------------------------------------------------
// Left-click pan only triggers on a true canvas click (no box/edge under the
// cursor) and only when no tool owns the gesture. Middle-button pan always
// wins — it's intercepted at the capture phase before any other handler runs
// so the user can pan regardless of mode or where the cursor is.
let panning = false;
let panLast = null;
let panMoved = false;
let panViaMiddle = false;

host.addEventListener('pointerdown', e => {
  if (e.button !== 1) return;
  // Middle button = pan, no matter what's under the cursor or which tool is
  // active. Capture-phase + stopImmediatePropagation prevents box drag,
  // edge tool, module rect, etc., from also reacting to this pointerdown.
  e.preventDefault();
  e.stopImmediatePropagation();
  panning = true;
  panMoved = false;
  panViaMiddle = true;
  panLast = { x: e.clientX, y: e.clientY };
  host.setPointerCapture(e.pointerId);
  host.style.cursor = 'grabbing';
}, true);

// Suppress Chrome/Firefox's middle-click auto-scroll cursor.
host.addEventListener('mousedown', e => {
  if (e.button === 1) e.preventDefault();
});

host.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (e.target !== host && e.target !== viewport && e.target !== edgeSvg) return;
  if (state.tool !== 'cursor') return;
  panning = true; panMoved = false; panViaMiddle = false;
  panLast = { x: e.clientX, y: e.clientY };
  host.setPointerCapture(e.pointerId);
});
host.addEventListener('pointermove', e => {
  if (!panning) return;
  const dx = e.clientX - panLast.x;
  const dy = e.clientY - panLast.y;
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
  state.pan.x += dx; state.pan.y += dy;
  panLast = { x: e.clientX, y: e.clientY };
  applyTransform();
});
host.addEventListener('pointerup', e => {
  if (!panning) return;
  panning = false;
  try { host.releasePointerCapture(e.pointerId); } catch {}
  host.style.cursor = '';
  if (!panMoved && !panViaMiddle) {
    // Empty left-click on canvas → unselect. Middle-click without movement
    // is treated as a no-op so the user doesn't accidentally unselect just
    // by middle-clicking.
    state.selected = null;
    render();
  }
  panViaMiddle = false;
  saveState();
});

host.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  const rect = host.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const newScale = Math.max(0.2, Math.min(3, state.pan.scale * factor));
  state.pan.x = mx - (mx - state.pan.x) * (newScale / state.pan.scale);
  state.pan.y = my - (my - state.pan.y) * (newScale / state.pan.scale);
  state.pan.scale = newScale;
  applyTransform();
  saveState();
}, { passive: false });

function applyTransform() {
  viewport.style.transform = 'translate(' + state.pan.x + 'px,' + state.pan.y + 'px) scale(' + state.pan.scale + ')';
}

function clientToWorld(cx, cy) {
  const rect = host.getBoundingClientRect();
  return {
    x: (cx - rect.left - state.pan.x) / state.pan.scale,
    y: (cy - rect.top - state.pan.y) / state.pan.scale,
  };
}

// --- Canvas tool dispatch --------------------------------------------------
host.addEventListener('click', e => {
  // Ignore clicks that bubbled from boxes; only pure-canvas clicks count.
  if (e.target !== host && e.target !== viewport && e.target !== edgeSvg) return;
  if (state.tool === 'box') {
    const p = clientToWorld(e.clientX, e.clientY);
    const box = newBox(p.x - 130, p.y - 20);
    state.selected = box.id;
    // Stay in the box tool so the user can keep adding boxes — they switch
    // back to the cursor with V (or Esc) when they're done.
    render();
    saveState();
  }
});

// --- Module drag-rect ------------------------------------------------------
let moduleDrag = null;
host.addEventListener('pointerdown', e => {
  if (state.tool !== 'module') return;
  if (e.target.closest('.box')) return; // start on canvas only
  const start = clientToWorld(e.clientX, e.clientY);
  moduleDrag = { startClient: { x: e.clientX, y: e.clientY }, start };
  host.setPointerCapture(e.pointerId);
  dragRect.style.display = 'block';
  dragRect.style.left = e.clientX + 'px';
  dragRect.style.top = e.clientY + 'px';
  dragRect.style.width = '0px';
  dragRect.style.height = '0px';
  e.preventDefault();
});
host.addEventListener('pointermove', e => {
  if (!moduleDrag) return;
  const x = Math.min(e.clientX, moduleDrag.startClient.x);
  const y = Math.min(e.clientY, moduleDrag.startClient.y);
  const w = Math.abs(e.clientX - moduleDrag.startClient.x);
  const h = Math.abs(e.clientY - moduleDrag.startClient.y);
  dragRect.style.left = x + 'px';
  dragRect.style.top = y + 'px';
  dragRect.style.width = w + 'px';
  dragRect.style.height = h + 'px';
});
host.addEventListener('pointerup', async e => {
  if (!moduleDrag) return;
  try { host.releasePointerCapture(e.pointerId); } catch {}
  dragRect.style.display = 'none';
  const end = clientToWorld(e.clientX, e.clientY);
  const x0 = Math.min(moduleDrag.start.x, end.x);
  const y0 = Math.min(moduleDrag.start.y, end.y);
  const x1 = Math.max(moduleDrag.start.x, end.x);
  const y1 = Math.max(moduleDrag.start.y, end.y);
  moduleDrag = null;
  const boxesInside = [...state.boxes.values()].filter(b => {
    const el = document.querySelector('[data-box-id="' + b.id + '"]');
    const w = el ? el.offsetWidth : 260;
    const h = el ? el.offsetHeight : 100;
    const cx = b.x + w / 2;
    const cy = b.y + h / 2;
    return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
  });
  if (boxesInside.length === 0) {
    toast('No boxes inside the selection — module not created.');
    return;
  }
  const result = await pickModule();
  if (!result) return;
  applyModuleToBoxes(result, boxesInside.map(b => b.id));
});

function applyModuleToBoxes(modInfo, boxIds) {
  // Either reuse an existing module (matched by relativePath), or create a new one.
  let mod = [...state.modules.values()].find(m => m.relativePath === modInfo.relativePath);
  if (!mod) {
    mod = {
      id: 'm' + state.nextModuleId++,
      relativePath: modInfo.relativePath,
      existingFileUri: modInfo.existingFileUri,
    };
    state.modules.set(mod.id, mod);
  } else if (modInfo.existingFileUri && !mod.existingFileUri) {
    mod.existingFileUri = modInfo.existingFileUri;
  }
  for (const id of boxIds) {
    const box = state.boxes.get(id);
    if (box) box.moduleId = mod.id;
  }
  render();
  saveState();
}

// --- Box rendering ---------------------------------------------------------
function render() {
  renderBoxes();
  renderEdges();
  renderModules();
}

function renderBoxes() {
  boxesLayer.innerHTML = '';
  for (const box of state.boxes.values()) {
    const el = createBoxElement(box);
    boxesLayer.appendChild(el);
  }
}

function createBoxElement(box) {
  const el = document.createElement('div');
  el.className = 'box' + (box.isAbstract ? ' abstract' : '') + (state.selected === box.id ? ' selected' : '');
  el.style.left = box.x + 'px';
  el.style.top = box.y + 'px';
  el.dataset.boxId = box.id;

  const header = document.createElement('div');
  header.className = 'header';
  let badge = null;
  const ensureBadge = () => {
    if (box.isAbstract && !badge) {
      badge = document.createElement('span');
      badge.className = 'abc-badge';
      badge.textContent = '(abc)';
      header.insertBefore(badge, header.firstChild);
    } else if (!box.isAbstract && badge) {
      badge.remove();
      badge = null;
    }
  };
  const title = document.createElement('span');
  title.className = 'box-title';
  title.textContent = box.name;
  title.style.cursor = 'text';
  header.appendChild(title);
  ensureBadge();

  // Drag + abstract toggle are bound to the whole box so any non-interactive
  // surface (header padding, section labels, empty body space, the title
  // text itself) works as a grab/click target. Interactive descendants
  // (buttons, inputs, the editable member text) opt out below so their own
  // click handlers stay reachable.
  //
  // Pointer capture is deliberately deferred until the user actually starts
  // dragging — capturing on pointerdown would retarget the subsequent click
  // events to the box element, which would prevent the title's native
  // dblclick (rename trigger) from firing.
  const DRAG_OPT_OUT =
    'button, input, .member-text, .abc-toggle, .grip';

  let dragging = false;
  let moved = false;
  let captured = false;
  let dragStart = null;
  let dragOrigin = null;

  el.addEventListener('pointerdown', e => {
    if (state.tool === 'edge') {
      e.stopPropagation();
      handleEdgeBoxClick(box);
      return;
    }
    if (state.tool === 'erase') {
      e.stopPropagation();
      deleteBox(box.id);
      return;
    }
    if (state.tool !== 'cursor') return;
    if (e.target.closest(DRAG_OPT_OUT)) return;
    e.stopPropagation();
    dragging = true; moved = false; captured = false;
    dragStart = { x: e.clientX, y: e.clientY };
    dragOrigin = { x: box.x, y: box.y };
  });
  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = (e.clientX - dragStart.x) / state.pan.scale;
    const dy = (e.clientY - dragStart.y) / state.pan.scale;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      if (!moved) {
        moved = true;
        try {
          el.setPointerCapture(e.pointerId);
          captured = true;
        } catch {}
      }
    }
    if (!moved) return;
    box.x = dragOrigin.x + dx;
    box.y = dragOrigin.y + dy;
    el.style.left = box.x + 'px';
    el.style.top = box.y + 'px';
    renderEdges();
    renderModules();
  });
  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    const wasMoved = moved;
    dragging = false;
    if (captured) {
      try { el.releasePointerCapture(e.pointerId); } catch {}
      captured = false;
    }
    if (!wasMoved && state.tool === 'cursor') {
      // No drag motion → click. Toggle abstract IN PLACE (no re-render) so
      // the title element survives the click sequence. If this click is the
      // first half of a double-click on the title, the toggle will run
      // twice (once per click) and net to no change, while the browser
      // fires dblclick on the still-alive title to enter rename mode.
      box.isAbstract = !box.isAbstract;
      el.classList.toggle('abstract', box.isAbstract);
      ensureBadge();
      saveState();
    } else if (wasMoved) {
      saveState();
    }
  });

  // Double-click on the name → enter rename mode.
  title.addEventListener('dblclick', e => {
    e.stopPropagation();
    startTitleEdit(box, title);
  });

  // --- Attributes section ---
  const attrSection = document.createElement('div');
  attrSection.className = 'section';
  const attrLabel = document.createElement('div');
  attrLabel.className = 'section-label';
  attrLabel.textContent = 'Attributes';
  attrSection.appendChild(attrLabel);
  for (let i = 0; i < box.attributes.length; i++) {
    attrSection.appendChild(createAttributeRow(box, i));
  }
  const addAttrBtn = document.createElement('button');
  addAttrBtn.className = 'add-btn';
  addAttrBtn.textContent = '+ Attribute';
  addAttrBtn.addEventListener('click', e => {
    e.stopPropagation();
    box.attributes.push({ name: '', type: '', default: '', isProperty: false });
    render(); saveState();
    setTimeout(() => focusLastEdit(el, 'attr', box.attributes.length - 1), 0);
  });
  const addPropBtn = document.createElement('button');
  addPropBtn.className = 'add-btn';
  addPropBtn.textContent = '+ Property';
  addPropBtn.style.marginLeft = '6px';
  addPropBtn.addEventListener('click', e => {
    e.stopPropagation();
    box.attributes.push({ name: '', type: '', default: '', isProperty: true });
    render(); saveState();
    setTimeout(() => focusLastEdit(el, 'attr', box.attributes.length - 1), 0);
  });
  attrSection.appendChild(addAttrBtn);
  attrSection.appendChild(addPropBtn);
  el.appendChild(header);
  el.appendChild(attrSection);

  // --- Methods section ---
  const divider = document.createElement('div');
  divider.className = 'divider';
  el.appendChild(divider);

  const methSection = document.createElement('div');
  methSection.className = 'section';
  const methLabel = document.createElement('div');
  methLabel.className = 'section-label';
  methLabel.textContent = 'Methods';
  methSection.appendChild(methLabel);
  for (let i = 0; i < box.methods.length; i++) {
    methSection.appendChild(createMethodRow(box, i));
  }
  const addMethBtn = document.createElement('button');
  addMethBtn.className = 'add-btn';
  addMethBtn.textContent = '+ Method';
  addMethBtn.addEventListener('click', e => {
    e.stopPropagation();
    const idx = box.methods.length;
    box.methods.push({
      name: '', params: [], returnType: '',
      isStatic: false, isClassMethod: false, isAbstract: false,
    });
    render(); saveState();
    // Open the edit input straight away — clicking the row would otherwise
    // cycle the method's kind (regular/class/static), not edit it.
    setTimeout(() => {
      const newEl = boxesLayer.querySelector('[data-box-id="' + box.id + '"]');
      const sel = '[data-edit-method="' + idx + '"]';
      const target = newEl ? newEl.querySelector(sel) : null;
      if (target) startMethodEdit(box, idx, target);
    }, 0);
  });
  methSection.appendChild(addMethBtn);
  el.appendChild(methSection);

  return el;
}

function startTitleEdit(box, titleSpan) {
  const input = document.createElement('input');
  input.className = 'title-input';
  input.value = box.name;
  titleSpan.replaceWith(input);
  input.focus(); input.select();
  const commit = () => {
    box.name = input.value.trim() || box.name;
    render(); saveState();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); render(); }
  });
  input.addEventListener('pointerdown', e => e.stopPropagation());
}

function focusLastEdit(boxEl, kind, idx) {
  const sel = '[data-edit-' + kind + '="' + idx + '"]';
  const target = boxEl.querySelector(sel);
  if (target) target.click();
}

// --- Attribute / property row ---------------------------------------------
function createAttributeRow(box, idx) {
  const attr = box.attributes[idx];
  const row = document.createElement('div');
  row.className = 'member-row';
  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.textContent = '×';
  grip.title = 'Remove';
  grip.addEventListener('click', e => {
    e.stopPropagation();
    box.attributes.splice(idx, 1);
    render(); saveState();
  });
  row.appendChild(grip);

  const text = document.createElement('div');
  text.className = 'member-text';
  text.dataset.editAttr = String(idx);
  renderAttributeText(text, attr);
  text.addEventListener('click', e => {
    e.stopPropagation();
    startAttributeEdit(box, idx, text);
  });
  row.appendChild(text);
  return row;
}

function renderAttributeText(el, attr) {
  el.innerHTML = '';
  if (!attr.name) {
    const ph = document.createElement('span');
    ph.style.color = 'var(--pt-section-label)';
    ph.style.fontStyle = 'italic';
    ph.textContent = attr.isProperty ? '(click to set property)' : '(click to set attribute)';
    el.appendChild(ph);
    return;
  }
  const nameCls = attr.isProperty ? 'tok-method' : 'tok-attr';
  el.appendChild(span(nameCls, attr.name));
  if (attr.type) {
    el.appendChild(span('tok-punct', attr.isProperty ? ' → ' : ': '));
    appendTypeTokens(el, attr.type);
  }
  if (attr.default && !attr.isProperty) {
    el.appendChild(span('tok-punct', ' = '));
    appendValueTokens(el, attr.default);
  }
}

function startAttributeEdit(box, idx, textEl) {
  const attr = box.attributes[idx];
  textEl.classList.add('editing');
  textEl.innerHTML = '';
  const input = document.createElement('input');
  input.className = 'member-edit';
  // Reconstruct a single-line representation user can edit:
  // attr: "name: type = default"   property: "name → type"
  const parts = [];
  if (attr.name) parts.push(attr.name);
  if (attr.type) parts.push((attr.isProperty ? ' -> ' : ': ') + attr.type);
  if (attr.default && !attr.isProperty) parts.push(' = ' + attr.default);
  input.value = parts.join('');
  input.placeholder = attr.isProperty ? 'name -> ReturnType' : 'name: Type = default';
  textEl.appendChild(input);
  input.focus();
  const commit = () => {
    parseAttribute(attr, input.value);
    textEl.classList.remove('editing');
    render(); saveState();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); textEl.classList.remove('editing'); render(); }
  });
}

function parseAttribute(attr, raw) {
  const s = raw.trim();
  if (!s) { attr.name = ''; attr.type = ''; attr.default = ''; return; }
  if (attr.isProperty) {
    // property: name -> ReturnType OR name → ReturnType OR just name
    const m = s.match(/^([A-Za-z_]\\w*)\\s*(?:->|→)\\s*(.+)$/);
    if (m) { attr.name = m[1]; attr.type = m[2].trim(); attr.default = ''; return; }
    attr.name = s.replace(/[^A-Za-z0-9_]/g, '_'); attr.type = ''; attr.default = '';
    return;
  }
  // attribute: name (: Type)? (= default)?
  // Use the FIRST ':' as the type separator; '=' that comes after splits default.
  let name = s, type = '', def = '';
  const colon = s.indexOf(':');
  const eq = s.indexOf('=');
  if (colon !== -1 && (eq === -1 || colon < eq)) {
    name = s.slice(0, colon).trim();
    const rest = s.slice(colon + 1);
    const eq2 = rest.indexOf('=');
    if (eq2 !== -1) {
      type = rest.slice(0, eq2).trim();
      def = rest.slice(eq2 + 1).trim();
    } else {
      type = rest.trim();
    }
  } else if (eq !== -1) {
    name = s.slice(0, eq).trim();
    def = s.slice(eq + 1).trim();
  }
  attr.name = (name || '').replace(/[^A-Za-z0-9_]/g, '_') || 'attr';
  attr.type = type;
  attr.default = def;
}

// --- Method row ------------------------------------------------------------
function createMethodRow(box, idx) {
  const method = box.methods[idx];
  const row = document.createElement('div');
  row.className = 'member-row method-row';

  // ABC toggle: small pill labelled "ABC" that marks the method abstract.
  const abc = document.createElement('span');
  abc.className = 'abc-toggle' + (method.isAbstract ? ' on' : '');
  abc.textContent = 'ABC';
  abc.title = 'Toggle @abstractmethod';
  abc.addEventListener('click', e => {
    e.stopPropagation();
    method.isAbstract = !method.isAbstract;
    render(); saveState();
  });
  row.appendChild(abc);

  // Clickable text: shows the rendered signature plus a decorator prefix line.
  // Clicking the text cycles the method's "kind" (regular → class → static).
  const text = document.createElement('div');
  text.className = 'member-text method-text';
  text.dataset.editMethod = String(idx);
  renderMethodText(text, method);
  text.title = 'Click to cycle: regular → @classmethod → @staticmethod';
  text.addEventListener('click', e => {
    e.stopPropagation();
    cycleMethodKind(method);
    render(); saveState();
  });
  row.appendChild(text);

  // Pencil → edit signature inline.
  const edit = document.createElement('button');
  edit.className = 'icon-btn';
  edit.textContent = '✎';
  edit.title = 'Edit signature';
  edit.addEventListener('click', e => {
    e.stopPropagation();
    startMethodEdit(box, idx, text);
  });
  row.appendChild(edit);

  // × → remove method.
  const remove = document.createElement('button');
  remove.className = 'icon-btn';
  remove.textContent = '×';
  remove.title = 'Remove method';
  remove.addEventListener('click', e => {
    e.stopPropagation();
    box.methods.splice(idx, 1);
    render(); saveState();
  });
  row.appendChild(remove);

  return row;
}

function cycleMethodKind(method) {
  if (method.isClassMethod) {
    method.isClassMethod = false;
    method.isStatic = true;
  } else if (method.isStatic) {
    method.isStatic = false;
    method.isClassMethod = false;
  } else {
    method.isClassMethod = true;
    method.isStatic = false;
  }
}

function renderMethodText(el, method) {
  el.innerHTML = '';
  if (!method.name) {
    const ph = document.createElement('span');
    ph.style.color = 'var(--pt-section-label)';
    ph.style.fontStyle = 'italic';
    ph.textContent = '(click pencil to edit, click row to cycle kind)';
    el.appendChild(ph);
    return;
  }
  if (method.isClassMethod) {
    el.appendChild(span('method-decorator', '@classmethod '));
  } else if (method.isStatic) {
    el.appendChild(span('method-decorator', '@staticmethod '));
  }
  el.appendChild(span('tok-method', method.name));
  el.appendChild(span('tok-punct', '('));
  method.params.forEach((p, i) => {
    if (i > 0) el.appendChild(span('tok-punct', ', '));
    el.appendChild(span('tok-attr', p.name));
    if (p.type) {
      el.appendChild(span('tok-punct', ': '));
      appendTypeTokens(el, p.type);
    }
    if (p.default) {
      el.appendChild(span('tok-punct', ' = '));
      appendValueTokens(el, p.default);
    }
  });
  el.appendChild(span('tok-punct', ')'));
  if (method.returnType) {
    el.appendChild(span('tok-punct', ' → '));
    appendTypeTokens(el, method.returnType);
  }
}

function startMethodEdit(box, idx, textEl) {
  const method = box.methods[idx];
  textEl.classList.add('editing');
  textEl.innerHTML = '';
  const input = document.createElement('input');
  input.className = 'member-edit';
  input.placeholder = 'name(arg: Type, ...) -> ReturnType';
  input.value = methodToString(method);
  textEl.appendChild(input);
  input.focus(); input.select();
  const commit = () => {
    parseMethod(method, input.value);
    textEl.classList.remove('editing');
    render(); saveState();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); textEl.classList.remove('editing'); render(); }
  });
}

function methodToString(method) {
  if (!method.name) return '';
  const params = method.params.map(p => {
    let s = p.name;
    if (p.type) s += ': ' + p.type;
    if (p.default) s += ' = ' + p.default;
    return s;
  }).join(', ');
  const ret = method.returnType ? ' -> ' + method.returnType : '';
  return method.name + '(' + params + ')' + ret;
}

function parseMethod(method, raw) {
  const s = raw.trim();
  // Accept: name(arg: T = d, ...) -> RetType
  const m = s.match(/^([A-Za-z_]\\w*)\\s*\\(([^]*?)\\)\\s*(?:->|→)?\\s*(.*)$/);
  if (!m) {
    // Fall back: just treat whole string as name.
    method.name = s.replace(/[^A-Za-z0-9_]/g, '_') || method.name || 'method';
    method.params = []; method.returnType = '';
    return;
  }
  method.name = m[1];
  const paramsRaw = m[2].trim();
  method.returnType = (m[3] || '').trim();
  if (!paramsRaw) {
    method.params = [];
    return;
  }
  method.params = splitParams(paramsRaw)
    .map(p => p.trim())
    .filter(p => p && p !== 'self' && p !== 'cls')
    .map(p => parseParam(p));
}

function splitParams(s) {
  // Naive split on commas at depth 0 (handles nested generics like List[int, str]).
  const out = []; let depth = 0; let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '[' || c === '(' || c === '{') depth++;
    else if (c === ']' || c === ')' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(last, i)); last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

function parseParam(p) {
  let name = p, type = '', def = '';
  const eq = p.indexOf('=');
  if (eq !== -1) {
    def = p.slice(eq + 1).trim();
    p = p.slice(0, eq);
  }
  const colon = p.indexOf(':');
  if (colon !== -1) {
    name = p.slice(0, colon).trim();
    type = p.slice(colon + 1).trim();
  } else {
    name = p.trim();
  }
  return { name, type, default: def };
}

// --- Token rendering -------------------------------------------------------
function span(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function appendTypeTokens(parent, typeStr) {
  // Split on punctuation that delimits type tokens, preserving the delimiters.
  const parts = typeStr.split(/(\\s+|[\\[\\]|,]|'[^']*'|"[^"]*")/);
  for (const tok of parts) {
    if (!tok) continue;
    if (/^\\s+$/.test(tok)) { parent.appendChild(document.createTextNode(tok)); continue; }
    if (/^[\\[\\]|,]$/.test(tok)) { parent.appendChild(span('tok-punct', tok)); continue; }
    if (/^['"]/.test(tok)) { parent.appendChild(span('tok-string', tok)); continue; }
    const known = isKnownType(tok);
    parent.appendChild(span(known ? 'tok-type' : 'tok-type-unknown', tok));
  }
}

function isKnownType(name) {
  if (knownTypes.has(name)) return true;
  // Also: any user-created box on the canvas counts as known.
  for (const b of state.boxes.values()) {
    if (b.name === name) return true;
  }
  // Type-with-dotted-path: take the trailing segment.
  const tail = name.split('.').pop();
  if (tail !== name && knownTypes.has(tail)) return true;
  return false;
}

function appendValueTokens(parent, expr) {
  // Lightweight Python value highlighter.
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    // String literal
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < expr.length && expr[j] !== q) {
        if (expr[j] === '\\\\') j++;
        j++;
      }
      j = Math.min(j + 1, expr.length);
      parent.appendChild(span('tok-string', expr.slice(i, j)));
      i = j;
      continue;
    }
    // Number
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i;
      while (j < expr.length && /[0-9_.eE+\\-]/.test(expr[j])) j++;
      parent.appendChild(span('tok-number', expr.slice(i, j)));
      i = j;
      continue;
    }
    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      const cls = (word === 'True' || word === 'False' || word === 'None' || word === 'and' || word === 'or' || word === 'not')
        ? 'tok-bool'
        : isKnownType(word) ? 'tok-type' : 'tok-text';
      parent.appendChild(span(cls, word));
      i = j;
      continue;
    }
    parent.appendChild(span('tok-punct', ch));
    i++;
  }
}

// --- Edges -----------------------------------------------------------------
// All the heavy lifting (lane assignment, attachment-X spreading, color
// indices via graph coloring, side highway lanes) lives in the shared
// PTEdgeLayout module bundled by esbuild from src/ui/utils/edgeLayout.ts.
// This file just builds raw connections from the current state, asks the
// shared module for the geometry, and renders it as DOM nodes.
const EDGE_PALETTE = [
  'var(--pt-edge-0)','var(--pt-edge-1)','var(--pt-edge-2)','var(--pt-edge-3)',
  'var(--pt-edge-4)','var(--pt-edge-5)','var(--pt-edge-6)','var(--pt-edge-7)',
  'var(--pt-edge-8)','var(--pt-edge-9)','var(--pt-edge-10)','var(--pt-edge-11)',
  'var(--pt-edge-12)','var(--pt-edge-13)','var(--pt-edge-14)',
];
const EDGE_ARROW_W = 12;
const EDGE_ARROW_H = 10;

function computeLayerOf(ids) {
  // Longest-path layering on the current edge set. Same shape as
  // src/ui/utils/resolve.ts's longestPathLayers, but op-on top of the
  // create-board's in-memory state (no ClassNode involved).
  const idSet = new Set(ids);
  const parentsOf = new Map(ids.map(id => [id, []]));
  const childrenOf = new Map(ids.map(id => [id, []]));
  for (const e of state.edges) {
    if (!idSet.has(e.childId) || !idSet.has(e.parentId)) continue;
    parentsOf.get(e.childId).push(e.parentId);
    childrenOf.get(e.parentId).push(e.childId);
  }
  const inDeg = new Map(ids.map(id => [id, parentsOf.get(id).length]));
  const dist = new Map(ids.map(id => [id, 0]));
  const queue = [];
  for (const id of ids) if (inDeg.get(id) === 0) queue.push(id);
  while (queue.length) {
    const u = queue.shift();
    for (const v of childrenOf.get(u)) {
      if (dist.get(u) + 1 > dist.get(v)) dist.set(v, dist.get(u) + 1);
      inDeg.set(v, inDeg.get(v) - 1);
      if (inDeg.get(v) === 0) queue.push(v);
    }
  }
  return dist;
}

function svgNode(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function drawHollowArrow(group, x, y, color) {
  group.appendChild(svgNode('polygon', {
    points: [
      x + ',' + y,
      (x - EDGE_ARROW_W / 2) + ',' + (y + EDGE_ARROW_H),
      (x + EDGE_ARROW_W / 2) + ',' + (y + EDGE_ARROW_H),
    ].join(' '),
    fill: 'var(--pt-bg)', stroke: color, 'stroke-width': '1.5',
  }));
}

function drawLine(parent, x1, y1, x2, y2, color) {
  // Wide invisible underlay carries the hit area; the thin visible line on
  // top renders the actual edge. Both share the same coordinates so click
  // targeting stays accurate even when buses overlap.
  parent.appendChild(svgNode('line', {
    x1, y1, x2, y2, stroke: 'transparent', 'stroke-width': '10', class: 'hit',
  }));
  parent.appendChild(svgNode('line', {
    x1, y1, x2, y2, stroke: color, 'stroke-width': '1.5', class: 'vis',
  }));
}

function makeEdgeGroup(childId, parentId) {
  const g = svgNode('g', { 'data-edge-idx': '1' });
  g.style.cursor = 'pointer';
  g.addEventListener('click', evt => {
    evt.stopPropagation();
    if (state.tool !== 'erase') return;
    const i = state.edges.findIndex(e => e.childId === childId && e.parentId === parentId);
    if (i !== -1) {
      state.edges.splice(i, 1);
      render(); saveState();
    }
  });
  return g;
}

function renderEdges() {
  while (edgeSvg.firstChild) edgeSvg.removeChild(edgeSvg.firstChild);

  const ids = [...state.boxes.keys()];
  if (ids.length === 0 || state.edges.length === 0) {
    edgeSvg.setAttribute('width', '0');
    edgeSvg.setAttribute('height', '0');
    return;
  }

  // Geometry snapshot from the current DOM.
  const geom = new Map();
  for (const b of state.boxes.values()) {
    const el = boxesLayer.querySelector('[data-box-id="' + b.id + '"]');
    const w = el ? el.offsetWidth : 260;
    const h = el ? el.offsetHeight : 100;
    geom.set(b.id, { x: b.x, y: b.y, w, h, cx: b.x + w / 2, top: b.y, bot: b.y + h });
  }

  // Size the SVG so it covers everything (including space for the highway).
  let maxX = 2000, maxY = 2000;
  for (const g of geom.values()) {
    if (g.x + g.w + 200 > maxX) maxX = g.x + g.w + 200;
    if (g.y + g.h + 200 > maxY) maxY = g.y + g.h + 200;
  }
  edgeSvg.setAttribute('width', String(maxX));
  edgeSvg.setAttribute('height', String(maxY));

  // Build the RawConnection[] the shared module wants. parentX/childX are
  // CENTER xs (same convention as BoxMeasures in the auto-tree renderer).
  const layerOf = computeLayerOf(ids);
  const rawConns = [];
  for (const e of state.edges) {
    const p = geom.get(e.parentId);
    const c = geom.get(e.childId);
    if (!p || !c) continue;
    rawConns.push({
      parentX: p.cx, parentBottom: p.bot,
      childX: c.cx, childTop: c.top,
      parentLayer: layerOf.get(e.parentId) || 0,
      childLayer: layerOf.get(e.childId) || 0,
      parentId: e.parentId, childId: e.childId,
    });
  }
  if (rawConns.length === 0) return;

  const bounds = {
    right: Math.max(...[...geom.values()].map(g => g.x + g.w / 2)),
    left: Math.min(...[...geom.values()].map(g => g.x - g.w / 2)),
  };

  // Hand off to the shared geometry module — same code path the auto-tree
  // SVG renderer uses (see src/ui/render/edges.ts).
  const computed = PTEdgeLayout.computeEdgeGeometry(rawConns, bounds);

  for (const e of computed) {
    const color = EDGE_PALETTE[e.colorIndex % EDGE_PALETTE.length];
    const g = makeEdgeGroup(e.childId, e.parentId);
    drawHollowArrow(g, e.arrow.x, e.arrow.y, color);
    for (const seg of e.segments) {
      drawLine(g, seg.x1, seg.y1, seg.x2, seg.y2, color);
    }
    edgeSvg.appendChild(g);
  }
}

function handleEdgeBoxClick(box) {
  if (!state.edgeFirst) {
    state.edgeFirst = box.id;
    document.querySelectorAll('.box').forEach(el => el.classList.toggle('edge-target', el.dataset.boxId === box.id));
    return;
  }
  if (state.edgeFirst === box.id) {
    state.edgeFirst = null;
    document.querySelectorAll('.box').forEach(el => el.classList.remove('edge-target'));
    return;
  }
  const childId = state.edgeFirst;
  const parentId = box.id;
  state.edgeFirst = null;
  document.querySelectorAll('.box').forEach(el => el.classList.remove('edge-target'));
  // Validate
  const violation = checkEdgeViolation(childId, parentId);
  if (violation) {
    toast(violation, true);
    return;
  }
  state.edges.push({ id: 'e' + state.nextEdgeId++, childId, parentId });
  render(); saveState();
}

function checkEdgeViolation(childId, parentId) {
  if (childId === parentId) return 'A class cannot inherit from itself.';
  if (state.edges.some(e => e.childId === childId && e.parentId === parentId)) {
    return 'This inheritance already exists.';
  }
  // Cycle: would parentId reach childId via existing edges?
  const visited = new Set();
  const stack = [parentId];
  while (stack.length) {
    const id = stack.pop();
    if (id === childId) return 'Cycle: that edge would create circular inheritance.';
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of state.edges) {
      if (e.childId === id) stack.push(e.parentId);
    }
  }
  // Diamond/MRO conflict: a name defined in two ancestors that aren't on the
  // same vertical line (one isn't an ancestor of the other) makes the override
  // order ambiguous. Use the projected edge set with the new edge included.
  const projected = [...state.edges, { childId, parentId }];
  const ancestors = collectAncestors(childId, projected);
  ancestors.delete(childId);
  const ancestorBoxes = [...ancestors].map(id => state.boxes.get(id)).filter(Boolean);
  const nameToOwners = new Map();
  for (const a of ancestorBoxes) {
    for (const x of a.attributes) {
      if (!x.name) continue;
      if (!nameToOwners.has(x.name)) nameToOwners.set(x.name, []);
      nameToOwners.get(x.name).push(a.id);
    }
    for (const x of a.methods) {
      if (!x.name) continue;
      if (!nameToOwners.has(x.name)) nameToOwners.set(x.name, []);
      nameToOwners.get(x.name).push(a.id);
    }
  }
  for (const [name, owners] of nameToOwners.entries()) {
    if (owners.length < 2) continue;
    if (allLinearlyRelated(owners, projected)) continue;
    const ownerNames = owners.map(id => state.boxes.get(id)?.name ?? id).join(', ');
    return 'Conflict: "' + name + '" is defined in unrelated ancestors (' + ownerNames + ').';
  }
  return null;
}

function collectAncestors(id, edges) {
  const out = new Set();
  const stack = [id];
  while (stack.length) {
    const c = stack.pop();
    if (out.has(c)) continue;
    out.add(c);
    for (const e of edges) {
      if (e.childId === c) stack.push(e.parentId);
    }
  }
  return out;
}

function isAncestor(maybeAncestor, of, edges) {
  if (maybeAncestor === of) return true;
  const stack = [of];
  const visited = new Set();
  while (stack.length) {
    const c = stack.pop();
    if (visited.has(c)) continue;
    visited.add(c);
    for (const e of edges) {
      if (e.childId === c) {
        if (e.parentId === maybeAncestor) return true;
        stack.push(e.parentId);
      }
    }
  }
  return false;
}

function allLinearlyRelated(ids, edges) {
  // True when every pair is in an ancestor/descendant relationship.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (!isAncestor(ids[i], ids[j], edges) && !isAncestor(ids[j], ids[i], edges)) {
        return false;
      }
    }
  }
  return true;
}

// --- Modules ---------------------------------------------------------------
function renderModules() {
  modulesLayer.innerHTML = '';
  for (const mod of state.modules.values()) {
    const boxes = [...state.boxes.values()].filter(b => b.moduleId === mod.id);
    if (boxes.length === 0) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of boxes) {
      const el = document.querySelector('[data-box-id="' + b.id + '"]');
      const w = el ? el.offsetWidth : 260;
      const h = el ? el.offsetHeight : 100;
      if (b.x < minX) minX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.x + w > maxX) maxX = b.x + w;
      if (b.y + h > maxY) maxY = b.y + h;
    }
    const pad = 24;
    const overlay = document.createElement('div');
    overlay.className = 'module-overlay';
    overlay.style.left = (minX - pad) + 'px';
    overlay.style.top = (minY - pad - 18) + 'px';
    overlay.style.width = (maxX - minX + pad * 2) + 'px';
    overlay.style.height = (maxY - minY + pad * 2 + 18) + 'px';
    modulesLayer.appendChild(overlay);

    const label = document.createElement('div');
    label.className = 'module-label';
    label.textContent = mod.relativePath;
    label.style.left = (minX - pad) + 'px';
    label.style.top = (minY - pad - 26) + 'px';
    label.title = 'Click to remove this module grouping';
    const modId = mod.id;
    label.addEventListener('click', e => {
      e.stopPropagation();
      for (const b of state.boxes.values()) {
        if (b.moduleId === modId) b.moduleId = null;
      }
      state.modules.delete(modId);
      render(); saveState();
    });
    modulesLayer.appendChild(label);
  }
}

// --- Arrange ---------------------------------------------------------------
function arrangeLayout() {
  // Build connected components on edges, then longest-path layering per component.
  const ids = [...state.boxes.keys()];
  const idSet = new Set(ids);
  if (ids.length === 0) return;
  const parent = new Map(ids.map(id => [id, id]));
  const find = x => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  for (const e of state.edges) {
    if (!idSet.has(e.childId) || !idSet.has(e.parentId)) continue;
    const a = find(e.childId), b = find(e.parentId);
    if (a !== b) parent.set(a, b);
  }
  const components = new Map();
  for (const id of ids) {
    const r = find(id);
    if (!components.has(r)) components.set(r, []);
    components.get(r).push(id);
  }

  const horizGap = 60;
  const vertGap = 90;
  const compGap = 80;

  let compOffsetY = 80;
  const componentList = [...components.values()].sort((a, b) => b.length - a.length);
  for (const comp of componentList) {
    const layers = longestPathLayers(comp);
    let maxComponentWidth = 0;
    const layerWidths = [];
    const layerHeights = [];
    for (const layer of layers) {
      let w = 0, h = 0;
      for (const id of layer) {
        const el = document.querySelector('[data-box-id="' + id + '"]');
        const bw = el ? el.offsetWidth : 260;
        const bh = el ? el.offsetHeight : 100;
        w += bw;
        if (bh > h) h = bh;
      }
      w += (layer.length - 1) * horizGap;
      layerWidths.push(w);
      layerHeights.push(h);
      if (w > maxComponentWidth) maxComponentWidth = w;
    }

    // Reorder each layer by parent-barycenter so edges cross less.
    const positions = new Map(); // id -> { x }
    let y = compOffsetY;
    for (let li = 0; li < layers.length; li++) {
      let layer = layers[li];
      if (li > 0) {
        layer = [...layer].sort((a, b) => barycenter(a, positions) - barycenter(b, positions));
        layers[li] = layer;
      }
      let x = -layerWidths[li] / 2;
      for (const id of layer) {
        const el = document.querySelector('[data-box-id="' + id + '"]');
        const bw = el ? el.offsetWidth : 260;
        const bh = el ? el.offsetHeight : 100;
        const cx = x + bw / 2;
        const box = state.boxes.get(id);
        box.x = 600 + cx - bw / 2;
        box.y = y;
        positions.set(id, { x: cx, y });
        x += bw + horizGap;
      }
      y += layerHeights[li] + vertGap;
    }
    compOffsetY = y + compGap;
  }
  render();
  saveState();
}

function barycenter(id, positions) {
  // Position child relative to its parents' average x.
  const parents = state.edges.filter(e => e.childId === id).map(e => e.parentId);
  const xs = parents.map(p => positions.get(p)).filter(p => p).map(p => p.x);
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function longestPathLayers(ids) {
  // Layer 0 = roots (no parents in our subset). Children sit deeper.
  const idSet = new Set(ids);
  const parentsOf = new Map(ids.map(id => [id, []]));
  const childrenOf = new Map(ids.map(id => [id, []]));
  for (const e of state.edges) {
    if (!idSet.has(e.childId) || !idSet.has(e.parentId)) continue;
    parentsOf.get(e.childId).push(e.parentId);
    childrenOf.get(e.parentId).push(e.childId);
  }
  const inDeg = new Map(ids.map(id => [id, parentsOf.get(id).length]));
  const dist = new Map(ids.map(id => [id, 0]));
  const queue = [];
  for (const id of ids) if (inDeg.get(id) === 0) queue.push(id);
  while (queue.length) {
    const u = queue.shift();
    for (const v of childrenOf.get(u)) {
      if (dist.get(u) + 1 > dist.get(v)) dist.set(v, dist.get(u) + 1);
      inDeg.set(v, inDeg.get(v) - 1);
      if (inDeg.get(v) === 0) queue.push(v);
    }
  }
  const maxD = Math.max(0, ...dist.values());
  const layers = [];
  for (let d = 0; d <= maxD; d++) layers.push([]);
  for (const [id, d] of dist) layers[d].push(id);
  return layers.filter(l => l.length > 0);
}

// --- Box deletion ---------------------------------------------------------
function deleteBox(id) {
  state.boxes.delete(id);
  state.edges = state.edges.filter(e => e.childId !== id && e.parentId !== id);
  state.selected = null;
  // Drop modules that no longer contain any boxes.
  for (const m of [...state.modules.values()]) {
    const any = [...state.boxes.values()].some(b => b.moduleId === m.id);
    if (!any) state.modules.delete(m.id);
  }
  render(); saveState();
}

// --- Dialogs ---------------------------------------------------------------
function pickModule() {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'dialog-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.innerHTML = '' +
      '<h3>Module for selected classes</h3>' +
      '<label for="mod-name">Module path (relative to workspace)</label>' +
      '<input id="mod-name" list="mod-list" placeholder="e.g. pytree/shapes.py"/>' +
      '<datalist id="mod-list">' +
        existingModules.map(m => '<option value="' + escapeAttr(m.relativePath) + '">' + escapeAttr(m.name) + '</option>').join('') +
      '</datalist>' +
      '<div class="hint">If the path matches an existing Python file, new classes will be appended to the end of that file.</div>' +
      '<div class="actions">' +
        '<button id="mod-cancel">Cancel</button>' +
        '<button id="mod-ok" class="primary">Apply</button>' +
      '</div>';
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    const input = dialog.querySelector('#mod-name');
    input.focus();
    const close = result => {
      backdrop.remove();
      resolve(result);
    };
    dialog.querySelector('#mod-cancel').addEventListener('click', () => close(null));
    const confirm = () => {
      const val = input.value.trim();
      if (!val) { close(null); return; }
      let rel = val.replace(/^\\/+/, '');
      if (!rel.endsWith('.py')) rel = rel + '.py';
      const existing = existingModules.find(m => m.relativePath === rel);
      close({ relativePath: rel, existingFileUri: existing?.fileUri });
    };
    dialog.querySelector('#mod-ok').addEventListener('click', confirm);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { e.preventDefault(); close(null); }
    });
  });
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// --- Toast -----------------------------------------------------------------
let toastTimer = null;
function toast(msg, isError) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3000);
}

// --- Create ----------------------------------------------------------------
function emitCreate() {
  if (state.boxes.size === 0) {
    toast('Nothing to create — add some classes first.', true);
    return;
  }
  // Validate names
  for (const b of state.boxes.values()) {
    if (!b.name || !/^[A-Za-z_]\\w*$/.test(b.name)) {
      toast('Class name "' + b.name + '" is invalid.', true);
      return;
    }
  }
  const payload = {
    boxes: [...state.boxes.values()].map(b => ({
      id: b.id, name: b.name, isAbstract: b.isAbstract,
      attributes: b.attributes.map(a => ({
        name: a.name, type: a.type, default: a.default, isProperty: !!a.isProperty,
      })),
      methods: b.methods.map(m => ({
        name: m.name,
        params: m.params.map(p => ({ name: p.name, type: p.type, default: p.default })),
        returnType: m.returnType,
        isStatic: !!m.isStatic, isClassMethod: !!m.isClassMethod, isAbstract: !!m.isAbstract,
      })),
      moduleId: b.moduleId,
    })),
    edges: state.edges.map(e => ({ childId: e.childId, parentId: e.parentId })),
    modules: [...state.modules.values()].map(m => ({
      id: m.id, relativePath: m.relativePath, existingFileUri: m.existingFileUri,
    })),
  };
  vscode.postMessage({ command: 'createFiles', payload });
}

window.addEventListener('message', e => {
  const msg = e.data;
  if (msg.command === 'createDone') {
    toast(msg.fileCount + ' file(s) written.');
  } else if (msg.command === 'createError') {
    toast(msg.error, true);
  }
});

// --- Init ------------------------------------------------------------------
setTool('cursor');
applyTransform();
render();
`;
}
