const fs = require('node:fs')
const path = require('node:path')
const { readFile } = require('./utils.cjs')

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
    devCmd: 'npm run dev',
  },
  pnpm: {
    name: 'pnpm',
    lockFile: 'pnpm-lock.yaml',
    installCmd: 'pnpm install',
    runCmd: 'pnpm',
    execCmd: 'pnpm dlx',
    testCmd: 'pnpm test',
    buildCmd: 'pnpm build',
    devCmd: 'pnpm dev',
  },
  yarn: {
    name: 'yarn',
    lockFile: 'yarn.lock',
    installCmd: 'yarn',
    runCmd: 'yarn',
    execCmd: 'yarn dlx',
    testCmd: 'yarn test',
    buildCmd: 'yarn build',
    devCmd: 'yarn dev',
  },
  bun: {
    name: 'bun',
    lockFile: 'bun.lockb',
    installCmd: 'bun install',
    runCmd: 'bun run',
    execCmd: 'bunx',
    testCmd: 'bun test',
    buildCmd: 'bun run build',
    devCmd: 'bun run dev',
  },
  uv: {
    name: 'uv',
    lockFile: 'uv.lock',
    installCmd: 'uv sync',
    runCmd: 'uv run',
    execCmd: 'uv exec',
    testCmd: 'uv test',
    buildCmd: 'uv build',
    devCmd: 'uv dev',
  },
}

const DETECTION_PRIORITY = ['pnpm', 'bun', 'yarn', 'npm', 'uv']

/**
 * Detect package manager from package.json packageManager field
 * @param {string} projectDir
 * @returns {string|null} package manager name or null
 */
function detectFromPackageJson(projectDir = require('node:process').cwd()) {
  const packageJsonPath = path.join(projectDir, 'package.json')
  const content = readFile(packageJsonPath)

  if (content) {
    try {
      const pkg = JSON.parse(content)
      if (pkg.packageManager) {
        // Format: "pnpm@8.6.0" or just "pnpm"
        const pmName = pkg.packageManager.split('@')[0]
        if (PACKAGE_MANAGERS[pmName]) {
          return pmName
        }
      }
    }
    catch {
      // Invalid package.json
    }
  }
  return null
}

/**
 * Detect package manager from lock file in project directory
 * @param {string} projectDir
 * @returns {string|null} package manager name or null
 */
function detectFromLockFile(projectDir = require('node:process').cwd()) {
  for (const pmName of DETECTION_PRIORITY) {
    const pm = PACKAGE_MANAGERS[pmName]
    const lockFilePath = path.join(projectDir, pm.lockFile)

    if (fs.existsSync(lockFilePath)) {
      return pmName
    }
  }
  return null
}

/**
 * Get the package manager to use for current project
 *
 * Detection priority:
 * 1. Environment variable
 * 2. package.json packageManager field
 * 3. Lock file detection
 * 4. Default to npm
 *
 * @param {object} options - Options
 * @param {string} options.projectDir - Project directory to detect from (default: cwd)
 * @returns {{ name: string, config: object, source: string }}
 */
function getPackageManager(options = {}) {
  const { projectDir = require('node:process').cwd() } = options

  // 1. Check environment variable
  const envPm = require('node:process').env.PACKAGE_MANAGER
  if (envPm && PACKAGE_MANAGERS[envPm]) {
    return {
      name: envPm,
      config: PACKAGE_MANAGERS[envPm],
      source: 'environment',
    }
  }

  // 2. Check package.json packageManager field
  const fromPackageJson = detectFromPackageJson(projectDir)
  if (fromPackageJson) {
    return { name: fromPackageJson, config: PACKAGE_MANAGERS[fromPackageJson], source: 'package.json' }
  }

  // 3. Check lock file
  const fromLockFile = detectFromLockFile(projectDir)
  if (fromLockFile) {
    return { name: fromLockFile, config: PACKAGE_MANAGERS[fromLockFile], source: 'lock-file' }
  }

  // 4. Default to npm (always available with Node.js)
  return { name: 'npm', config: PACKAGE_MANAGERS.npm, source: 'default' }
}

module.exports = { PACKAGE_MANAGERS, DETECTION_PRIORITY, detectFromPackageJson, detectFromLockFile, getPackageManager }
