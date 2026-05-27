import { Theme, UI } from '../../config';
import { FindBar, WebViewOptions } from '../components';
import type { FilterInfo } from '../components/WebViewOptions';

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

export function renderViewportScript(
    opts: {
        initialScale?: number;
        focusNodeId?: string;
        filterInfo?: FilterInfo;
        // When provided, the script wires up viewport-driven body hydration:
        // each box's heavy content is parked in this map and only injected
        // into its `<g data-pt-lazy-body>` slot when the box (or a generous
        // margin around it) intersects the visible viewport.
        lazyBodies?: Array<[string, string]>;
    } = {}
): string {
    const initialScale = opts.initialScale ?? 1;
    const initialBboxScript = opts.focusNodeId
        ? `const _focusEl = viewport.querySelector('[data-pt-box-id="' + (window.CSS && CSS.escape ? CSS.escape(${JSON.stringify(opts.focusNodeId)}) : ${JSON.stringify(opts.focusNodeId)}) + '"]');
      const _initBbox = _focusEl ? _focusEl.getBBox() : viewport.getBBox();`
        : `const _initBbox = viewport.getBBox();`;

    // Escape `</` so a body containing literal "</script>" (e.g. a default
    // value with a fragment) can't terminate the script tag early.
    const lazyDataTag = opts.lazyBodies
        ? `<script type="application/json" id="pt-lazy-bodies">${JSON.stringify(
              opts.lazyBodies
          ).replace(/<\//g, '<\\/')}</script>`
        : '';

    return `
${lazyDataTag}
<style>
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
  [data-pt-edge]:hover polygon[fill="none"] {
    transform-box: fill-box;
    transform-origin: top center;
    transform: scale(1.5);
  }
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
</style>
${WebViewOptions(opts.filterInfo)}
${FindBar()}
<div id="edge-tooltip"></div>
<div id="nav-tooltip">Go to definition</div>
<script>
  const svg = document.getElementById("svgRoot");
  const viewport = document.getElementById("viewport");

  let isPanning = false;
  let pointerDownTarget = null;
  let pointerMoved = false;
  let lastX = 0;
  let lastY = 0;

  const vscode = acquireVsCodeApi();

  const PAN_SENSITIVITY = ${UI.pan.sensitivity};
  const ZOOM_STEP = ${UI.zoom.step};
  const CLICK_THRESHOLD = 4;
  // Above this many class boxes, switch zoom from direct <g> repaint to
  // snapshot mode (CSS transform on a wrapper div, commit on wheel idle).
  // Small trees stay on the original path — no blur, no commit "snap".
  const LARGE_TREE_THRESHOLD = 50;
  const isLargeTree = document.getElementById('viewport').querySelectorAll('[data-pt-box]').length >= LARGE_TREE_THRESHOLD;

  const currentState = vscode.getState();
  let tx = currentState ? currentState.tx : 0;
  let ty = currentState ? currentState.ty : 0;
  let scale = currentState ? currentState.scale : ${initialScale};
  let showPaths = currentState ? (currentState.showPaths ?? false) : false;

  const showPathsCb = document.getElementById('show-paths-cb');
  showPathsCb.checked = showPaths;
  if (showPaths) svg.classList.add('show-paths');

  // === LAZY BODY HYDRATION ===
  // For trees above UI.lazy.renderThreshold, each box ships with an empty
  // <g data-pt-lazy-body="..."> slot. The body SVG sits parked in a JSON
  // payload until the box's bounding box (plus a margin) intersects the
  // viewport, at which point we inject it. Boxes that drift far enough away
  // get torn back down so the DOM stays bounded regardless of tree size.
  const lazyDataEl = document.getElementById('pt-lazy-bodies');
  const lazyBodies = lazyDataEl
    ? new Map(JSON.parse(lazyDataEl.textContent))
    : null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Hydrate slightly outside the viewport so panning reveals already-loaded
  // content. Dehydrate at a much larger radius so fast pan reversals don't
  // immediately repay the parse cost.
  const HYDRATE_MARGIN_PX = 400;
  const DEHYDRATE_MARGIN_PX = 1600;

  let lazyBoxes = null;
  function collectLazyBoxes() {
    if (!lazyBodies) return;
    lazyBoxes = [];
    viewport.querySelectorAll('[data-pt-box]').forEach(el => {
      const slot = el.querySelector('[data-pt-lazy-body]');
      if (!slot) return;
      lazyBoxes.push({
        slot,
        x: parseFloat(el.dataset.ptX),
        y: parseFloat(el.dataset.ptY),
        w: parseFloat(el.dataset.ptW),
        h: parseFloat(el.dataset.ptH),
        hydrated: false,
      });
    });
  }
  collectLazyBoxes();

  function hydrateBox(box) {
    if (box.hydrated) return;
    const id = box.slot.dataset.ptLazyBody;
    const html = lazyBodies.get(id);
    if (!html) return;
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

  function dehydrateBox(box) {
    if (!box.hydrated) return;
    while (box.slot.firstChild) {
      box.slot.removeChild(box.slot.firstChild);
    }
    box.hydrated = false;
  }

  let forceHydrateAll = false;
  function updateLazyBodies() {
    if (!lazyBoxes) return;
    if (forceHydrateAll) {
      for (const box of lazyBoxes) hydrateBox(box);
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
      if (!box.hydrated) continue;
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

  let _hydrateRAF = null;
  function scheduleHydrate() {
    if (!lazyBoxes) return;
    if (_hydrateRAF !== null) return;
    _hydrateRAF = requestAnimationFrame(() => {
      _hydrateRAF = null;
      updateLazyBodies();
    });
  }

  // === EXPORT DROPDOWN ===
  const exportBtnEl  = document.getElementById('export-btn');
  const exportMenuEl = document.getElementById('export-menu');

  exportBtnEl.addEventListener('click', e => {
    e.stopPropagation();
    exportMenuEl.classList.toggle('open');
  });
  exportMenuEl.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', () => exportMenuEl.classList.remove('open'));

  function buildExportClone() {
    const svgEl = document.getElementById('svgRoot');
    const vpEl  = document.getElementById('viewport');
    const bbox  = vpEl.getBBox();
    const pad   = 40;
    const vbX   = Math.floor(bbox.x - pad);
    const vbY   = Math.floor(bbox.y - pad);
    const vbW   = Math.ceil(bbox.width  + pad * 2);
    const vbH   = Math.ceil(bbox.height + pad * 2);
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('viewBox', vbX + ' ' + vbY + ' ' + vbW + ' ' + vbH);
    clone.setAttribute('width',  vbW);
    clone.setAttribute('height', vbH);
    const vpClone = clone.querySelector('#viewport');
    if (vpClone) { vpClone.setAttribute('transform', 'translate(0,0) scale(1)'); }

    // Resolve VSCode editor font and bake it into the clone so the exported
    // file uses the same font outside the webview (where --vscode-* vars are
    // undefined and would fall back to the browser default).
    // Must be appended LAST so it wins the cascade over the inline style from
    // renderBaseStyles() that references var(--vscode-editor-font-family),
    // and uses !important so any user-agent rule cannot override it.
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.fontFamily = 'var(--vscode-editor-font-family)';
    document.body.appendChild(probe);
    const resolvedFont = getComputedStyle(probe).fontFamily;
    probe.remove();
    const fontStyleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    fontStyleEl.textContent =
      'svg text, text { font-family: ' + resolvedFont + ' !important; }';
    clone.appendChild(fontStyleEl);

    return { clone, vbW, vbH };
  }

  document.getElementById('export-as-html').addEventListener('click', () => {
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

  document.getElementById('export-as-svg').addEventListener('click', () => {
    exportMenuEl.classList.remove('open');
    const { clone } = buildExportClone();

    // Resolve CSS custom properties to concrete color values so the SVG renders
    // correctly as a standalone file (no webview stylesheet in scope).
    const varNames = [
      '--pt-bg', '--pt-panel-bg', '--pt-border', '--pt-text',
      '--pt-header-bg', '--pt-abstract-header-bg', '--pt-header-text',
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
    const resolvedVars = varNames.map(v => {
      tmp.style.color = 'var(' + v + ')';
      return v + ': ' + getComputedStyle(tmp).color + ';';
    }).join(' ');
    tmp.remove();

    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
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
    vscode.setState({ tx, ty, scale, showPaths });
  });

  // === SNAPSHOT ZOOM (large trees only) ===
  // For big trees, repainting the SVG <g> on every wheel event is too slow.
  // We instead apply a CSS transform to a wrapper <div> (GPU-tiled, cheap)
  // during active zoom, and "commit" to the <g> when the wheel goes idle.
  // Small trees skip this — direct <g> repaint is fast enough and avoids the
  // bitmap blur of snapshot scaling.
  let wrapper = null;
  if (isLargeTree) {
    wrapper = document.createElement('div');
    wrapper.id = 'zoom-wrapper';
    wrapper.style.position = 'fixed';
    wrapper.style.inset = '0';
    wrapper.style.overflow = 'hidden';
    wrapper.style.transformOrigin = '0 0';
    wrapper.style.willChange = 'transform';
    svg.parentNode.insertBefore(wrapper, svg);
    wrapper.appendChild(svg);
  }

  let _committedTx = tx;
  let _committedTy = ty;
  let _committedScale = scale;
  let _zoomActive = false;
  let _zoomEndTimer = null;

  function applySnapshotTransform() {
    const ds = scale / _committedScale;
    const dtx = tx - ds * _committedTx;
    const dty = ty - ds * _committedTy;
    wrapper.style.transform = 'translate(' + dtx + 'px,' + dty + 'px) scale(' + ds + ')';
  }

  function update() {
    if (_zoomActive) {
      _zoomActive = false;
      svg.classList.remove('zooming');
      if (_zoomEndTimer) { clearTimeout(_zoomEndTimer); _zoomEndTimer = null; }
      wrapper.style.transform = '';
    }
    viewport.setAttribute(
      "transform",
      "translate(" + tx + "," + ty + ") scale(" + scale + ")"
    );
    _committedTx = tx;
    _committedTy = ty;
    _committedScale = scale;
    vscode.setState({ tx, ty, scale, showPaths });
    scheduleHydrate();
  }

  // When wrapped, the SVG's rect is post-CSS-transform, so we hardcode the
  // wrapper's natural rect (viewport). Otherwise, fall back to the SVG's own.
  let _svgRect = isLargeTree
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : svg.getBoundingClientRect();
  window.addEventListener('resize', () => {
    if (isLargeTree) {
      _svgRect.width = window.innerWidth;
      _svgRect.height = window.innerHeight;
    } else {
      _svgRect = svg.getBoundingClientRect();
    }
    scheduleHydrate();
  });

  svg.style.cursor = "grab";
  svg.style.userSelect = "none";

  // === EDGE DRAG ===
  // When the user starts a pointerdown on an inheritance arrow, we capture
  // the drag and prevent the canvas pan from kicking in. While dragging,
  // a "ghost" line follows the cursor from the original child class box.
  // On pointerup, if released over a class box, we ask the extension to
  // change the inheritance in the source code.
  let edgeDrag = null;

  // === TOOLTIPS (edge + navigation) ===
  const edgeTooltip = document.getElementById('edge-tooltip');
  const navTooltip = document.getElementById('nav-tooltip');
  let tooltipEdgeEl = null;

  function hideAllTooltips() {
    edgeTooltip.style.display = 'none';
    navTooltip.style.display = 'none';
    tooltipEdgeEl = null;
  }

  svg.addEventListener('mousemove', e => {
    const edgeEl = e.target.closest && e.target.closest('[data-pt-edge]');
    if (edgeEl) {
      if (edgeEl !== tooltipEdgeEl) {
        const childName = edgeEl.dataset.ptEdgeChildName || edgeEl.dataset.ptEdgeChild || '?';
        const parentName = edgeEl.dataset.ptEdgeParentName || edgeEl.dataset.ptEdgeParent || '?';
        edgeTooltip.textContent = childName + ' → ' + parentName;
        tooltipEdgeEl = edgeEl;
      }
      edgeTooltip.style.display = 'block';
      edgeTooltip.style.left = (e.clientX + 14) + 'px';
      edgeTooltip.style.top = (e.clientY - 32) + 'px';
      navTooltip.style.display = 'none';
      return;
    }
    edgeTooltip.style.display = 'none';
    tooltipEdgeEl = null;

    const navEl = e.target.closest && e.target.closest('[data-line]');
    if (navEl) {
      navTooltip.style.display = 'block';
      navTooltip.style.left = (e.clientX + 14) + 'px';
      navTooltip.style.top = (e.clientY - 32) + 'px';
    } else {
      navTooltip.style.display = 'none';
    }
  });

  svg.addEventListener('mouseleave', hideAllTooltips);

  function clientToSvg(clientX, clientY) {
    return {
      x: (clientX - _svgRect.left - tx) / scale,
      y: (clientY - _svgRect.top - ty) / scale,
    };
  }

  function getBoxCenter(boxEl) {
    const r = boxEl.getBoundingClientRect();
    return clientToSvg(r.left + r.width / 2, r.top + r.height / 2);
  }

  function startEdgeDrag(edgeEl, e) {
    const childId = edgeEl.dataset.ptEdgeChild;
    const parentId = edgeEl.dataset.ptEdgeParent;
    if (!childId || !parentId) return;

    // Pick up the visible arrow's stroke color so the ghost line matches
    // the edge being dragged. The hit area polygon has stroke="none", so
    // we look for the first polygon with a real stroke.
    let edgeColor = '#888';
    const polygons = edgeEl.querySelectorAll('polygon');
    for (const p of polygons) {
      const s = p.getAttribute('stroke');
      if (s && s !== 'none') { edgeColor = s; break; }
    }

    // Resolve the child box's center as the drag origin.
    const childBox = viewport.querySelector(
      '[data-pt-box-id="' + (window.CSS && CSS.escape ? CSS.escape(childId) : childId) + '"]'
    );
    const origin = childBox ? getBoxCenter(childBox) : clientToSvg(e.clientX, e.clientY);

    // Build the ghost line element once.
    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ghost.setAttribute('stroke', edgeColor);
    ghost.setAttribute('stroke-opacity', '0.55');
    ghost.setAttribute('stroke-width', '2');
    ghost.setAttribute('stroke-dasharray', '6 4');
    ghost.setAttribute('pointer-events', 'none');
    ghost.setAttribute('x1', origin.x);
    ghost.setAttribute('y1', origin.y);
    ghost.setAttribute('x2', origin.x);
    ghost.setAttribute('y2', origin.y);
    viewport.appendChild(ghost);

    edgeDrag = { edgeEl, childId, parentId, origin, ghost, hoverBoxEl: null };
    hideAllTooltips();
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  }

  function updateEdgeDrag(e) {
    if (!edgeDrag) return;
    const p = clientToSvg(e.clientX, e.clientY);
    edgeDrag.ghost.setAttribute('x2', p.x);
    edgeDrag.ghost.setAttribute('y2', p.y);

    // Highlight the box currently under the cursor (if any).
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const boxEl = under ? under.closest('[data-pt-box-id]') : null;
    if (boxEl !== edgeDrag.hoverBoxEl) {
      if (edgeDrag.hoverBoxEl) edgeDrag.hoverBoxEl.style.filter = '';
      if (boxEl) boxEl.style.filter = 'brightness(1.25)';
      edgeDrag.hoverBoxEl = boxEl;
    }
  }

  function endEdgeDrag(e) {
    if (!edgeDrag) return false;
    const { childId, parentId, ghost, hoverBoxEl } = edgeDrag;
    if (hoverBoxEl) hoverBoxEl.style.filter = '';
    ghost.remove();

    // Determine the drop target box.
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const boxEl = under ? under.closest('[data-pt-box-id]') : null;
    const newParentId = boxEl ? boxEl.dataset.ptBoxId : null;

    edgeDrag = null;
    svg.style.cursor = 'grab';
    try { svg.releasePointerCapture(e.pointerId); } catch {}

    if (newParentId && newParentId !== parentId) {
      vscode.postMessage({
        command: 'changeInheritance',
        childId: childId,
        oldParentId: parentId,
        newParentId: newParentId,
      });
    }
    return true;
  }

  svg.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const edgeEl = e.target.closest && e.target.closest('[data-pt-edge]');
    if (edgeEl) {
      e.stopPropagation();
      startEdgeDrag(edgeEl, e);
      return;
    }
    isPanning = true;
    pointerDownTarget = e.target;
    pointerMoved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });

  svg.addEventListener("pointermove", e => {
    if (edgeDrag) {
      updateEdgeDrag(e);
      return;
    }
    if (!isPanning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) pointerMoved = true;
    tx += dx * PAN_SENSITIVITY;
    ty += dy * PAN_SENSITIVITY;
    lastX = e.clientX;
    lastY = e.clientY;
    update();
  });

  function endPan(e) {
    if (endEdgeDrag(e)) return;
    if (!pointerMoved && pointerDownTarget) {
      const navTarget = pointerDownTarget.closest("[data-line]");
      if (navTarget) {
        vscode.postMessage({
          command: "navigate",
          fileUri: navTarget.dataset.file,
          line: parseInt(navTarget.dataset.line, 10),
        });
      }
    }
    isPanning = false;
    pointerMoved = false;
    pointerDownTarget = null;
    svg.style.cursor = "grab";
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  }

  svg.addEventListener("pointerup", endPan);
  svg.addEventListener("pointercancel", endPan);

  let _wheelRAF = null;
  let _wheelFactor = 1;
  let _wheelMx = 0;
  let _wheelMy = 0;

  svg.addEventListener("wheel", e => {
    e.preventDefault();

    if (isLargeTree) {
      if (!_zoomActive) {
        _zoomActive = true;
        svg.classList.add('zooming');
      }
      if (_zoomEndTimer) clearTimeout(_zoomEndTimer);
      _zoomEndTimer = setTimeout(update, 150);
    }

    _wheelMx = e.clientX - _svgRect.left;
    _wheelMy = e.clientY - _svgRect.top;

    const dir = e.deltaY < 0 ? 1 : -1;
    _wheelFactor *= (1 + dir * ZOOM_STEP);

    if (_wheelRAF !== null) return;
    _wheelRAF = requestAnimationFrame(() => {
      _wheelRAF = null;
      const newScale = scale * _wheelFactor;
      tx = _wheelMx - (_wheelMx - tx) * (newScale / scale);
      ty = _wheelMy - (_wheelMy - ty) * (newScale / scale);
      scale = newScale;
      _wheelFactor = 1;
      if (isLargeTree) applySnapshotTransform();
      else update();
    });
  }, { passive: false });

  if (currentState) {
    update();
  } else {
    requestAnimationFrame(() => {
      ${initialBboxScript}
      tx = window.innerWidth  / 2 - (_initBbox.x + _initBbox.width  / 2) * scale;
      ty = window.innerHeight / 2 - (_initBbox.y + _initBbox.height / 2) * scale;
      update();
    });
  }

  // === FIND ===

  let findMatches = [];
  let findCurrent = -1;
  let findCaseSensitive = false;
  let findWholeWord = false;

  const findBar     = document.getElementById('find-bar');
  const findInput   = document.getElementById('find-input');
  const findCountEl = document.getElementById('find-count');
  const findPrev    = document.getElementById('find-prev');
  const findNext    = document.getElementById('find-next');
  const findClose   = document.getElementById('find-close');
  const findCaseBtn = document.getElementById('find-case');
  const findWordBtn = document.getElementById('find-word');

  let hlGroup = null;

  function getHlGroup() {
    if (!hlGroup) {
      hlGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      hlGroup.setAttribute('pointer-events', 'none');
      viewport.appendChild(hlGroup);
    }
    return hlGroup;
  }

  function clearHighlights() {
    if (hlGroup) hlGroup.innerHTML = '';
  }

  function buildHighlightRect(elem, isCurrent) {
    const r = elem.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const pad = 2;
    const x = (r.left - _svgRect.left - tx) / scale - pad;
    const y = (r.top  - _svgRect.top  - ty) / scale - pad;
    const w = r.width  / scale + pad * 2;
    const h = r.height / scale + pad * 2;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('fill', isCurrent ? 'rgba(255,200,0,0.45)' : 'rgba(255,200,0,0.18)');
    rect.setAttribute('rx', '2');
    return rect;
  }

  function buildHighlights() {
    clearHighlights();
    if (!findMatches.length) return;
    const g = getHlGroup();
    findMatches.forEach((elem, i) => {
      const rect = buildHighlightRect(elem, i === findCurrent);
      if (rect) g.appendChild(rect);
    });
  }

  function updateCount() {
    if (!findMatches.length) {
      findCountEl.textContent = findInput.value.trim() ? 'No results' : '';
      findCountEl.style.color = findInput.value.trim() ? '#f88' : '#888';
    } else {
      findCountEl.textContent = (findCurrent + 1) + ' / ' + findMatches.length;
      findCountEl.style.color = '#888';
    }
  }

  function panToMatch(index) {
    const elem = findMatches[index];
    if (!elem) return;
    const r = elem.getBoundingClientRect();
    tx += _svgRect.width  / 2 - (r.left + r.width  / 2 - _svgRect.left);
    ty += _svgRect.height / 2 - (r.top  + r.height / 2 - _svgRect.top);
    update();
  }

  function textMatches(text, query) {
    if (findWholeWord) {
      const escaped = query.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      const flags = findCaseSensitive ? '' : 'i';
      return new RegExp('\\\\b' + escaped + '\\\\b', flags).test(text);
    }
    if (findCaseSensitive) {
      return text.includes(query);
    }
    return text.toLowerCase().includes(query.toLowerCase());
  }

  function doSearch(query) {
    findMatches = [];
    findCurrent = -1;
    clearHighlights();
    if (!query.trim()) { updateCount(); return; }
    viewport.querySelectorAll('text:not([data-pt-section-label])').forEach(t => {
      if (textMatches(t.textContent, query)) findMatches.push(t);
    });
    if (findMatches.length) {
      findCurrent = 0;
      panToMatch(0);
    }
    updateCount();
    buildHighlights();
  }

  function navigate(dir) {
    if (!findMatches.length) return;
    findCurrent = (findCurrent + dir + findMatches.length) % findMatches.length;
    panToMatch(findCurrent);
    updateCount();
    buildHighlights();
  }

  function openFindBar() {
    // Find searches the live DOM, so when lazy mode is on we have to bring
    // every body in before the user can match anything off-viewport. The
    // cost is paid once on open; subsequent searches reuse the hydrated DOM.
    if (lazyBoxes && !forceHydrateAll) {
      forceHydrateAll = true;
      updateLazyBodies();
    }
    findBar.style.display = 'flex';
    findInput.focus();
    findInput.select();
  }

  function closeFindBar() {
    findBar.style.display = 'none';
    clearHighlights();
    findMatches = [];
    findCurrent = -1;
    findCountEl.textContent = '';
    findInput.value = '';
    // Drop the "hydrate everything" flag and let the next scheduled pass
    // tear down boxes that have drifted far from the current viewport.
    if (forceHydrateAll) {
      forceHydrateAll = false;
      scheduleHydrate();
    }
  }

  function toggleFindCase() {
    findCaseSensitive = !findCaseSensitive;
    findCaseBtn.classList.toggle('active', findCaseSensitive);
    doSearch(findInput.value);
  }

  function toggleFindWord() {
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
    if (findBar.style.display === 'none') return;
    if (e.altKey && e.key.toLowerCase() === 'c') { e.preventDefault(); toggleFindCase(); }
    if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); toggleFindWord(); }
    if (e.key === 'Escape') { closeFindBar(); }
  });

  findInput.addEventListener('input', () => doSearch(findInput.value));
  findInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); navigate(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeFindBar(); }
  });

  findCaseBtn.addEventListener('click', toggleFindCase);
  findWordBtn.addEventListener('click', toggleFindWord);
  findPrev.addEventListener('click',  () => navigate(-1));
  findNext.addEventListener('click',  () => navigate(1));
  findClose.addEventListener('click', () => closeFindBar());
</script>
`;
}
