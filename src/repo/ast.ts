import { parse } from '@babel/parser';
// @ts-expect-error - no types shipped cleanly for default import in this setup
import traverseModule from '@babel/traverse';
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

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

export function extractSymbols(code: string, relPath: string): FileSymbols | null {
  const isTs = /\.tsx?$/.test(relPath);
  const isJsx = /\.[jt]sx$/.test(relPath);
  // Older/pre-TS codebases (e.g. vue-router circa Flow-era Vue 2) annotate
  // plain .js files with Flow types (`/* @flow */`, `import type X`). The
  // `typescript` and `flow` Babel plugins are mutually exclusive, so a .js
  // file must be sniffed for Flow markers rather than assumed to be untyped.
  const isFlow = !isTs && /^\s*\/\*\s*@flow\b|^\s*\/\/\s*@flow\b/m.test(code);

  let ast;
  try {
    ast = parse(code, {
      sourceType: 'unambiguous',
      plugins: [
        isTs ? 'typescript' : null,
        isFlow ? 'flow' : null,
        isJsx ? 'jsx' : null,
        'classProperties',
        'objectRestSpread',
        'optionalChaining',
        'nullishCoalescingOperator',
        'dynamicImport',
      ].filter(Boolean) as any,
      errorRecovery: true,
    });
  } catch {
    return null;
  }

  const imports: string[] = [];
  const exports: string[] = [];
  const functions: FunctionSymbol[] = [];
  const classes: string[] = [];

  try {
    traverse(ast, {
      ImportDeclaration(path: any) {
        imports.push(path.node.source.value);
      },
      CallExpression(path: any) {
        if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'require') {
          const arg = path.node.arguments[0];
          if (arg && arg.type === 'StringLiteral') imports.push(arg.value);
        }
      },
      ExportNamedDeclaration(path: any) {
        const decl = path.node.declaration;
        if (decl) {
          if (decl.id?.name) exports.push(decl.id.name);
          if (decl.declarations) {
            for (const d of decl.declarations) {
              if (d.id?.name) exports.push(d.id.name);
            }
          }
        }
        for (const spec of path.node.specifiers || []) {
          if (spec.exported?.name) exports.push(spec.exported.name);
        }
      },
      ExportDefaultDeclaration() {
        exports.push('default');
      },
      FunctionDeclaration(path: any) {
        if (path.node.id?.name) {
          functions.push({ name: path.node.id.name, line: path.node.loc?.start.line ?? 0, kind: 'function' });
        }
      },
      FunctionExpression(path: any) {
        // Named function expressions anywhere (e.g. `export default x && function foo() {}`)
        if (path.node.id?.name) {
          functions.push({ name: path.node.id.name, line: path.node.loc?.start.line ?? 0, kind: 'function' });
        }
      },
      ClassDeclaration(path: any) {
        if (path.node.id?.name) classes.push(path.node.id.name);
      },
      ClassMethod(path: any) {
        const key = path.node.key;
        const name = key?.name || key?.value;
        if (name) functions.push({ name, line: path.node.loc?.start.line ?? 0, kind: 'method' });
      },
      // Private methods (`#foo() {}`) are a distinct node type from ClassMethod;
      // the key is a PrivateName wrapping an Identifier at key.id.name, not key.name.
      ClassPrivateMethod(path: any) {
        const name = path.node.key?.id?.name;
        if (name) functions.push({ name: `#${name}`, line: path.node.loc?.start.line ?? 0, kind: 'method' });
      },
      ObjectMethod(path: any) {
        const key = path.node.key;
        const name = key?.name || key?.value;
        if (name) functions.push({ name, line: path.node.loc?.start.line ?? 0, kind: 'method' });
      },
      VariableDeclarator(path: any) {
        const init = path.node.init;
        if (
          init &&
          (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') &&
          path.node.id?.name
        ) {
          functions.push({ name: path.node.id.name, line: path.node.loc?.start.line ?? 0, kind: 'arrow' });
        }
      },
      AssignmentExpression(path: any) {
        // Pattern used by express: `res.send = function send(body) {...}`
        const left = path.node.left;
        const right = path.node.right;
        if (
          left?.type === 'MemberExpression' &&
          left.property?.name &&
          (right?.type === 'FunctionExpression' || right?.type === 'ArrowFunctionExpression')
        ) {
          functions.push({ name: left.property.name, line: path.node.loc?.start.line ?? 0, kind: 'method' });
        }
      },
    });
  } catch {
    // partial results are fine
  }

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exports)],
    functions: dedupeFunctions(functions),
    classes: [...new Set(classes)],
  };
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
