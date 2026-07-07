import type { ClassNode } from '../../types';

// Kahn's topological sort for longest-path layering.
// edges: adjacency list — node → nodes it propagates distance to.
// Returns node → longest-path depth from any source (in-degree 0) node.
function longestPathLayers(
    nodes: string[],
    edges: Map<string, string[]>
): Map<string, number> {
    const inDeg = new Map<string, number>();
    for (const n of nodes) {
        inDeg.set(n, 0);
    }
    for (const targets of edges.values()) {
        for (const t of targets) {
            inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
        }
    }

    const dist = new Map<string, number>();
    for (const n of nodes) {
        dist.set(n, 0);
    }

    const queue: string[] = [];
    for (const [n, deg] of inDeg) {
        if (deg === 0) {
            queue.push(n);
        }
    }
    queue.sort();

    while (queue.length > 0) {
        const curr = queue.shift()!;
        const d = dist.get(curr)!;
        for (const next of edges.get(curr) ?? []) {
            // Longest path: take max, not min — ensures diamond ancestors land above every path that reaches them.
            if (d + 1 > dist.get(next)!) {
                dist.set(next, d + 1);
            }
            const newDeg = inDeg.get(next)! - 1;
            inDeg.set(next, newDeg);
            if (newDeg === 0) {
                queue.push(next);
            }
        }
    }

    return dist;
}

export function buildConnectedComponents(
    classes: Map<string, ClassNode>
): ClassNode[][] {
    const parent = new Map<string, string>();
    for (const id of classes.keys()) {
        parent.set(id, id);
    }

    const find = (x: string): string => {
        while (parent.get(x) !== x) {
            parent.set(x, parent.get(parent.get(x)!)!);
            x = parent.get(x)!;
        }
        return x;
    };

    for (const [id, node] of classes.entries()) {
        for (const base of node.bases) {
            if (base.id && classes.has(base.id)) {
                const rx = find(id),
                    ry = find(base.id);
                if (rx !== ry) {
                    parent.set(rx, ry);
                }
            }
        }
    }

    const groups = new Map<string, ClassNode[]>();
    for (const [id, node] of classes.entries()) {
        const root = find(id);
        if (!groups.has(root)) {
            groups.set(root, []);
        }
        groups.get(root)!.push(node);
    }

    return [...groups.values()].sort((a, b) => {
        if (b.length !== a.length) {
            return b.length - a.length;
        }
        const minId = (arr: ClassNode[]) =>
            arr.reduce((m, n) => (n.id < m ? n.id : m), arr[0].id);
        return minId(a).localeCompare(minId(b));
    });
}

export function buildComponentLayers(component: ClassNode[]): ClassNode[][] {
    const idSet = new Set(component.map(n => n.id));
    const nodeById = new Map(component.map(n => [n.id, n]));

    // Edges go from base class → derived classes (root-to-leaf direction)
    const edges = new Map<string, string[]>();
    for (const node of component) {
        for (const base of node.bases) {
            if (base.id && idSet.has(base.id)) {
                if (!edges.has(base.id)) {
                    edges.set(base.id, []);
                }
                edges.get(base.id)!.push(node.id);
            }
        }
    }

    const dist = longestPathLayers(
        component.map(n => n.id),
        edges
    );

    const layerMap = new Map<number, ClassNode[]>();
    for (const [id, d] of dist) {
        if (!layerMap.has(d)) {
            layerMap.set(d, []);
        }
        layerMap.get(d)!.push(nodeById.get(id)!);
    }

    const maxDist = dist.size > 0 ? Math.max(...dist.values()) : 0;
    const layers: ClassNode[][] = [];
    for (let d = 0; d <= maxDist; d++) {
        const layer = layerMap.get(d);
        if (layer?.length) {
            layers.push(layer.sort((a, b) => a.id.localeCompare(b.id)));
        }
    }
    return layers;
}

// Runs longest-path layering on `related` nodes (relative to `focusId` at depth 0).
// `edgesOf(id)` must return the subgraph neighbours that depth should propagate to.
// Returns layers[0] = nodes at depth 1, layers[1] = nodes at depth 2, etc.
export function layerByLongestPath(
    focusId: string,
    related: Set<string>,
    edgesOf: (id: string) => string[]
): string[][] {
    if (related.size === 0) {
        return [];
    }

    const subgraph = new Set([focusId, ...related]);

    const edges = new Map<string, string[]>();
    for (const id of subgraph) {
        const targets = edgesOf(id);
        if (targets.length) {
            edges.set(id, targets);
        }
    }

    const dist = longestPathLayers([...subgraph], edges);

    const layerMap = new Map<number, string[]>();
    for (const id of related) {
        const d = dist.get(id)!;
        if (!layerMap.has(d)) {
            layerMap.set(d, []);
        }
        layerMap.get(d)!.push(id);
    }

    const maxDist = Math.max(...[...related].map(id => dist.get(id)!));
    const layers: string[][] = [];
    for (let d = 1; d <= maxDist; d++) {
        const layer = layerMap.get(d);
        if (layer?.length) {
            layers.push(layer);
        }
    }
    return layers;
}

export function collectAncestors(
    classId: string,
    classes: Map<string, ClassNode>
): string[][] {
    const allAncestors = new Set<string>();
    const stack: string[] = [classId];
    while (stack.length > 0) {
        const curr = stack.pop()!;
        for (const base of classes.get(curr)?.bases ?? []) {
            if (base.id && classes.has(base.id) && !allAncestors.has(base.id)) {
                allAncestors.add(base.id);
                stack.push(base.id);
            }
        }
    }

    const subgraph = new Set([classId, ...allAncestors]);
    // Edges go from derived class → base classes (focus-to-ancestor direction).
    return layerByLongestPath(classId, allAncestors, id =>
        (classes.get(id)?.bases ?? [])
            .filter(b => b.id && subgraph.has(b.id))
            .map(b => b.id!)
    );
}

export function collectDescendants(
    classId: string,
    classes: Map<string, ClassNode>
): string[][] {
    // Build parent → children adjacency list for the whole class map.
    const children = new Map<string, string[]>();
    for (const [id, node] of classes) {
        for (const base of node.bases) {
            if (base.id && classes.has(base.id)) {
                if (!children.has(base.id)) {
                    children.set(base.id, []);
                }
                children.get(base.id)!.push(id);
            }
        }
    }

    // BFS to collect the full set of descendants.
    const allDescendants = new Set<string>();
    const queue: string[] = [classId];
    const visited = new Set<string>([classId]);
    while (queue.length > 0) {
        const curr = queue.shift()!;
        for (const child of children.get(curr) ?? []) {
            if (!visited.has(child)) {
                visited.add(child);
                allDescendants.add(child);
                queue.push(child);
            }
        }
    }

    const subgraph = new Set([classId, ...allDescendants]);
    // Edges go from base class → derived classes (focus-to-descendant direction).
    return layerByLongestPath(classId, allDescendants, id =>
        (children.get(id) ?? []).filter(c => subgraph.has(c))
    );
}
