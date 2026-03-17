const { getPackageManager } = require('./lib/package-manager.cjs')
const { detectProjectType } = require('./lib/project-detect.cjs')
const { log, output } = require('./lib/utils.cjs')

let rawInput = ''
require('node:process').stdin.setEncoding('utf8')
require('node:process').stdin.on('data', (chunk) => {
  rawInput += chunk
})
require('node:process').stdin.on('end', () => {
  let hookInput = {}
  try {
    hookInput = JSON.parse(rawInput)
  }
  catch {}

  const projectDir = hookInput.cwd || require('node:process').cwd()
  main(projectDir).catch((err) => {
    console.error('[SessionStart] Error:', err.message)
    require('node:process').exit(0)
  })
})

async function main(projectDir) {
  // Detect and report package manager
  const pm = getPackageManager(projectDir)
  log(`[SessionStart] Package manager: ${pm.name} (${pm.source})`)

  // If no explicit package manager config was found, show selection prompt
  if (pm.source === 'default') {
    log('[SessionStart] No package manager preference found.')
  }

  // Detect project type and frameworks (#293)
  const projectInfo = detectProjectType(projectDir)

  if (projectInfo.languages.length > 0 || projectInfo.frameworks.length > 0) {
    const parts = []
    if (projectInfo.languages.length > 0) {
      parts.push(`languages: ${projectInfo.languages.join(', ')}`)
    }
    if (projectInfo.frameworks.length > 0) {
      parts.push(`frameworks: ${projectInfo.frameworks.join(', ')}`)
    }
    log(`[SessionStart] Project detected — ${parts.join('; ')}`)

    const additionalContext = [
      `Package Manager: ${pm.name} (Source: ${pm.source})`,
      `Languages: ${projectInfo.languages.join(', ') || 'unknown'}`,
      `Frameworks: ${projectInfo.frameworks.join(', ') || 'none'}`,
      `Directory: ${projectDir}`,
    ]

    output({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: additionalContext.join('\n'),
      },
    })
  }
  else {
    log('[SessionStart] No specific project type detected')
  }

  require('node:process').exit(0)
}
