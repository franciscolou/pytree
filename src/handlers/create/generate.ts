// Python source generation for the PyTree: Create board.
//
// Receives the user-built canvas (boxes, edges, modules) and emits one Python
// file per module. Classes inside the same module are emitted in topological
// order so bases declared in that module precede their derived classes; cross-
// module bases produce relative imports.

export interface CreateAttr {
    name: string;
    type: string;
    default: string;
    isProperty: boolean;
}

export interface CreateParam {
    name: string;
    type: string;
    default: string;
}

export interface CreateMethod {
    name: string;
    params: CreateParam[];
    returnType: string;
    isStatic: boolean;
    isClassMethod: boolean;
    isAbstract: boolean;
}

export interface CreateBox {
    id: string;
    name: string;
    isAbstract: boolean;
    attributes: CreateAttr[];
    methods: CreateMethod[];
    moduleId: string | null;
}

export interface CreateEdge {
    childId: string;
    parentId: string;
}

export interface CreateModule {
    id: string;
    relativePath: string;
    existingFileUri?: string;
}

export interface CreateBoardState {
    boxes: CreateBox[];
    edges: CreateEdge[];
    modules: CreateModule[];
}

export interface GeneratedFile {
    relativePath: string;
    content: string;
    appendToExisting: boolean;
    existingFileUri?: string;
}

interface ResolvedBoxModule {
    box: CreateBox;
    relativePath: string;
    isDefault: boolean;
    existingFileUri?: string;
}

const DEFAULT_MODULE_DIR = 'pytree';

function sanitizePyName(name: string): string {
    const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
    return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function defaultPathFor(box: CreateBox): string {
    return `${DEFAULT_MODULE_DIR}/${sanitizePyName(box.name) || 'Unnamed'}.py`;
}

function ensurePyExt(p: string): string {
    return p.endsWith('.py') ? p : `${p}.py`;
}

function moduleDottedFromPath(relPath: string): string {
    const noExt = relPath.replace(/\.py$/i, '');
    return noExt.split(/[\\/]+/).filter(Boolean).join('.');
}

function resolveBoxModules(state: CreateBoardState): Map<string, ResolvedBoxModule> {
    const moduleById = new Map(state.modules.map(m => [m.id, m]));
    const byId = new Map<string, ResolvedBoxModule>();
    for (const box of state.boxes) {
        const mod = box.moduleId ? moduleById.get(box.moduleId) : undefined;
        if (mod) {
            byId.set(box.id, {
                box,
                relativePath: ensurePyExt(mod.relativePath),
                isDefault: false,
                existingFileUri: mod.existingFileUri,
            });
        } else {
            byId.set(box.id, {
                box,
                relativePath: defaultPathFor(box),
                isDefault: true,
            });
        }
    }
    return byId;
}

function topoSortWithinModule(
    boxes: CreateBox[],
    edges: CreateEdge[]
): CreateBox[] {
    const ids = new Set(boxes.map(b => b.id));
    const childrenOf = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    for (const b of boxes) {
        inDeg.set(b.id, 0);
    }
    for (const e of edges) {
        if (!ids.has(e.childId) || !ids.has(e.parentId)) {
            continue;
        }
        if (!childrenOf.has(e.parentId)) {
            childrenOf.set(e.parentId, []);
        }
        childrenOf.get(e.parentId)!.push(e.childId);
        inDeg.set(e.childId, (inDeg.get(e.childId) ?? 0) + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDeg) {
        if (deg === 0) {
            queue.push(id);
        }
    }
    queue.sort();
    const order: CreateBox[] = [];
    const byId = new Map(boxes.map(b => [b.id, b]));
    while (queue.length > 0) {
        const id = queue.shift()!;
        order.push(byId.get(id)!);
        for (const child of childrenOf.get(id) ?? []) {
            const next = (inDeg.get(child) ?? 0) - 1;
            inDeg.set(child, next);
            if (next === 0) {
                queue.push(child);
            }
        }
    }
    // Stragglers (cycle) come last in id order — should never trigger because
    // the UI rejects edges that create cycles, but emit them rather than dropping.
    if (order.length < boxes.length) {
        const placed = new Set(order.map(b => b.id));
        for (const b of [...boxes].sort((a, b) => a.id.localeCompare(b.id))) {
            if (!placed.has(b.id)) {
                order.push(b);
            }
        }
    }
    return order;
}

function basesOf(boxId: string, edges: CreateEdge[]): string[] {
    return edges.filter(e => e.childId === boxId).map(e => e.parentId);
}

function classDeclaration(
    box: CreateBox,
    baseNames: string[]
): string {
    const bases = [...baseNames];
    if (box.isAbstract && !bases.some(b => b === 'ABC' || b.endsWith('.ABC'))) {
        bases.push('ABC');
    }
    const baseStr = bases.length ? `(${bases.join(', ')})` : '';
    return `class ${box.name}${baseStr}:`;
}

function renderAttributes(attrs: CreateAttr[]): string[] {
    return attrs.map(a => {
        const t = a.type ? `: ${a.type}` : '';
        const d = a.default ? ` = ${a.default}` : '';
        return `    ${a.name}${t}${d}`;
    });
}

function renderProperty(attr: CreateAttr): string {
    const ret = attr.type ? ` -> ${attr.type}` : '';
    return [
        `    @property`,
        `    def ${attr.name}(self)${ret}:`,
        `        ...`,
    ].join('\n');
}

function renderMethod(m: CreateMethod): string {
    const decorators: string[] = [];
    if (m.isStatic) {
        decorators.push('    @staticmethod');
    }
    if (m.isClassMethod) {
        decorators.push('    @classmethod');
    }
    if (m.isAbstract) {
        decorators.push('    @abstractmethod');
    }

    const fixedParams: CreateParam[] = [];
    const hasExplicitSelf = m.params.some(p => p.name === 'self' || p.name === 'cls');
    if (!hasExplicitSelf) {
        if (m.isStatic) {
            // no implicit param
        } else if (m.isClassMethod) {
            fixedParams.push({ name: 'cls', type: '', default: '' });
        } else {
            fixedParams.push({ name: 'self', type: '', default: '' });
        }
    }
    const allParams = [...fixedParams, ...m.params];
    const paramStr = allParams
        .map(p => {
            const t = p.type ? `: ${p.type}` : '';
            const d = p.default ? ` = ${p.default}` : '';
            return `${p.name}${t}${d}`;
        })
        .join(', ');
    const ret = m.returnType ? ` -> ${m.returnType}` : '';
    const sig = `    def ${m.name}(${paramStr})${ret}:`;
    const body = m.isAbstract ? '        ...' : '        ...';
    return [...decorators, sig, body].join('\n');
}

function relativeImport(fromPath: string, toPath: string, name: string): string {
    const fromParts = fromPath.replace(/\.py$/i, '').split(/[\\/]+/).filter(Boolean);
    const toParts = toPath.replace(/\.py$/i, '').split(/[\\/]+/).filter(Boolean);
    // Strip the file from `from` so we end up at the directory level.
    fromParts.pop();
    // Find common prefix.
    let common = 0;
    while (
        common < fromParts.length &&
        common < toParts.length - 1 &&
        fromParts[common] === toParts[common]
    ) {
        common++;
    }
    const upSteps = fromParts.length - common;
    const downParts = toParts.slice(common);
    const dots = '.'.repeat(upSteps + 1);
    const modulePart = downParts.join('.');
    return `from ${dots}${modulePart} import ${name}`;
}

function absoluteImport(toPath: string, name: string): string {
    return `from ${moduleDottedFromPath(toPath)} import ${name}`;
}

function buildImports(
    boxesInFile: CreateBox[],
    edges: CreateEdge[],
    resolved: Map<string, ResolvedBoxModule>,
    filePath: string,
    fileBoxIds: Set<string>
): string[] {
    const lines = new Set<string>();
    const needsAbc = boxesInFile.some(
        b => b.isAbstract || b.methods.some(m => m.isAbstract)
    );
    if (needsAbc) {
        const items: string[] = [];
        if (boxesInFile.some(b => b.isAbstract)) {
            items.push('ABC');
        }
        if (boxesInFile.some(b => b.methods.some(m => m.isAbstract))) {
            items.push('abstractmethod');
        }
        lines.add(`from abc import ${items.join(', ')}`);
    }

    for (const box of boxesInFile) {
        for (const parentId of basesOf(box.id, edges)) {
            if (fileBoxIds.has(parentId)) {
                continue;
            }
            const parent = resolved.get(parentId);
            if (!parent) {
                continue;
            }
            const importLine = relativeImport(
                filePath,
                parent.relativePath,
                parent.box.name
            );
            lines.add(importLine);
        }
    }

    return [...lines].sort();
}

function renderClass(
    box: CreateBox,
    bases: string[]
): string {
    const lines: string[] = [];
    lines.push(classDeclaration(box, bases));

    const classAttrs = box.attributes.filter(a => !a.isProperty);
    const propAttrs = box.attributes.filter(a => a.isProperty);

    const classMethods = box.methods.filter(m => m.isClassMethod);
    const staticMethods = box.methods.filter(m => m.isStatic);
    const regularMethods = box.methods.filter(
        m => !m.isClassMethod && !m.isStatic
    );

    const blocks: string[] = [];

    if (classAttrs.length) {
        blocks.push(renderAttributes(classAttrs).join('\n'));
    }
    for (const p of propAttrs) {
        blocks.push(renderProperty(p));
    }
    for (const m of classMethods) {
        blocks.push(renderMethod(m));
    }
    for (const m of staticMethods) {
        blocks.push(renderMethod(m));
    }
    for (const m of regularMethods) {
        blocks.push(renderMethod(m));
    }

    if (blocks.length === 0) {
        lines[lines.length - 1] += ' ...';
    } else {
        lines.push(blocks.join('\n\n'));
    }

    return lines.join('\n');
}

export function generateFiles(state: CreateBoardState): GeneratedFile[] {
    const resolved = resolveBoxModules(state);

    // Group boxes by output file path.
    const byPath = new Map<string, { boxes: CreateBox[]; existingFileUri?: string }>();
    for (const r of resolved.values()) {
        if (!byPath.has(r.relativePath)) {
            byPath.set(r.relativePath, {
                boxes: [],
                existingFileUri: r.existingFileUri,
            });
        }
        byPath.get(r.relativePath)!.boxes.push(r.box);
    }

    const files: GeneratedFile[] = [];
    for (const [relPath, group] of byPath.entries()) {
        const fileBoxIds = new Set(group.boxes.map(b => b.id));
        const ordered = topoSortWithinModule(group.boxes, state.edges);

        const importLines = buildImports(
            ordered,
            state.edges,
            resolved,
            relPath,
            fileBoxIds
        );

        const classBlocks: string[] = [];
        for (const box of ordered) {
            const parentIds = basesOf(box.id, state.edges);
            const baseNames = parentIds
                .map(pid => resolved.get(pid)?.box.name)
                .filter((n): n is string => Boolean(n));
            classBlocks.push(renderClass(box, baseNames));
        }

        const sections: string[] = [];
        if (importLines.length) {
            sections.push(importLines.join('\n'));
        }
        sections.push(classBlocks.join('\n\n\n'));

        files.push({
            relativePath: relPath,
            content: sections.join('\n\n\n') + '\n',
            appendToExisting: Boolean(group.existingFileUri),
            existingFileUri: group.existingFileUri,
        });
    }

    return files;
}

// Helper: derive a flat, dot-style absolute import (currently unused — kept for
// potential cross-package imports). Suppress unused-vars lint when needed.
export const _absoluteImport = absoluteImport;
