import type { ClassNode, BoxMeasures } from '../../../types';
import { UI } from '../../../config';
import { Svg, Group, HtmlRoot } from '../../components';
import type { FilterInfo } from '../../components/WebViewOptions';
import {
    renderClassBox,
    measureClassBox,
    collectInheritedNames,
} from '../classBox';
import { renderBaseStyles, renderViewportScript } from '../../webview/viewport';
import { renderLayeredEdges } from '../edges';
import { orderByParentBarycenter } from '../../utils/barycenter';

const COMPONENT_GAP = 400;

/* =========================================================
   COMPONENT LAYOUT
========================================================= */

function computeComponentWidth(
    layers: ClassNode[][],
    horizontalGap: number
): number {
    return Math.max(
        ...layers.map(layer => {
            const sizes = layer.map(node => measureClassBox(node));
            return (
                sizes.reduce((sum, s) => sum + s.width, 0) +
                Math.max(0, layer.length - 1) * horizontalGap
            );
        })
    );
}

function computeComponentHeight(
    layers: ClassNode[][],
    verticalGap: number
): number {
    const layerHeights = layers.map(layer =>
        Math.max(...layer.map(node => measureClassBox(node).height))
    );
    return (
        layerHeights.reduce((sum, h) => sum + h, 0) +
        Math.max(0, layers.length - 1) * verticalGap
    );
}

function positionLayerAt(
    layer: ClassNode[],
    topY: number,
    centerX: number,
    allNodes: Map<string, ClassNode>,
    horizontalGap: number,
    lazy: boolean,
    lazyBodies: Array<[string, string]>
): { svgs: string[]; positions: BoxMeasures[] } {
    const inherited = layer.map(node => collectInheritedNames(node, allNodes));
    const sizes = layer.map(node => measureClassBox(node));
    const totalWidth =
        sizes.reduce((sum, s) => sum + s.width, 0) +
        Math.max(0, layer.length - 1) * horizontalGap;
    let xCursor = centerX - totalWidth / 2;

    const svgs: string[] = [];
    const positions: BoxMeasures[] = [];

    layer.forEach((node, i) => {
        const x = xCursor + sizes[i].width / 2;
        const rendered = renderClassBox(node, x, topY, inherited[i], { lazy });
        svgs.push(rendered.svg);
        if (rendered.lazyBody) {
            lazyBodies.push([rendered.lazyBody.boxId, rendered.lazyBody.html]);
        }
        positions.push({
            x,
            y: topY,
            width: sizes[i].width,
            height: sizes[i].height,
        });
        xCursor += sizes[i].width + horizontalGap;
    });

    return { svgs, positions };
}

// Returns grid positions sorted by Euclidean distance to the grid centre so
// that component[0] (the largest) lands on the most central cell.
function centerFirstGridPositions(
    n: number,
    rows: number,
    cols: number
): Array<{ row: number; col: number }> {
    const centerRow = (rows - 1) / 2;
    const centerCol = (cols - 1) / 2;

    const positions: Array<{ row: number; col: number; dist: number }> = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (r * cols + c < n) {
                positions.push({
                    row: r,
                    col: c,
                    dist: Math.hypot(r - centerRow, c - centerCol),
                });
            }
        }
    }

    positions.sort((a, b) => {
        const dd = a.dist - b.dist;
        if (Math.abs(dd) > 1e-9) {
            return dd;
        }
        return a.row !== b.row ? a.row - b.row : a.col - b.col;
    });

    return positions.map(({ row, col }) => ({ row, col }));
}

/* =========================================================
   FOREST RENDERING
========================================================= */

export function renderProjectTree(
    componentLayers: ClassNode[][][],
    allNodes: Map<string, ClassNode>,
    filterInfo?: FilterInfo
): string {
    const { verticalGap, horizontalGap } = UI.tree;

    const N = componentLayers.length;
    const cols = Math.max(1, Math.ceil(Math.sqrt(N)));
    const rows = Math.ceil(N / cols);

    const widths = componentLayers.map(layers =>
        computeComponentWidth(layers, horizontalGap)
    );
    const heights = componentLayers.map(layers =>
        computeComponentHeight(layers, verticalGap)
    );

    // Assign components to grid cells: biggest (index 0) → most central cell.
    const gridPos = centerFirstGridPositions(N, rows, cols);

    const colWidths = new Array<number>(cols).fill(0);
    const rowHeights = new Array<number>(rows).fill(0);
    for (let ci = 0; ci < N; ci++) {
        const { row, col } = gridPos[ci];
        colWidths[col] = Math.max(colWidths[col], widths[ci]);
        rowHeights[row] = Math.max(rowHeights[row], heights[ci]);
    }

    const colXs = colWidths.reduce<number[]>(
        (acc, _, i) => [
            ...acc,
            i === 0 ? 0 : acc[i - 1] + colWidths[i - 1] + COMPONENT_GAP,
        ],
        []
    );
    const rowYs = rowHeights.reduce<number[]>(
        (acc, _, i) => [
            ...acc,
            i === 0 ? 0 : acc[i - 1] + rowHeights[i - 1] + COMPONENT_GAP,
        ],
        []
    );

    const lazy = allNodes.size > UI.lazy.renderThreshold;
    const lazyBodies: Array<[string, string]> = [];

    let boxesSvg = '';
    let edgesSvg = '';

    for (let ci = 0; ci < componentLayers.length; ci++) {
        const rawLayers = componentLayers[ci];
        const { row, col } = gridPos[ci];
        const centerX = colXs[col] + colWidths[col] / 2;

        const layers: ClassNode[][] = [];
        const layerBoxes: BoxMeasures[][] = [];
        let currentY = rowYs[row];
        let parentPositions = new Map<string, number>();

        for (const rawLayer of rawLayers) {
            const ordered =
                parentPositions.size > 0
                    ? orderByParentBarycenter(rawLayer, parentPositions)
                    : [...rawLayer];
            layers.push(ordered);
            const { svgs, positions } = positionLayerAt(
                ordered,
                currentY,
                centerX,
                allNodes,
                horizontalGap,
                lazy,
                lazyBodies
            );
            boxesSvg += svgs.join('');
            layerBoxes.push(positions);
            currentY += Math.max(...positions.map(p => p.height)) + verticalGap;
            parentPositions = new Map(
                ordered.map((node, i) => [node.id, positions[i].x])
            );
        }

        edgesSvg += renderLayeredEdges(layers, layerBoxes);
    }

    return HtmlRoot(
        Svg({
            width: '100%',
            height: '100vh',
            className: lazy ? 'lazy-tree' : undefined,
            children:
                renderBaseStyles() +
                Group({
                    id: 'viewport',
                    transform: 'translate(0,0) scale(1)',
                    children: edgesSvg + boxesSvg,
                }),
        }) +
            renderViewportScript({
                initialScale: 0.5,
                filterInfo,
                lazyBodies: lazy ? lazyBodies : undefined,
            })
    );
}
