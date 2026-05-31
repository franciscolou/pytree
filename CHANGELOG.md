# Changelog

All notable changes to the "PyTree" extension will be documented in this file.

## Unreleased

### Added

- Added **Pick Paths** feature (selects classes defined in chosen files/folders and renders them with their full inheritance, even when ancestors or descendants live outside the selection)
- Added **All Except** feature (renders the project tree of the workspace excluding the selected files/folders — useful for filtering out test directories or generated code)
- Added **Create** feature: an interactive board to design classes visually (draw class boxes, connect inheritance edges, group classes into modules) and generate the corresponding Python source files, with dependency-ordered class definitions, cross-module relative imports, and `ABC`/`abstractmethod` scaffolding
- Clicking an inheritance arrow now recenters the view on a related class — the arrow tip focuses the subclass, the arrow body focuses the superclass
- Variadic parameters (\*args, \*\*kwargs) now are displayed in method signatures

### Changed

- Refreshed the visual design across every webview and the in-editor hover card — gradient headers, softer elevation, a unified accent color, and frosted-glass toolbars/menus
- Increased the number of distinct colors used for inheritance edges so adjacent edges are easier to tell apart
- Large workspaces now load faster: trees with many classes hydrate their box content lazily as you pan, and the workspace is indexed in the background on startup so the first command is responsive
- **Project Tree** now displays larger trees at the center of the grid, instead of top-left to down-right direction.
- Fixed an issue where command executions with the same tree type and module, without file changes, reused the panel even when the class was different.
- Fixed (again) a parsing issue where classes declared with PEP 695 (Type Parameter Syntax Enhancement) notation got their inheritances ignored
- Fixed whole word match toggle in search bar
- Fixed an issue where the font in webviews wasn't being preserved in exports

## [0.0.8] - 2026-05-15

### Added

- Class boxes now display a dedicated **Properties** section for `@property`-decorated members, showing `name → ReturnType`
- `ClassVar` attributes (previously silently dropped) are now rendered correctly — Pylance reports them as `SymbolKind.Constant`, which is now handled alongside `Variable` and `Field`
- Any tree view can now be exported to a local file via the **Export** button in the top-right toolbar. Clicking it opens a small dropdown with `svg` and `png` formats.

### Changed

- Fixed a parsing issue where classes declared with PEP 695 (Type Parameter Syntax Enhancement) notation got their inheritances ignored
- Fixed an issue where the tree rendering result were not being deterministic depending on the classes order returned by the VSCode API
- Improved element coloring (now identifies pipes (|), commas (,) and keyword arguments)
- Added strategies to mitigate zoom tool freezing in very large projects.

## [0.0.7] - 2026-05-13

### Changed

- Removed unnecessary file for building the extension package

## [0.0.6] - 2026-05-13

### Added

- Inheritance can now be changed directly from a tree view by dragging an inheritance arrow onto a different class — the change is written back to the source file, and a confirmation dialog is shown before any modification (with conflicts surfaced upfront when present)
- Trees can now identify abstract classes and methods, class methods and static methods;
- Class boxes now group members into labelled sections: **Attributes**, **Class Methods**, **Static Methods**, and **Methods**
- Added **Colors and Symbols** section to `README.md`

### Changed

- Webview generation calls now lookup for already opened webviews with the same envolved files versions before opening a new webview
- Cache optimizations

## [0.0.5] - 2026-05-09

### Changed

- Reduced extension size in 99.6% by referencing images and GIFs via GitHub raw links

## [0.0.4] - 2026-05-09

### Changed

- Updated `README.md` with no more zoom restriction

## [0.0.3] - 2026-05-09

### Added

- Added `CHANGELOG.md`

## [0.0.2] - 2026-05-08

### Added

- Added GIF tutorials for key features in `README.md`

### Changed

- Updated the extension icon
- Removed zoom restrictions from Webviews

## [0.0.1] - 2026-05-08

### Added

- Initial release of PyTree
    - Added **Simple Tree** (renders ancestors only)
    - Added **Complete Tree** (renders ancestors and descendants)
    - Added **Project Tree** (renders all project classes)
    - Added **Pick Classes** (allows selecting specific classes to render)
