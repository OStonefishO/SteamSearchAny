// 数据清理：把「未定档」占位发售年份（2099 / 未来年份）置空，避免出现 2099 年这种鬼东西
import fs from 'node:fs';

const nowYear = new Date().getFullYear();
const LIMIT = nowYear + 1;

for (const file of ['data/corpus.json', 'data/build-state.json']) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bag = raw.games ?? raw.done ?? {};
  let fixed = 0;
  for (const g of Object.values(bag)) {
    if (!g) continue;
    if (Number.isFinite(g.year) && g.year > LIMIT) {
      g.year = null;
      fixed += 1;
    }
    // 未来的 release 时间戳同样视为未定档
    if (Number.isFinite(g.relTs) && new Date(g.relTs * 1000).getUTCFullYear() > LIMIT) {
      g.relTs = null;
      if (g.year === LIMIT) g.year = null;
    }
  }
  fs.writeFileSync(file, JSON.stringify(raw), 'utf8');
  console.log(`${file}: 修正 ${fixed} 条未来年份（>${LIMIT}）`);
}
