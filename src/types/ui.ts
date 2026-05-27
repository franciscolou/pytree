export interface RenderedBox {
    svg: string;
    width: number;
    height: number;
    // Populated only when `renderClassBox` is invoked with `lazy: true`.
    // `svg` then contains the shell (panel + header + class title) plus an
    // empty `<g data-pt-lazy-body>` slot; `lazyBody.html` is the heavy body
    // SVG that the viewport script injects on demand.
    lazyBody?: { boxId: string; html: string };
}

export type BoxMeasures = {
    x: number;
    y: number;
    width: number;
    height: number;
};
