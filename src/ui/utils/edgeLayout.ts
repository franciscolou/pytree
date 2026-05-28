// Pure geometric layout for inheritance edges.
//
// This module is consumed in two places:
//   - The extension-side SVG renderer (src/ui/render/edges.ts), which turns
//     the computed geometry into `<line>` / `<polygon>` strings.
//   - The webview-side renderer (src/handlers/create/...), which turns the
//     same geometry into DOM nodes.
//
// Keep this file dependency-free (no `vscode`, no SVG-string building) so
// esbuild can bundle it into a browser IIFE alongside being imported as a
// regular Node module in the extension.

export interface RawConnection {
    parentX: number;
    parentBottom: number;
    childX: number;
    childTop: number;
    // Layer indices for adjacency detection: childLayer - parentLayer === 1
    // routes the edge through the bus between the two layers; anything else
    // routes through the lateral highway.
    parentLayer: number;
    childLayer: number;
    parentId: string;
    childId: string;
    parentName?: string;
    childName?: string;
}

export interface EdgeSegment {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface EdgeArrow {
    x: number;
    y: number;
}

export interface ComputedEdge {
    segments: EdgeSegment[];
    arrow: EdgeArrow;
    colorIndex: number;
    parentId: string;
    childId: string;
    parentName?: string;
    childName?: string;
}

export interface EdgeLayoutBounds {
    left: number;
    right: number;
}

export interface EdgeLayoutOptions {
    laneStep?: number;
    attachStep?: number;
    arrowH?: number;
    sideStep?: number;
    topOffset?: number;
    botOffset?: number;
    yStep?: number;
    margin?: number;
}

const DEFAULTS: Required<EdgeLayoutOptions> = {
    laneStep: 18,
    attachStep: 14,
    arrowH: 10,
    sideStep: 14,
    topOffset: 20,
    botOffset: 10,
    yStep: 12,
    margin: 40,
};

/* =========================================================
   Low-level helpers (also exported for reuse in callers
   that want to compose their own layout passes).
========================================================= */

// Assigns Y offsets to overlapping horizontal segments so they land on
// distinct lanes. Lane order: 0, +step, -step, +2*step, -2*step, ...
export function assignEdgeLanes(
    segments: [number, number][],
    step: number
): number[] {
    const n = segments.length;
    if (n <= 1) {
        return new Array(n).fill(0);
    }
    const normalized = segments.map(
        ([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number]
    );
    const laneOrder: number[] = [0];
    for (let i = 1; i <= n; i++) {
        laneOrder.push(i * step, -(i * step));
    }
    const laneRanges = new Map<number, [number, number][]>();
    const result = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        const [left, right] = normalized[i];
        for (const offset of laneOrder) {
            const occupied = laneRanges.get(offset) ?? [];
            const conflicts = occupied.some(
                ([ol, or]) => left < or && right > ol
            );
            if (!conflicts) {
                result[i] = offset;
                if (!laneRanges.has(offset)) {
                    laneRanges.set(offset, []);
                }
                laneRanges.get(offset)!.push([left, right]);
                break;
            }
        }
    }
    return result;
}

// Spreads attachment X positions for connections sharing the same node,
// ordered by the other endpoint's X to minimise crossing at the attachment.
export function spreadAttachXs(
    ownXs: number[],
    otherXs: number[],
    step: number
): number[] {
    const result = ownXs.slice();
    const groups = new Map<number, number[]>();
    ownXs.forEach((x, i) => {
        if (!groups.has(x)) {
            groups.set(x, []);
        }
        groups.get(x)!.push(i);
    });
    for (const [ownX, idxs] of groups) {
        if (idxs.length === 1) {
            result[idxs[0]] = ownX;
            continue;
        }
        idxs.sort((a, b) => otherXs[a] - otherXs[b]);
        const half = ((idxs.length - 1) * step) / 2;
        idxs.forEach((idx, pos) => {
            result[idx] = ownX - half + pos * step;
        });
    }
    return result;
}

// Returns true if a horizontal segment (at y=hy, from hx1 to hx2) strictly
// crosses a vertical segment (at x=vx, from vy1 to vy2) in the interior.
export function hVIntersect(
    hy: number,
    hx1: number,
    hx2: number,
    vx: number,
    vy1: number,
    vy2: number
): boolean {
    const minHX = Math.min(hx1, hx2);
    const maxHX = Math.max(hx1, hx2);
    const minVY = Math.min(vy1, vy2);
    const maxVY = Math.max(vy1, vy2);
    return minHX < vx && vx < maxHX && minVY < hy && hy < maxVY;
}

export function rangesOverlap(
    a1: number,
    a2: number,
    b1: number,
    b2: number
): boolean {
    const minA = Math.min(a1, a2);
    const maxA = Math.max(a1, a2);
    const minB = Math.min(b1, b2);
    const maxB = Math.max(b1, b2);
    return minA < maxB && minB < maxA;
}

// 3-segment connection (after attach spreading): parent-attach-X (pX),
// parent-bottom (parentBottom), child-attach-X (cX), child-top (childTop).
export interface PlacedConnection {
    pX: number;
    cX: number;
    parentBottom: number;
    childTop: number;
}

// Two adjacent connections collide if any of their 3-segment paths cross
// geometrically.
export function connectionsCross(
    ci: PlacedConnection,
    eyi: number,
    cj: PlacedConnection,
    eyj: number
): boolean {
    if (hVIntersect(eyi, ci.pX, ci.cX, cj.pX, cj.parentBottom, eyj)) {
        return true;
    }
    if (hVIntersect(eyi, ci.pX, ci.cX, cj.cX, eyj, cj.childTop)) {
        return true;
    }
    if (hVIntersect(eyj, cj.pX, cj.cX, ci.pX, ci.parentBottom, eyi)) {
        return true;
    }
    if (hVIntersect(eyj, cj.pX, cj.cX, ci.cX, eyi, ci.childTop)) {
        return true;
    }
    if (
        ci.pX === cj.pX &&
        rangesOverlap(ci.parentBottom, eyi, cj.parentBottom, eyj)
    ) {
        return true;
    }
    if (
        ci.cX === cj.cX &&
        rangesOverlap(eyi, ci.childTop, eyj, cj.childTop)
    ) {
        return true;
    }
    return false;
}

/* =========================================================
   High-level: compute geometry for all inheritance edges.
========================================================= */

interface PreparedConn extends RawConnection {
    pX: number;
    cX: number;
}

// Per-edge geometry for an adjacent (single-bus) connection.
function buildAdjacentSegments(
    conn: PreparedConn,
    edgeY: number,
    arrowH: number
): { segments: EdgeSegment[]; arrow: EdgeArrow } {
    return {
        arrow: { x: conn.pX, y: conn.parentBottom },
        segments: [
            {
                x1: conn.pX,
                y1: conn.parentBottom + arrowH,
                x2: conn.pX,
                y2: edgeY,
            },
            { x1: conn.pX, y1: edgeY, x2: conn.cX, y2: edgeY },
            { x1: conn.cX, y1: edgeY, x2: conn.cX, y2: conn.childTop },
        ],
    };
}

function buildHighwaySegments(
    conn: PreparedConn,
    topY: number,
    botY: number,
    sideX: number,
    arrowH: number
): { segments: EdgeSegment[]; arrow: EdgeArrow } {
    return {
        arrow: { x: conn.pX, y: conn.parentBottom },
        segments: [
            {
                x1: conn.pX,
                y1: conn.parentBottom + arrowH,
                x2: conn.pX,
                y2: topY,
            },
            { x1: conn.pX, y1: topY, x2: sideX, y2: topY },
            { x1: sideX, y1: topY, x2: sideX, y2: botY },
            { x1: sideX, y1: botY, x2: conn.cX, y2: botY },
            { x1: conn.cX, y1: botY, x2: conn.cX, y2: conn.childTop },
        ],
    };
}

function colorIndicesForGroup(
    placed: PlacedConnection[],
    edgeYs: number[]
): number[] {
    const n = placed.length;
    const result = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        const used = new Set<number>();
        for (let j = 0; j < i; j++) {
            if (connectionsCross(placed[i], edgeYs[i], placed[j], edgeYs[j])) {
                used.add(result[j]);
            }
        }
        let c = 0;
        while (used.has(c)) {
            c++;
        }
        result[i] = c;
    }
    return result;
}

function assignYOffsets(keys: number[], yStep: number): number[] {
    const offsets = new Array<number>(keys.length).fill(0);
    const groups = new Map<number, number[]>();
    keys.forEach((key, i) => {
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(i);
    });
    for (const idxs of groups.values()) {
        idxs.forEach((idx, pos) => {
            offsets[idx] = pos * yStep;
        });
    }
    return offsets;
}

/**
 * Computes the full geometric layout for a set of inheritance connections.
 *
 * For every connection it returns:
 *  - a sequence of straight segments to draw (3 segments for adjacent edges,
 *    5 segments when the connection has to take the side highway),
 *  - the arrow tip position at the parent's bottom,
 *  - a color index suitable for indexing into an edge-color palette.
 *
 * Callers are responsible for turning the result into SVG strings or DOM
 * nodes — this function never touches the rendering surface.
 */
export function computeEdgeGeometry(
    connections: RawConnection[],
    bounds: EdgeLayoutBounds,
    options: EdgeLayoutOptions = {}
): ComputedEdge[] {
    if (connections.length === 0) {
        return [];
    }
    const opts: Required<EdgeLayoutOptions> = { ...DEFAULTS, ...options };

    // Spread attachment Xs across ALL edges so a class with multiple parents
    // gets distinct attachment points along its top/bottom edge.
    const pAttach = spreadAttachXs(
        connections.map(c => c.parentX),
        connections.map(c => c.childX),
        opts.attachStep
    );
    const cAttach = spreadAttachXs(
        connections.map(c => c.childX),
        connections.map(c => c.parentX),
        opts.attachStep
    );
    const prepared: PreparedConn[] = connections.map((c, i) => ({
        ...c,
        pX: pAttach[i],
        cX: cAttach[i],
    }));

    const out: ComputedEdge[] = new Array(prepared.length);

    // ---- Adjacent edges (childLayer = parentLayer + 1) ----
    const adjacent: { conn: PreparedConn; idx: number }[] = [];
    const nonAdjacent: { conn: PreparedConn; idx: number }[] = [];
    prepared.forEach((c, idx) => {
        if (c.childLayer - c.parentLayer === 1) {
            adjacent.push({ conn: c, idx });
        } else {
            nonAdjacent.push({ conn: c, idx });
        }
    });

    // Group adjacent edges by (parentLayer, childLayer) and compute a shared
    // busY for each group from actual parent/child positions.
    const adjGroups = new Map<string, { conn: PreparedConn; idx: number }[]>();
    for (const entry of adjacent) {
        const key = entry.conn.parentLayer + '->' + entry.conn.childLayer;
        if (!adjGroups.has(key)) {
            adjGroups.set(key, []);
        }
        adjGroups.get(key)!.push(entry);
    }

    for (const group of adjGroups.values()) {
        const maxPB = Math.max(...group.map(g => g.conn.parentBottom));
        const minCT = Math.min(...group.map(g => g.conn.childTop));
        const busY = (maxPB + minCT) / 2;

        const laneOffsets = assignEdgeLanes(
            group.map(g => [g.conn.pX, g.conn.cX]),
            opts.laneStep
        );
        const edgeYs = laneOffsets.map(lo => busY + lo);
        const placed = group.map(g => ({
            pX: g.conn.pX,
            cX: g.conn.cX,
            parentBottom: g.conn.parentBottom,
            childTop: g.conn.childTop,
        }));
        const colorIdx = colorIndicesForGroup(placed, edgeYs);

        group.forEach(({ conn, idx }, i) => {
            const built = buildAdjacentSegments(conn, edgeYs[i], opts.arrowH);
            out[idx] = {
                segments: built.segments,
                arrow: built.arrow,
                colorIndex: colorIdx[i],
                parentId: conn.parentId,
                childId: conn.childId,
                parentName: conn.parentName,
                childName: conn.childName,
            };
        });
    }

    // ---- Non-adjacent edges (side highway) ----
    if (nonAdjacent.length > 0) {
        const naConns = nonAdjacent.map(e => e.conn);
        const componentCenter = bounds.right + bounds.left;
        const goRight = naConns.map(
            c => c.childX + c.parentX > componentCenter
        );

        const topOffsets = assignYOffsets(
            naConns.map(c => Math.round(c.parentBottom)),
            opts.yStep
        );
        const botOffsets = assignYOffsets(
            naConns.map(c => Math.round(c.childTop)),
            opts.yStep
        );
        const topYs = naConns.map(
            (c, i) => c.parentBottom + opts.topOffset + topOffsets[i]
        );
        const botYs = naConns.map(
            (c, i) => c.childTop - opts.botOffset - botOffsets[i]
        );

        const rightLanes: [number, number][][] = [];
        const leftLanes: [number, number][][] = [];
        const laneIdx = new Array<number>(naConns.length).fill(0);
        for (let i = 0; i < naConns.length; i++) {
            const ranges = goRight[i] ? rightLanes : leftLanes;
            let lane = 0;
            for (;;) {
                if (!ranges[lane]) {
                    ranges[lane] = [];
                }
                if (
                    !ranges[lane].some(
                        ([t, b]) => topYs[i] < b && botYs[i] > t
                    )
                ) {
                    ranges[lane].push([topYs[i], botYs[i]]);
                    laneIdx[i] = lane;
                    break;
                }
                lane++;
            }
        }

        const sideXs = naConns.map(
            (_, i) =>
                (goRight[i] ? bounds.right : bounds.left) +
                (goRight[i] ? 1 : -1) * laneIdx[i] * opts.sideStep
        );

        nonAdjacent.forEach(({ conn, idx }, i) => {
            const built = buildHighwaySegments(
                conn,
                topYs[i],
                botYs[i],
                sideXs[i],
                opts.arrowH
            );
            out[idx] = {
                segments: built.segments,
                arrow: built.arrow,
                colorIndex: laneIdx[i],
                parentId: conn.parentId,
                childId: conn.childId,
                parentName: conn.parentName,
                childName: conn.childName,
            };
        });
    }

    return out;
}
