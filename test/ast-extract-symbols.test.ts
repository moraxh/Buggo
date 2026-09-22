import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSymbols } from '../src/repo/ast.js';

test('extractSymbols (JS): imports, require, named/default exports', () => {
  const code = `
import { foo } from './foo';
const bar = require('./bar');
export function myFunc() {}
export const myArrow = () => {};
export default class MyClass {}
`;
  const sym = extractSymbols(code, 'file.js')!;
  assert.ok(sym.imports.includes('./foo'));
  assert.ok(sym.imports.includes('./bar'));
  assert.ok(sym.exports.includes('myFunc'));
  assert.ok(sym.exports.includes('myArrow'));
  assert.ok(sym.exports.includes('default'));
  assert.ok(sym.functions.some((f) => f.name === 'myFunc' && f.kind === 'function'));
  assert.ok(sym.functions.some((f) => f.name === 'myArrow' && f.kind === 'arrow'));
});

test('extractSymbols (JS): class methods, private methods, static methods', () => {
  const code = `
class Widget {
  render() {}
  #internalHelper() {}
  static create() {}
}
`;
  const sym = extractSymbols(code, 'file.js')!;
  assert.ok(sym.classes.includes('Widget'));
  assert.ok(sym.functions.some((f) => f.name === 'render' && f.kind === 'method'));
  assert.ok(sym.functions.some((f) => f.name === '#internalHelper' && f.kind === 'method'));
  assert.ok(sym.functions.some((f) => f.name === 'create' && f.kind === 'method'));
});

test('extractSymbols (JS): object method shorthand and the res.send = function pattern', () => {
  const code = `
const obj = {
  handler() {},
};
res.send = function send(body) {};
`;
  const sym = extractSymbols(code, 'file.js')!;
  assert.ok(sym.functions.some((f) => f.name === 'handler' && f.kind === 'method'));
  assert.ok(sym.functions.some((f) => f.name === 'send' && f.kind === 'method'));
});

test('extractSymbols (TS): typed function and interface-adjacent class both parse', () => {
  const code = `
export function add(a: number, b: number): number {
  return a + b;
}
class Store<T> {
  get(key: string): T | undefined { return undefined; }
}
`;
  const sym = extractSymbols(code, 'file.ts')!;
  assert.ok(sym.functions.some((f) => f.name === 'add'));
  assert.ok(sym.classes.includes('Store'));
  assert.ok(sym.functions.some((f) => f.name === 'get'));
});

test('extractSymbols (TSX): JSX syntax parses without throwing', () => {
  const code = `
export function Button() {
  return <button onClick={() => {}}>Click</button>;
}
`;
  const sym = extractSymbols(code, 'file.tsx')!;
  assert.ok(sym.functions.some((f) => f.name === 'Button'));
});

test('extractSymbols (Python): functions, classes, methods, imports', () => {
  const code = `
import os
from collections import OrderedDict

def compute_total(items):
    return sum(items)

class Order:
    def __init__(self, items):
        self.items = items

    def total(self):
        return compute_total(self.items)

def _private_helper():
    pass
`;
  const sym = extractSymbols(code, 'file.py')!;
  assert.ok(sym.imports.includes('os'));
  assert.ok(sym.imports.includes('collections'));
  assert.ok(sym.functions.some((f) => f.name === 'compute_total' && f.kind === 'function'));
  assert.ok(sym.classes.includes('Order'));
  assert.ok(sym.functions.some((f) => f.name === '__init__' && f.kind === 'method'));
  assert.ok(sym.functions.some((f) => f.name === 'total' && f.kind === 'method'));
  assert.ok(sym.exports.includes('compute_total'));
  assert.ok(sym.exports.includes('Order'));
  assert.ok(!sym.exports.includes('_private_helper'), 'underscore-prefixed top-level names are not treated as public');
});

test('extractSymbols: unsupported extension returns null', () => {
  assert.equal(extractSymbols('fn main() {}', 'file.rs'), null);
});

test('extractSymbols: malformed code does not throw', () => {
  assert.doesNotThrow(() => extractSymbols('function (', 'file.js'));
});
