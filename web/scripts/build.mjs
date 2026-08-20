/** 生产构建：打包 + 拷贝数据，输出到 dist/ */
import { buildOnce } from './build-lib.mjs';

await buildOnce();
console.log('✔ build complete -> dist/');
