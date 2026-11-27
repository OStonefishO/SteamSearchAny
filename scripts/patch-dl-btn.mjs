// 在顶栏插入「下载 Windows 桌面版」入口
import fs from 'node:fs';

const P = 'D:/综合创作/steam-lighthouse/public/index.html';
const URL =
  'https://github.com/OStonefishO/SteamSearchAny-web/releases/latest/download/SteamSearchAny.exe';

let s = fs.readFileSync(P, 'utf8');
if (s.includes('releases/latest/download/SteamSearchAny.exe')) {
  console.log('已存在下载按钮');
  process.exit(0);
}

const anchor = '<button class="icon-btn" id="uiBtn"';
if (!s.includes(anchor)) {
  console.log('MISS 锚点');
  process.exit(1);
}

const btn =
  '<a class="icon-btn" href="' + URL + '" title="下载 Windows 桌面版（2.6 MB，双击即用）" download rel="noreferrer">⬇</a>\n  ';

s = s.replace(anchor, btn + anchor);
fs.writeFileSync(P, s, 'utf8');
console.log('已加入下载按钮');
