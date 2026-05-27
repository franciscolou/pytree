export interface GroupProps {
    id?: string;
    transform?: string;
    className?: string;
    clipPath?: string;
    dataPtBox?: boolean;
    dataPtBoxId?: string;
    // Pre-transform box coordinates in viewport-space. Emitted only when set
    // (lazy mode) so the hydration script can compute screen visibility from
    // (tx, ty, scale) without touching layout via getBoundingClientRect.
    dataPtX?: number;
    dataPtY?: number;
    dataPtW?: number;
    dataPtH?: number;
    children: string;
}

function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

export function Group({
    id,
    transform,
    className,
    clipPath,
    dataPtBox,
    dataPtBoxId,
    dataPtX,
    dataPtY,
    dataPtW,
    dataPtH,
    children,
}: GroupProps): string {
    const attrs = [
        id ? `id="${id}"` : '',
        transform ? `transform="${transform}"` : '',
        className ? `class="${className}"` : '',
        clipPath ? `clip-path="${clipPath}"` : '',
        dataPtBox ? 'data-pt-box' : '',
        dataPtBoxId ? `data-pt-box-id="${escapeAttr(dataPtBoxId)}"` : '',
        dataPtX !== undefined ? `data-pt-x="${dataPtX}"` : '',
        dataPtY !== undefined ? `data-pt-y="${dataPtY}"` : '',
        dataPtW !== undefined ? `data-pt-w="${dataPtW}"` : '',
        dataPtH !== undefined ? `data-pt-h="${dataPtH}"` : '',
    ]
        .filter(Boolean)
        .join(' ');
    return `<g${attrs ? ' ' + attrs : ''}>${children}</g>`;
}
