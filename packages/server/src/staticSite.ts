import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";

// The built client (packages/client/dist), served by the game server itself so the whole game is one address and an
// invite link is just a URL. The build is about 2 MB, so every file is read into memory once at start, and the ones
// that shrink are compressed once, both ways: brotli takes the mech models from about 900 kB to under 100 kB, and
// plenty of hosts do not compress `model/gltf-binary` themselves. Only files in the build can be asked for, so a
// path can never reach outside it.

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  json: "application/json", glb: "model/gltf-binary", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  woff2: "font/woff2", txt: "text/plain; charset=utf-8",
};
// Already compressed formats gain nothing from another pass.
const SHRINKS = new Set(["html", "js", "css", "json", "glb", "svg", "txt"]);

interface File {
  type: string;
  raw: Buffer;
  br: Buffer | null;
  gzip: Buffer | null;
  cache: string;
}

export interface StaticSite {
  serve(request: IncomingMessage, response: ServerResponse): boolean; // false when no file matches the path
  fileCount: number;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

export function loadStaticSite(dir: string): StaticSite {
  const files = new Map<string, File>();
  for (const path of filesUnder(dir)) {
    const url = `/${relative(dir, path).split(sep).join("/")}`;
    const ext = url.slice(url.lastIndexOf(".") + 1).toLowerCase();
    const type = TYPES[ext];
    if (!type) continue; // leftovers such as .gitkeep
    const raw = readFileSync(path);
    const shrinks = SHRINKS.has(ext) && raw.length > 1024;
    const br = shrinks ? brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : null;
    const gzip = shrinks ? gzipSync(raw, { level: 9 }) : null;
    // Vite names everything under /assets/ by its contents, so those never change; pages and models can.
    const cache = url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    files.set(url, { type, raw, br: br && br.length < raw.length ? br : null, gzip: gzip && gzip.length < raw.length ? gzip : null, cache });
  }
  const page = files.get("/index.html");
  if (page) files.set("/", page);

  return {
    fileCount: files.size,
    serve(request, response) {
      if (request.method !== "GET" && request.method !== "HEAD") return false;
      const path = new URL(request.url ?? "/", "http://site").pathname;
      const file = files.get(path);
      if (!file) return false;
      const accepts = String(request.headers["accept-encoding"] ?? "");
      const [body, encoding] = file.br && /\bbr\b/.test(accepts) ? [file.br, "br"] : file.gzip && /\bgzip\b/.test(accepts) ? [file.gzip, "gzip"] : [file.raw, null];
      response.writeHead(200, {
        "Content-Type": file.type, "Content-Length": body.length, "Cache-Control": file.cache, Vary: "Accept-Encoding",
        "X-Content-Type-Options": "nosniff", ...(encoding ? { "Content-Encoding": encoding } : {}),
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return true;
    },
  };
}
