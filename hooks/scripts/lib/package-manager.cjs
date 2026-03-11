const fs = require('fs');
const path = require('path');
const { readFile } = require('./utils.cjs');

const PACKAGE_MANAGERS = {
  npm: { name: 'npm', lockFile: 'package-lock.json', installCmd: 'npm install', runCmd: 'npm run', execCmd: 'npx' },
  pnpm: { name: 'pnpm', lockFile: 'pnpm-lock.yaml', installCmd: 'pnpm install', runCmd: 'pnpm', execCmd: 'pnpm dlx' },
  yarn: { name: 'yarn', lockFile: 'yarn.lock', installCmd: 'yarn', runCmd: 'yarn', execCmd: 'yarn dlx' },
  bun: { name: 'bun', lockFile: 'bun.lock', installCmd: 'bun install', runCmd: 'bun run', execCmd: 'bunx' }
};

const DETECTION_PRIORITY = ['pnpm', 'bun', 'yarn', 'npm'];

function getPackageManager(projectDir = process.cwd()) {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkgContent = readFile(pkgPath);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      if (pkg.packageManager) {
        const pmName = pkg.packageManager.split('@')[0];
        if (PACKAGE_MANAGERS[pmName]) return { name: pmName, config: PACKAGE_MANAGERS[pmName], source: 'package.json' };
      }
    } catch (e) {}
  }

  for (const pmName of DETECTION_PRIORITY) {
    const pm = PACKAGE_MANAGERS[pmName];
    if (fs.existsSync(path.join(projectDir, pm.lockFile))) {
      return { name: pmName, config: pm, source: 'lock-file' };
    }
  }

  return { name: 'npm', config: PACKAGE_MANAGERS.npm, source: 'default' };
}

module.exports = { PACKAGE_MANAGERS, getPackageManager };
