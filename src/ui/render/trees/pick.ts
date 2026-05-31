import { ClassNode } from '../../../types';
import { UI } from '../../../config';
import { Group, HtmlRoot, Svg } from '../../components';
import { buildTreeLayout } from './single';
import { renderBaseStyles, renderViewportScript } from '../../utils/viewport';

const TREE_GAP = 300;

export function renderMultiTree(
    trees: Array<{
        focus: ClassNode;
        ancestorLayers: ClassNode[][];
        descendantLayers: ClassNode[][];
    }>
): string {
    // Lazy decision uses the union of all class IDs across trees — a single
    // class shared between trees counts once. This matches the user-visible
    // DOM cost (each box is rendered once per tree it appears in, but the
    // threshold tracks logical complexity of the picked set).
    const allIds = new Set<string>();
    for (const t of trees) {
        allIds.add(t.focus.id);
        for (const layer of t.ancestorLayers) {
            for (const node of layer) {
                allIds.add(node.id);
            }
        }
        for (const layer of t.descendantLayers) {
            for (const node of layer) {
                allIds.add(node.id);
            }
        }
    }
    const lazy = allIds.size > UI.lazy.renderThreshold;

    const layouts = trees.map(t =>
        buildTreeLayout(t.focus, t.ancestorLayers, t.descendantLayers, lazy)
    );

    const centersX: number[] = [];
    let cursorX = 0;
    for (const layout of layouts) {
        cursorX += layout.halfWidth;
        centersX.push(cursorX);
        cursorX += layout.halfWidth + TREE_GAP;
    }

    const allSvg = layouts
        .map((layout, i) =>
            Group({
                transform: `translate(${centersX[i]}, 0)`,
                children: layout.svg,
            })
        )
        .join('');

    // Aggregate body fragments across all picked trees. Each tree wraps its
    // boxes in a `translate(centerX, 0)` group, but lazy bodies are inserted
    // into the slot inside each box's own `<g data-pt-box>` — that slot is
    // already positioned, so injection is location-independent.
    const lazyBodies = lazy ? layouts.flatMap(l => l.lazyBodies) : undefined;

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
                    children: allSvg,
                }),
        }) + renderViewportScript({ initialScale: 0.5, lazyBodies })
    );
}
