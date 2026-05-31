import type {
    ClassNode,
    RenderedBox,
    MethodDef,
    MethodParam,
    PropDef,
} from '../../types';
import { Theme, UI, Messages } from '../../config';
import {
    ClassBox,
    Line,
    Text,
    TSpan,
    NavGroup,
    ClipPath,
    Group,
} from '../components';

let _workspaceUri = '';
export function setWorkspaceUri(uri: string): void {
    _workspaceUri = uri.replace(/\/?$/, '');
}

type InheritedNames = {
    attrs: Set<string>;
    props: Set<string>;
    methods: Set<string>;
};

// Memoized per `ClassNode` object. The result depends on the node plus the
// ancestor membership of `allNodes`, so the cached entry is keyed by node
// identity and guarded on the `allNodes` map identity (each render/tree builds
// its own map). `ClassNode`s are rebuilt on every parse, so stale objects are
// dropped by the WeakMap without any explicit invalidation.
const inheritedCache = new WeakMap<
    ClassNode,
    { allNodes: Map<string, ClassNode>; value: InheritedNames }
>();

export function collectInheritedNames(
    node: ClassNode,
    allNodes: Map<string, ClassNode>
): InheritedNames {
    const cached = inheritedCache.get(node);
    if (cached && cached.allNodes === allNodes) {
        return cached.value;
    }
    const attrs = new Set<string>();
    const props = new Set<string>();
    const methods = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = node.bases
        .map(b => b.id)
        .filter((id): id is string => id !== undefined);
    while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) {
            continue;
        }
        visited.add(id);
        const base = allNodes.get(id);
        if (!base) {
            continue;
        }
        for (const attr of base.attributes) {
            attrs.add(attr.name);
        }
        for (const prop of base.properties) {
            props.add(prop.name);
        }
        for (const method of base.methods) {
            methods.add(method.name);
        }
        for (const b of base.bases) {
            if (b.id) {
                stack.push(b.id);
            }
        }
    }
    const value: InheritedNames = { attrs, props, methods };
    inheritedCache.set(node, { allNodes, value });
    return value;
}

function renderParamName(name: string, color: string): string {
    const stars = name.match(/^\*+/)?.[0] ?? '';
    return stars
        ? TSpan({ fill: Theme.colors.text, children: stars }) +
              TSpan({ fill: color, children: name.slice(stars.length) })
        : TSpan({ fill: color, children: name });
}

function renderTypeSpans(typeStr: string): string {
    const tokens = typeStr.split(/((?:'[^']*')|(?:"[^"]*")|[\[\]|,])/);
    return tokens
        .map(token => {
            if (!token) {
                return '';
            }
            if (
                (token.startsWith("'") && token.endsWith("'")) ||
                (token.startsWith('"') && token.endsWith('"'))
            ) {
                return TSpan({ fill: Theme.colors.string, children: token });
            }
            if (
                token === '[' ||
                token === ']' ||
                token === '|' ||
                token === ','
            ) {
                return TSpan({ fill: Theme.colors.text, children: token });
            }
            return TSpan({ fill: Theme.colors.type, children: token });
        })
        .join('');
}

const BOOL_KEYWORDS = new Set(['True', 'False', 'None', 'and', 'or']);
const PY_KEYWORDS = new Set(['not', 'in', 'is', 'lambda', 'if', 'else', 'for']);

function escapeXml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderPythonValue(expr: string): string {
    type Tok = { text: string; color: string };
    const toks: Tok[] = [];
    let i = 0;

    while (i < expr.length) {
        // String prefix + literal
        const strPfx = expr.slice(i).match(/^[fFbBrRuU]{0,2}(?:'{3}|"{3}|'|")/);
        if (strPfx) {
            const raw = strPfx[0];
            const q = raw.endsWith("'''")
                ? "'''"
                : raw.endsWith('"""')
                  ? '"""'
                  : raw.slice(-1);
            let j = i + raw.length;
            while (j < expr.length) {
                if (expr.startsWith(q, j)) {
                    j += q.length;
                    break;
                }
                if (expr[j] === '\\') {
                    j++;
                }
                j++;
            }
            const pfxLen = raw.length - q.length;
            if (pfxLen > 0) {
                toks.push({
                    text: escapeXml(expr.slice(i, i + pfxLen)),
                    color: Theme.colors.bool,
                });
            }
            toks.push({
                text: escapeXml(expr.slice(i + pfxLen, j)),
                color: Theme.colors.string,
            });
            i = j;
            continue;
        }

        // Number
        if (
            /[0-9]/.test(expr[i]) ||
            (expr[i] === '.' && /[0-9]/.test(expr[i + 1] ?? ''))
        ) {
            if (expr[i] === '0' && /[xXbBoO]/.test(expr[i + 1] ?? '')) {
                let j = i + 2;
                while (j < expr.length && /[0-9a-fA-F_]/.test(expr[j])) {
                    j++;
                }
                toks.push({
                    text: expr.slice(i, j),
                    color: Theme.colors.number,
                });
                i = j;
            } else {
                let p = i;
                while (p < expr.length && /[0-9_]/.test(expr[p])) {
                    p++;
                }
                if (p > i) {
                    toks.push({
                        text: expr.slice(i, p),
                        color: Theme.colors.number,
                    });
                }
                i = p;
                if (i < expr.length && expr[i] === '.') {
                    toks.push({ text: '.', color: Theme.colors.text });
                    i++;
                    p = i;
                    while (p < expr.length && /[0-9_]/.test(expr[p])) {
                        p++;
                    }
                    if (p > i) {
                        toks.push({
                            text: expr.slice(i, p),
                            color: Theme.colors.number,
                        });
                    }
                    i = p;
                }
                if (i < expr.length && /[eE]/.test(expr[i])) {
                    p = i + 1;
                    if (p < expr.length && /[+\-]/.test(expr[p])) {
                        p++;
                    }
                    while (p < expr.length && /[0-9_]/.test(expr[p])) {
                        p++;
                    }
                    toks.push({
                        text: expr.slice(i, p),
                        color: Theme.colors.number,
                    });
                    i = p;
                }
                if (i < expr.length && /[jJ]/.test(expr[i])) {
                    toks.push({ text: expr[i], color: Theme.colors.text });
                    i++;
                }
            }
            continue;
        }

        // Identifier / keyword
        if (/[a-zA-Z_]/.test(expr[i])) {
            let j = i;
            while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) {
                j++;
            }
            const word = expr.slice(i, j);
            const color = BOOL_KEYWORDS.has(word)
                ? Theme.colors.bool
                : PY_KEYWORDS.has(word)
                  ? Theme.colors.bool
                  : /[(\[]/.test(expr[j] ?? '')
                    ? Theme.colors.method
                    : expr[j] === '.'
                      ? Theme.colors.type
                      : expr[j] === '=' && expr[j + 1] !== '='
                        ? Theme.colors.attribute
                        : Theme.colors.text;
            toks.push({ text: word, color });
            i = j;
            continue;
        }

        toks.push({ text: escapeXml(expr[i]), color: Theme.colors.text });
        i++;
    }

    // Merge adjacent same-color tokens
    const merged: Tok[] = [];
    for (const tok of toks) {
        if (merged.length && merged[merged.length - 1].color === tok.color) {
            merged[merged.length - 1].text += tok.text;
        } else {
            merged.push({ ...tok });
        }
    }
    return merged
        .map(tok => TSpan({ fill: tok.color, children: tok.text }))
        .join('');
}

export interface MethodLayout {
    wrapped: boolean;
    measureLines: string[];
}

export function computeMethodLayouts(
    methods: MethodDef[],
    wrapAt: number
): MethodLayout[] {
    const indentStr = '    ';
    return methods.map(method => {
        const prefix = method.isAbstract
            ? `${Messages.ui.abstractIndicator} `
            : '';
        const fmtParam = (param: MethodParam) =>
            `${param.name}${param.type ? `: ${param.type}` : ''}${param.defaultValue !== undefined ? ` = ${param.defaultValue}` : ''}`;
        const singleLine =
            prefix +
            `${method.name}(${method.params.map(fmtParam).join(', ')})` +
            `${method.returnType ? ` -> ${method.returnType}` : ''}`;
        if (singleLine.length <= wrapAt) {
            return { wrapped: false, measureLines: [singleLine] };
        }
        return {
            wrapped: true,
            measureLines: [
                `${prefix}${method.name}(`,
                ...method.params.map(
                    param => `${indentStr}${fmtParam(param)},`
                ),
                `) -> ${method.returnType ?? ''}`,
            ],
        };
    });
}

function computeFilePathLines(fileUri: string, boxWidth: number): string[] {
    const { sidePadding, filePathCharWidth } = UI.box;
    const maxChars = Math.floor((boxWidth - sidePadding) / filePathCharWidth);
    const absPath = decodeURIComponent(fileUri.replace(/^file:\/\//, ''));
    const wsPath = _workspaceUri
        ? decodeURIComponent(_workspaceUri.replace(/^file:\/\//, ''))
        : '';
    const path =
        wsPath && absPath.startsWith(wsPath)
            ? absPath.slice(wsPath.length) || '/'
            : absPath;
    if (path.length <= maxChars) {
        return [path];
    }
    const lines: string[] = [];
    let remaining = path;
    while (remaining.length > maxChars) {
        let breakAt = remaining.lastIndexOf('/', maxChars);
        if (breakAt <= 0) {
            breakAt = maxChars;
        } else {
            breakAt++;
        }
        lines.push(remaining.slice(0, breakAt));
        remaining = remaining.slice(breakAt);
    }
    if (remaining) {
        lines.push(remaining);
    }
    return lines.slice(0, 3);
}

function filePathSectionHeight(lines: string[]): number {
    return (
        UI.box.filePathPadding * 2 + lines.length * UI.box.filePathLineHeight
    );
}

export function computeBoxWidth(
    node: ClassNode,
    layouts: MethodLayout[]
): number {
    const { minWidth, maxWidth, charWidth, sidePadding } = UI.box;
    const attrTexts = node.attributes.flatMap(attr => {
        const base = attr.type
            ? `${attr.name}: ${attr.type}`
            : `${attr.name} = ${attr.defaultValue ?? ''}`;
        if (!attr.defaultValue || !attr.type) {
            return [base];
        }
        const [first, ...rest] = attr.defaultValue.split('\n');
        return [`${base} = ${first}`, ...rest];
    });
    const propTexts = node.properties.map(p =>
        p.returnType ? `${p.name} → ${p.returnType}` : p.name
    );
    const methodTexts = layouts.flatMap(layout => layout.measureLines);
    const longestLineLength = Math.max(
        node.name.length,
        ...attrTexts.map(t => t.length),
        ...propTexts.map(t => t.length),
        ...methodTexts.map(t => t.length),
        10
    );
    return Math.min(
        maxWidth,
        Math.max(minWidth, longestLineLength * charWidth + sidePadding)
    );
}

// Memoized per `ClassNode` object: the measurement (method wrapping, width)
// depends only on the node's own members. Called 3–4× per node across the
// measure/position/render passes; the WeakMap collapses that to one compute.
const measureCache = new WeakMap<ClassNode, { width: number; height: number }>();

export function measureClassBox(
    node: ClassNode
): { width: number; height: number } {
    const memo = measureCache.get(node);
    if (memo) {
        return memo;
    }
    const {
        headerHeight,
        padding,
        lineHeight,
        sectionGap,
        sectionTopPadding,
        maxWidth,
        sidePadding,
        charWidth,
    } = UI.box;
    const wrapAt = Math.floor((maxWidth - sidePadding) / charWidth);

    const classMethods = node.methods.filter(m => m.isClassMethod);
    const staticMethods = node.methods.filter(m => m.isStaticMethod);
    const regularMethods = node.methods.filter(
        m => !m.isClassMethod && !m.isStaticMethod
    );

    const classLayouts = computeMethodLayouts(classMethods, wrapAt);
    const staticLayouts = computeMethodLayouts(staticMethods, wrapAt);
    const regularLayouts = computeMethodLayouts(regularMethods, wrapAt);
    const allLayouts = [...classLayouts, ...staticLayouts, ...regularLayouts];

    const width = computeBoxWidth(node, allLayouts);

    const countLines = (layouts: MethodLayout[]) =>
        layouts.reduce((sum, l) => sum + l.measureLines.length, 0);

    const attrLineCount = node.attributes.reduce(
        (sum, attr) =>
            sum +
            (attr.defaultValue ? attr.defaultValue.split('\n').length : 1),
        0
    );

    let y = headerHeight + sectionTopPadding;

    if (node.attributes.length) {
        y += lineHeight; // "Attributes" label
        y += attrLineCount * lineHeight;
    }

    if (node.properties.length) {
        if (node.attributes.length) {
            y += sectionGap;
        }
        y += lineHeight; // "Properties" label
        y += node.properties.length * lineHeight;
    }

    const hasAnyMethod =
        classMethods.length || staticMethods.length || regularMethods.length;
    if (hasAnyMethod) {
        if (node.attributes.length || node.properties.length) {
            y += sectionGap / 2 + sectionTopPadding;
        }
        if (classMethods.length) {
            y += lineHeight; // "Class Methods" label
            y += countLines(classLayouts) * lineHeight;
        }
        if (staticMethods.length) {
            if (classMethods.length) {
                y += sectionGap;
            }
            y += lineHeight; // "Static Methods" label
            y += countLines(staticLayouts) * lineHeight;
        }
        if (regularMethods.length) {
            if (classMethods.length || staticMethods.length) {
                y += sectionGap;
            }
            y += lineHeight; // "Methods" label
            y += countLines(regularLayouts) * lineHeight;
        }
    }

    const measured = { width, height: y + padding };
    measureCache.set(node, measured);
    return measured;
}

function renderSectionLabel(
    label: string,
    y: number
): { svg: string; endY: number } {
    return {
        svg: Text({
            x: 16,
            y,
            fontSize: Theme.font.size.normal,
            sectionLabel: true,
            children: TSpan({
                fill: Theme.colors.sectionLabel,
                fontStyle: 'italic',
                children: label,
            }),
        }),
        endY: y + UI.box.lineHeight,
    };
}

function renderAttributes(
    node: ClassNode,
    startY: number,
    baseX: number,
    inherited: { attrs: Set<string> }
): { svg: string; endY: number } {
    const { lineHeight, charWidth } = UI.box;
    let y = startY;
    const svg = node.attributes
        .map(attr => {
            const [firstDefault, ...contLines] = attr.defaultValue
                ? attr.defaultValue.split('\n')
                : [];

            const nameColor = inherited.attrs.has(attr.name)
                ? Theme.colors.override
                : Theme.colors.attribute;
            const firstText = Text({
                x: baseX,
                y,
                fontSize: Theme.font.size.normal,
                children: attr.type
                    ? TSpan({ fill: nameColor, children: attr.name }) +
                      TSpan({ fill: Theme.colors.text, children: ': ' }) +
                      renderTypeSpans(attr.type) +
                      (firstDefault !== undefined
                          ? TSpan({
                                fill: Theme.colors.text,
                                children: ' = ',
                            }) + renderPythonValue(firstDefault)
                          : '')
                    : TSpan({ fill: nameColor, children: attr.name }) +
                      (firstDefault !== undefined
                          ? TSpan({
                                fill: Theme.colors.text,
                                children: ' = ',
                            }) + renderPythonValue(firstDefault)
                          : ''),
            });
            y += lineHeight;

            const contSvg = contLines
                .map(line => {
                    const leadingSpaces = line.match(/^ */)?.[0].length ?? 0;
                    const text = Text({
                        x: baseX + leadingSpaces * charWidth,
                        y,
                        fontSize: Theme.font.size.normal,
                        children: renderPythonValue(line.trimStart()),
                    });
                    y += lineHeight;
                    return text;
                })
                .join('');

            return NavGroup({
                fileUri: node.fileUri,
                line: attr.definedAtLine,
                role: 'member',
                children: firstText + contSvg,
            });
        })
        .join('');
    return { svg, endY: y };
}

function renderProperties(
    node: ClassNode,
    startY: number,
    baseX: number,
    inherited: { props: Set<string> }
): { svg: string; endY: number } {
    const { lineHeight } = UI.box;
    let y = startY;
    const svg = node.properties
        .map(prop => {
            const nameColor = inherited.props.has(prop.name)
                ? Theme.colors.override
                : Theme.colors.method;
            const text = Text({
                x: baseX,
                y,
                fontSize: Theme.font.size.normal,
                children:
                    TSpan({ fill: nameColor, children: prop.name }) +
                    (prop.returnType
                        ? TSpan({ fill: Theme.colors.text, children: ' → ' }) +
                          renderTypeSpans(prop.returnType)
                        : ''),
            });
            y += lineHeight;
            return NavGroup({
                fileUri: node.fileUri,
                line: prop.definedAtLine,
                role: 'member',
                children: text,
            });
        })
        .join('');
    return { svg, endY: y };
}

function renderDivider(
    y: number,
    boxWidth: number
): { svg: string; endY: number } {
    const dividerY = y + UI.box.sectionGap / 2;
    return {
        svg: Line({
            x1: 12,
            y1: dividerY,
            x2: boxWidth - 12,
            y2: dividerY,
            stroke: Theme.colors.border,
        }),
        endY: dividerY + UI.box.sectionTopPadding,
    };
}

function renderMethodRows(
    node: ClassNode,
    methods: MethodDef[],
    layouts: MethodLayout[],
    startY: number,
    baseX: number,
    inherited: { methods: Set<string> }
): { svg: string; endY: number } {
    const { lineHeight } = UI.box;
    const indentPx = 4 * UI.box.charWidth;
    let y = startY;

    const svg = methods
        .map((method, i) => {
            const methodColor = inherited.methods.has(method.name)
                ? Theme.colors.override
                : Theme.colors.method;
            const layout = layouts[i];

            const abstractPrefixSvg = method.isAbstract
                ? TSpan({
                      fill: '#ffffff',
                      fontStyle: 'italic',
                      fontWeight: 'bold',
                      children: `${Messages.ui.abstractIndicator} `,
                  })
                : '';

            if (!layout.wrapped) {
                const paramsSvg = method.params
                    .map(
                        param =>
                            renderParamName(
                                param.name,
                                Theme.colors.attribute
                            ) +
                            (param.type
                                ? TSpan({
                                      fill: Theme.colors.text,
                                      children: ': ',
                                  }) + renderTypeSpans(param.type)
                                : '') +
                            (param.defaultValue !== undefined
                                ? TSpan({
                                      fill: Theme.colors.text,
                                      children: ' = ',
                                  }) + renderPythonValue(param.defaultValue)
                                : '')
                    )
                    .join(TSpan({ fill: Theme.colors.text, children: ', ' }));

                const returnSvg = method.returnType
                    ? TSpan({ fill: Theme.colors.text, children: ' → ' }) +
                      renderTypeSpans(method.returnType)
                    : '';

                const text = Text({
                    x: baseX,
                    y,
                    fontSize: Theme.font.size.normal,
                    children:
                        abstractPrefixSvg +
                        TSpan({ fill: methodColor, children: method.name }) +
                        TSpan({ fill: Theme.colors.text, children: '(' }) +
                        paramsSvg +
                        TSpan({ fill: Theme.colors.text, children: ')' }) +
                        returnSvg,
                });
                y += lineHeight;
                return NavGroup({
                    fileUri: node.fileUri,
                    line: method.definedAtLine,
                    role: 'member',
                    children: text,
                });
            }

            const lines: string[] = [];
            lines.push(
                Text({
                    x: baseX,
                    y,
                    fontSize: Theme.font.size.normal,
                    children:
                        abstractPrefixSvg +
                        TSpan({ fill: methodColor, children: method.name }) +
                        TSpan({ fill: Theme.colors.text, children: '(' }),
                })
            );
            y += lineHeight;

            for (const param of method.params) {
                lines.push(
                    Text({
                        x: baseX + indentPx,
                        y,
                        fontSize: Theme.font.size.normal,
                        children:
                            renderParamName(
                                param.name,
                                Theme.colors.attribute
                            ) +
                            (param.type
                                ? TSpan({
                                      fill: Theme.colors.text,
                                      children: ': ',
                                  }) + renderTypeSpans(param.type)
                                : '') +
                            (param.defaultValue !== undefined
                                ? TSpan({
                                      fill: Theme.colors.text,
                                      children: ' = ',
                                  }) + renderPythonValue(param.defaultValue)
                                : '') +
                            TSpan({ fill: Theme.colors.text, children: ',' }),
                    })
                );
                y += lineHeight;
            }

            lines.push(
                Text({
                    x: baseX,
                    y,
                    fontSize: Theme.font.size.normal,
                    children:
                        TSpan({ fill: Theme.colors.text, children: ')' }) +
                        (method.returnType
                            ? TSpan({
                                  fill: Theme.colors.text,
                                  children: ' → ',
                              }) + renderTypeSpans(method.returnType)
                            : ''),
                })
            );
            y += lineHeight;

            return NavGroup({
                fileUri: node.fileUri,
                line: method.definedAtLine,
                role: 'member',
                children: lines.join(''),
            });
        })
        .join('');

    return { svg, endY: y };
}

export function renderClassBox(
    node: ClassNode,
    x: number,
    y: number,
    inherited: {
        attrs: Set<string>;
        props: Set<string>;
        methods: Set<string>;
    },
    opts: { lazy?: boolean } = {}
): RenderedBox {
    const {
        headerHeight,
        padding,
        sectionGap,
        sectionTopPadding,
        maxWidth,
        sidePadding,
        charWidth,
        borderRadius,
    } = UI.box;
    const wrapAt = Math.floor((maxWidth - sidePadding) / charWidth);
    const contentIndent = 24;

    const classMethods = node.methods.filter(m => m.isClassMethod);
    const staticMethods = node.methods.filter(m => m.isStaticMethod);
    const regularMethods = node.methods.filter(
        m => !m.isClassMethod && !m.isStaticMethod
    );

    const classLayouts = computeMethodLayouts(classMethods, wrapAt);
    const staticLayouts = computeMethodLayouts(staticMethods, wrapAt);
    const regularLayouts = computeMethodLayouts(regularMethods, wrapAt);
    const allLayouts = [...classLayouts, ...staticLayouts, ...regularLayouts];

    const width = computeBoxWidth(node, allLayouts);

    const fpLines = computeFilePathLines(node.fileUri, width);
    const fpHeight = filePathSectionHeight(fpLines);
    const { filePathFontSize, filePathLineHeight, filePathPadding } = UI.box;

    const parts: string[] = [];
    let curY = headerHeight + sectionTopPadding;

    if (node.attributes.length) {
        const lbl = renderSectionLabel(Messages.ui.sections.attributes, curY);
        parts.push(lbl.svg);
        curY = lbl.endY;
        const attrs = renderAttributes(node, curY, contentIndent, inherited);
        parts.push(attrs.svg);
        curY = attrs.endY;
    }

    if (node.properties.length) {
        if (node.attributes.length) {
            curY += sectionGap;
        }
        const lbl = renderSectionLabel(Messages.ui.sections.properties, curY);
        parts.push(lbl.svg);
        curY = lbl.endY;
        const props = renderProperties(node, curY, contentIndent, inherited);
        parts.push(props.svg);
        curY = props.endY;
    }

    const hasAnyMethod =
        classMethods.length || staticMethods.length || regularMethods.length;
    if (hasAnyMethod) {
        if (node.attributes.length || node.properties.length) {
            const divider = renderDivider(curY, width);
            parts.push(divider.svg);
            curY = divider.endY;
        }
        if (classMethods.length) {
            const lbl = renderSectionLabel(
                Messages.ui.sections.classMethods,
                curY
            );
            parts.push(lbl.svg);
            curY = lbl.endY;
            const rows = renderMethodRows(
                node,
                classMethods,
                classLayouts,
                curY,
                contentIndent,
                inherited
            );
            parts.push(rows.svg);
            curY = rows.endY;
        }
        if (staticMethods.length) {
            if (classMethods.length) {
                curY += sectionGap;
            }
            const lbl = renderSectionLabel(
                Messages.ui.sections.staticMethods,
                curY
            );
            parts.push(lbl.svg);
            curY = lbl.endY;
            const rows = renderMethodRows(
                node,
                staticMethods,
                staticLayouts,
                curY,
                contentIndent,
                inherited
            );
            parts.push(rows.svg);
            curY = rows.endY;
        }
        if (regularMethods.length) {
            if (classMethods.length || staticMethods.length) {
                curY += sectionGap;
            }
            const lbl = renderSectionLabel(Messages.ui.sections.methods, curY);
            parts.push(lbl.svg);
            curY = lbl.endY;
            const rows = renderMethodRows(
                node,
                regularMethods,
                regularLayouts,
                curY,
                contentIndent,
                inherited
            );
            parts.push(rows.svg);
            curY = rows.endY;
        }
    }

    const height = curY + padding;

    const panel = ClassBox({
        x: 0,
        y: 0,
        width,
        height,
        borderRadius,
        fill: Theme.colors.panelBackground,
        stroke: Theme.colors.border,
    });

    // File path floats above the box (negative y) so it doesn't affect box layout.
    // It extends by borderRadius downward so the bottom rounded corners are hidden behind the panel.
    const filePathBg = ClassBox({
        x: 0,
        y: -fpHeight,
        width,
        height: fpHeight + borderRadius,
        borderRadius,
        fill: Theme.colors.filePathBackground,
        stroke: 'none',
    });
    const filePathTextSvg = fpLines
        .map((line, i) =>
            Text({
                x: 16,
                y:
                    -fpHeight +
                    filePathPadding +
                    (i + 1) * filePathLineHeight -
                    2,
                fontSize: filePathFontSize,
                fill: Theme.colors.filePathText,
                children: escapeXml(line),
            })
        )
        .join('');
    const filePathSection = Group({
        className: 'file-path-section',
        children: filePathBg + filePathTextSvg,
    });

    // Header: top corners rounded to match the panel, bottom edge flush so it
    // sits seamlessly above the body. A thin accent rule separates it from the
    // content.
    const r = borderRadius;
    const headerFill = node.isAbstract
        ? Theme.colors.abstractHeaderGradient
        : Theme.colors.headerGradient;
    const headerPath = `M 0 ${headerHeight} L 0 ${r} A ${r} ${r} 0 0 1 ${r} 0 L ${
        width - r
    } 0 A ${r} ${r} 0 0 1 ${width} ${r} L ${width} ${headerHeight} Z`;
    const header =
        `<path d="${headerPath}" fill="${headerFill}" />` +
        Line({
            x1: 0,
            y1: headerHeight - 0.5,
            x2: width,
            y2: headerHeight - 0.5,
            stroke: 'rgba(0,0,0,0.18)',
        });

    const title = NavGroup({
        fileUri: node.fileUri,
        line: node.definedAtLine,
        role: 'class',
        children: Text({
            x: width / 2,
            y: 22,
            textAnchor: 'middle',
            fontSize: Theme.font.size.header,
            fontWeight: Theme.font.weight.bold,
            fill: Theme.colors.headerText,
            children: node.name,
        }),
    });

    const clipId = `clip-${node.id.replace(/\W/g, '_')}`;
    const clipDef = ClipPath({
        id: clipId,
        x: 0,
        y: headerHeight,
        width,
        height: height - headerHeight,
    });
    const clippedContent = Group({
        clipPath: `url(#${clipId})`,
        children: parts.join(''),
    });

    const boxX = x - width / 2;

    // Split point: shell (always emitted) vs. body (lazy-hydratable).
    // Shell carries enough to show the box outline + class name in place so
    // the layout is intelligible while panning across thousands of nodes.
    // `filePathSection` lives in the shell on purpose — it's hover-only (so
    // the DOM cost is trivial) and keeping it before `header` preserves the
    // intended z-order (header masks the section's bottom-rounded corners).
    const shell = panel + filePathSection + header + title;
    const body = clipDef + clippedContent;

    if (opts.lazy) {
        const slot = `<g data-pt-lazy-body="${escapeXml(node.id).replace(/"/g, '&quot;')}"></g>`;
        return {
            svg: Group({
                dataPtBox: true,
                dataPtBoxId: node.id,
                dataPtX: boxX,
                dataPtY: y,
                dataPtW: width,
                dataPtH: height,
                transform: `translate(${boxX}, ${y})`,
                children: shell + slot,
            }),
            width,
            height,
            lazyBody: { boxId: node.id, html: body },
        };
    }

    return {
        svg: Group({
            dataPtBox: true,
            dataPtBoxId: node.id,
            transform: `translate(${boxX}, ${y})`,
            children: shell + body,
        }),
        width,
        height,
    };
}
