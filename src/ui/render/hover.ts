import type { ClassNode } from '../../types';
import { Messages } from '../../config';

const { brand, icons, labels, descriptions } = Messages.hover;

export function renderClassHover(node: ClassNode): string {
    const ref = encodeURIComponent(
        JSON.stringify([{ fileUri: node.fileUri, line: node.definedAtLine }])
    );

    const option = (
        icon: string,
        label: string,
        description: string,
        command: string
    ): string =>
        `$(${icon}) [**${label}**](command:${command}?${ref})  \n` +
        `&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;_${description}_`;

    return [
        `$(${icons.brand}) **${brand}**`,
        '',
        option(
            icons.showClassTree,
            labels.showClassTree,
            descriptions.showClassTree,
            'pytree.showClassTree'
        ),
        '',
        option(
            icons.showCompleteTree,
            labels.showCompleteTree,
            descriptions.showCompleteTree,
            'pytree.showCompleteClassTree'
        ),
    ].join('\n');
}
