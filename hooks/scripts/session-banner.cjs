const { getPackageManager } = require('./lib/package-manager.cjs');
const { detectProjectType } = require('./lib/project-detect.cjs');

const projectDir = process.cwd();
const pm = getPackageManager(projectDir);
const projectInfo = detectProjectType(projectDir);

console.log(`----------------------------------------\n`);
console.log(`Package Manager: ${pm.name} (Source: ${pm.source})`);
console.log(`Languages:       ${projectInfo.languages.join(', ') || 'unknown'}`);
console.log(`Frameworks:      ${projectInfo.frameworks.join(', ') || 'none'}`);
console.log(`Directory:       ${projectDir}`);
console.log(`----------------------------------------\n`);

process.exit(0);
