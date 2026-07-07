export const Messages = {
    errors: {
        noClassUnderCursor: 'No class found under cursor.',
        noClassesFound: 'No Python classes found in the workspace.',
        pylanceRequired:
            'PyTree could not query the Python type hierarchy because Pylance extension must be installed and active to show subclasses.',
    },
    hover: {
        brand: 'PyTree',
        icons: {
            brand: 'list-tree',
            showAncestorsTree: 'type-hierarchy-super',
            showCompleteTree: 'type-hierarchy',
            showDescendantsTree: 'type-hierarchy-sub',
        },
        labels: {
            showAncestorsTree: 'Show Ancestors Tree',
            showCompleteTree: 'Show Complete Tree',
            showDescendantsTree: 'Show Descendants Tree',
        },
        descriptions: {
            showAncestorsTree: 'Ancestors only',
            showCompleteTree: 'Ancestors and descendants',
            showDescendantsTree: 'Descendants only',
        },
    },

    status: {
        scanningFiles: 'PyTree: scanning files...',
        backgroundScan: 'PyTree: indexing workspace classes...',
    },

    webView: {
        titles: {
            ancestorsTree: (name: string) => `PyTree: ${name} Inheritance`,
            completeClassTree: (name: string) =>
                `PyTree: ${name} Complete Inheritance`,
            descendantsTree: (name: string) => `PyTree: ${name} Descendants`,
            projectTree: 'PyTree: Project Tree',
            pickedClassesTree: 'PyTree: Picked Classes',
            pickedPathsTree: 'PyTree: Picked Paths',
            allExceptTree: 'PyTree: All Except',
        },
        options: {
            showAllFilePaths: 'Show all file paths',
            export: 'Export',
        },
        create: {
            tools: {
                cursor: {
                    title: "Cursor (V)",
                    description: "Drag boxes, click header to toggle abstract, double-click name to rename"
                },
                addBox: {
                    title: "Add Box (B)",
                    description: "Click on the canvas to add a class box"
                },
                addEdge: {
                    title: "Add Edge (E)",
                    description: "Click first box (child), then second box (parent) to connect"
                },
                module: {
                    title: "Module (M)",
                    description: "Drag a rectangle around classes to group them in a module"
                },
                erase: {
                    title: "Erase (X)",
                    description: "Click a box or edge to delete it"
                },
                arrange: "Arrange layout",
                confirm: "Create Python files"
            }
        }
    },

    ui: {
        abstractIndicator: '(abc)',
        sections: {
            attributes: 'Attributes',
            properties: 'Properties',
            classMethods: 'Class Methods',
            staticMethods: 'Static Methods',
            methods: 'Methods',
        },
    },

    inheritance: {
        cycleError: (child: string, parent: string) =>
            `Cannot change inheritance: ${parent} is already a descendant of ${child}, which would create a circular inheritance.`,
        alreadyInheritsError: (child: string, parent: string) =>
            `Cannot change inheritance: ${child} already inherits from ${parent}.`,
        sameParent: 'The selected class is already the current parent.',
        confirmTitle: (child: string, oldParent: string, newParent: string) =>
            `Change ${child}'s base from ${oldParent} to ${newParent}?`,
        confirmApply: 'Apply',
        conflictTitle: (child: string, newParent: string) =>
            `Changing ${child}'s parent to ${newParent} introduces conflicts:`,
        conflictAttrs: (names: string[]) => `Attributes: ${names.join(', ')}`,
        conflictMethods: (names: string[]) => `Methods: ${names.join(', ')}`,
        conflictFooter:
            'Apply anyway? You can resolve the conflicts manually in the source file afterwards.',
        applyAnyway: 'Apply Anyway',
        cancel: 'Cancel',
        rewriteFailed:
            'Could not rewrite the source: please check the class declaration is well-formed.',
        appliedNotice: (child: string, parent: string) =>
            `Changed ${child}'s base class to ${parent}.`,
    },

    commands: {
        pickClasses: {
            labels: {
                placeholder: 'Select tree type',

                simpleTree: {
                    title: 'Simple Tree',
                    description: 'Ancestors only',
                },
                completeTree: {
                    title: 'Complete Tree',
                    description: 'Ancestors and descendants',
                },
            },
        },
        pickPaths: {
            labels: {
                placeholder: 'Select tree type',

                simpleTree: {
                    title: 'Simple Tree',
                    description:
                        'Classes in selected paths plus their ancestors',
                },
                completeTree: {
                    title: 'Complete Tree',
                    description:
                        'Classes in selected paths plus ancestors and descendants',
                },
            },
            picker: {
                title: 'Pick files/folders to include',
                placeholder:
                    'Toggle items with Space — pick one or more files/folders, then press Enter',
            },
            errors: {
                noClassesInPaths:
                    'No Python classes found in the selected paths.',
                noneSelected: 'No paths selected.',
            },
        },
        allExcept: {
            labels: {
                placeholder: 'Select tree type',

                simpleTree: {
                    title: 'Simple Tree',
                    description:
                        'All classes outside selected paths plus their ancestors',
                },
                completeTree: {
                    title: 'Complete Tree',
                    description:
                        'All classes outside selected paths plus ancestors and descendants',
                },
            },
            picker: {
                title: 'Pick files/folders to exclude',
                placeholder:
                    'Toggle items with Space — pick one or more files/folders, then press Enter',
            },
            errors: {
                noClassesAfterExclude:
                    'No Python classes remain after excluding the selected paths.',
                noneSelected: 'No paths selected.',
            },
        },
    },
} as const;
