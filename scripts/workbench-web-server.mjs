#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.UXCOMPILER_WORKBENCH_PORT ?? 8788);
const host = args.host ?? "127.0.0.1";
const artifactRoot = args.artifacts ?? "/artifacts/sample";
const root = resolve(process.cwd());

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".map", "application/json; charset=utf-8"],
  [".arb", "application/json; charset=utf-8"],
  [".dart", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    if (requestUrl.pathname === "/") {
      const workbenchUrl = new URL("/apps/workbench-web/", `http://${host}:${port}`);
      workbenchUrl.searchParams.set("artifacts", artifactRoot);
      response.writeHead(302, { location: workbenchUrl.pathname + workbenchUrl.search });
      response.end();
      return;
    }

    const filePath = await resolveRequestPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      response.end(body);
    }
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, host, () => {
  const url = new URL("/apps/workbench-web/", `http://${host}:${port}`);
  url.searchParams.set("artifacts", artifactRoot);
  console.log(`UXCompiler Workbench listening on ${url.toString()}`);
  console.log(`Serving workspace root ${root}`);
});

async function resolveRequestPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath.endsWith("/") ? `${decodedPath}index.html` : decodedPath;
  const filePath = resolve(root, `.${requestPath}`);
  const relation = relative(root, filePath);
  if (relation.startsWith(`..${sep}`) || relation === ".." || relation === "") return undefined;
  try {
    const info = await stat(filePath);
    if (info.isFile()) return filePath;
  } catch {
    return undefined;
  }
  return undefined;
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--port" || value === "--host" || value === "--artifacts") {
      result[value.slice(2)] = values[index + 1];
      index += 1;
    }
  }
  return result;
}
