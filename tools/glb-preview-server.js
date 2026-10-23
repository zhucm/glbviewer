import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createGlbPreviewMiddleware() {
  const files = new Map();
  return async (req, res, next) => {
    if (!req.url.startsWith('/__glb-preview/')) return next();
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    try {
      const base = new URL(`http://${req.headers.host}`);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
          (req.headers.origin && new URL(req.headers.origin).host !== base.host)) {
        return json(403, { error: '仅允许本机同源访问' });
      }
      if (req.method !== 'GET') return json(405, { error: '仅支持读取' });
      const url = new URL(req.url, base);
      if (url.pathname === '/__glb-preview/list') {
        const directory = url.searchParams.get('directory')?.trim();
        if (!directory || !isAbsolute(directory)) return json(400, { error: '请输入本机目录的绝对路径' });
        const root = await realpath(directory);
        const entries = [];
        const pendingFiles = [];
        const scan = async (folder) => {
          for (const entry of await readdir(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) await scan(path);
            else if (entry.isFile() && /\.glb$/i.test(entry.name)) {
              const id = randomUUID();
              pendingFiles.push([id, path]);
              entries.push({ name: entry.name, path: relative(root, path).split('\\').join('/'), url: `/__glb-preview/file?id=${id}` });
            }
          }
        };
        await scan(root);
        for (const [id, path] of pendingFiles) files.set(id, path);
        return json(200, { directory: root, entries });
      }
      if (url.pathname === '/__glb-preview/file') {
        const path = files.get(url.searchParams.get('id'));
        if (!path) return json(404, { error: '文件不在目录列表中，请重新设置目录' });
        const info = await stat(path);
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': info.size, 'Cache-Control': 'no-store' });
        const stream = createReadStream(path);
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
        return;
      }
      return json(404, { error: '接口不存在' });
    } catch (error) {
      const message = ['ENOENT', 'ENOTDIR'].includes(error.code) ? '目录或文件不存在' :
        ['EACCES', 'EPERM'].includes(error.code) ? '没有读取此目录或文件的权限' : '无法读取目录或文件';
      return json(400, { error: message });
    }
  };
}
