import { URL, fileURLToPath } from 'node:url';

export const frameworkAliases = [
  ['router', 'router'],
  ['compat/router', 'compat-router'],
  ['navigation', 'navigation'],
  ['link', 'link'],
  ['head', 'head'],
  ['dynamic', 'dynamic'],
  ['script', 'script'],
  ['document', 'document'],
  ['error', 'error'],
].map(([name, shim]) => ({
  find: new RegExp(`^next/${name}(?:\\.js)?$`),
  replacement: fileURLToPath(
    new URL(`./node_modules/vinext/dist/shims/${shim}.js`, import.meta.url),
  ),
}));
