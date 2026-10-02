// 诊断脚本：验证 node-pty 在 Electron 主进程可加载并产出数据。
// 用法（仓库根，必须先清掉 ELECTRON_RUN_AS_NODE）：
//   pnpm --filter main exec electron ../../scripts/pty-spike.cjs
// pnpm 隔离布局：scripts/ 位于 packages/main 之外，按包名 require 解析不到 node-pty，
// 故显式从 packages/main 解析（逻辑与输出与 brief Step 3 一致）。
const path = require('path')
const pty = require(require.resolve('node-pty', { paths: [path.join(__dirname, '..', 'packages', 'main')] }))
const proc = pty.spawn('powershell.exe', ['-NoProfile', '-Command', 'Write-Output PTY_OK'], { name: 'xterm', cols: 80, rows: 24, cwd: process.cwd() })
let out = ''
proc.onData((d) => { out += d })
proc.onExit(({ exitCode }) => {
  console.log('CHUNK:', JSON.stringify(out))
  console.log(exitCode === 0 && out.includes('PTY_OK') ? 'SPIKE_PASS' : 'SPIKE_FAIL')
  process.exit(exitCode === 0 && out.includes('PTY_OK') ? 0 : 1)
})
setTimeout(() => { console.error('SPIKE_TIMEOUT', JSON.stringify(out)); process.exit(2) }, 15000)
