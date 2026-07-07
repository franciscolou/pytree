import * as vscode from 'vscode';
import { ClassNode } from '../types';
import { scanWorkspaceClasses } from '../utils/scan';
import { Messages } from '../config';
import {
    buildComponentLayers,
    buildConnectedComponents,
    collectAncestors,
    collectDescendants,
} from '../ui/utils/layering';
import { openWebview, PanelState } from '../utils/webview';
import { renderProjectTree } from '../ui/render/trees/project';
import type { FilterInfo } from '../ui/components/WebViewOptions';

type FilterMode = 'include' | 'exclude';

const EXCLUDE_GLOB =
    '{**/node_modules/**,**/.venv/**,**/venv/**,**/__pycache__/**,**/.git/**,**/site-packages/**}';

function workspaceRoot(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
}

function toRelative(absPath: string): string {
    const root = workspaceRoot();
    if (!root) {
        return absPath;
    }
    if (absPath === root) {
        return '.';
    }
    if (absPath.startsWith(root + '/')) {
        return absPath.slice(root.length + 1);
    }
    if (absPath.startsWith(root + '\\')) {
        return absPath.slice(root.length + 1);
    }
    return absPath;
}

function isInside(fileFsPath: string, selectedFsPath: string): boolean {
    if (fileFsPath === selectedFsPath) {
        return true;
    }
    const sep = selectedFsPath.includes('\\') ? '\\' : '/';
    const prefix = selectedFsPath.endsWith(sep)
        ? selectedFsPath
        : selectedFsPath + sep;
    return fileFsPath.startsWith(prefix);
}

function isClassInPaths(node: ClassNode, paths: string[]): boolean {
    const filePath = vscode.Uri.parse(node.fileUri).fsPath;
    return paths.some(p => isInside(filePath, p));
}

interface CommandTexts {
    labels: {
        placeholder: string;
        simpleTree: { title: string; description: string };
        completeTree: { title: string; description: string };
    };
    picker: { title: string; placeholder: string };
    errors: { empty: string; noneSelected: string };
    badgeMode: 'include' | 'exclude';
}

async function pickComplete(texts: CommandTexts): Promise<boolean | undefined> {
    const items = [
        {
            label: texts.labels.simpleTree.title,
            description: texts.labels.simpleTree.description,
            isComplete: false,
        },
        {
            label: texts.labels.completeTree.title,
            description: texts.labels.completeTree.description,
            isComplete: true,
        },
    ];
    const picked = await vscode.window.showQuickPick(items, {
        placeHolder: texts.labels.placeholder,
    });
    return picked?.isComplete;
}

interface PathItem extends vscode.QuickPickItem {
    fsPath: string;
}

async function buildPathItems(): Promise<PathItem[]> {
    const root = workspaceRoot();
    const files = await vscode.workspace.findFiles('**/*.py', EXCLUDE_GLOB);

    const folderSet = new Set<string>();
    for (const file of files) {
        const rel = toRelative(file.fsPath);
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) {
            folderSet.add(parts.slice(0, i).join('/'));
        }
    }

    const folderItems: PathItem[] = [...folderSet].sort().map(rel => ({
        label: `$(folder) ${rel}/`,
        description: 'folder',
        fsPath: root ? `${root}/${rel}` : rel,
    }));

    const fileItems: PathItem[] = files
        .map(uri => ({ uri, rel: toRelative(uri.fsPath) }))
        .sort((a, b) => a.rel.localeCompare(b.rel))
        .map(({ uri, rel }) => ({
            label: `$(file) ${rel}`,
            description: 'file',
            fsPath: uri.fsPath,
        }));

    return [...folderItems, ...fileItems];
}

async function pickPaths(texts: CommandTexts): Promise<string[] | undefined> {
    const items = await buildPathItems();
    if (items.length === 0) {
        vscode.window.showInformationMessage(Messages.errors.noClassesFound);
        return undefined;
    }

    const qp = vscode.window.createQuickPick<PathItem>();
    qp.items = items;
    qp.canSelectMany = true;
    qp.title = texts.picker.title;
    qp.placeholder = texts.picker.placeholder;
    qp.matchOnDescription = true;

    return new Promise<string[] | undefined>(resolve => {
        let resolved = false;
        qp.onDidAccept(() => {
            if (resolved) {
                return;
            }
            const picked = qp.selectedItems.map(i => i.fsPath);
            resolved = true;
            qp.hide();
            if (picked.length === 0) {
                vscode.window.showInformationMessage(texts.errors.noneSelected);
                resolve(undefined);
            } else {
                resolve(picked);
            }
        });
        qp.onDidHide(() => {
            if (!resolved) {
                resolved = true;
                resolve(undefined);
            }
            qp.dispose();
        });
        qp.show();
    });
}

function buildIncludedClasses(
    filterMode: FilterMode,
    isComplete: boolean,
    allClasses: Map<string, ClassNode>,
    paths: string[]
): Map<string, ClassNode> {
    const included = new Map<string, ClassNode>();

    const focusIds: string[] = [];
    for (const [id, node] of allClasses) {
        const inPaths = isClassInPaths(node, paths);
        const isFocus = filterMode === 'include' ? inPaths : !inPaths;
        if (isFocus) {
            focusIds.push(id);
            included.set(id, node);
        }
    }

    const isAllowed = (node: ClassNode): boolean =>
        filterMode === 'include' ? true : !isClassInPaths(node, paths);

    const addLayers = (layers: string[][]): void => {
        for (const layer of layers) {
            for (const id of layer) {
                const node = allClasses.get(id);
                if (node && isAllowed(node)) {
                    included.set(id, node);
                }
            }
        }
    };

    for (const focusId of focusIds) {
        addLayers(collectAncestors(focusId, allClasses));
        if (isComplete) {
            addLayers(collectDescendants(focusId, allClasses));
        }
    }

    return included;
}

function buildFilterInfo(
    badgeMode: 'include' | 'exclude',
    paths: string[]
): FilterInfo {
    return {
        mode: badgeMode,
        paths: paths.map(toRelative).sort(),
    };
}

async function showPathFilteredTree(
    context: vscode.ExtensionContext,
    filterMode: FilterMode,
    texts: CommandTexts,
    viewType: string,
    title: string
): Promise<void> {
    const isComplete = await pickComplete(texts);
    if (isComplete === undefined) {
        return;
    }

    const paths = await pickPaths(texts);
    if (!paths) {
        return;
    }

    const filterInfo = buildFilterInfo(texts.badgeMode, paths);

    const computeState = async (
        progress?: vscode.Progress<{
            message?: string;
            increment?: number;
        }>
    ): Promise<PanelState | null> => {
        const allClasses = await scanWorkspaceClasses(progress);
        if (!allClasses.size) {
            return null;
        }
        const included = buildIncludedClasses(
            filterMode,
            isComplete,
            allClasses,
            paths
        );
        if (!included.size) {
            return null;
        }
        const components = buildConnectedComponents(included);
        const componentLayers = components.map(comp =>
            buildComponentLayers(comp)
        );
        const fileUris = [
            ...new Set([...included.values()].map(n => n.fileUri)),
        ];
        return {
            html: renderProjectTree(componentLayers, included, filterInfo),
            fileUris,
            classes: included,
        };
    };

    let state: PanelState | null = null;
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: Messages.status.scanningFiles,
            cancellable: false,
        },
        async progress => {
            state = await computeState(progress);
        }
    );

    if (!state) {
        vscode.window.showInformationMessage(texts.errors.empty);
        return;
    }
    const finalState: PanelState = state;

    const extraKey = [
        filterMode,
        isComplete ? 'complete' : 'simple',
        ...paths.slice().sort(),
    ].join('\0');
    await openWebview(
        context,
        viewType,
        title,
        finalState.html,
        finalState.fileUris,
        extraKey,
        () => computeState()
    );
}

export async function showPickPathsTree(context: vscode.ExtensionContext) {
    const cfg = Messages.commands.pickPaths;
    await showPathFilteredTree(
        context,
        'include',
        {
            labels: cfg.labels,
            picker: cfg.picker,
            errors: {
                empty: cfg.errors.noClassesInPaths,
                noneSelected: cfg.errors.noneSelected,
            },
            badgeMode: 'include',
        },
        'pytreePickedPaths',
        Messages.webView.titles.pickedPathsTree
    );
}

export async function showAllExceptTree(context: vscode.ExtensionContext) {
    const cfg = Messages.commands.allExcept;
    await showPathFilteredTree(
        context,
        'exclude',
        {
            labels: cfg.labels,
            picker: cfg.picker,
            errors: {
                empty: cfg.errors.noClassesAfterExclude,
                noneSelected: cfg.errors.noneSelected,
            },
            badgeMode: 'exclude',
        },
        'pytreeAllExcept',
        Messages.webView.titles.allExceptTree
    );
}
