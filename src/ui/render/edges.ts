import type { ClassNode, BoxMeasures } from '../../types';
import { Theme, UI } from '../../config';
import { Line } from '../components';
import {
    computeEdgeGeometry,
    type ComputedEdge,
    type RawConnection,
} from '../utils/edgeLayout';

const ARROW_W = 12;
const ARROW_H = 10;
const BODY_HIT_W = 14;
const BODY_VIS_W = 1;

export function hollowArrow(
    x: number,
    y: number,
    color: string,
    className?: string
): string {
    const cls = className ? ` class="${className}"` : '';
    return `<polygon${cls} points="${x},${y} ${x - ARROW_W / 2},${y + ARROW_H} ${x + ARROW_W / 2},${y + ARROW_H}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

// Interactive edge: wraps the whole inheritance arrow (the triangular tip plus
// the polyline body) in a single group carrying the child/parent identifiers
// so the webview can drive:
//   - tooltip on hover (anywhere on the edge)
//   - drag-and-drop on the tip → change inheritance
//   - click on the tip without drag → focus the subclass
//   - click anywhere on the body → focus the superclass
// Each visible primitive is shadowed by a wider, transparent twin that owns the
// hit area, so a thin 1px line still has a comfortable click target.
//
// `parentBottomCollapsed` is the Y the parent's bottom edge would be at if it
// were collapsed (see classBox.ts). Segment 0 (and the arrow/tip) always sit
// at the parent's attach point by construction — see buildAdjacentSegments /
// buildHighwaySegments in edgeLayout.ts — so they're the only pieces tagged
// for the client to re-anchor when that specific parent's collapse state
// toggles; everything downstream of them (the bus/highway routing) is
// computed from *other* boxes' positions and is unaffected.
function interactiveEdge(
    e: ComputedEdge,
    color: string,
    parentBottomCollapsed: number
): string {
    const { arrow, segments, childId, parentId, childName, parentName } = e;

    const tipPad = 6;
    const tipHit = `<polygon class="pt-edge-tip-hit" points="${arrow.x},${arrow.y - tipPad} ${arrow.x - ARROW_W / 2 - tipPad},${arrow.y + ARROW_H + tipPad} ${arrow.x + ARROW_W / 2 + tipPad},${arrow.y + ARROW_H + tipPad}" fill="transparent" stroke="none"/>`;
    const tipVis = hollowArrow(arrow.x, arrow.y, color, 'pt-edge-arrow');
    const tipGroup = `<g data-pt-edge-role="tip" style="cursor: pointer">${tipHit}${tipVis}</g>`;

    const bodySegments = segments
        .map((s, i) => {
            const segCls = i === 0 ? ' pt-edge-seg0' : '';
            return (
                `<line class="pt-edge-hit${segCls}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="transparent" stroke-width="${BODY_HIT_W}" pointer-events="stroke"/>` +
                `<line class="pt-edge-body-vis${segCls}" x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${color}" stroke-width="${BODY_VIS_W}" pointer-events="none"/>`
            );
        })
        .join('');
    const bodyGroup = `<g data-pt-edge-role="body" style="cursor: pointer">${bodySegments}</g>`;

    const nameAttrs =
        childName && parentName
            ? ` data-pt-edge-child-name="${escapeAttr(childName)}" data-pt-edge-parent-name="${escapeAttr(parentName)}"`
            : '';
    return (
        `<g data-pt-edge="1" data-pt-edge-child="${escapeAttr(childId)}" data-pt-edge-parent="${escapeAttr(parentId)}"` +
        ` data-pt-parent-x="${arrow.x}" data-pt-parent-bottom-expanded="${arrow.y}" data-pt-parent-bottom-collapsed="${parentBottomCollapsed}"` +
        `${nameAttrs}>${tipGroup}${bodyGroup}</g>`
    );
}

function renderComputedEdge(
    e: ComputedEdge,
    palette: readonly string[],
    interactive: boolean,
    parentBottomCollapsed: number
): string {
    const color = palette[e.colorIndex % palette.length];
    if (!interactive) {
        const arrow = hollowArrow(e.arrow.x, e.arrow.y, color);
        const lines = e.segments
            .map(s =>
                Line({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: color })
            )
            .join('');
        return arrow + lines;
    }
    return interactiveEdge(e, color, parentBottomCollapsed);
}

/* =========================================================
   LAYERED EDGES — unified renderer for any layered DAG.
   Builds raw connections from layers + layerBoxes, hands them to the shared
   geometry module, then converts the result to SVG strings. The actual layout
   (lanes, attach spread, color choice, side highways) lives in edgeLayout.ts
   so the interactive create-board webview can reuse the same algorithm.
========================================================= */
export function renderLayeredEdges(
    layers: ClassNode[][],
    layerBoxes: BoxMeasures[][]
): string {
    if (layers.length < 2) {
        return '';
    }

    const connections: RawConnection[] = [];
    // Parallel to `connections`: the Y each connection's parent bottom would
    // be at if that parent were collapsed. Kept alongside rather than on
    // RawConnection itself since computeEdgeGeometry doesn't need it — it's
    // purely client-side metadata for patching the edge after the fact.
    const parentBottomsCollapsed: number[] = [];
    for (let i = 0; i < layers.length; i++) {
        for (let j = i + 1; j < layers.length; j++) {
            layers[i].forEach((parent, pi) => {
                layers[j].forEach((child, ci) => {
                    if (!(child.bases ?? []).some(b => b.id === parent.id)) {
                        return;
                    }
                    const pBox = layerBoxes[i][pi];
                    const cBox = layerBoxes[j][ci];
                    connections.push({
                        parentX: pBox.x,
                        parentBottom: pBox.y + pBox.height,
                        childX: cBox.x,
                        childTop: cBox.y,
                        parentLayer: i,
                        childLayer: j,
                        parentId: parent.id,
                        childId: child.id,
                        parentName: parent.name,
                        childName: child.name,
                    });
                    parentBottomsCollapsed.push(
                        pBox.y +
                            Math.min(UI.box.collapsedHeaderHeight, pBox.height)
                    );
                });
            });
        }
    }
    if (connections.length === 0) {
        return '';
    }

    const allBoxes = layerBoxes.flat();
    const bounds = {
        right: Math.max(...allBoxes.map(b => b.x + b.width / 2)),
        left: Math.min(...allBoxes.map(b => b.x - b.width / 2)),
    };
    const computed = computeEdgeGeometry(connections, bounds);
    return computed
        .map((e, i) =>
            renderComputedEdge(
                e,
                Theme.colors.edgePalette,
                true,
                parentBottomsCollapsed[i]
            )
        )
        .join('');
}

/* =========================================================
   ANCESTOR / DESCENDANT EDGES
   Thin wrappers around renderLayeredEdges. They inject the focus class as a
   layer of size 1 so it participates in lane assignment and highway routing
   exactly like any other class.
========================================================= */
export function renderAncestorEdges(
    orderedLayers: ClassNode[][],
    layerBoxes: BoxMeasures[][],
    focus: ClassNode,
    focusBox: BoxMeasures
): string {
    // orderedLayers[0] = depth-1 ancestors (closest to focus, largest y).
    // Reverse so deepest ancestor (most negative y) comes first; focus is the
    // last layer (largest y).
    const layers = [...orderedLayers].reverse();
    layers.push([focus]);
    const boxes = [...layerBoxes].reverse();
    boxes.push([focusBox]);
    return renderLayeredEdges(layers, boxes);
}

export function renderDescendantEdges(
    orderedLayers: ClassNode[][],
    layerBoxes: BoxMeasures[][],
    focus: ClassNode,
    focusBox: BoxMeasures
): string {
    // orderedLayers[0] = depth-1 descendants. Focus is the first layer.
    const layers = [[focus], ...orderedLayers];
    const boxes = [[focusBox], ...layerBoxes];
    return renderLayeredEdges(layers, boxes);
}
