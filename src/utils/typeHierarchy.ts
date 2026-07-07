import * as vscode from 'vscode';
import { ClassNode } from '../types';
import { extractClasses } from './parser';
import { layerByLongestPath } from '../ui/utils/layering';

// Pylance resolves every Python stdlib/builtin type (object, str,
// BaseException, abc.ABC, typing.Protocol, …) to a stub under
// `dist/typeshed-fallback/stdlib/`. Other LSPs that consume typeshed follow
// the same `typeshed/stdlib/` convention. Third-party stubs live under
// `typeshed/stubs/<pkg>/` and are intentionally left untouched so library
// ancestors stay visible.
const STDLIB_STUB_PATH =
    /[\/\\](?:typeshed-fallback|typeshed)[\/\\]stdlib[\/\\]/;

function isPythonStdlib(item: vscode.TypeHierarchyItem): boolean {
    return STDLIB_STUB_PATH.test(item.uri.path);
}

function itemKey(item: vscode.TypeHierarchyItem): string {
    return `${item.uri.toString()}#${item.selectionRange.start.line}`;
}

// Scans forward from startLine to find the line where `class <name>` appears,
// handling decorators that precede the actual class declaration.
function findClassPosition(
    doc: vscode.TextDocument,
    startLine: number,
    className: string
): vscode.Position | undefined {
    const limit = Math.min(startLine + 10, doc.lineCount);
    for (let l = startLine; l < limit; l++) {
        const text = doc.lineAt(l).text;
        const classIdx = text.indexOf('class');
        if (classIdx < 0) {
            continue;
        }
        const nameIdx = text.indexOf(className, classIdx + 5);
        if (nameIdx >= 0) {
            return new vscode.Position(l, nameIdx);
        }
    }
    return undefined;
}

export async function prepareTypeHierarchyAt(
    node: ClassNode
): Promise<vscode.TypeHierarchyItem | undefined> {
    const uri = vscode.Uri.parse(node.fileUri);
    const doc = await vscode.workspace.openTextDocument(uri);
    const pos = findClassPosition(doc, node.definedAtLine, node.name);
    if (!pos) {
        return undefined;
    }

    const items = await vscode.commands.executeCommand<
        vscode.TypeHierarchyItem[]
    >('vscode.prepareTypeHierarchy', uri, pos);
    if (!items || items.length === 0) {
        return undefined;
    }
    return items.find(it => it.name === node.name) ?? items[0];
}

// BFS that traverses the type hierarchy in one direction, tracking structure.
// Returns:
//   items   — all visited nodes (including root), keyed by itemKey
//   edges   — adjacency in traversal direction (from → to), keyed by itemKey
//   fileUris — URIs of non-root items that passed the filter
async function bfsTypeHierarchy(
    rootItem: vscode.TypeHierarchyItem,
    command: 'vscode.provideSupertypes',
    accept: (item: vscode.TypeHierarchyItem) => boolean
): Promise<{
    items: Map<string, vscode.TypeHierarchyItem>;
    edges: Map<string, string[]>;
    fileUris: Set<string>;
}> {
    const items = new Map<string, vscode.TypeHierarchyItem>();
    const edges = new Map<string, string[]>();
    const fileUris = new Set<string>();

    const rootKey = itemKey(rootItem);
    items.set(rootKey, rootItem);

    let frontier = [rootItem];
    while (frontier.length > 0) {
        const results = await Promise.all(
            frontier.map(it =>
                vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>(
                    command,
                    it
                )
            )
        );
        const next: vscode.TypeHierarchyItem[] = [];
        for (let i = 0; i < frontier.length; i++) {
            const fromKey = itemKey(frontier[i]);
            const neighbours: string[] = [];
            for (const nb of results[i] ?? []) {
                if (!accept(nb)) {
                    continue;
                }
                const key = itemKey(nb);
                neighbours.push(key);
                if (!items.has(key)) {
                    items.set(key, nb);
                    fileUris.add(nb.uri.toString());
                    next.push(nb);
                }
            }
            edges.set(fromKey, neighbours);
        }
        frontier = next;
    }

    return { items, edges, fileUris };
}

// Extracts ClassNodes from the given file URIs into `classes`.
// Returns a secondary lookup keyed by "uriStr#className" for decorator-safe
// matching against TypeHierarchyItems (whose selectionRange.start.line may
// differ from ClassNode.definedAtLine when decorators are present).
async function extractIntoClasses(
    fileUris: Set<string>,
    classes: Map<string, ClassNode>
): Promise<Map<string, ClassNode>> {
    const byUriName = new Map<string, ClassNode>();
    for (const uriStr of fileUris) {
        try {
            const doc = await vscode.workspace.openTextDocument(
                vscode.Uri.parse(uriStr)
            );
            const local = await extractClasses(doc);
            for (const [id, n] of local) {
                if (!classes.has(id)) {
                    classes.set(id, n);
                }
                byUriName.set(`${uriStr}#${n.name}`, n);
            }
        } catch {
            // skip unreadable files
        }
    }
    return byUriName;
}

// Converts the BFS result into ClassNode[][] using longestPathLayers on the
// recorded edges. The focusNode is mapped to the root key directly.
function buildLayersFromBfs(
    rootKey: string,
    items: Map<string, vscode.TypeHierarchyItem>,
    edges: Map<string, string[]>,
    byUriName: Map<string, ClassNode>,
    focusNode: ClassNode
): ClassNode[][] {
    const relatedKeys = new Set(
        [...items.keys()].filter(k => k !== rootKey)
    );
    if (relatedKeys.size === 0) {
        return [];
    }

    const keyToNode = new Map<string, ClassNode>([[rootKey, focusNode]]);
    for (const [key, item] of items) {
        if (key === rootKey) {
            continue;
        }
        const n = byUriName.get(`${item.uri.toString()}#${item.name}`);
        if (n) {
            keyToNode.set(key, n);
        }
    }

    const layers = layerByLongestPath(
        rootKey,
        relatedKeys,
        id => edges.get(id) ?? []
    );

    return layers.map(layer =>
        layer
            .map(k => keyToNode.get(k))
            .filter((n): n is ClassNode => n !== undefined)
    );
}

// Walks supertypes via Pylance, populates `classes` with ancestor ClassNodes,
// and returns them as longest-path layers (layer 0 = direct parents).
// Python stdlib/builtin types (object, str, BaseException, …) are filtered out
// so they don't clutter every tree; third-party library ancestors are kept.
export async function buildAncestorLayers(
    rootItem: vscode.TypeHierarchyItem,
    focusNode: ClassNode,
    classes: Map<string, ClassNode>
): Promise<ClassNode[][]> {
    const { items, edges, fileUris } = await bfsTypeHierarchy(
        rootItem,
        'vscode.provideSupertypes',
        item => !isPythonStdlib(item)
    );
    const byUriName = await extractIntoClasses(fileUris, classes);
    return buildLayersFromBfs(
        itemKey(rootItem),
        items,
        edges,
        byUriName,
        focusNode
    );
}

