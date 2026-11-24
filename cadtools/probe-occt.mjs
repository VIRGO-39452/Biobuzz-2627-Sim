import { readFileSync } from 'node:fs';
import occtimportjs from 'occt-import-js';
const t0 = Date.now();
const occt = await occtimportjs();
const buf = readFileSync(process.argv[2]);
console.log('read', buf.length, 'bytes');
const r = occt.ReadStepFile(buf, { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.002, angularDeflection: 0.5 });
console.log('success', r.success, 'meshes', r.meshes?.length, 'root children', r.root?.children?.length, 'sec', (Date.now() - t0) / 1000);
