const fs = require('fs');
const path = require('path');

/**
 * Language detection rules.
 * Each rule checks for marker files or glob patterns in the project root.
 */
const LANGUAGE_RULES = [
  {
    type: 'python',
    markers: ['requirements.txt', 'pyproject.toml', 'setup.py', 'setup.cfg', 'Pipfile', 'poetry.lock'],
    extensions: ['.py']
  },
  {
    type: 'typescript',
    markers: ['tsconfig.json', 'tsconfig.build.json'],
    extensions: ['.ts', '.tsx']
  },
  {
    type: 'javascript',
    markers: ['package.json', 'jsconfig.json'],
    extensions: ['.js', '.jsx', '.mjs']
  },
  {
    type: 'golang',
    markers: ['go.mod', 'go.sum'],
    extensions: ['.go']
  },
  {
    type: 'rust',
    markers: ['Cargo.toml', 'Cargo.lock'],
    extensions: ['.rs']
  },
  {
    type: 'ruby',
    markers: ['Gemfile', 'Gemfile.lock', 'Rakefile'],
    extensions: ['.rb']
  },
  {
    type: 'java',
    markers: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    extensions: ['.java']
  },
  {
    type: 'csharp',
    markers: [],
    extensions: ['.cs', '.csproj', '.sln']
  },
  {
    type: 'swift',
    markers: ['Package.swift'],
    extensions: ['.swift']
  },
  {
    type: 'kotlin',
    markers: [],
    extensions: ['.kt', '.kts']
  },
  {
    type: 'elixir',
    markers: ['mix.exs'],
    extensions: ['.ex', '.exs']
  },
  {
    type: 'php',
    markers: ['composer.json', 'composer.lock'],
    extensions: ['.php']
  }
];

/**
 * Framework detection rules.
 * Checked after language detection for more specific identification.
 */
const FRAMEWORK_RULES = [
  // Python frameworks
  { framework: 'django', language: 'python', markers: ['manage.py'], packageKeys: ['django'] },
  { framework: 'fastapi', language: 'python', markers: [], packageKeys: ['fastapi'] },
  { framework: 'flask', language: 'python', markers: [], packageKeys: ['flask'] },

  // JavaScript/TypeScript frameworks
  { framework: 'nextjs', language: 'typescript', markers: ['next.config.js', 'next.config.mjs', 'next.config.ts'], packageKeys: ['next'] },
  { framework: 'react', language: 'typescript', markers: [], packageKeys: ['react'] },
  { framework: 'vue', language: 'typescript', markers: ['vue.config.js'], packageKeys: ['vue'] },
  { framework: 'angular', language: 'typescript', markers: ['angular.json'], packageKeys: ['@angular/core'] },
  { framework: 'svelte', language: 'typescript', markers: ['svelte.config.js'], packageKeys: ['svelte'] },
  { framework: 'express', language: 'javascript', markers: [], packageKeys: ['express'] },
  { framework: 'nestjs', language: 'typescript', markers: ['nest-cli.json'], packageKeys: ['@nestjs/core'] },
  { framework: 'remix', language: 'typescript', markers: [], packageKeys: ['@remix-run/node', '@remix-run/react'] },
  { framework: 'astro', language: 'typescript', markers: ['astro.config.mjs', 'astro.config.ts'], packageKeys: ['astro'] },
  { framework: 'nuxt', language: 'typescript', markers: ['nuxt.config.js', 'nuxt.config.ts'], packageKeys: ['nuxt'] },
  { framework: 'electron', language: 'typescript', markers: [], packageKeys: ['electron'] },

  // Ruby frameworks
  { framework: 'rails', language: 'ruby', markers: ['config/routes.rb', 'bin/rails'], packageKeys: [] },

  // Go frameworks
  { framework: 'gin', language: 'golang', markers: [], packageKeys: ['github.com/gin-gonic/gin'] },
  { framework: 'echo', language: 'golang', markers: [], packageKeys: ['github.com/labstack/echo'] },

  // Rust frameworks
  { framework: 'actix', language: 'rust', markers: [], packageKeys: ['actix-web'] },
  { framework: 'axum', language: 'rust', markers: [], packageKeys: ['axum'] },

  // Java frameworks
  { framework: 'spring', language: 'java', markers: [], packageKeys: ['spring-boot', 'org.springframework'] },

  // PHP frameworks
  { framework: 'laravel', language: 'php', markers: ['artisan'], packageKeys: ['laravel/framework'] },
  { framework: 'symfony', language: 'php', markers: ['symfony.lock'], packageKeys: ['symfony/framework-bundle'] },

  // Elixir frameworks
  { framework: 'phoenix', language: 'elixir', markers: [], packageKeys: ['phoenix'] }
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
