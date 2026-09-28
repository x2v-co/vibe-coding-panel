import fs from 'node:fs';
import path from 'node:path';

// Pins the generated service worker to this build and emits dist/version.json.
// Vite copies public/ to dist/ at renderStart, so the on-disk sw.js can be
// rewritten in generateBundle; version.json rides along with the bundle.
export function releasePlugin({ revision, version }) {
  let outDir;
  return {
    name: 'panel-release',
    apply: 'build',
    configResolved(resolvedConfig) {
      outDir = resolvedConfig.build.outDir;
    },
    generateBundle() {
      const swPath = path.join(outDir, 'sw.js');
      if (fs.existsSync(swPath)) {
        const source = fs
          .readFileSync(swPath, 'utf8')
          .replace(/__PANEL_REVISION__/g, revision)
          .replace(/__PANEL_VERSION__/g, version);
        fs.writeFileSync(swPath, source);
      } else {
        this.warn(`Expected service worker at ${swPath}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ name: 'vibe-coding-panel', version, revision }, null, 2)}\n`,
      });
    },
  };
}
