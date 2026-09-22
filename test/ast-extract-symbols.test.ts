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

test('extractSymbols (MDX): import and exported function survive amid markdown prose', () => {
  const code = `
import Counter from '../components/Counter';

# Hello World

This is **markdown** prose with a [link](/foo).

export function greet(name) {
  return 'hi ' + name;
}

<Counter initial={5} />
`;
  const sym = extractSymbols(code, 'src/content/post.mdx')!;
  assert.ok(sym.imports.includes('../components/Counter'));
  assert.ok(sym.functions.some((f) => f.name === 'greet'));
});

test('extractSymbols (.mts/.cts): parsed with the TS grammar', () => {
  const mts = extractSymbols('export function loadConfig(): void {}', 'scripts/build.mts')!;
  assert.ok(mts.functions.some((f) => f.name === 'loadConfig'));

  const cts = extractSymbols('export function legacyLoader(): void {}', 'scripts/legacy.cts')!;
  assert.ok(cts.functions.some((f) => f.name === 'legacyLoader'));
});

test('extractSymbols: unsupported extension returns null', () => {
  assert.equal(extractSymbols('fn main() {}', 'file.rs'), null);
});

test('extractSymbols: malformed code does not throw', () => {
  assert.doesNotThrow(() => extractSymbols('function (', 'file.js'));
});

test('extractSymbols (Astro): frontmatter fence parses as TS', () => {
  const code = `---
import Layout from '../layouts/Layout.astro';
export function formatTitle(title: string): string {
  return title.toUpperCase();
}
const items = [1, 2, 3];
---
<Layout>
  <h1>{formatTitle('hello')}</h1>
</Layout>
`;
  const sym = extractSymbols(code, 'src/pages/index.astro')!;
  assert.ok(sym.imports.includes('../layouts/Layout.astro'));
  assert.ok(sym.functions.some((f) => f.name === 'formatTitle'));
  assert.ok(sym.exports.includes('formatTitle'));
});

test('extractSymbols (Astro): no frontmatter fence returns empty symbols, not null', () => {
  const sym = extractSymbols('<h1>Static</h1>', 'src/pages/static.astro')!;
  assert.deepEqual(sym, { imports: [], exports: [], functions: [], classes: [] });
});

test('extractSymbols (Vue): <script setup lang="ts"> parses as TS', () => {
  const code = `
<template>
  <button @click="increment">{{ count }}</button>
</template>
<script setup lang="ts">
import { ref } from 'vue';
const count = ref(0);
function increment(): void {
  count.value++;
}
</script>
`;
  const sym = extractSymbols(code, 'src/components/Counter.vue')!;
  assert.ok(sym.imports.includes('vue'));
  assert.ok(sym.functions.some((f) => f.name === 'increment'));
});

test('extractSymbols (Svelte): plain <script> parses as JS', () => {
  const code = `
<script>
  import { onMount } from 'svelte';
  export function greet(name) {
    return 'hi ' + name;
  }
</script>
<p>Hello</p>
`;
  const sym = extractSymbols(code, 'src/Greeting.svelte')!;
  assert.ok(sym.imports.includes('svelte'));
  assert.ok(sym.functions.some((f) => f.name === 'greet'));
});

test('extractSymbols (CSS): top-level selectors reported as exports', () => {
  const code = `
.card { color: red; }
#header { display: flex; }
.card .title { font-weight: bold; }
`;
  const sym = extractSymbols(code, 'src/styles/global.css')!;
  assert.ok(sym.exports.includes('.card'));
  assert.ok(sym.exports.includes('#header'));
});

test('extractSymbols (HTML): script src and ids reported', () => {
  const code = `
<html>
<head><script src="/main.js"></script></head>
<body><div id="app"></div></body>
</html>
`;
  const sym = extractSymbols(code, 'index.html')!;
  assert.ok(sym.imports.includes('/main.js'));
  assert.ok(sym.exports.includes('#app'));
});

test('extractSymbols (JSON): top-level keys reported as exports', () => {
  const code = JSON.stringify({ name: 'buggo', scripts: { build: 'tsc' } });
  const sym = extractSymbols(code, 'tsconfig.json')!;
  assert.ok(sym.exports.includes('name'));
  assert.ok(sym.exports.includes('scripts'));
});
