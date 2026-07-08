export const UI = {
    box: {
        minWidth: 260,
        maxWidth: 720,
        headerHeight: 32,
        collapsedHeaderHeight: 56,
        padding: 14,
        sectionGap: 10,
        lineHeight: 20,
        sidePadding: 32,
        borderRadius: 10,
        charWidth: 8.8,
        sectionTopPadding: 25,

        filePathFontSize: 11,
        filePathLineHeight: 16,
        filePathPadding: 4,
        filePathCharWidth: 6.5,
    },

    tree: {
        verticalGap: 150,
        horizontalGap: 160,
        initialTranslate: {
            x: 1000,
            y: 1000,
        },
    },

    zoom: {
        step: 0.1,
    },

    pan: {
        sensitivity: 0.9,
    },

    lazy: {
        // Above this many class boxes in a single webview, body content
        // (file path, attributes, properties, methods) is hydrated on demand
        // as boxes enter the viewport instead of being baked into the initial
        // SVG. Outline + class-name header are always present so the layout
        // and box positions remain visible while panning. Tuning placeholder.
        renderThreshold: 150,
    },
} as const;
