import * as vscode from 'vscode';
import { getClassUnderCursor } from '../utils/resolve';
import { renderClassHover } from '../ui/render/hover';

export const HoverProvider: vscode.HoverProvider = {
    async provideHover(document, position) {
        const node = await getClassUnderCursor(document, position);

        if (!node) {
            return;
        }

        const md = new vscode.MarkdownString(renderClassHover(node));

        md.isTrusted = true;
        md.supportThemeIcons = true;

        return new vscode.Hover(md);
    },
};
