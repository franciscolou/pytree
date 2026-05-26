import * as vscode from 'vscode';
import type {
    ClassNode,
    MethodParam,
    MethodDef,
    AttrDef,
    PropDef,
    BaseRef,
    DecoratorScan,
} from '../types';

/* =========================================================
   REGEX (used only on individual declaration lines)
   ========================================================= */

const ABSTRACT_CLASS_REGEX = /\bmetaclass\s*=\s*(?:abc\.)?ABCMeta\b/;
const ABSTRACT_BASE_REGEX = /\b(?:abc\.)?ABC\b/;
const ABSTRACT_METHOD_REGEX = /^\s*@(?:abc\.)?abstractmethod\b/;
const CLASS_METHOD_REGEX = /^\s*@classmethod\b/;
const STATIC_METHOD_REGEX = /^\s*@staticmethod\b/;
const PROPERTY_REGEX = /^\s*@property\b/;

const DEF_START_REGEX = /^\s*def\s+/;
const METHOD_DECL_REGEX =
    /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/;
const ATTR_DECL_REGEX =
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=\n]+?)(?:\s*=\s*(.+))?$/;
const ENUM_MEMBER_REGEX = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;
const BARE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_.]*/;

// Strip a trailing inline Python comment (# ...) from a source line,
// respecting single-quoted and double-quoted string literals.
function stripInlineComment(line: string): string {
    let inStr: string | null = null;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inStr) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === inStr) {
                inStr = null;
            }
        } else {
            if (ch === '"' || ch === "'") {
                inStr = ch;
            } else if (ch === '#') {
                return line.slice(0, i).trimEnd();
            }
        }
    }
    return line;
}

/* =========================================================
   IDENTIFIERS
   ========================================================= */

// Workspace URI prefix used by `makeClassId` to produce stable, relative
// IDs. Cached because the function is called once per class + once per base
// reference (thousands of times on large workspaces) and resolving folders
// each time would allocate a fresh string every call.
let cachedWorkspacePrefix: string | null | undefined;

export function resetWorkspacePrefix(): void {
    cachedWorkspacePrefix = undefined;
}

export function makeClassId(
    fileUri: string,
    name: string,
    line: number
): string {
    if (cachedWorkspacePrefix === undefined) {
        const wsUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
        cachedWorkspacePrefix = wsUri ? wsUri + '/' : null;
    }
    const prefix = cachedWorkspacePrefix;
    const key =
        prefix && fileUri.startsWith(prefix)
            ? fileUri.slice(prefix.length)
            : fileUri;
    return `${key}#${name}@${line}`;
}

/* =========================================================
   DOCUMENT SYMBOLS
   ========================================================= */

// Raw `DocumentSymbol[]` cache keyed by URI. Distinct from `symbolCache`
// (which stores the post-processed `ClassNode` map): this one short-circuits
// the LSP roundtrip itself. The big payoff is `resolveBaseId` — every class
// in the workspace that inherits from a class in `models.py` ends up asking
// for `models.py`'s symbols, and without dedup that's N redundant LSP calls
// for the same data. Stores a Promise so concurrent callers share a single
// in-flight request. Invalidated by `invalidateParserCache(uri)`.
const rawSymbolsCache = new Map<
    string,
    Promise<vscode.DocumentSymbol[] | undefined>
>();

async function getDocumentSymbols(
    uri: vscode.Uri
): Promise<vscode.DocumentSymbol[] | undefined> {
    const key = uri.toString();
    const pending = rawSymbolsCache.get(key);
    if (pending) {
        return pending;
    }
    const fresh = (async () => {
        try {
            return await vscode.commands.executeCommand<
                vscode.DocumentSymbol[] | undefined
            >('vscode.executeDocumentSymbolProvider', uri);
        } catch (err) {
            // Don't cache failures — Pylance may simply not be ready yet, and
            // we want subsequent calls to retry rather than serve a rejection.
            rawSymbolsCache.delete(key);
            throw err;
        }
    })();
    rawSymbolsCache.set(key, fresh);
    return fresh;
}

/* =========================================================
   MEMBER EXTRACTION
   ========================================================= */

function collectMethodDeclText(
    startLine: number,
    document: vscode.TextDocument
): string {
    const parts: string[] = [];
    let depth = 0;
    let foundOpen = false;
    const limit = Math.min(startLine + 30, document.lineCount - 1);
    for (let l = startLine; l <= limit; l++) {
        const text = stripInlineComment(document.lineAt(l).text);
        parts.push(text);
        depth += bracketDepth(text);
        if (!foundOpen && text.includes('(')) {
            foundOpen = true;
        }
        if (foundOpen && depth === 0) {
            break;
        }
    }
    return parts.join(' ');
}

function scanDecorators(
    startLine: number,
    document: vscode.TextDocument
): DecoratorScan {
    const result: DecoratorScan = {
        defLine: undefined,
        isProperty: false,
        isAbstract: false,
        isClassMethod: false,
        isStaticMethod: false,
    };
    const limit = Math.min(startLine + 10, document.lineCount - 1);
    for (let l = startLine; l <= limit; l++) {
        const t = document.lineAt(l).text;
        if (PROPERTY_REGEX.test(t)) {
            result.isProperty = true;
        }
        if (ABSTRACT_METHOD_REGEX.test(t)) {
            result.isAbstract = true;
        }
        if (CLASS_METHOD_REGEX.test(t)) {
            result.isClassMethod = true;
        }
        if (STATIC_METHOD_REGEX.test(t)) {
            result.isStaticMethod = true;
        }
        if (DEF_START_REGEX.test(t)) {
            result.defLine = l;
            break;
        }
    }
    return result;
}

function extractMethod(
    sym: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    scan: DecoratorScan
): MethodDef {
    const declText =
        scan.defLine !== undefined
            ? collectMethodDeclText(scan.defLine, document)
            : '';

    // Bracket-aware extraction: METHOD_DECL_REGEX uses [^)]* which stops at
    // the first ')' and misses params whose defaults contain calls like dict().
    const nameMatch = declText.match(/^\s*def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/);
    let params: MethodParam[] = [];
    let returnType: string | undefined;
    if (nameMatch) {
        const openIdx = declText.indexOf('(', nameMatch[0].length - 1);
        const closeIdx = findMatchingParen(declText, openIdx);
        if (closeIdx >= 0) {
            params = parseParams(declText.slice(openIdx + 1, closeIdx));
            const retMatch = declText
                .slice(closeIdx + 1)
                .match(/^\s*->\s*([^:]+?)\s*:/);
            returnType = retMatch?.[1]?.trim();
        }
    }

    return {
        name: sym.name,
        params,
        returnType,
        definedAtLine: sym.range.start.line,
        isAbstract: scan.isAbstract || undefined,
        isClassMethod: scan.isClassMethod || undefined,
        isStaticMethod: scan.isStaticMethod || undefined,
    };
}

function bracketDepth(text: string): number {
    let depth = 0;
    for (const ch of text) {
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        }
    }
    return depth;
}

function extractAttribute(
    sym: vscode.DocumentSymbol,
    document: vscode.TextDocument
): AttrDef {
    const firstLine = stripInlineComment(
        document.lineAt(sym.range.start.line).text
    );
    const match = firstLine.match(ATTR_DECL_REGEX);

    const baseIndent = firstLine.match(/^ */)?.[0].length ?? 0;

    let defaultValue: string | undefined;
    if (match?.[3] !== undefined) {
        const parts = [match[3].trim()];
        let depth = bracketDepth(parts[0]);
        let l = sym.range.start.line + 1;
        while (
            depth > 0 &&
            l < document.lineCount &&
            l <= sym.range.start.line + 20
        ) {
            const rawLine = document.lineAt(l).text;
            parts.push(rawLine.slice(baseIndent).trimEnd());
            depth += bracketDepth(rawLine);
            l++;
        }
        defaultValue = parts.join('\n');
    }

    return {
        name: sym.name,
        type: match?.[2]?.trim() || undefined,
        defaultValue: defaultValue || undefined,
        definedAtLine: sym.range.start.line,
    };
}

function extractProperty(
    sym: vscode.DocumentSymbol,
    document: vscode.TextDocument,
    scan: DecoratorScan
): PropDef | undefined {
    if (scan.defLine === undefined) {
        return undefined;
    }
    const declText = collectMethodDeclText(scan.defLine, document);
    const match = declText.match(METHOD_DECL_REGEX);
    return {
        name: sym.name,
        returnType: match?.[3]?.trim() || undefined,
        definedAtLine: sym.range.start.line,
    };
}

function collectClassDeclLines(
    sym: vscode.DocumentSymbol,
    document: vscode.TextDocument
): string[] {
    const lines: string[] = [];
    let depth = 0;
    let foundOpen = false;
    const limit = Math.min(sym.range.start.line + 30, document.lineCount - 1);
    for (let l = sym.range.start.line; l <= limit; l++) {
        const text = document.lineAt(l).text;
        lines.push(text);
        for (const ch of text) {
            if (ch === '(') {
                depth++;
                foundOpen = true;
            } else if (ch === ')') {
                depth--;
            }
        }
        if (!foundOpen || (foundOpen && depth === 0)) {
            break;
        }
    }
    return lines;
}

async function extractClassFromSymbol(
    sym: vscode.DocumentSymbol,
    document: vscode.TextDocument
): Promise<ClassNode> {
    const declLines = collectClassDeclLines(sym, document);
    const isAbstract =
        declLines.some(
            l => ABSTRACT_CLASS_REGEX.test(l) || ABSTRACT_BASE_REGEX.test(l)
        ) || undefined;
    const bases = await resolveBases(declLines, document, sym);

    const methods: MethodDef[] = [];
    const attributes: AttrDef[] = [];
    const properties: PropDef[] = [];

    const tryPushAttr = (child: vscode.DocumentSymbol): boolean => {
        const lineText = document.lineAt(child.range.start.line).text;
        if (ATTR_DECL_REGEX.test(lineText)) {
            attributes.push(extractAttribute(child, document));
            return true;
        }
        return false;
    };

    const pushProperty = (
        child: vscode.DocumentSymbol,
        scan: DecoratorScan
    ): void => {
        const prop = extractProperty(child, document, scan);
        if (prop) {
            properties.push(prop);
        }
    };

    for (const child of sym.children) {
        switch (child.kind) {
            case vscode.SymbolKind.Method:
            case vscode.SymbolKind.Function:
            case vscode.SymbolKind.Constructor: {
                const scan = scanDecorators(child.range.start.line, document);
                if (scan.isProperty) {
                    pushProperty(child, scan);
                } else {
                    methods.push(extractMethod(child, document, scan));
                }
                break;
            }
            case vscode.SymbolKind.Variable:
            case vscode.SymbolKind.Field:
            case vscode.SymbolKind.Constant: {
                tryPushAttr(child);
                break;
            }
            case vscode.SymbolKind.Property: {
                const scan = scanDecorators(child.range.start.line, document);
                pushProperty(child, scan);
                break;
            }
            case vscode.SymbolKind.EnumMember: {
                if (tryPushAttr(child)) {
                    break;
                }
                const lineText = document.lineAt(child.range.start.line).text;
                const m = lineText.match(ENUM_MEMBER_REGEX);
                if (m) {
                    attributes.push({
                        name: m[1],
                        defaultValue: m[2].trim(),
                        definedAtLine: child.range.start.line,
                    });
                }
                break;
            }
        }
    }

    return {
        id: makeClassId(
            document.uri.toString(),
            sym.name,
            sym.range.start.line
        ),
        name: sym.name,
        bases,
        attributes,
        properties,
        methods,
        definedAtLine: sym.range.start.line,
        fileUri: document.uri.toString(),
        isAbstract,
    };
}

/* =========================================================
   CACHE
   ========================================================= */

const symbolCache = new Map<
    string,
    { version: number; classes: Map<string, ClassNode> }
>();

export function invalidateParserCache(uri?: vscode.Uri): void {
    if (uri) {
        const key = uri.toString();
        symbolCache.delete(key);
        rawSymbolsCache.delete(key);
    } else {
        symbolCache.clear();
        rawSymbolsCache.clear();
    }
}

/* =========================================================
   ENTRY POINTS
   ========================================================= */

/**
 * Returns the classes defined in `document`, identified by their universal class
 * IDs. Bases are resolved via the language server so that aliased imports
 * and same-name classes from different files are disambiguated to the
 * actual definition site.
 */
export async function extractClasses(
    document: vscode.TextDocument
): Promise<Map<string, ClassNode>> {
    const key = document.uri.toString();
    const cached = symbolCache.get(key);
    if (cached?.version === document.version) {
        return cached.classes;
    }

    const symbols = await getDocumentSymbols(document.uri);
    if (!symbols) {
        return new Map();
    }

    // Process classes in the same file in parallel: each
    // `extractClassFromSymbol` mostly awaits `executeDefinitionProvider` calls
    // for its base list, and those are independent across classes. The Map
    // is built after all promises resolve so insertion order is deterministic.
    const classSyms = symbols.filter(
        s => s.kind === vscode.SymbolKind.Class
    );
    const nodes = await Promise.all(
        classSyms.map(s => extractClassFromSymbol(s, document))
    );

    const classes = new Map<string, ClassNode>();
    for (const node of nodes) {
        classes.set(node.id, node);
    }

    symbolCache.set(key, { version: document.version, classes });
    return classes;
}

/**
 * Resolves the bases of a class declaration into BaseRefs.
 *
 * For each base expression, the bare class identifier is located on the
 * declaration line and `executeDefinitionProvider` is asked where it points
 * to. The resulting position is used to compute the universal ID of the
 * actual class being inherited from. This naturally disambiguates classes
 * with the same name across files and resolves aliased imports.
 */
/**
 * Returns the index of the `(` that opens the base-class list, correctly
 * skipping an optional PEP 695 type-parameter block `[...]` that may appear
 * between the class name and the parentheses.  Returns -1 when not found.
 */
function findBasesParenIndex(lineText: string): number {
    const m = lineText.match(/^\s*class\s+\w+/);
    if (!m) {
        return -1;
    }
    let i = m[0].length;
    while (i < lineText.length && lineText[i] === ' ') {
        i++;
    }
    if (lineText[i] === '[') {
        let depth = 1;
        i++;
        while (i < lineText.length && depth > 0) {
            if (lineText[i] === '[') {
                depth++;
            } else if (lineText[i] === ']') {
                depth--;
            }
            i++;
        }
        while (i < lineText.length && lineText[i] === ' ') {
            i++;
        }
    }
    return lineText[i] === '(' ? i : -1;
}

async function resolveBases(
    declLines: string[],
    document: vscode.TextDocument,
    classSymbol: vscode.DocumentSymbol
): Promise<BaseRef[]> {
    const startLine = classSymbol.range.start.line;

    // Flatten the (possibly multi-line) declaration into a single string while
    // recording the source (line, column) of each character so we can later
    // hand a precise position to executeDefinitionProvider.
    let flat = '';
    const lineMap: number[] = [];
    const colMap: number[] = [];
    for (let li = 0; li < declLines.length; li++) {
        const text = declLines[li];
        for (let ci = 0; ci < text.length; ci++) {
            flat += text[ci];
            lineMap.push(startLine + li);
            colMap.push(ci);
        }
        if (li < declLines.length - 1) {
            flat += ' ';
            lineMap.push(startLine + li);
            colMap.push(text.length);
        }
    }

    const parenIdx = findBasesParenIndex(flat);
    if (parenIdx < 0) {
        return [];
    }
    const closeIdx = findMatchingParen(flat, parenIdx);
    if (closeIdx < 0 || !flat.slice(parenIdx + 1, closeIdx).trim()) {
        return [];
    }

    // Split base list by top-level commas, respecting bracket depth so that
    // generic args like `Foo[X, Y]` aren't split incorrectly.
    const chunks: { raw: string; startIdx: number }[] = [];
    let depth = 0;
    let chunkStart = parenIdx + 1;
    for (let i = parenIdx + 1; i < closeIdx; i++) {
        const ch = flat[i];
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        } else if (ch === ',' && depth === 0) {
            chunks.push({
                raw: flat.slice(chunkStart, i),
                startIdx: chunkStart,
            });
            chunkStart = i + 1;
        }
    }
    chunks.push({
        raw: flat.slice(chunkStart, closeIdx),
        startIdx: chunkStart,
    });

    return Promise.all(
        chunks
            .filter(c => c.raw.trim())
            .map(async chunk => {
                const raw = chunk.raw.trim();
                const bareName = raw.match(BARE_NAME_REGEX)?.[0] ?? raw;
                const nameIdx = flat.indexOf(bareName, chunk.startIdx);
                if (nameIdx < 0) {
                    return { name: raw };
                }
                const id = await resolveBaseId(
                    lineMap[nameIdx],
                    colMap[nameIdx],
                    document
                );
                return { name: raw, id };
            })
    );
}

async function resolveBaseId(
    line: number,
    column: number,
    fromDoc: vscode.TextDocument
): Promise<string | undefined> {
    const position = new vscode.Position(line, column);
    const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        fromDoc.uri,
        position
    );
    if (!locations?.length) {
        return undefined;
    }

    const loc = locations[0];
    const targetSymbols = await getDocumentSymbols(loc.uri);
    if (!targetSymbols) {
        return undefined;
    }

    const targetSym = findEnclosingClass(targetSymbols, loc.range.start);
    if (!targetSym) {
        return undefined;
    }

    return makeClassId(
        loc.uri.toString(),
        targetSym.name,
        targetSym.range.start.line
    );
}

function findEnclosingClass(
    symbols: vscode.DocumentSymbol[],
    pos: vscode.Position
): vscode.DocumentSymbol | undefined {
    for (const sym of symbols) {
        if (sym.kind === vscode.SymbolKind.Class && sym.range.contains(pos)) {
            return sym;
        }
    }
    // Fallback: definition might land on a name token whose range is the
    // selectionRange, not the full class range. Try selectionRange match.
    for (const sym of symbols) {
        if (
            sym.kind === vscode.SymbolKind.Class &&
            sym.selectionRange.contains(pos)
        ) {
            return sym;
        }
    }
    return undefined;
}

/* =========================================================
   HELPERS
   ========================================================= */

// Finds the index of the ')' that closes the '(' at openIdx, respecting
// nested brackets and string literals. Returns -1 if not found.
function findMatchingParen(s: string, openIdx: number): number {
    let depth = 1;
    let inStr: string | null = null;
    for (let i = openIdx + 1; i < s.length; i++) {
        const ch = s[i];
        if (inStr !== null) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (s.startsWith(inStr, i)) {
                i += inStr.length - 1;
                inStr = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            const triple = s[i + 1] === ch && s[i + 2] === ch;
            inStr = triple ? ch.repeat(3) : ch;
            if (triple) {
                i += 2;
            }
            continue;
        }
        if (ch === '(') {
            depth++;
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

// Splits s at the first '=' that is at bracket/string depth 0 and is not
// part of ==, !=, <=, >=. Returns [lhs, rhs] (both trimmed), or [s, undefined].
function splitAtFirstEquals(s: string): [string, string | undefined] {
    let depth = 0;
    let inStr: string | null = null;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (inStr !== null) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (s.startsWith(inStr, i)) {
                i += inStr.length - 1;
                inStr = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            const triple = s[i + 1] === ch && s[i + 2] === ch;
            inStr = triple ? ch.repeat(3) : ch;
            if (triple) {
                i += 2;
            }
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            continue;
        }
        if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            continue;
        }
        if (ch === '=' && depth === 0) {
            const prev = i > 0 ? s[i - 1] : '';
            const next = s[i + 1] ?? '';
            if (
                next === '=' ||
                prev === '!' ||
                prev === '<' ||
                prev === '>' ||
                prev === '='
            ) {
                continue;
            }
            return [s.slice(0, i).trimEnd(), s.slice(i + 1).trimStart()];
        }
    }
    return [s, undefined];
}

function splitParams(raw: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of raw) {
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
            current += ch;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            current += ch;
        } else if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current) {
        parts.push(current);
    }
    return parts;
}

function parseParams(raw: string): MethodParam[] {
    if (!raw.trim()) {
        return [];
    }

    return splitParams(raw)
        .map(p => p.trim())
        .filter(p => p && p !== 'self' && p !== 'cls' && p !== '*')
        .map(p => {
            const [nameAndType, defaultValue] = splitAtFirstEquals(p);
            const [name, type] = nameAndType.split(':').map(s => s.trim());
            return {
                name,
                type: type || undefined,
                defaultValue,
            };
        });
}
