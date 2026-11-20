// Run the Crunching test suite in Node: node tests/run.mjs
import { runTests } from '../docs/tests.js';

const t0 = Date.now();
const { results, passed, failed, total } = runTests();
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
console.log(`\n${passed}/${total} passed, ${failed} failed (${Date.now() - t0} ms)`);
process.exit(failed ? 1 : 0);
