const fs = require('fs');
const path = require('path');

const CLIENT_DIR = path.join(__dirname, '../dist/client');
const OUT_DIR = path.join(__dirname, '../out');

// Vinext emits the base path in its client tree; the embedded bundle is mounted
// at /clickstack by its host, so expose that subtree at the export root.
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.cpSync(path.join(CLIENT_DIR, 'clickstack'), OUT_DIR, { recursive: true });
fs.copyFileSync(
  path.join(CLIENT_DIR, 'clickstack.html'),
  path.join(OUT_DIR, 'index.html'),
);
fs.copyFileSync(
  path.join(CLIENT_DIR, '404.html'),
  path.join(OUT_DIR, '404.html'),
);
const PYODIDE_PATH = path.join(OUT_DIR, 'pyodide');
const ALLOWED_EXTENSIONS = [
  '.html',
  '.js',
  '.css',
  '.map',
  '.woff2',
  '.png',
  '.svg',
  '.ico',
];
// Specific filenames kept regardless of extension. `.json` is NOT allow-listed
// broadly on purpose — the export deletes Next's route-data JSON to keep the
// bundle small — so the "What's new" data is rescued by name.
const ALLOWED_FILENAMES = ['whats-new.json'];

// Removes pyodide from the static build. We want a small bundle size, so that feature would just be ignored
if (fs.existsSync(PYODIDE_PATH)) {
  fs.rmSync(PYODIDE_PATH, { recursive: true, force: true });
  console.log('Removed pyodide from static build');
}

// Remove all files that are not in ALLOWED_EXTENSIONS
function removeNonEssentialFiles(dir) {
  let removedCount = 0;

  function walkDir(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          !ALLOWED_EXTENSIONS.includes(ext) &&
          !ALLOWED_FILENAMES.includes(entry.name)
        ) {
          fs.unlinkSync(fullPath);
          console.log(
            `Removed non-essential file: ${path.relative(OUT_DIR, fullPath)}`,
          );
          removedCount++;
        }
      }
    }
  }

  walkDir(dir);
  console.log(`Removed ${removedCount} non-essential file(s)`);
}

// Execute cleanup and optimization
if (fs.existsSync(OUT_DIR)) {
  removeNonEssentialFiles(OUT_DIR);
} else {
  console.error('No out directory found. Build preparation failed.');
  process.exit(1);
}
