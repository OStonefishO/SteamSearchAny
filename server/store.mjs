// 极简 JSON 持久化：原子写入 + 内存缓存
import fs from 'node:fs/promises';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.cwd(), 'data');

export async function ensureDir(dir = DATA_DIR) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson(file, fallback = null) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt.replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

export async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(value), 'utf8');
  await fs.rename(tmp, file);
}

export function dataPath(...parts) {
  return path.join(DATA_DIR, ...parts);
}
