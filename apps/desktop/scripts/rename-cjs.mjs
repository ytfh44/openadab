// Post-build: rename .js → .cjs in dist-electron and rewrite require paths.
import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, "..", "dist-electron");

if (!existsSync(DIST_DIR)) {
  console.log("dist-electron not found, skipping rename");
  process.exit(0);
}

// Step 1: rewrite require() paths in .js files to reference .cjs
function rewriteRequirePaths(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteRequirePaths(full);
    } else if (entry.name.endsWith(".js")) {
      let content = readFileSync(full, "utf8");
      // Replace require("./foo.js") → require("./foo.cjs")
      // and require("../foo.js") → require("../foo.cjs")
      content = content.replace(
        /require\((["'])(\.\.?\/[^"']+?)\.js\1\)/g,
        'require($1$2.cjs$1)'
      );
      // Also replace sourceMappingURL references
      content = content.replace(/(\/\/# sourceMappingURL=.+)\.js\.map/g, "$1.cjs.map");
      writeFileSync(full, content, "utf8");
    }
  }
}

// Step 2: rename .js → .cjs and .js.map → .cjs.map
function renameToCjs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      renameToCjs(full);
    } else if (entry.name.endsWith(".js")) {
      const newPath = full.replace(/\.js$/, ".cjs");
      renameSync(full, newPath);
    } else if (entry.name.endsWith(".js.map")) {
      const newPath = full.replace(/\.js\.map$/, ".cjs.map");
      renameSync(full, newPath);
    }
  }
}

rewriteRequirePaths(DIST_DIR);
renameToCjs(DIST_DIR);

// Step 3: fix .d.ts and .d.ts.map — keep .js references in declarations
for (const entry of readdirSync(DIST_DIR, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile()) continue;
  const full = join(entry.parentPath || entry.path, entry.name);
  if (entry.name.endsWith(".d.ts")) {
    let content = readFileSync(full, "utf8");
    content = content.replace(/\.js(["')])/g, '.cjs$1');
    writeFileSync(full, content, "utf8");
  }
}

console.log("dist-electron: .js → .cjs rename complete");
