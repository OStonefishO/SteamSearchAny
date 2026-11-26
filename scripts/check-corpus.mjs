// 语料库体检
import fs from 'node:fs';

const c = JSON.parse(fs.readFileSync('data/corpus.json', 'utf8'));
const games = Object.values(c.games);
const td = c.tagDict;
const tag = (id) => td[String(id)]?.zh ?? String(id);

console.log('games', games.length, '| tags', Object.keys(td).length, '| builtAt', c.builtAt);

const nms = c.games['275850'];
console.log('NMS:', nms
  ? { name: nms.name, year: nms.year, price: nms.price, rev: nms.rev, tags: nms.tags.slice(0, 6).map((t) => tag(t.id)) }
  : 'MISSING');

console.log('tagDict sample:', Object.entries(td).slice(0, 8).map(([id, t]) => `${id}:${t.zh}/${t.en}(${t.count})`).join(' | '));

const withRev = games.filter((g) => g.rev && g.rev.total > 0);
console.log('with reviews:', withRev.length);

const gems = games.filter((g) => g.rev && g.rev.total >= 12 && g.rev.total <= 1200 && g.rev.pct >= 85);
console.log('gem candidates (12..1200 revs, >=85%):', gems.length);
for (const g of gems.slice(0, 8)) {
  console.log('  ·', g.name, '|', g.rev.total, 'revs', g.rev.pct + '%', '|', g.year, '|', tag(g.tags[0].id));
}

const years = {};
for (const g of games) years[g.year ?? 0] = (years[g.year ?? 0] ?? 0) + 1;
console.log('years:', Object.entries(years).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([y, n]) => `${y}:${n}`).join(' '));

console.log('missing header:', games.filter((g) => !g.header).length);
console.log('missing price:', games.filter((g) => !g.price).length);

// 标签分布 top15
const counts = new Map();
for (const g of games) for (const t of g.tags) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
console.log(
  'top tags:',
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, n]) => `${tag(id)}(${n})`).join(' ')
);
