// One-shot codemod: eslint --fix converted NestJS constructor-injected class
// imports to `import type`, which erases them from emitDecoratorMetadata and
// breaks DI. Move any type-imported name that appears as a constructor param
// type back to a value import. Uses paren-counting (decorators like
// @InjectQueue('x') nest parentheses, regexes are not enough).
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync("find apps/api/src -name '*.ts'", { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);

function constructorParamTypes(src) {
  const types = new Set();
  let idx = 0;
  while ((idx = src.indexOf('constructor', idx)) !== -1) {
    const open = src.indexOf('(', idx);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const params = src.slice(open + 1, end);
    for (const t of params.matchAll(/:\s*([A-Za-z_][A-Za-z0-9_]*)/g)) types.add(t[1]);
    idx = end;
  }
  return types;
}

let changed = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const ctorTypes = constructorParamTypes(src);
  if (ctorTypes.size === 0) continue;

  let out = src.replace(/import type \{([^}]+)\} from (['"][^'"]+['"]);/g, (full, names, spec) => {
    const parts = names.split(',').map((s) => s.trim()).filter(Boolean);
    const value = [];
    const typeOnly = [];
    for (const p of parts) {
      const bare = p.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      (ctorTypes.has(bare) ? value : typeOnly).push(p);
    }
    if (value.length === 0) return full;
    const stmts = [`import { ${value.join(', ')} } from ${spec};`];
    if (typeOnly.length > 0) stmts.push(`import type { ${typeOnly.join(', ')} } from ${spec};`);
    return stmts.join('\n');
  });

  if (out !== src) {
    writeFileSync(file, out);
    changed++;
    console.log('fixed', file);
  }
}
console.log(`done: ${changed} files`);
