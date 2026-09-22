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

type Language = 'js' | 'ts' | 'tsx' | 'py' | 'config';

function detectLanguage(relPath: string): Language | null {
  if (/\.tsx$/.test(relPath)) return 'tsx';
  if (/\.ts$/.test(relPath)) return 'ts';
  if (/\.(js|jsx|mjs|cjs)$/.test(relPath)) return 'js';
  if (/\.py$/.test(relPath)) return 'py';
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

function parserFor(lang: Language): Parser {
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

export function extractSymbols(code: string, relPath: string): FileSymbols | null {
  const lang = detectLanguage(relPath);
  if (!lang) return null;
  if (lang === 'config') return extractConfigSymbols(code, relPath);

  let root: Parser.SyntaxNode;
  try {
    const parser = parserFor(lang);
    root = parser.parse(code).rootNode;
  } catch {
    return null;
  }

  try {
    return lang === 'py' ? extractPythonSymbols(root) : extractJsLikeSymbols(root);
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
