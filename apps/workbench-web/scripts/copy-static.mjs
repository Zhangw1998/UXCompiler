import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const files = [
  ["src/styles.css", "dist/styles.css"]
];

for (const [from, to] of files) {
  const output = resolve(to);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(from), output);
}

console.log("workbench-web static assets copied");
