const fs = require('fs');
const path = require('path');
const { readFile } = require('./utils.cjs');

// Package manager definitions
const PACKAGE_MANAGERS = {
  npm: {
    name: 'npm',
    lockFile: 'package-lock.json',
    installCmd: 'npm install',
    runCmd: 'npm run',
    execCmd: 'npx',
    testCmd: 'npm test',
    buildCmd: 'npm run build',
    devCmd: 'npm run dev'
  },
  pnpm: {
    name: 'pnpm',
    lockFile: 'pnpm-lock.yaml',
    installCmd: 'pnpm install',
    runCmd: 'pnpm',
    execCmd: 'pnpm dlx',
    testCmd: 'pnpm test',
    buildCmd: 'pnpm build',
    devCmd: 'pnpm dev'
  },
  yarn: {
    name: 'yarn',
    lockFile: 'yarn.lock',
    installCmd: 'yarn',
    runCmd: 'yarn',
    execCmd: 'yarn dlx',
    testCmd: 'yarn test',
    buildCmd: 'yarn build',
    devCmd: 'yarn dev'
  },
  bun: {
    name: 'bun',
    lockFile: 'bun.lockb',
    installCmd: 'bun install',
    runCmd: 'bun run',
    execCmd: 'bunx',
    testCmd: 'bun test',
    buildCmd: 'bun run build',
    devCmd: 'bun run dev'
  },
  uv: {
    name: 'uv',
    lockFile: 'uv.lock',
    installCmd: 'uv sync',
    runCmd: 'uv run',
    execCmd: 'uv exec',
    testCmd: 'uv test',
    buildCmd: 'uv build',
    devCmd: 'uv dev'
  }
};

const DETECTION_PRIORITY = ['pnpm', 'bun', 'yarn', 'npm', 'uv'];

/**
 * Detect package manager from package.json packageManager field
 * @param {string} projectDir
 * @returns {string|null} package manager name or null
 */
function detectFromPackageJson(projectDir = process.cwd()) {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkgContent = readFile(pkgPath);
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      if (pkg.packageManager) {
        const pmName = pkg.packageManager.split('@')[0];
        if (PACKAGE_MANAGERS[pmName]) return pmName;
      }
    } catch {}
  }
  return null;
}

/**
 * Detect package manager from lock file in project directory
 * @param {string} projectDir
 * @returns {string|null} package manager name or null
 */
function detectFromLockFile(projectDir = process.cwd()) {
  for (const pmName of DETECTION_PRIORITY) {
    const pm = PACKAGE_MANAGERS[pmName];
    if (fs.existsSync(path.join(projectDir, pm.lockFile))) {
      return pmName;
    }
  }
  return null;
}

/**
 * Get the package manager to use for current project
 *
 * Detection priority:
 * 1. package.json packageManager field
 * 2. Lock file detection
 * 3. Default to npm
 *
 * @param {string} projectDir - Project directory to detect from (default: cwd)
 * @returns {{ name: string, config: object, source: string }}
 */
function getPackageManager(projectDir = process.cwd()) {
  const fromPackageJson = detectFromPackageJson(projectDir);
  if (fromPackageJson) {
    return { name: fromPackageJson, config: PACKAGE_MANAGERS[fromPackageJson], source: 'package.json' };
  }

  const fromLockFile = detectFromLockFile(projectDir);
  if (fromLockFile) {
    return { name: fromLockFile, config: PACKAGE_MANAGERS[fromLockFile], source: 'lock-file' };
  }

  return { name: 'npm', config: PACKAGE_MANAGERS.npm, source: 'default' };
}

module.exports = { PACKAGE_MANAGERS, DETECTION_PRIORITY, detectFromPackageJson, detectFromLockFile, getPackageManager };
