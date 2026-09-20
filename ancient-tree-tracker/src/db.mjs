// JSON 文件持久化：整库读入内存，写时原子替换。单机单进程足够。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export const EMPTY_DB = { trees: {}, exams: {}, measures: {}, trackings: {}, followups: {} };

export class JsonDB {
  constructor(file) {
    this.file = file;
    this.data = structuredClone(EMPTY_DB);
    this._saving = Promise.resolve();
  }

  async load() {
    if (!existsSync(this.file)) {
      await mkdir(path.dirname(this.file), { recursive: true });
      await this._persist();
      return;
    }
    const raw = await readFile(this.file, 'utf8');
    const parsed = JSON.parse(raw);
    this.data = { ...structuredClone(EMPTY_DB), ...parsed };
  }

  async _persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  // 串行化写入，避免并发请求互相覆盖
  save() {
    this._saving = this._saving.then(() => this._persist());
    return this._saving;
  }
}
