const fs = require('fs');
const path = require('path');

const LANGUAGE_RULES = [
  { type: 'python', markers: ['requirements.txt', 'pyproject.toml', 'setup.py'], extensions: ['.py'] },
  { type: 'typescript', markers: ['tsconfig.json'], extensions: ['.ts', '.tsx'] },
  { type: 'javascript', markers: ['package.json', 'jsconfig.json'], extensions: ['.js', '.jsx'] },
  { type: 'golang', markers: ['go.mod'], extensions: ['.go'] },
  { type: 'rust', markers: ['Cargo.toml'], extensions: ['.rs'] },
  { type: 'php', markers: ['composer.json'], extensions: ['.php'] }
];

const FRAMEWORK_RULES = [
  { framework: 'nextjs', language: 'typescript', markers: ['next.config.js', 'next.config.ts'], packageKeys: ['next'] },
  { framework: 'react', language: 'typescript', markers: [], packageKeys: ['react'] },
  { framework: 'vue', language: 'typescript', markers: ['vue.config.js'], packageKeys: ['vue'] },
  { framework: 'electron', language: 'typescript', markers: [], packageKeys: ['electron'] },
  { framework: 'vite', language: 'typescript', markers: ['vite.config.ts', 'vite.config.js'], packageKeys: ['vite'] },
  { framework: 'express', language: 'javascript', markers: [], packageKeys: ['express'] }
];

function detectProjectType(projectDir = process.cwd()) {
  const languages = [];
  const frameworks = [];
  
  const files = fs.readdirSync(projectDir);
  const extensions = new Set(files.map(f => path.extname(f)));

  for (const rule of LANGUAGE_RULES) {
    const hasMarker = rule.markers.some(m => fs.existsSync(path.join(projectDir, m)));
    const hasExt = rule.extensions.some(ext => extensions.has(ext));
    if (hasMarker || hasExt) languages.push(rule.type);
  }

  if (languages.includes('typescript') && languages.includes('javascript')) {
    const idx = languages.indexOf('javascript');
    if (idx !== -1) languages.splice(idx, 1);
  }

  let deps = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf8'));
    deps = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})];
  } catch (e) {}

  for (const rule of FRAMEWORK_RULES) {
    const hasMarker = rule.markers.some(m => fs.existsSync(path.join(projectDir, m)));
    const hasDep = rule.packageKeys.some(key => deps.some(d => d.toLowerCase().includes(key.toLowerCase())));
    if (hasMarker || hasDep) frameworks.push(rule.framework);
  }

  return { languages, frameworks };
}

module.exports = { detectProjectType };
