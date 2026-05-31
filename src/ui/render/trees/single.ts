import { UI } from '../../../config';
import { BoxMeasures, ClassNode } from '../../../types';
import {
    collectInheritedNames,
    measureClassBox,
    renderClassBox,
} from '../classBox';
import { Group, HtmlRoot, Svg } from '../../components';
import { renderAncestorEdges, renderDescendantEdges } from '../edges';
import {
    orderByChildBarycenter,
    orderByParentBarycenter,
} from '../../utils/layout';
import { renderBaseStyles, renderViewportScript } from '../../utils/viewport';

function measureLayerMaxHeight(layer: ClassNode[]): number {
    return Math.max(...layer.map(node => measureClassBox(node).height));
}

function positionLayer(
    layer: ClassNode[],
    topY: number,
    allNodes: Map<string, ClassNode>,
    horizontalGap: number,
    lazy: boolean,
    lazyBodies: Array<[string, string]>
): { svgs: string[]; positions: BoxMeasures[] } {
    const inherited = layer.map(node => collectInheritedNames(node, allNodes));
    const sizes = layer.map(node => measureClassBox(node));

    const totalWidth =
        sizes.reduce((sum, s) => sum + s.width, 0) +
        (layer.length - 1) * horizontalGap;
    let xCursor = -totalWidth / 2;

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

export interface TreeLayout {
    svg: string;
    halfWidth: number;
    topY: number;
    bottomY: number;
    lazyBodies: Array<[string, string]>;
}

export function buildTreeLayout(
    focus: ClassNode,
    ancestorLayers: ClassNode[][],
    descendantLayers: ClassNode[][],
    lazy = false
): TreeLayout {
    const { verticalGap, horizontalGap } = UI.tree;

    const allNodes = new Map<string, ClassNode>();
    allNodes.set(focus.id, focus);
    for (const layer of ancestorLayers) {
        for (const node of layer) {
            allNodes.set(node.id, node);
        }
    }
    for (const layer of descendantLayers) {
        for (const node of layer) {
            allNodes.set(node.id, node);
        }
    }

    const layerHalfWidth = (layer: ClassNode[]): number => {
        const sizes = layer.map(node => measureClassBox(node));
        const total =
            sizes.reduce((sum, s) => sum + s.width, 0) +
            (layer.length - 1) * horizontalGap;
        return total / 2;
    };

    const lazyBodies: Array<[string, string]> = [];

    const focusRendered = renderClassBox(
        focus,
        0,
        0,
        collectInheritedNames(focus, allNodes),
        { lazy }
    );
    if (focusRendered.lazyBody) {
        lazyBodies.push([
            focusRendered.lazyBody.boxId,
            focusRendered.lazyBody.html,
        ]);
    }
    let halfWidth = layerHalfWidth([focus]);
    let boxesSvg = focusRendered.svg;

    let currentY = 0;
    const ancestorLayerBoxes: BoxMeasures[][] = [];
    const orderedAncestorLayers: ClassNode[][] = [];
    let prevAncestorLayer: ClassNode[] = [focus];
    let prevAncestorPositions = new Map<string, number>([[focus.id, 0]]);

    for (const layer of ancestorLayers) {
        const ordered = orderByChildBarycenter(
            layer,
            prevAncestorLayer,
            prevAncestorPositions
        );
        orderedAncestorLayers.push(ordered);
        halfWidth = Math.max(halfWidth, layerHalfWidth(ordered));
        currentY -= verticalGap + measureLayerMaxHeight(ordered);
        const { svgs, positions } = positionLayer(
            ordered,
            currentY,
            allNodes,
            horizontalGap,
            lazy,
            lazyBodies
        );
        boxesSvg += svgs.join('');
        ancestorLayerBoxes.push(positions);
        prevAncestorPositions = new Map(
            ordered.map((node, i) => [node.id, positions[i].x])
        );
        prevAncestorLayer = ordered;
    }
    const topY = currentY;

    currentY = focusRendered.height + verticalGap;
    const descendantLayerBoxes: BoxMeasures[][] = [];
    const orderedDescendantLayers: ClassNode[][] = [];
    let parentPositions = new Map<string, number>([[focus.id, 0]]);

    for (const layer of descendantLayers) {
        const ordered = orderByParentBarycenter(layer, parentPositions);
        orderedDescendantLayers.push(ordered);
        halfWidth = Math.max(halfWidth, layerHalfWidth(ordered));
        const { svgs, positions } = positionLayer(
            ordered,
            currentY,
            allNodes,
            horizontalGap,
            lazy,
            lazyBodies
        );
        boxesSvg += svgs.join('');
        currentY += Math.max(...positions.map(box => box.height)) + verticalGap;
        descendantLayerBoxes.push(positions);
        parentPositions = new Map(
            ordered.map((node, i) => [node.id, positions[i].x])
        );
    }
    const bottomY =
        descendantLayers.length > 0
            ? currentY - verticalGap
            : focusRendered.height;

    const focusBox: BoxMeasures = {
        x: 0,
        y: 0,
        width: focusRendered.width,
        height: focusRendered.height,
    };
    const edgesSvg =
        renderAncestorEdges(
            orderedAncestorLayers,
            ancestorLayerBoxes,
            focus,
            focusBox
        ) +
        renderDescendantEdges(
            orderedDescendantLayers,
            descendantLayerBoxes,
            focus,
            focusBox
        );

    return {
        svg: edgesSvg + boxesSvg,
        halfWidth,
        topY,
        bottomY,
        lazyBodies,
    };
}

function totalNodeCount(
    focus: ClassNode,
    ancestorLayers: ClassNode[][],
    descendantLayers: ClassNode[][]
): number {
    const seen = new Set<string>([focus.id]);
    for (const layer of ancestorLayers) {
        for (const node of layer) {
            seen.add(node.id);
        }
    }
    for (const layer of descendantLayers) {
        for (const node of layer) {
            seen.add(node.id);
        }
    }
    return seen.size;
}

export function renderClassTree(
    focus: ClassNode,
    ancestorLayers: ClassNode[][],
    descendantLayers: ClassNode[][]
): string {
    const total = totalNodeCount(focus, ancestorLayers, descendantLayers);
    const lazy = total > UI.lazy.renderThreshold;
    const { svg, lazyBodies } = buildTreeLayout(
        focus,
        ancestorLayers,
        descendantLayers,
        lazy
    );

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
                    children: svg,
                }),
        }) +
            renderViewportScript({
                focusNodeId: focus.id,
                lazyBodies: lazy ? lazyBodies : undefined,
            })
    );
}
