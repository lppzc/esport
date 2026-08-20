/**
 * Rollup 配置：TypeScript + React 打包。
 * 全链路进程内执行（rollup native 为 dlopen 加载，无子进程），适配沙箱环境。
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = here; // rollup.config.mjs 位于项目根（web/）

/** 把 import 的 CSS 收集起来，输出为单个 app.css 资源 */
function css() {
  const styles = new Map();
  return {
    name: 'collect-css',
    transform(code, id) {
      if (id.endsWith('.css')) {
        styles.set(id, code);
        return { code: 'export default ""', map: null };
      }
      return null;
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'app.css', source: [...styles.values()].join('\n') });
    },
  };
}

/** JSON → ESM default export（JSON 是合法 JS 字面量，直接内联） */
function json() {
  return {
    name: 'inline-json',
    transform(code, id) {
      if (id.endsWith('.json')) {
        return { code: `const data = ${code.trim()};\nexport default data;`, map: null };
      }
      return null;
    },
  };
}

/** react/react-dom 生产分支切换 */
function replaceNodeEnv() {
  return {
    name: 'replace-node-env',
    transform(code, id) {
      if (id.includes('node_modules') && code.includes('process.env.NODE_ENV')) {
        return code.replace(/process\.env\.NODE_ENV/g, '"production"');
      }
      return null;
    },
  };
}

/** 生成 dist/index.html（引用打包产物） */
function html() {
  return {
    name: 'emit-html',
    buildStart() {
      this.addWatchFile(join(root, 'index.html'));
    },
    generateBundle() {
      let tpl = readFileSync(join(root, 'index.html'), 'utf8');
      tpl = tpl.replace(
        '<script type="module" src="/src/main.tsx"></script>',
        '<link rel="stylesheet" href="./app.css" />\n    <script type="module" src="./app.js"></script>'
      );
      this.emitFile({ type: 'asset', fileName: 'index.html', source: tpl });
    },
  };
}

export default {
  input: join(root, 'src', 'main.tsx'),
  output: {
    dir: join(root, 'dist'),
    format: 'esm',
    entryFileNames: 'app.js',
    chunkFileNames: '[name]-[hash].js',
    assetFileNames: '[name][extname]',
  },
  plugins: [
    replaceNodeEnv(),
    css(),
    json(),
    nodeResolve({ extensions: ['.ts', '.tsx', '.js'] }),
    commonjs(),
    typescript({
      tsconfig: join(root, 'tsconfig.json'),
      compilerOptions: {
        noEmit: false,
        declaration: false,
        declarationMap: false,
        allowImportingTsExtensions: false,
        module: 'ESNext',
      },
      exclude: ['node_modules/**'],
    }),
    html(),
  ],
  onwarn(warning, warn) {
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    warn(warning);
  },
};
