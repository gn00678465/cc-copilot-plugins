const fs = require('node:fs')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * Log to stderr (visible to user in Claude Code)
 */
function log(message) {
  console.error(message)
}

/**
 * Output to stdout (returned to Claude)
 */
function output(data) {
  if (typeof data === 'object') {
    console.log(JSON.stringify(data))
  }
  else {
    console.log(data)
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  }
  catch (err) {
    return null
  }
}

function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf8')
    return true
  }
  catch (err) {
    return false
  }
}

module.exports = { ensureDir, readFile, writeFile, log, output }
