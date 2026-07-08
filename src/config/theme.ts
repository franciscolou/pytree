export const Theme = {
    colors: {
        background: 'var(--pt-bg)',
        panelBackground: 'var(--pt-panel-bg)',
        border: 'var(--pt-border)',

        headerBackground: 'var(--pt-header-bg)',
        abstractHeaderBackground: 'var(--pt-abstract-header-bg)',
        headerGradient: 'url(#pt-header-grad)',
        abstractHeaderGradient: 'url(#pt-abstract-grad)',
        headerText: 'var(--pt-header-text)',
        accent: 'var(--pt-accent)',

        filePathBackground: 'var(--pt-filepath-bg)',
        filePathText: 'var(--pt-filepath-text)',

        sectionLabel: 'var(--pt-section-label)',

        text: 'var(--pt-text)',
        type: 'var(--pt-type)',
        string: 'var(--pt-string)',
        number: 'var(--pt-number)',
        bool: 'var(--pt-bool)',
        attribute: 'var(--pt-attribute)',
        method: 'var(--pt-method)',
        override: 'var(--pt-override)',

        edge: 'var(--pt-edge)',
        edgePalette: [
            'var(--pt-edge-0)',
            'var(--pt-edge-1)',
            'var(--pt-edge-2)',
            'var(--pt-edge-3)',
            'var(--pt-edge-4)',
            'var(--pt-edge-5)',
            'var(--pt-edge-6)',
            'var(--pt-edge-7)',
            'var(--pt-edge-8)',
            'var(--pt-edge-9)',
            'var(--pt-edge-10)',
            'var(--pt-edge-11)',
            'var(--pt-edge-12)',
            'var(--pt-edge-13)',
            'var(--pt-edge-14)',
        ] as const,
    },

    font: {
        family: 'var(--vscode-editor-font-family)',
        size: {
            small: 13,
            normal: 14,
            header: 15,
            collapsedHeader: 24,
        },
        weight: {
            normal: 'normal',
            bold: 'bold',
        },
    },
} as const;
