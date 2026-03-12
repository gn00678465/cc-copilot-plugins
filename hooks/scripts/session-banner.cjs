const { getPackageManager } = require('./lib/package-manager.cjs');
const { detectProjectType } = require('./lib/project-detect.cjs');

const projectDir = process.cwd();
const pm = getPackageManager(projectDir);
const projectInfo = detectProjectType(projectDir);

const additionalContext = [
    `Package Manager: ${pm.name} (Source: ${pm.source})`,
    `Languages: ${projectInfo.languages.join(', ') || 'unknown'}`,
    `Frameworks: ${projectInfo.frameworks.join(', ') || 'none'}`,
    `Directory: ${projectDir}`
]

console.log(JSON.stringify({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": additionalContext.join('\n')
    }
}))

process.exit(0);
