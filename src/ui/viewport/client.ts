// Browser-side runtime for the auto-tree webview.
//
// This file replaces what used to live as a giant template literal inside
// `src/ui/webview/viewport.ts`. esbuild bundles it as a self-contained IIFE
// (dist/viewport.client.js) that the renderer inlines into the webview
// HTML. Type checking + linting now catch the bugs we hit before from
// stringly-typed code (backticks in comments closing the template,
// undeclared identifiers slipping through, etc.).
//
// Runtime config comes from a JSON `<script>` block emitted by the renderer
// alongside the bundle; per-call options (initial scale, focus node, ...)
// arrive that way instead of being interpolated into the source.

import type { ViewportConfig } from './types';
import { Theme } from '../../config';

// --- Ambient declarations for the VSCode webview API ----------------------
interface VsCodeApi {
    postMessage(message: unknown): void;
    setState(state: unknown): void;
    getState(): unknown;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface PersistedState {
    tx: number;
    ty: number;
    scale: number;
    showPaths?: boolean;
    // Box ids currently collapsed (header-only, all views).
    collapsed?: string[];
    // "Unlock class dragging" checkbox state (Project Tree only).
    dragUnlocked?: boolean;
    // Per-component drag offsets, keyed by `data-pt-component-id`.
    offsets?: Array<[string, [number, number]]>;
    // "Show collapse tools" checkbox state — defaults to true (visible).
    showCollapseTools?: boolean;
    // Box ids whose descendants/ancestors are currently hidden via that
    // box's own hide-descendants/hide-ancestors button.
    descHiddenTriggers?: string[];
    ancHiddenTriggers?: string[];
}

const CLICK_THRESHOLD = 4;
const LARGE_TREE_THRESHOLD = 50;
const HYDRATE_MARGIN_PX = 400;
const DEHYDRATE_MARGIN_PX = 1600;
const SVG_NS = 'http://www.w3.org/2000/svg';
// A collapsed title counter-scales as the view zooms out so it never drops
// below the normal (expanded) header's font size on screen, capped so it
// can't balloon at extreme zoom-out.
const MIN_APPARENT_HEADER_PX = Theme.font.size.header;
const MAX_COLLAPSE_COUNTER_SCALE = 4;

// --- Config + DOM bootstrap -----------------------------------------------
const configEl = document.getElementById('pt-viewport-config');
if (!configEl) {
    throw new Error('PyTree viewport: missing #pt-viewport-config');
}
const config = JSON.parse(configEl.textContent ?? '{}') as ViewportConfig;

const svg = document.getElementById('svgRoot') as unknown as SVGSVGElement;
const viewport = document.getElementById('viewport') as unknown as SVGGElement;
const vscode = acquireVsCodeApi();

const showPathsCb = document.getElementById(
    'show-paths-cb'
) as HTMLInputElement;
const showCollapseToolsCb = document.getElementById(
    'show-collapse-tools-cb'
) as HTMLInputElement;
// Only present when the renderer passed `dragEnabled: true` (Project Tree).
const dragCb = document.getElementById(
    'unlock-drag-cb'
) as HTMLInputElement | null;
const edgeTooltip = document.getElementById('edge-tooltip') as HTMLDivElement;
const navTooltip = document.getElementById('nav-tooltip') as HTMLDivElement;

const findBar = document.getElementById('find-bar') as HTMLDivElement;
const findInput = document.getElementById('find-input') as HTMLInputElement;
const findCountEl = document.getElementById('find-count') as HTMLSpanElement;
const findPrev = document.getElementById('find-prev') as HTMLButtonElement;
const findNext = document.getElementById('find-next') as HTMLButtonElement;
const findClose = document.getElementById('find-close') as HTMLButtonElement;
const findCaseBtn = document.getElementById('find-case') as HTMLButtonElement;
const findWordBtn = document.getElementById('find-word') as HTMLButtonElement;

const exportBtnEl = document.getElementById('export-btn') as HTMLButtonElement;
const exportMenuEl = document.getElementById('export-menu') as HTMLDivElement;
const optionsBtnEl = document.getElementById(
    'options-btn'
) as HTMLButtonElement;
const optionsMenuEl = document.getElementById(
    'options-menu'
) as HTMLDivElement;

const isLargeTree =
    viewport.querySelectorAll('[data-pt-box]').length >= LARGE_TREE_THRESHOLD;

// --- Persisted pan/zoom state ---------------------------------------------
const currentState = vscode.getState() as PersistedState | null;
let tx = currentState ? currentState.tx : 0;
let ty = currentState ? currentState.ty : 0;
let scale = currentState ? currentState.scale : config.initialScale;
let showPaths = currentState ? currentState.showPaths ?? false : false;
let showCollapseTools = currentState?.showCollapseTools ?? true;
const collapsedIds = new Set<string>(currentState?.collapsed ?? []);
let dragUnlocked = currentState?.dragUnlocked ?? false;
const componentOffsets = new Map<string, [number, number]>(
    currentState?.offsets ?? []
);
const descHiddenTriggers = new Set<string>(
    currentState?.descHiddenTriggers ?? []
);
const ancHiddenTriggers = new Set<string>(
    currentState?.ancHiddenTriggers ?? []
);

function persistState(): void {
    vscode.setState({
        tx,
        ty,
        scale,
        showPaths,
        collapsed: Array.from(collapsedIds),
        dragUnlocked,
        offsets: Array.from(componentOffsets),
        showCollapseTools,
        descHiddenTriggers: Array.from(descHiddenTriggers),
        ancHiddenTriggers: Array.from(ancHiddenTriggers),
    });
}

showPathsCb.checked = showPaths;
if (showPaths) {
    svg.classList.add('show-paths');
}

showCollapseToolsCb.checked = showCollapseTools;
if (!showCollapseTools) {
    svg.classList.add('hide-collapse-tools');
}
showCollapseToolsCb.addEventListener('change', () => {
    showCollapseTools = showCollapseToolsCb.checked;
    svg.classList.toggle('hide-collapse-tools', !showCollapseTools);
    persistState();
});

if (dragCb) {
    dragCb.checked = dragUnlocked;
}
if (dragUnlocked) {
    svg.classList.add('drag-unlocked');
}
if (dragCb) {
    dragCb.addEventListener('change', () => {
        dragUnlocked = dragCb.checked;
        svg.classList.toggle('drag-unlocked', dragUnlocked);
        persistState();
    });
}

// --- Restore collapsed boxes + dragged component positions -----------------
function escapeCss(id: string): string {
    return window.CSS && CSS.escape ? CSS.escape(id) : id;
}

// A collapsed box's own footprint shrinks to just its (enlarged) title —
// nothing is left behind, so its outgoing edges (where it's the parent) need
// their attach point re-anchored to the new, higher bottom. Mirrors the
// constants in src/ui/render/edges.ts; only the parent-side arrow + first
// segment ever move (see the comment on interactiveEdge for why the rest of
// each edge's route is untouched).
const EDGE_ARROW_W = 12;
const EDGE_ARROW_H = 10;
const EDGE_TIP_PAD = 6;

function updateEdgeParentAttach(edgeEl: Element, collapsed: boolean): void {
    const x = parseFloat(edgeEl.getAttribute('data-pt-parent-x') ?? '0');
    const yExpanded = parseFloat(
        edgeEl.getAttribute('data-pt-parent-bottom-expanded') ?? '0'
    );
    const yCollapsed = parseFloat(
        edgeEl.getAttribute('data-pt-parent-bottom-collapsed') ?? '0'
    );
    const y = collapsed ? yCollapsed : yExpanded;

    const arrow = edgeEl.querySelector('.pt-edge-arrow');
    if (arrow) {
        arrow.setAttribute(
            'points',
            x +
                ',' +
                y +
                ' ' +
                (x - EDGE_ARROW_W / 2) +
                ',' +
                (y + EDGE_ARROW_H) +
                ' ' +
                (x + EDGE_ARROW_W / 2) +
                ',' +
                (y + EDGE_ARROW_H)
        );
    }
    const tipHit = edgeEl.querySelector('.pt-edge-tip-hit');
    if (tipHit) {
        tipHit.setAttribute(
            'points',
            x +
                ',' +
                (y - EDGE_TIP_PAD) +
                ' ' +
                (x - EDGE_ARROW_W / 2 - EDGE_TIP_PAD) +
                ',' +
                (y + EDGE_ARROW_H + EDGE_TIP_PAD) +
                ' ' +
                (x + EDGE_ARROW_W / 2 + EDGE_TIP_PAD) +
                ',' +
                (y + EDGE_ARROW_H + EDGE_TIP_PAD)
        );
    }
    const newY1 = String(y + EDGE_ARROW_H);
    edgeEl
        .querySelector('.pt-edge-hit.pt-edge-seg0')
        ?.setAttribute('y1', newY1);
    edgeEl
        .querySelector('.pt-edge-body-vis.pt-edge-seg0')
        ?.setAttribute('y1', newY1);
}

function updateOutgoingEdges(boxId: string, collapsed: boolean): void {
    viewport
        .querySelectorAll(
            '[data-pt-edge][data-pt-edge-parent="' + escapeCss(boxId) + '"]'
        )
        .forEach(edgeEl => updateEdgeParentAttach(edgeEl, collapsed));
}

for (const id of collapsedIds) {
    const boxEl = viewport.querySelector(
        '[data-pt-box-id="' + escapeCss(id) + '"]'
    );
    boxEl?.setAttribute('data-pt-collapsed', '1');
    updateOutgoingEdges(id, true);
}

componentOffsets.forEach(([dx, dy], componentId) => {
    const compEl = viewport.querySelector(
        '[data-pt-component-id="' + escapeCss(componentId) + '"]'
    );
    compEl?.setAttribute('transform', 'translate(' + dx + ',' + dy + ')');
});

// Horizontal/vertical fractions of the collapsed panel the scaled title is
// allowed to fill — leaves a margin so it never touches the panel edges
// (and, since the title scales from its own centre, never grows tall enough
// to poke above the panel top into the file-path hover element that floats
// just above the box).
const COLLAPSE_FIT_W = 0.86;
const COLLAPSE_FIT_H = 0.7;

function updateCollapsedScale(boxEl: Element): void {
    const titleEl = boxEl.querySelector<SVGGElement>('.pt-collapsed-title');
    const panelRect = boxEl.querySelector<SVGRectElement>(
        '.pt-panel-collapsed rect'
    );
    if (!titleEl || !panelRect) {
        return;
    }
    const bbox = titleEl.getBBox();
    if (bbox.width === 0 || bbox.height === 0) {
        return;
    }
    const panelW = parseFloat(panelRect.getAttribute('width') ?? '0');
    const panelH = parseFloat(panelRect.getAttribute('height') ?? '0');

    const legibilityK = Math.max(
        1,
        MIN_APPARENT_HEADER_PX / (Theme.font.size.collapsedHeader * scale)
    );
    const fitK = Math.min(
        (panelW * COLLAPSE_FIT_W) / bbox.width,
        (panelH * COLLAPSE_FIT_H) / bbox.height
    );
    const k = Math.min(legibilityK, fitK, MAX_COLLAPSE_COUNTER_SCALE);
    titleEl.style.transform = k > 1 ? 'scale(' + k + ')' : '';
}

function updateAllCollapsedScales(): void {
    collapsedIds.forEach(id => {
        const boxEl = viewport.querySelector(
            '[data-pt-box-id="' + escapeCss(id) + '"]'
        );
        if (boxEl) {
            updateCollapsedScale(boxEl);
        }
    });
}

function toggleCollapse(boxEl: Element): void {
    const id = (boxEl as HTMLElement).dataset.ptBoxId;
    if (!id) {
        return;
    }
    const collapsing = !boxEl.hasAttribute('data-pt-collapsed');
    if (collapsing) {
        boxEl.setAttribute('data-pt-collapsed', '1');
        collapsedIds.add(id);
        updateCollapsedScale(boxEl);
    } else {
        boxEl.removeAttribute('data-pt-collapsed');
        collapsedIds.delete(id);
    }
    updateOutgoingEdges(id, collapsing);
    persistState();
}

// === HIDE DESCENDANTS / ANCESTORS ==========================================
// Adjacency is derived once from the (static) edge elements already in the
// DOM — collapse/hide/drag never add or remove edges, only toggle their
// visibility, so this never goes stale.
const childrenOf = new Map<string, string[]>();
const parentsOf = new Map<string, string[]>();
viewport.querySelectorAll<HTMLElement>('[data-pt-edge]').forEach(edgeEl => {
    const p = edgeEl.dataset.ptEdgeParent;
    const c = edgeEl.dataset.ptEdgeChild;
    if (!p || !c) {
        return;
    }
    if (!childrenOf.has(p)) {
        childrenOf.set(p, []);
    }
    childrenOf.get(p)!.push(c);
    if (!parentsOf.has(c)) {
        parentsOf.set(c, []);
    }
    parentsOf.get(c)!.push(p);
});

function collectReachable(
    startId: string,
    adjacency: Map<string, string[]>
): Set<string> {
    const result = new Set<string>();
    const stack = [...(adjacency.get(startId) ?? [])];
    while (stack.length) {
        const cur = stack.pop()!;
        if (result.has(cur)) {
            continue;
        }
        result.add(cur);
        stack.push(...(adjacency.get(cur) ?? []));
    }
    return result;
}

// Ids currently hidden by *any* trigger. An edge is hidden whenever either
// endpoint is in this set, so a hidden box never leaves a dangling arrow
// behind (e.g. an ancestor's *other* children that aren't themselves
// ancestors of the triggering box).
const hiddenNodeIds = new Set<string>();

function refreshEdgesTouching(ids: Set<string>): void {
    viewport.querySelectorAll<HTMLElement>('[data-pt-edge]').forEach(edgeEl => {
        const p = edgeEl.dataset.ptEdgeParent;
        const c = edgeEl.dataset.ptEdgeChild;
        if ((p && ids.has(p)) || (c && ids.has(c))) {
            const hidden =
                (!!p && hiddenNodeIds.has(p)) || (!!c && hiddenNodeIds.has(c));
            edgeEl.style.display = hidden ? 'none' : '';
        }
    });
}

function hideNodes(ids: Set<string>): void {
    ids.forEach(id => {
        hiddenNodeIds.add(id);
        const boxEl = viewport.querySelector(
            '[data-pt-box-id="' + escapeCss(id) + '"]'
        );
        boxEl?.setAttribute('data-pt-hidden', '1');
    });
    refreshEdgesTouching(ids);
}

function showNodes(ids: Set<string>): void {
    ids.forEach(id => {
        hiddenNodeIds.delete(id);
        const boxEl = viewport.querySelector(
            '[data-pt-box-id="' + escapeCss(id) + '"]'
        );
        boxEl?.removeAttribute('data-pt-hidden');
    });
    refreshEdgesTouching(ids);
}

// Both directions share this shape: recompute the (static) subtree fresh
// each time rather than remembering exactly what a given click hid, so
// overlapping hide operations from different boxes stay simple — the trade
// off is that "show" always reveals a trigger's *whole* subtree even if
// another still-active trigger would also claim part of it.
function toggleTreeVisibility(
    boxEl: Element,
    kind: 'descendants' | 'ancestors'
): void {
    const id = (boxEl as HTMLElement).dataset.ptBoxId;
    if (!id) {
        return;
    }
    const adjacency = kind === 'descendants' ? childrenOf : parentsOf;
    const attr =
        kind === 'descendants'
            ? 'data-pt-descendants-hidden'
            : 'data-pt-ancestors-hidden';
    const triggers = kind === 'descendants' ? descHiddenTriggers : ancHiddenTriggers;
    const targets = collectReachable(id, adjacency);
    const hiding = !boxEl.hasAttribute(attr);
    if (hiding) {
        boxEl.setAttribute(attr, '1');
        triggers.add(id);
        hideNodes(targets);
    } else {
        boxEl.removeAttribute(attr);
        triggers.delete(id);
        showNodes(targets);
    }
    persistState();
}

for (const id of descHiddenTriggers) {
    const boxEl = viewport.querySelector(
        '[data-pt-box-id="' + escapeCss(id) + '"]'
    );
    if (boxEl) {
        boxEl.setAttribute('data-pt-descendants-hidden', '1');
        hideNodes(collectReachable(id, childrenOf));
    }
}
for (const id of ancHiddenTriggers) {
    const boxEl = viewport.querySelector(
        '[data-pt-box-id="' + escapeCss(id) + '"]'
    );
    if (boxEl) {
        boxEl.setAttribute('data-pt-ancestors-hidden', '1');
        hideNodes(collectReachable(id, parentsOf));
    }
}

// === LAZY BODY HYDRATION ==================================================
// For trees above UI.lazy.renderThreshold, each box ships with an empty
// `<g data-pt-lazy-body="...">` slot. The body SVG sits parked in the
// JSON payload until the box (plus a generous margin) intersects the
// viewport. Boxes that drift far enough get torn down again so the DOM
// stays bounded regardless of tree size.
interface LazyBox {
    slot: SVGElement;
    x: number;
    y: number;
    w: number;
    h: number;
    hydrated: boolean;
}

const lazyDataEl = document.getElementById('pt-lazy-bodies');
const lazyBodies = lazyDataEl
    ? new Map<string, string>(
          JSON.parse(lazyDataEl.textContent ?? '[]') as Array<[string, string]>
      )
    : null;

let lazyBoxes: LazyBox[] | null = null;
function collectLazyBoxes(): void {
    if (!lazyBodies) {
        return;
    }
    lazyBoxes = [];
    viewport.querySelectorAll<SVGElement>('[data-pt-box]').forEach(el => {
        const slot = el.querySelector<SVGElement>('[data-pt-lazy-body]');
        if (!slot) {
            return;
        }
        lazyBoxes!.push({
            slot,
            x: parseFloat(el.dataset.ptX ?? '0'),
            y: parseFloat(el.dataset.ptY ?? '0'),
            w: parseFloat(el.dataset.ptW ?? '0'),
            h: parseFloat(el.dataset.ptH ?? '0'),
            hydrated: false,
        });
    });
}
collectLazyBoxes();

function hydrateBox(box: LazyBox): void {
    if (box.hydrated || !lazyBodies) {
        return;
    }
    const id = box.slot.dataset.ptLazyBody ?? '';
    const html = lazyBodies.get(id);
    if (!html) {
        return;
    }
    // Wrap in a foreign <svg> so the HTML parser puts children in the SVG
    // namespace; then move them into the live slot. Faster than DOMParser
    // and avoids the XML strictness pitfalls.
    const wrapper = document.createElementNS(SVG_NS, 'svg');
    wrapper.innerHTML = html;
    while (wrapper.firstChild) {
        box.slot.appendChild(wrapper.firstChild);
    }
    box.hydrated = true;
}

function dehydrateBox(box: LazyBox): void {
    if (!box.hydrated) {
        return;
    }
    while (box.slot.firstChild) {
        box.slot.removeChild(box.slot.firstChild);
    }
    box.hydrated = false;
}

let forceHydrateAll = false;
function updateLazyBodies(): void {
    if (!lazyBoxes) {
        return;
    }
    if (forceHydrateAll) {
        for (const box of lazyBoxes) {
            hydrateBox(box);
        }
        return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const box of lazyBoxes) {
        const screenLeft = box.x * scale + tx;
        const screenTop = box.y * scale + ty;
        const screenRight = screenLeft + box.w * scale;
        const screenBottom = screenTop + box.h * scale;
        const inHydrateRect =
            screenRight >= -HYDRATE_MARGIN_PX &&
            screenLeft <= vw + HYDRATE_MARGIN_PX &&
            screenBottom >= -HYDRATE_MARGIN_PX &&
            screenTop <= vh + HYDRATE_MARGIN_PX;
        if (inHydrateRect) {
            hydrateBox(box);
            continue;
        }
        if (!box.hydrated) {
            continue;
        }
        const inDehydrateRect =
            screenRight >= -DEHYDRATE_MARGIN_PX &&
            screenLeft <= vw + DEHYDRATE_MARGIN_PX &&
            screenBottom >= -DEHYDRATE_MARGIN_PX &&
            screenTop <= vh + DEHYDRATE_MARGIN_PX;
        if (!inDehydrateRect) {
            dehydrateBox(box);
        }
    }
}

let _hydrateRAF: number | null = null;
function scheduleHydrate(): void {
    if (!lazyBoxes) {
        return;
    }
    if (_hydrateRAF !== null) {
        return;
    }
    _hydrateRAF = requestAnimationFrame(() => {
        _hydrateRAF = null;
        updateLazyBodies();
    });
}

// === EXPORT DROPDOWN ======================================================
exportBtnEl.addEventListener('click', e => {
    e.stopPropagation();
    exportMenuEl.classList.toggle('open');
});
exportMenuEl.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => exportMenuEl.classList.remove('open'));

// === OPTIONS DROPDOWN (Show all file paths, Unlock class dragging, ...) ===
optionsBtnEl.addEventListener('click', e => {
    e.stopPropagation();
    optionsMenuEl.classList.toggle('open');
});
optionsMenuEl.addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () =>
    optionsMenuEl.classList.remove('open')
);

function buildExportClone(): {
    clone: SVGSVGElement;
    vbW: number;
    vbH: number;
} {
    const svgEl = document.getElementById('svgRoot') as unknown as SVGSVGElement;
    const vpEl = document.getElementById('viewport') as unknown as SVGGElement;
    const bbox = (vpEl as SVGGraphicsElement).getBBox();
    const pad = 40;
    const vbX = Math.floor(bbox.x - pad);
    const vbY = Math.floor(bbox.y - pad);
    const vbW = Math.ceil(bbox.width + pad * 2);
    const vbH = Math.ceil(bbox.height + pad * 2);
    const clone = svgEl.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH);
    clone.setAttribute('width', String(vbW));
    clone.setAttribute('height', String(vbH));
    const vpClone = clone.querySelector('#viewport');
    if (vpClone) {
        vpClone.setAttribute('transform', 'translate(0,0) scale(1)');
    }

    // Resolve VSCode editor font and bake it into the clone so the exported
    // file uses the same font outside the webview (where --vscode-* vars are
    // undefined and would fall back to the browser default).
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.fontFamily = 'var(--vscode-editor-font-family)';
    document.body.appendChild(probe);
    const resolvedFont = getComputedStyle(probe).fontFamily;
    probe.remove();
    const fontStyleEl = document.createElementNS(SVG_NS, 'style');
    fontStyleEl.textContent =
        'svg text, text { font-family: ' + resolvedFont + ' !important; }';
    clone.appendChild(fontStyleEl);

    return { clone, vbW, vbH };
}

document.getElementById('export-as-html')!.addEventListener('click', () => {
    exportMenuEl.classList.remove('open');
    const { clone } = buildExportClone();
    const themeKind = document.body.dataset.vscodeThemeKind || 'vscode-dark';
    vscode.postMessage({
        command: 'export',
        format: 'html',
        svgContent: new XMLSerializer().serializeToString(clone),
        themeKind,
    });
});

document.getElementById('export-as-svg')!.addEventListener('click', () => {
    exportMenuEl.classList.remove('open');
    const { clone } = buildExportClone();

    const varNames = [
        '--pt-bg', '--pt-panel-bg', '--pt-border', '--pt-text',
        '--pt-header-bg', '--pt-abstract-header-bg', '--pt-header-text',
        '--pt-header-bg-top', '--pt-header-bg-bot',
        '--pt-abstract-bg-top', '--pt-abstract-bg-bot',
        '--pt-filepath-bg', '--pt-filepath-text', '--pt-section-label',
        '--pt-type', '--pt-string', '--pt-number', '--pt-attribute',
        '--pt-method', '--pt-override', '--pt-bool', '--pt-edge',
        '--pt-edge-0', '--pt-edge-1', '--pt-edge-2', '--pt-edge-3',
        '--pt-edge-4', '--pt-edge-5', '--pt-edge-6', '--pt-edge-7',
        '--pt-edge-8', '--pt-edge-9', '--pt-edge-10', '--pt-edge-11',
        '--pt-edge-12', '--pt-edge-13', '--pt-edge-14',
        '--pt-hover-underline', '--pt-hover-underline-member',
    ];
    const tmp = document.createElement('span');
    tmp.style.display = 'none';
    document.body.appendChild(tmp);
    const resolvedVars = varNames
        .map(v => {
            tmp.style.color = 'var(' + v + ')';
            return v + ': ' + getComputedStyle(tmp).color + ';';
        })
        .join(' ');
    tmp.remove();

    const styleEl = document.createElementNS(SVG_NS, 'style');
    styleEl.textContent = ':root { ' + resolvedVars + ' }';
    clone.insertBefore(styleEl, clone.firstChild);

    vscode.postMessage({
        command: 'export',
        format: 'svg',
        svgContent: new XMLSerializer().serializeToString(clone),
    });
});

showPathsCb.addEventListener('change', () => {
    showPaths = showPathsCb.checked;
    svg.classList.toggle('show-paths', showPaths);
    persistState();
});

// === SNAPSHOT ZOOM (large trees only) =====================================
// For big trees, repainting the SVG <g> on every wheel event is too slow.
// We instead apply a CSS transform to a wrapper <div> (GPU-tiled, cheap)
// during active zoom, and "commit" to the <g> when the wheel goes idle.
let wrapper: HTMLDivElement | null = null;
if (isLargeTree) {
    wrapper = document.createElement('div');
    wrapper.id = 'zoom-wrapper';
    wrapper.style.position = 'fixed';
    wrapper.style.inset = '0';
    wrapper.style.overflow = 'hidden';
    wrapper.style.transformOrigin = '0 0';
    wrapper.style.willChange = 'transform';
    svg.parentNode!.insertBefore(wrapper, svg);
    wrapper.appendChild(svg);
}

let _committedTx = tx;
let _committedTy = ty;
let _committedScale = scale;
let _zoomActive = false;
let _zoomEndTimer: ReturnType<typeof setTimeout> | null = null;

function applySnapshotTransform(): void {
    if (!wrapper) {
        return;
    }
    const ds = scale / _committedScale;
    const dtx = tx - ds * _committedTx;
    const dty = ty - ds * _committedTy;
    wrapper.style.transform =
        'translate(' + dtx + 'px,' + dty + 'px) scale(' + ds + ')';
}

function update(): void {
    if (_zoomActive) {
        _zoomActive = false;
        svg.classList.remove('zooming');
        if (_zoomEndTimer) {
            clearTimeout(_zoomEndTimer);
            _zoomEndTimer = null;
        }
        if (wrapper) {
            wrapper.style.transform = '';
        }
    }
    viewport.setAttribute(
        'transform',
        'translate(' + tx + ',' + ty + ') scale(' + scale + ')'
    );
    _committedTx = tx;
    _committedTy = ty;
    _committedScale = scale;
    updateAllCollapsedScales();
    persistState();
    scheduleHydrate();
}

// When wrapped, the SVG's rect is post-CSS-transform, so we hardcode the
// wrapper's natural rect. Otherwise, fall back to the SVG's own.
let _svgRect = isLargeTree
    ? {
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
      }
    : svg.getBoundingClientRect();
window.addEventListener('resize', () => {
    if (isLargeTree) {
        _svgRect = {
            left: 0,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        };
    } else {
        _svgRect = svg.getBoundingClientRect();
    }
    scheduleHydrate();
});

svg.style.cursor = 'grab';
svg.style.userSelect = 'none';

// === EDGE INTERACTIONS ====================================================
// The inheritance arrow has two interactive regions:
//   - tip → drag changes inheritance; a click pans to focus the subclass.
//   - body → click pans to focus the superclass.
interface EdgeDragState {
    edgeEl: SVGGElement;
    childId: string;
    parentId: string;
    ghost: SVGLineElement;
    hoverBoxEl: SVGElement | null;
    startX: number;
    startY: number;
    moved: boolean;
}
interface EdgeBodyClickState {
    parentId: string;
    startX: number;
    startY: number;
    moved: boolean;
}

let edgeDrag: EdgeDragState | null = null;
let edgeBodyClick: EdgeBodyClickState | null = null;

function panToBox(boxId: string | undefined): void {
    if (!boxId) {
        return;
    }
    const escaped = window.CSS && CSS.escape ? CSS.escape(boxId) : boxId;
    const boxEl = viewport.querySelector('[data-pt-box-id="' + escaped + '"]');
    if (!boxEl) {
        return;
    }
    // getBoundingClientRect is post-transform (it accounts for the box
    // group's own translate()); getBBox would not. Convert to a pan delta
    // that puts the box centre at the viewport centre.
    const r = boxEl.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
        return;
    }
    const screenCx = r.left + r.width / 2;
    const screenCy = r.top + r.height / 2;
    tx += window.innerWidth / 2 - screenCx;
    ty += window.innerHeight / 2 - screenCy;
    update();
}

let tooltipEdgeEl: Element | null = null;
function hideAllTooltips(): void {
    edgeTooltip.style.display = 'none';
    navTooltip.style.display = 'none';
    tooltipEdgeEl = null;
}

svg.addEventListener('mousemove', e => {
    const target = e.target as Element | null;
    const edgeEl = target?.closest<HTMLElement>('[data-pt-edge]');
    if (edgeEl) {
        if (edgeEl !== tooltipEdgeEl) {
            const childName =
                edgeEl.dataset.ptEdgeChildName ??
                edgeEl.dataset.ptEdgeChild ??
                '?';
            const parentName =
                edgeEl.dataset.ptEdgeParentName ??
                edgeEl.dataset.ptEdgeParent ??
                '?';
            edgeTooltip.textContent = childName + ' → ' + parentName;
            tooltipEdgeEl = edgeEl;
        }
        edgeTooltip.style.display = 'block';
        edgeTooltip.style.left = e.clientX + 14 + 'px';
        edgeTooltip.style.top = e.clientY - 32 + 'px';
        navTooltip.style.display = 'none';
        return;
    }
    edgeTooltip.style.display = 'none';
    tooltipEdgeEl = null;

    const navEl = target?.closest('[data-line]');
    if (navEl) {
        navTooltip.style.display = 'block';
        navTooltip.style.left = e.clientX + 14 + 'px';
        navTooltip.style.top = e.clientY - 32 + 'px';
    } else {
        navTooltip.style.display = 'none';
    }
});
svg.addEventListener('mouseleave', hideAllTooltips);

function clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
    return {
        x: (clientX - _svgRect.left - tx) / scale,
        y: (clientY - _svgRect.top - ty) / scale,
    };
}

function getBoxCenter(boxEl: Element): { x: number; y: number } {
    const r = boxEl.getBoundingClientRect();
    return clientToSvg(r.left + r.width / 2, r.top + r.height / 2);
}

function startEdgeDrag(edgeEl: SVGGElement, e: PointerEvent): void {
    const childId = edgeEl.dataset.ptEdgeChild;
    const parentId = edgeEl.dataset.ptEdgeParent;
    if (!childId || !parentId) {
        return;
    }

    // Pick up the visible arrow's stroke color so the ghost matches.
    let edgeColor = '#888';
    for (const p of Array.from(edgeEl.querySelectorAll('polygon'))) {
        const s = p.getAttribute('stroke');
        if (s && s !== 'none') {
            edgeColor = s;
            break;
        }
    }

    const escaped = window.CSS && CSS.escape ? CSS.escape(childId) : childId;
    const childBox = viewport.querySelector(
        '[data-pt-box-id="' + escaped + '"]'
    );
    const origin = childBox
        ? getBoxCenter(childBox)
        : clientToSvg(e.clientX, e.clientY);

    // Ghost stays hidden until the user actually drags past the threshold so
    // a simple click on the tip doesn't paint a stub line.
    const ghost = document.createElementNS(SVG_NS, 'line');
    ghost.setAttribute('stroke', edgeColor);
    ghost.setAttribute('stroke-opacity', '0.55');
    ghost.setAttribute('stroke-width', '2');
    ghost.setAttribute('stroke-dasharray', '6 4');
    ghost.setAttribute('pointer-events', 'none');
    ghost.setAttribute('x1', String(origin.x));
    ghost.setAttribute('y1', String(origin.y));
    ghost.setAttribute('x2', String(origin.x));
    ghost.setAttribute('y2', String(origin.y));
    ghost.style.display = 'none';
    viewport.appendChild(ghost);

    edgeDrag = {
        edgeEl,
        childId,
        parentId,
        ghost,
        hoverBoxEl: null,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
    };
    hideAllTooltips();
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
}

function updateEdgeDrag(e: PointerEvent): void {
    if (!edgeDrag) {
        return;
    }
    if (!edgeDrag.moved) {
        const dx = e.clientX - edgeDrag.startX;
        const dy = e.clientY - edgeDrag.startY;
        if (
            Math.abs(dx) < CLICK_THRESHOLD &&
            Math.abs(dy) < CLICK_THRESHOLD
        ) {
            return;
        }
        edgeDrag.moved = true;
        edgeDrag.ghost.style.display = '';
    }
    const p = clientToSvg(e.clientX, e.clientY);
    edgeDrag.ghost.setAttribute('x2', String(p.x));
    edgeDrag.ghost.setAttribute('y2', String(p.y));

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const boxEl = (under?.closest('[data-pt-box-id]') ?? null) as SVGElement | null;
    if (boxEl !== edgeDrag.hoverBoxEl) {
        if (edgeDrag.hoverBoxEl) {
            edgeDrag.hoverBoxEl.style.filter = '';
        }
        if (boxEl) {
            boxEl.style.filter = 'brightness(1.25)';
        }
        edgeDrag.hoverBoxEl = boxEl;
    }
}

function endEdgeDrag(e: PointerEvent): boolean {
    if (!edgeDrag) {
        return false;
    }
    const { childId, parentId, ghost, hoverBoxEl, moved } = edgeDrag;
    if (hoverBoxEl) {
        hoverBoxEl.style.filter = '';
    }
    ghost.remove();

    edgeDrag = null;
    svg.style.cursor = 'grab';
    try {
        svg.releasePointerCapture(e.pointerId);
    } catch {
        // already released
    }

    if (!moved) {
        panToBox(childId);
        return true;
    }

    const under = document.elementFromPoint(e.clientX, e.clientY);
    const boxEl = under?.closest<HTMLElement>('[data-pt-box-id]') ?? null;
    const newParentId = boxEl ? boxEl.dataset.ptBoxId : null;
    if (newParentId && newParentId !== parentId) {
        vscode.postMessage({
            command: 'changeInheritance',
            childId,
            oldParentId: parentId,
            newParentId,
        });
    }
    return true;
}

function startEdgeBodyClick(edgeEl: HTMLElement, e: PointerEvent): void {
    const parentId = edgeEl.dataset.ptEdgeParent;
    if (!parentId) {
        return;
    }
    edgeBodyClick = {
        parentId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
    };
    hideAllTooltips();
    svg.setPointerCapture(e.pointerId);
}

function updateEdgeBodyClick(e: PointerEvent): void {
    if (!edgeBodyClick || edgeBodyClick.moved) {
        return;
    }
    const dx = e.clientX - edgeBodyClick.startX;
    const dy = e.clientY - edgeBodyClick.startY;
    if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) {
        edgeBodyClick.moved = true;
    }
}

function endEdgeBodyClick(e: PointerEvent): boolean {
    if (!edgeBodyClick) {
        return false;
    }
    const { parentId, moved } = edgeBodyClick;
    edgeBodyClick = null;
    try {
        svg.releasePointerCapture(e.pointerId);
    } catch {
        // already released
    }
    if (!moved) {
        panToBox(parentId);
    }
    return true;
}

// === COMPONENT DRAG (Project Tree, "Unlock class dragging" only) ==========
// A connected component never shares an edge with another component, so
// dragging just translates the whole `[data-pt-component-id]` group — every
// box and edge inside it moves together and nothing outside it is touched.
interface ComponentDragState {
    groupEl: SVGGElement;
    componentId: string;
    baseDx: number;
    baseDy: number;
    startX: number;
    startY: number;
    moved: boolean;
    // svg.setPointerCapture() retargets e.target to `svg` itself on every
    // subsequent event for this pointer, so the originally clicked element
    // has to be captured up front — reading e.target in endComponentDrag
    // would always miss the [data-line] ancestor. Same pitfall the generic
    // pan path avoids via `pointerDownTarget`.
    downTarget: Element | null;
}

let componentDrag: ComponentDragState | null = null;

function startComponentDrag(boxEl: Element, e: PointerEvent): void {
    const groupEl = boxEl.closest<SVGGElement>('[data-pt-component-id]');
    if (!groupEl) {
        return;
    }
    const componentId = groupEl.dataset.ptComponentId ?? '';
    const [baseDx, baseDy] = componentOffsets.get(componentId) ?? [0, 0];
    componentDrag = {
        groupEl,
        componentId,
        baseDx,
        baseDy,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        downTarget: e.target as Element | null,
    };
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
}

function updateComponentDrag(e: PointerEvent): void {
    if (!componentDrag) {
        return;
    }
    const dx = e.clientX - componentDrag.startX;
    const dy = e.clientY - componentDrag.startY;
    if (
        !componentDrag.moved &&
        Math.abs(dx) < CLICK_THRESHOLD &&
        Math.abs(dy) < CLICK_THRESHOLD
    ) {
        return;
    }
    componentDrag.moved = true;
    const newDx = componentDrag.baseDx + dx / scale;
    const newDy = componentDrag.baseDy + dy / scale;
    componentDrag.groupEl.setAttribute(
        'transform',
        'translate(' + newDx + ',' + newDy + ')'
    );
}

// Returns true when it fully handled the pointerup (drag commit or the
// click-to-navigate fallback for a non-moved click), mirroring
// endEdgeDrag/endEdgeBodyClick so endPan's generic pan-end logic is skipped.
function endComponentDrag(e: PointerEvent): boolean {
    if (!componentDrag) {
        return false;
    }
    const {
        groupEl,
        componentId,
        baseDx,
        baseDy,
        startX,
        startY,
        moved,
        downTarget,
    } = componentDrag;
    componentDrag = null;
    svg.style.cursor = 'grab';
    try {
        svg.releasePointerCapture(e.pointerId);
    } catch {
        // already released
    }

    if (!moved) {
        const navTarget = downTarget?.closest<HTMLElement>('[data-line]');
        if (navTarget) {
            vscode.postMessage({
                command: 'navigate',
                fileUri: navTarget.dataset.file,
                line: parseInt(navTarget.dataset.line ?? '0', 10),
            });
        }
        return true;
    }

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newDx = baseDx + dx / scale;
    const newDy = baseDy + dy / scale;
    groupEl.setAttribute('transform', 'translate(' + newDx + ',' + newDy + ')');
    componentOffsets.set(componentId, [newDx, newDy]);
    persistState();
    return true;
}

// === PAN / ZOOM ===========================================================
let isPanning = false;
let pointerDownTarget: Element | null = null;
let pointerMoved = false;
let lastX = 0;
let lastY = 0;
let panButton = -1;

// Suppress Chrome/Firefox auto-scroll on middle-click.
svg.addEventListener('mousedown', e => {
    if (e.button === 1) {
        e.preventDefault();
    }
});

svg.addEventListener('pointerdown', e => {
    if (e.button === 1) {
        e.preventDefault();
        isPanning = true;
        panButton = 1;
        pointerDownTarget = null;
        pointerMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        svg.setPointerCapture(e.pointerId);
        svg.style.cursor = 'grabbing';
        return;
    }
    if (e.button !== 0) {
        return;
    }
    const target = e.target as Element | null;

    const collapseBtn = target?.closest('[data-pt-collapse-toggle]');
    if (collapseBtn) {
        e.stopPropagation();
        const boxEl = collapseBtn.closest('[data-pt-box]');
        if (boxEl) {
            toggleCollapse(boxEl);
        }
        return;
    }

    const hideDescendantsBtn = target?.closest('[data-pt-hide-descendants]');
    if (hideDescendantsBtn) {
        e.stopPropagation();
        const boxEl = hideDescendantsBtn.closest('[data-pt-box]');
        if (boxEl) {
            toggleTreeVisibility(boxEl, 'descendants');
        }
        return;
    }

    const hideAncestorsBtn = target?.closest('[data-pt-hide-ancestors]');
    if (hideAncestorsBtn) {
        e.stopPropagation();
        const boxEl = hideAncestorsBtn.closest('[data-pt-box]');
        if (boxEl) {
            toggleTreeVisibility(boxEl, 'ancestors');
        }
        return;
    }

    const edgeEl = target?.closest('[data-pt-edge]') as SVGGElement | null;
    if (edgeEl) {
        e.stopPropagation();
        const roleEl = target?.closest<HTMLElement>('[data-pt-edge-role]');
        const role = roleEl?.dataset.ptEdgeRole;
        if (role === 'body') {
            startEdgeBodyClick(edgeEl as unknown as HTMLElement, e);
        } else {
            startEdgeDrag(edgeEl, e);
        }
        return;
    }

    if (config.dragEnabled && dragUnlocked) {
        const boxEl = target?.closest('[data-pt-box]');
        if (boxEl) {
            e.stopPropagation();
            startComponentDrag(boxEl, e);
            return;
        }
    }

    isPanning = true;
    panButton = 0;
    pointerDownTarget = target;
    pointerMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
});

svg.addEventListener('pointermove', e => {
    if (edgeDrag) {
        updateEdgeDrag(e);
        return;
    }
    if (edgeBodyClick) {
        updateEdgeBodyClick(e);
        return;
    }
    if (componentDrag) {
        updateComponentDrag(e);
        return;
    }
    if (!isPanning) {
        return;
    }
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) {
        pointerMoved = true;
    }
    tx += dx * config.panSensitivity;
    ty += dy * config.panSensitivity;
    lastX = e.clientX;
    lastY = e.clientY;
    update();
});

function endPan(e: PointerEvent): void {
    if (endEdgeDrag(e)) {
        return;
    }
    if (endEdgeBodyClick(e)) {
        return;
    }
    if (endComponentDrag(e)) {
        return;
    }
    // Only the left button triggers click-to-navigate. A middle-click without
    // motion is a stationary pan attempt, not a navigation request.
    if (panButton === 0 && !pointerMoved && pointerDownTarget) {
        const navTarget = pointerDownTarget.closest<HTMLElement>(
            '[data-line]'
        );
        if (navTarget) {
            vscode.postMessage({
                command: 'navigate',
                fileUri: navTarget.dataset.file,
                line: parseInt(navTarget.dataset.line ?? '0', 10),
            });
        }
    }
    isPanning = false;
    panButton = -1;
    pointerMoved = false;
    pointerDownTarget = null;
    svg.style.cursor = 'grab';
    try {
        svg.releasePointerCapture(e.pointerId);
    } catch {
        // already released
    }
}

svg.addEventListener('pointerup', endPan);
svg.addEventListener('pointercancel', endPan);

let _wheelRAF: number | null = null;
let _wheelFactor = 1;
let _wheelMx = 0;
let _wheelMy = 0;

svg.addEventListener(
    'wheel',
    e => {
        e.preventDefault();

        if (isLargeTree) {
            if (!_zoomActive) {
                _zoomActive = true;
                svg.classList.add('zooming');
            }
            if (_zoomEndTimer) {
                clearTimeout(_zoomEndTimer);
            }
            _zoomEndTimer = setTimeout(update, 150);
        }

        _wheelMx = e.clientX - _svgRect.left;
        _wheelMy = e.clientY - _svgRect.top;

        const dir = e.deltaY < 0 ? 1 : -1;
        _wheelFactor *= 1 + dir * config.zoomStep;

        if (_wheelRAF !== null) {
            return;
        }
        _wheelRAF = requestAnimationFrame(() => {
            _wheelRAF = null;
            const newScale = scale * _wheelFactor;
            tx = _wheelMx - (_wheelMx - tx) * (newScale / scale);
            ty = _wheelMy - (_wheelMy - ty) * (newScale / scale);
            scale = newScale;
            _wheelFactor = 1;
            if (isLargeTree) {
                applySnapshotTransform();
            } else {
                update();
            }
        });
    },
    { passive: false }
);

if (currentState) {
    update();
} else {
    requestAnimationFrame(() => {
        let initBbox: DOMRect | SVGRect;
        if (config.focusNodeId) {
            const escaped =
                window.CSS && CSS.escape
                    ? CSS.escape(config.focusNodeId)
                    : config.focusNodeId;
            const focusEl = viewport.querySelector(
                '[data-pt-box-id="' + escaped + '"]'
            ) as SVGGraphicsElement | null;
            initBbox = focusEl
                ? focusEl.getBBox()
                : (viewport as unknown as SVGGraphicsElement).getBBox();
        } else {
            initBbox = (viewport as unknown as SVGGraphicsElement).getBBox();
        }
        tx =
            window.innerWidth / 2 -
            (initBbox.x + initBbox.width / 2) * scale;
        ty =
            window.innerHeight / 2 -
            (initBbox.y + initBbox.height / 2) * scale;
        update();
    });
}

// === FIND =================================================================
let findMatches: Element[] = [];
let findCurrent = -1;
let findCaseSensitive = false;
let findWholeWord = false;

let hlGroup: SVGGElement | null = null;
function getHlGroup(): SVGGElement {
    if (!hlGroup) {
        hlGroup = document.createElementNS(SVG_NS, 'g');
        hlGroup.setAttribute('pointer-events', 'none');
        viewport.appendChild(hlGroup);
    }
    return hlGroup;
}

function clearHighlights(): void {
    if (hlGroup) {
        hlGroup.innerHTML = '';
    }
}

function buildHighlightRect(elem: Element, isCurrent: boolean): SVGRectElement | null {
    const r = elem.getBoundingClientRect();
    if (!r.width && !r.height) {
        return null;
    }
    const pad = 2;
    const x = (r.left - _svgRect.left - tx) / scale - pad;
    const y = (r.top - _svgRect.top - ty) / scale - pad;
    const w = r.width / scale + pad * 2;
    const h = r.height / scale + pad * 2;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute(
        'fill',
        isCurrent ? 'rgba(255,200,0,0.45)' : 'rgba(255,200,0,0.18)'
    );
    rect.setAttribute('rx', '2');
    return rect;
}

function buildHighlights(): void {
    clearHighlights();
    if (!findMatches.length) {
        return;
    }
    const g = getHlGroup();
    findMatches.forEach((elem, i) => {
        const rect = buildHighlightRect(elem, i === findCurrent);
        if (rect) {
            g.appendChild(rect);
        }
    });
}

function updateCount(): void {
    if (!findMatches.length) {
        findCountEl.textContent = findInput.value.trim() ? 'No results' : '';
        findCountEl.style.color = findInput.value.trim() ? '#f88' : '#888';
    } else {
        findCountEl.textContent =
            findCurrent + 1 + ' / ' + findMatches.length;
        findCountEl.style.color = '#888';
    }
}

function panToMatch(index: number): void {
    const elem = findMatches[index];
    if (!elem) {
        return;
    }
    const r = elem.getBoundingClientRect();
    tx += _svgRect.width / 2 - (r.left + r.width / 2 - _svgRect.left);
    ty += _svgRect.height / 2 - (r.top + r.height / 2 - _svgRect.top);
    update();
}

function textMatches(text: string, query: string): boolean {
    if (findWholeWord) {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = findCaseSensitive ? '' : 'i';
        return new RegExp('\\b' + escaped + '\\b', flags).test(text);
    }
    if (findCaseSensitive) {
        return text.includes(query);
    }
    return text.toLowerCase().includes(query.toLowerCase());
}

function doSearch(query: string): void {
    findMatches = [];
    findCurrent = -1;
    clearHighlights();
    if (!query.trim()) {
        updateCount();
        return;
    }
    viewport
        .querySelectorAll('text:not([data-pt-section-label])')
        .forEach(t => {
            if (textMatches(t.textContent ?? '', query)) {
                findMatches.push(t);
            }
        });
    if (findMatches.length) {
        findCurrent = 0;
        panToMatch(0);
    }
    updateCount();
    buildHighlights();
}

function navigateFind(dir: number): void {
    if (!findMatches.length) {
        return;
    }
    findCurrent =
        (findCurrent + dir + findMatches.length) % findMatches.length;
    panToMatch(findCurrent);
    updateCount();
    buildHighlights();
}

function openFindBar(): void {
    if (lazyBoxes && !forceHydrateAll) {
        forceHydrateAll = true;
        updateLazyBodies();
    }
    findBar.style.display = 'flex';
    findInput.focus();
    findInput.select();
}

function closeFindBar(): void {
    findBar.style.display = 'none';
    clearHighlights();
    findMatches = [];
    findCurrent = -1;
    findCountEl.textContent = '';
    findInput.value = '';
    if (forceHydrateAll) {
        forceHydrateAll = false;
        scheduleHydrate();
    }
}

function toggleFindCase(): void {
    findCaseSensitive = !findCaseSensitive;
    findCaseBtn.classList.toggle('active', findCaseSensitive);
    doSearch(findInput.value);
}

function toggleFindWord(): void {
    findWholeWord = !findWholeWord;
    findWordBtn.classList.toggle('active', findWholeWord);
    doSearch(findInput.value);
}

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openFindBar();
        return;
    }
    if (findBar.style.display === 'none') {
        return;
    }
    if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        toggleFindCase();
    }
    if (e.altKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        toggleFindWord();
    }
    if (e.key === 'Escape') {
        closeFindBar();
    }
});

findInput.addEventListener('input', () => doSearch(findInput.value));
findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        e.preventDefault();
        navigateFind(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        closeFindBar();
    }
});

findCaseBtn.addEventListener('click', toggleFindCase);
findWordBtn.addEventListener('click', toggleFindWord);
findPrev.addEventListener('click', () => navigateFind(-1));
findNext.addEventListener('click', () => navigateFind(1));
findClose.addEventListener('click', () => closeFindBar());
