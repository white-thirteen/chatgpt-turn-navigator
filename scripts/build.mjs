import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const header = `// ==UserScript==
// @name         ChatGPT 轮次导航 / Turn Navigator
// @namespace    local.chatgpt.turn-navigator
// @version      0.1.1
// @homepageURL  https://github.com/white-thirteen/chatgpt-turn-navigator
// @description  本地只读对话导航：悬停预览、轮次跳转、阅读位置高亮。
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==
`;
await mkdir(path.join(root, 'build'), { recursive: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/index.js')],
  outfile: path.join(root, 'build/turn-navigator.js'),
  bundle: true, format: 'iife', target: ['chrome109', 'firefox115'],
  loader: { '.css': 'text' }, legalComments: 'inline', charset: 'utf8',
  banner: { js: `// Geometry, state model and interaction semantics ported from DeepSeek Harness
// packages/client/ui-chat/src/client/chat/TurnNavigator.js
// (c) DeepSeek, MIT License — https://github.com/deepseek-ai/deepseek-harness
// Reimplemented from the supplied specification; upstream source parity is unverified.` }
});
const bundle = await readFile(path.join(root, 'build/turn-navigator.js'), 'utf8');
await writeFile(path.join(root, 'dist/turn-navigator.user.js'), header + bundle);
console.log('Built dist/turn-navigator.user.js');
