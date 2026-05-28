import type { ClassNode, BoxMeasures } from '../../types';
import { Theme } from '../../config';
import { Line } from '../components';
import {
    computeEdgeGeometry,
    type ComputedEdge,
    type RawConnection,
} from '../utils/edgeLayout';

const ARROW_W = 12;
const ARROW_H = 10;

export function hollowArrow(x: number, y: number, color: string): string {
    return `<polygon points="${x},${y} ${x - ARROW_W / 2},${y + ARROW_H} ${x + ARROW_W / 2},${y + ARROW_H}" fill="none" stroke="${color}" stroke-width="1.5"/>`;
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

// Interactive arrow: enlarged transparent hit area + visible polygon, wrapped
// in a group carrying the child/parent class IDs so the webview can detect
// drag-and-drop of the inheritance arrow.
function interactiveHollowArrow(
    x: number,
    y: number,
    color: string,
    childId: string,
    parentId: string,
    childName?: string,
    parentName?: string
): string {
    const pad = 6;
    const hitArea = `<polygon points="${x},${y - pad} ${x - ARROW_W / 2 - pad},${y + ARROW_H + pad} ${x + ARROW_W / 2 + pad},${y + ARROW_H + pad}" fill="transparent" stroke="none"/>`;
    const arrow = hollowArrow(x, y, color);
    const nameAttrs =
        childName && parentName
            ? ` data-pt-edge-child-name="${escapeAttr(childName)}" data-pt-edge-parent-name="${escapeAttr(parentName)}"`
            : '';
    return `<g data-pt-edge="1" data-pt-edge-child="${escapeAttr(childId)}" data-pt-edge-parent="${escapeAttr(parentId)}"${nameAttrs} style="cursor: grab">${hitArea}${arrow}</g>`;
}

function renderComputedEdge(
    e: ComputedEdge,
    palette: readonly string[],
    interactive: boolean
): string {
    const color = palette[e.colorIndex % palette.length];
    const arrow = interactive
        ? interactiveHollowArrow(
              e.arrow.x,
              e.arrow.y,
              color,
              e.childId,
              e.parentId,
              e.childName,
              e.parentName
          )
        : hollowArrow(e.arrow.x, e.arrow.y, color);
    const lines = e.segments
        .map(s => Line({ x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: color }))
        .join('');
    return arrow + lines;
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
        .map(e => renderComputedEdge(e, Theme.colors.edgePalette, true))
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
