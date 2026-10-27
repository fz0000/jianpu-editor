/**
 * 清理本地临时文件与构建产物（发布 / 提交前跑一遍）。
 * 运行： npm run clean
 *
 * 只删生成物，**绝不动** node_modules（删它得跑 npm ci，交给用户自己决定）、
 * 源码、测试与仓库根目录的本地 MIDI / 工程文件（见 .gitignore）。
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 固定要清的目录 */
const DIRS = ['dist', 'dist-ssr', '.vite', 'coverage', '.tmp-profile', 'tmp-profile', '.tmp', 'tmp'];

const removed = [];

function remove(target, label) {
  rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  removed.push(label);
}

for (const name of DIRS) {
  const target = join(root, name);
  if (existsSync(target)) remove(target, `${name}/`);
}

// 根目录下的 *.log（dev.log 之类），只扫一层，不进子目录
for (const entry of readdirSync(root)) {
  if (!entry.endsWith('.log')) continue;
  const target = join(root, entry);
  if (statSync(target).isFile()) remove(target, entry);
}

console.log(removed.length > 0 ? `已清理：${removed.join('、')}` : '没有需要清理的临时文件');
