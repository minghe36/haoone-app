const { execFile } = require('node:child_process')

// Inspect executable names, never plugin arguments or installation paths.
function hasResolveProcess(output, platform) {
  return String(output)
    .split(/\r?\n/)
    .some(line => {
      if (platform === 'win32') {
        return /^"Resolve\.exe",/i.test(line.trim())
      }
      return line.trim().split('/').pop() === 'Resolve'
    })
}

function probeResolveProcess(platform = process.platform) {
  const windows = platform === 'win32'
  return new Promise((resolve, reject) => {
    execFile(
      windows ? 'tasklist' : 'ps',
      windows
        ? ['/FI', 'IMAGENAME eq Resolve.exe', '/FO', 'CSV', '/NH']
        : ['-axo', 'comm='],
      { windowsHide: true, timeout: 1500, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(hasResolveProcess(stdout, platform))
      }
    )
  })
}

function startResolveLifecycle({
  onExit,
  probe = probeResolveProcess,
  schedule = setTimeout,
  cancel = clearTimeout,
  intervalMs = 2000,
  onError = () => {},
}) {
  let stopped = false
  let timer
  let missingCount = 0
  async function check() {
    try {
      const running = await probe()
      if (stopped) return
      missingCount = running ? 0 : missingCount + 1
      if (missingCount >= 2) {
        stopped = true
        onExit()
        return
      }
    } catch (error) {
      // A failed process query is not evidence that Resolve exited.
      missingCount = 0
      if (!stopped) onError(error)
    }
    if (!stopped) timer = schedule(check, intervalMs)
  }
  timer = schedule(check, intervalMs)
  return () => {
    stopped = true
    cancel(timer)
  }
}

module.exports = {
  hasResolveProcess,
  probeResolveProcess,
  startResolveLifecycle,
}
