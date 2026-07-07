import * as vscode from 'vscode';
import { ClassNode } from '../types';
import { scanWorkspaceClasses } from '../utils/scan';
import { Messages } from '../config';
import { resolveLayeredNodes } from '../utils/resolve';
import { collectAncestors, collectDescendants } from '../ui/utils/layering';
import { openWebview, PanelState } from '../utils/webview';
import { renderMultiTree } from '../ui/render/trees/pick';

export async function showPickClassesTree(context: vscode.ExtensionContext) {
    const treeTypeItem = await vscode.window.showQuickPick(
        [
            {
                label: Messages.commands.pickClasses.labels.simpleTree.title,
                description:
                    Messages.commands.pickClasses.labels.simpleTree.description,
            },
            {
                label: Messages.commands.pickClasses.labels.completeTree.title,
                description:
                    Messages.commands.pickClasses.labels.completeTree
                        .description,
            },
        ],
        { placeHolder: Messages.commands.pickClasses.labels.placeholder }
    );
    if (!treeTypeItem) {
        return;
    }
    const isComplete =
        treeTypeItem.label ===
        Messages.commands.pickClasses.labels.completeTree.title;

    let allClasses = new Map<string, ClassNode>();
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: Messages.status.scanningFiles,
            cancellable: false,
        },
        async progress => {
            allClasses = await scanWorkspaceClasses(progress);
        }
    );

    if (!allClasses.size) {
        vscode.window.showInformationMessage(Messages.errors.noClassesFound);
        return;
    }

    const workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const items = [...allClasses.values()].map(node => {
        const filePath = vscode.Uri.parse(node.fileUri).fsPath;
        const relPath = workspaceRoot
            ? filePath.replace(workspaceRoot + '/', '')
            : filePath;
        return { label: node.name, description: relPath, nodeId: node.id };
    });

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select classes to display',
        canPickMany: true,
    });
    if (!selected || selected.length === 0) {
        return;
    }

    const selectedIds = selected.map(s => s.nodeId);

    const computeState = async (): Promise<PanelState | null> => {
        const classes = await scanWorkspaceClasses();
        if (!classes.size) {
            return null;
        }
        const presentIds = selectedIds.filter(id => classes.has(id));
        if (!presentIds.length) {
            return null;
        }
        const trees = presentIds.map(id => {
            const focus = classes.get(id)!;
            const ancestorLayers = resolveLayeredNodes(
                collectAncestors(focus.id, classes),
                classes
            );
            const descendantLayers = isComplete
                ? resolveLayeredNodes(
                      collectDescendants(focus.id, classes),
                      classes
                  )
                : [];
            return { focus, ancestorLayers, descendantLayers };
        });
        const fileUris = [
            ...new Set([...classes.values()].map(n => n.fileUri)),
        ];
        return {
            html: renderMultiTree(trees),
            fileUris,
            classes,
        };
    };

    const state = await computeState();
    if (!state) {
        vscode.window.showInformationMessage(Messages.errors.noClassesFound);
        return;
    }
    const extraKey = [
        isComplete ? 'complete' : 'simple',
        ...selectedIds.slice().sort(),
    ].join('\0');
    await openWebview(
        context,
        'pytreePickedClasses',
        Messages.webView.titles.pickedClassesTree,
        state.html,
        state.fileUris,
        extraKey,
        computeState
    );
}
