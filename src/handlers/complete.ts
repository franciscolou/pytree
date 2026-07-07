import * as vscode from 'vscode';
import { openWebview, PanelState } from '../utils/webview';
import { resolveClassNode, resolveLayeredNodes } from '../utils/resolve';
import { Messages } from '../config';
import { extractClasses } from '../utils/parser';
import { scanWorkspaceClasses } from '../utils/scan';
import { collectDescendants } from '../ui/utils/layering';
import {
    buildAncestorLayers,
    prepareTypeHierarchyAt,
} from '../utils/typeHierarchy';
import { renderClassTree } from '../ui/render/trees/single';
import { ClassRef } from '../types';

export async function showCompleteClassTree(
    context: vscode.ExtensionContext,
    ref?: ClassRef
) {
    const focusNode = await resolveClassNode(ref);
    if (!focusNode) {
        vscode.window.showInformationMessage(Messages.errors.noClassUnderCursor);
        return;
    }

    const focusRef: ClassRef = {
        fileUri: focusNode.fileUri,
        line: focusNode.definedAtLine,
    };

    const computeState = async (
        progress?: vscode.Progress<{ message?: string; increment?: number }>
    ): Promise<PanelState | null> => {
        const node = await resolveClassNode(focusRef);
        if (!node) {
            return null;
        }
        const document = await vscode.workspace.openTextDocument(
            vscode.Uri.parse(node.fileUri)
        );
        const classes = await extractClasses(document);
        const rootItem = await prepareTypeHierarchyAt(node);
        if (!rootItem) {
            vscode.window.showInformationMessage(Messages.errors.pylanceRequired);
            return null;
        }

        // Ancestors: Pylance's `provideSupertypes` is reliable because the
        // focus file (and its imports) are already loaded into the index.
        const ancestors = await buildAncestorLayers(rootItem, node, classes);

        // Descendants: Pylance's `provideSubtypes` returns only what Pyright
        // has type-checked, which on large repos like Django is incomplete
        // even with `diagnosticMode: workspace` after a full reindex. Fall
        // back to the same workspace-scan strategy used by the Project Tree.
        const allClasses = await scanWorkspaceClasses(progress);
        for (const [id, n] of allClasses) {
            if (!classes.has(id)) {
                classes.set(id, n);
            }
        }
        const descendants = resolveLayeredNodes(
            collectDescendants(node.id, classes),
            classes
        );

        // Only the files of classes actually drawn in this tree gate panel
        // reuse — not every file in the workspace scan. The full `classes`
        // map is still handed to the panel for inheritance-edit validation.
        const treeFiles = new Set<string>([node.fileUri]);
        for (const layer of [...ancestors, ...descendants]) {
            for (const n of layer) {
                treeFiles.add(n.fileUri);
            }
        }
        const fileUris = [...treeFiles];
        return {
            html: renderClassTree(node, ancestors, descendants),
            fileUris,
            classes,
        };
    };

    let state: PanelState | null = null;
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: Messages.status.scanningFiles,
            cancellable: false,
        },
        async reporter => {
            state = await computeState(reporter);
        }
    );

    if (!state) {
        return;
    }
    const finalState: PanelState = state;

    await openWebview(
        context,
        'pytreeClassTree',
        Messages.webView.titles.completeClassTree(focusNode.name),
        finalState.html,
        finalState.fileUris,
        'complete:' + focusNode.id,
        () => computeState()
    );
}
