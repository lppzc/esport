/** 打包核心：rollup 编程式 API（进程内，无子进程） */
import { rollup } from 'rollup';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../rollup.config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const root = join(here, '..');
export const dist = join(root, 'dist');

export async function buildOnce() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });
  const bundle = await rollup(config);
  await bundle.write(config.output);
  await bundle.close();
  // 原始数据 JSON 一并放入 dist 便于核对
  cpSync(join(root, 'src', 'data'), join(dist, 'data'), { recursive: true });
}

