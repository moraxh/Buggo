/**
 * Symbol extraction via tree-sitter, one grammar per language, behind the
 * same FileSymbols contract the rest of the pipeline (scanner.ts, files.ts,
 * functions.ts) already depends on - extractSymbols() is a drop-in
 * replacement for the previous @babel/parser-based implementation, not a
 * new API. Supports JS/JSX/TS/TSX (tree-sitter-javascript/-typescript) and
 * Python (tree-sitter-python); an unsupported extension returns null, same
 * as an unparseable file did before.
 */
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';

export type FunctionSymbol = {
  name: string;
  line: number;
  kind: 'function' | 'method' | 'arrow';
};

export type FileSymbols = {
  imports: string[];
  exports: string[];
  functions: FunctionSymbol[];
  classes: string[];
};

type Language = 'js' | 'ts' | 'tsx' | 'py' | 'config' | 'astro' | 'vue' | 'svelte' | 'markup';

function detectLanguage(relPath: string): Language | null {
  // .mdx is Markdown with embedded JSX/imports/exports; the TSX grammar
  // tolerates the surrounding prose as ERROR nodes (still walked by the
  // visitor below) and still finds the real import/export/function nodes.
  if (/\.(tsx|mdx)$/.test(relPath)) return 'tsx';
  if (/\.(ts|mts|cts)$/.test(relPath)) return 'ts';
  if (/\.(js|jsx|mjs|cjs)$/.test(relPath)) return 'js';
  if (/\.py$/.test(relPath)) return 'py';
  if (/\.astro$/.test(relPath)) return 'astro';
  if (/\.vue$/.test(relPath)) return 'vue';
  if (/\.svelte$/.test(relPath)) return 'svelte';
  if (/\.(css|scss|less)$/.test(relPath)) return 'markup';
  if (/\.html?$/.test(relPath)) return 'markup';
  if (/\.json$/.test(relPath)) return 'markup';
  if (isConfigFile(relPath)) return 'config';
  return null;
}

/**
 * Config/infra files (build tooling, CI, deploy manifests) have no AST to
 * speak of, but a bug report about a deploy/build failure often points
 * straight at one of these - excluding them from candidates entirely (as
 * the scanner did before) makes such bugs unfindable by construction. Kept
 * deliberately narrow (extension + a short list of well-known bare
 * filenames) so ordinary data/fixture YAML or JSON doesn't flood the
 * candidate list.
 */
const CONFIG_FILENAMES = new Set([
  'dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.dockerignore', '.gitignore', '.npmrc', '.nvmrc',
]);

function isConfigFile(relPath: string): boolean {
  const base = relPath.split('/').pop() ?? relPath;
  const lower = base.toLowerCase();
  if (CONFIG_FILENAMES.has(lower)) return true;
  if (/\.(ya?ml|toml)$/.test(lower)) return true;
  // "next.config.ts" is already covered by the ts/js branches above (real
  // AST); this only catches the non-JS config surface (next.config.mjs's
  // and vite.config's own default-export bodies still parse as JS/TS).
  return false;
}

function parserFor(lang: 'js' | 'ts' | 'tsx' | 'py'): Parser {
  const parser = new Parser();
  switch (lang) {
    case 'js':
      parser.setLanguage(JavaScript);
      break;
    case 'ts':
      parser.setLanguage(TypeScript.typescript);
      break;
    case 'tsx':
      parser.setLanguage(TypeScript.tsx);
      break;
    case 'py':
      parser.setLanguage(Python);
      break;
  }
  return parser;
}

/**
 * .astro/.vue/.svelte components embed a real JS/TS script block inside a
 * template file tree-sitter's JS/TS grammars can't parse whole (the
 * template markup around it isn't valid JS). Isolate just that block with a
 * regex (Astro's frontmatter fence, or an HTML-like <script> tag) and hand
 * its contents to the same TS/JS parser used for plain .ts/.js files, so
 * these components get real function/export symbols instead of none.
 */
function extractEmbeddedScript(code: string, lang: 'astro' | 'vue' | 'svelte'): { code: string; ts: boolean } | null {
  if (lang === 'astro') {
    // Astro frontmatter: a `---` fence at the very top of the file, TS by convention.
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(code);
    return m ? { code: m[1], ts: true } : null;
  }
  // Vue SFC / Svelte: <script> or <script setup lang="ts">...</script>.
  const m = /<script\b([^>]*)>([\s\S]*?)<\/script>/i.exec(code);
  if (!m) return null;
  const attrs = m[1];
  const ts = /lang\s*=\s*["']ts["']|lang\s*=\s*["']typescript["']/i.test(attrs);
  return { code: m[2], ts };
}

function lineOf(node: Parser.SyntaxNode): number {
  return node.startPosition.row + 1;
}

function extractJsLikeSymbols(root: Parser.SyntaxNode): FileSymbols {
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: string[] = [];

  function nameOfMethodLike(node: Parser.SyntaxNode): string | null {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return null;
    if (nameNode.type === 'private_property_identifier') return `#${nameNode.text.replace(/^#/, '')}`;
    return nameNode.text;
  }

  function visit(node: Parser.SyntaxNode) {
    switch (node.type) {
      case 'import_statement': {
        const source = node.childForFieldName('source');
        if (source) imports.push(source.text.replace(/^['"]|['"]$/g, ''));
        break;
      }
      case 'call_expression': {
        const fn = node.childForFieldName('function');
        if (fn?.type === 'identifier' && fn.text === 'require') {
          const args = node.childForFieldName('arguments');
          const first = args?.namedChild(0);
          if (first?.type === 'string') imports.push(first.text.replace(/^['"]|['"]$/g, ''));
        }
        break;
      }
      case 'export_statement': {
        const decl = node.childForFieldName('declaration');
        const isDefault = node.children.some((c) => c.type === 'default');
        if (isDefault) {
          exports.push('default');
        } else if (decl) {
          if (decl.type === 'function_declaration' || decl.type === 'class_declaration') {
            const nameNode = decl.childForFieldName('name');
            if (nameNode) exports.push(nameNode.text);
          } else if (decl.type === 'lexical_declaration' || decl.type === 'variable_declaration') {
            for (const d of decl.namedChildren) {
              if (d.type === 'variable_declarator') {
                const nameNode = d.childForFieldName('name');
                if (nameNode) exports.push(nameNode.text);
              }
            }
          }
        }
        const clause = node.namedChildren.find((c) => c.type === 'export_clause');
        if (clause) {
          for (const spec of clause.namedChildren) {
            if (spec.type === 'export_specifier') {
              const alias = spec.childForFieldName('alias');
              const name = spec.childForFieldName('name');
              exports.push((alias ?? name)?.text ?? '');
            }
          }
        }
        break;
      }
      case 'function_declaration':
      case 'function_expression':
      case 'generator_function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) functions.push({ name: nameNode.text, line: lineOf(node), kind: 'function' });
        break;
      }
      case 'class_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) classes.push(nameNode.text);
        break;
      }
      case 'method_definition': {
        const name = nameOfMethodLike(node);
        if (name) functions.push({ name, line: lineOf(node), kind: 'method' });
        break;
      }
      case 'pair': {
        // Object literal method shorthand parses as `pair` when it has a
        // colon (key: function(){}); true shorthand methods are their own
        // 'method_definition' inside object expressions, already handled above.
        const value = node.childForFieldName('value');
        if (value && (value.type === 'function_expression' || value.type === 'arrow_function')) {
          const key = node.childForFieldName('key');
          if (key) functions.push({ name: key.text, line: lineOf(node), kind: 'method' });
        }
        break;
      }
      case 'variable_declarator': {
        const value = node.childForFieldName('value');
        const nameNode = node.childForFieldName('name');
        if (
          value &&
          nameNode?.type === 'identifier' &&
          (value.type === 'arrow_function' || value.type === 'function_expression')
        ) {
          functions.push({ name: nameNode.text, line: lineOf(node), kind: 'arrow' });
        }
        break;
      }
      case 'assignment_expression': {
        // Pattern used by express: `res.send = function send(body) {...}`
        const left = node.childForFieldName('left');
        const right = node.childForFieldName('right');
        if (
          left?.type === 'member_expression' &&
          (right?.type === 'function_expression' || right?.type === 'arrow_function')
        ) {
          const property = left.childForFieldName('property');
          if (property) functions.push({ name: property.text, line: lineOf(node), kind: 'method' });
        }
        break;
      }
    }
    for (const child of node.namedChildren) visit(child);
  }

  visit(root);
  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports.filter(Boolean))],
    functions: dedupeFunctions(functions),
    classes: [...new Set(classes)],
  };
}

function extractPythonSymbols(root: Parser.SyntaxNode): FileSymbols {
  const imports: string[] = [];
  const exports: string[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: string[] = [];

  function visit(node: Parser.SyntaxNode, insideClass: boolean) {
    switch (node.type) {
      case 'import_statement':
      case 'import_from_statement': {
        for (const child of node.namedChildren) {
          if (child.type === 'dotted_name' || child.type === 'relative_import') {
            imports.push(child.text);
            break;
          }
        }
        break;
      }
      case 'function_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          functions.push({ name: nameNode.text, line: lineOf(node), kind: insideClass ? 'method' : 'function' });
          // Python has no explicit export keyword; a top-level, non-underscore-prefixed
          // name is the closest real signal of "public API" without inventing one.
          if (!insideClass && !nameNode.text.startsWith('_')) exports.push(nameNode.text);
        }
        break;
      }
      case 'class_definition': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
          classes.push(nameNode.text);
          if (!nameNode.text.startsWith('_')) exports.push(nameNode.text);
        }
        break;
      }
    }
    const nowInsideClass = insideClass || node.type === 'class_definition';
    for (const child of node.namedChildren) visit(child, nowInsideClass);
  }

  visit(root, false);
  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    functions: dedupeFunctions(functions),
    classes: [...new Set(classes)],
  };
}

/**
 * YAML/TOML/Dockerfile have no real AST parser wired up here - top-level
 * keys (YAML/TOML) or instructions (Dockerfile) are extracted with plain
 * line scanning instead. They're reported as `exports` (the field files.ts
 * already surfaces to Jev's ranking prompt as "exports: ..."), not
 * `functions`, since "top-level key" is the closer analog: it's the part
 * of the file a human skimming it for "does this look relevant" would look
 * at first.
 */
function extractConfigSymbols(code: string, relPath: string): FileSymbols {
  const base = (relPath.split('/').pop() ?? relPath).toLowerCase();
  const keys: string[] = [];

  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    for (const line of code.split('\n')) {
      const m = /^\s*([A-Z]+)\s+\S/.exec(line);
      if (m) keys.push(m[1]);
    }
  } else {
    // YAML/TOML top-level keys: unindented `key:` (YAML) or `key = ` / `[section]` (TOML).
    for (const line of code.split('\n')) {
      if (/^\s/.test(line) || !line.trim() || line.trim().startsWith('#')) continue;
      const yamlKey = /^([A-Za-z0-9_.\-]+)\s*:/.exec(line);
      const tomlSection = /^\[([^\]]+)\]/.exec(line);
      const tomlKey = /^([A-Za-z0-9_.\-]+)\s*=/.exec(line);
      const match = yamlKey ?? tomlSection ?? tomlKey;
      if (match) keys.push(match[1]);
    }
  }

  return { imports: [], exports: [...new Set(keys)], functions: [], classes: [] };
}

/**
 * CSS/SCSS/LESS/HTML/JSON have no executable symbols, but a UI bug report
 * ("the button is misaligned", "the modal has no styles") often points
 * straight at one of these - reported as `exports` (the field files.ts
 * already surfaces to Jev's ranking prompt), same rationale as
 * extractConfigSymbols. JSON keys come from a real JSON.parse since the
 * format is unambiguous; CSS selectors and HTML ids/classes/script srcs are
 * cheap line/regex scans, not a real parser.
 */
function extractMarkupSymbols(code: string, relPath: string): FileSymbols {
  const ext = (relPath.split('.').pop() ?? '').toLowerCase();

  if (ext === 'json') {
    try {
      const parsed = JSON.parse(code);
      const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
      return { imports: [], exports: keys, functions: [], classes: [] };
    } catch {
      return { imports: [], exports: [], functions: [], classes: [] };
    }
  }

  if (ext === 'html' || ext === 'htm') {
    const imports: string[] = [];
    const exports: string[] = [];
    for (const m of code.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) exports.push(`#${m[1]}`);
    for (const m of code.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) imports.push(m[1]);
    for (const m of code.matchAll(/<link[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) imports.push(m[1]);
    return { imports: [...new Set(imports)], exports: [...new Set(exports)], functions: [], classes: [] };
  }

  // CSS/SCSS/LESS: top-level selectors (class/id/element/at-rule openers), a
  // cheap analog of "top-level keys" for a format Jev's ranking can skim.
  const exports: string[] = [];
  for (const m of code.matchAll(/([.#]?[A-Za-z0-9_-]+(?:\s*[,>+~]\s*[.#]?[A-Za-z0-9_-]+)*)\s*\{/g)) {
    const selector = m[1].trim();
    if (selector && selector.length < 80) exports.push(selector);
  }
  return { imports: [], exports: [...new Set(exports)], functions: [], classes: [] };
}

export function extractSymbols(code: string, relPath: string): FileSymbols | null {
  const lang = detectLanguage(relPath);
  if (!lang) return null;
  if (lang === 'config') return extractConfigSymbols(code, relPath);
  if (lang === 'markup') return extractMarkupSymbols(code, relPath);

  let embeddedTs = false;
  let scriptCode = code;
  if (lang === 'astro' || lang === 'vue' || lang === 'svelte') {
    const embedded = extractEmbeddedScript(code, lang);
    if (!embedded) return { imports: [], exports: [], functions: [], classes: [] };
    scriptCode = embedded.code;
    embeddedTs = embedded.ts;
  }

  const parseLang: 'js' | 'ts' | 'tsx' | 'py' =
    lang === 'py' ? 'py' : lang === 'astro' || embeddedTs ? 'ts' : lang === 'js' || lang === 'ts' ? lang : 'js';

  let root: Parser.SyntaxNode;
  try {
    const parser = parserFor(parseLang);
    root = parser.parse(scriptCode).rootNode;
  } catch {
    return null;
  }

  try {
    return parseLang === 'py' ? extractPythonSymbols(root) : extractJsLikeSymbols(root);
  } catch {
    // partial/best-effort results only - never throw out of symbol extraction
    return { imports: [], exports: [], functions: [], classes: [] };
  }
}

function dedupeFunctions(fns: FunctionSymbol[]): FunctionSymbol[] {
  const seen = new Set<string>();
  const out: FunctionSymbol[] = [];
  for (const f of fns) {
    const key = `${f.name}:${f.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
