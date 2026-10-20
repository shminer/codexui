const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:4173'
const output = path.resolve('output/playwright')
const threadId = 'plan-browser-test'
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="app" style="height:100dvh"></div><script type="module" src="/scripts/fixtures/plan-realtime.js"></script></body></html>'

async function run() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch()
  const reports = []
  try {
    for (const mode of ['main', 'flow']) {
      const viewport = mode === 'main' ? { width: 1440, height: 1000 } : { width: 375, height: 812 }
      const context = await browser.newContext({ viewport })
      const errors = []
      const requests = []
      let socket
      await context.routeWebSocket('**/codex-api/ws', ws => { socket = ws })
      await context.route('**/__plan-test?*', route => route.fulfill({ contentType: 'text/html', body: html }))
      await context.route(`${base}/codex-api/**`, route => {
        const url = new URL(route.request().url())
        const body = route.request().postDataJSON() || {}
        requests.push({ path: url.pathname, method: body.method })
        const reply = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) })
        if (url.pathname === '/codex-api/rpc') {
          if (['thread/read', 'thread/resume'].includes(body.method)) return reply({ error: 'Synthetic history unavailable' }, 503)
          if (body.method === 'thread/list') return reply({ result: { data: [{
            id: threadId, cwd: '', preview: '', createdAt: 1, updatedAt: 2,
            source: 'cli', status: { type: 'idle' }, turns: [],
          }], nextCursor: null } })
          return reply({ result: { data: [], nextCursor: null } })
        }
        if (/thread-(recent|turn-page)/.test(url.pathname)) return reply({ error: 'Synthetic history unavailable' }, 503)
        return reply({ data: [], prompts: [], order: [], labels: {}, active: [], projectOrder: [] })
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${base}/__plan-test?mode=${mode}`)
      await page.waitForFunction(() => window.planTest)
      assert.ok(socket)
      const emit = (method, params) => socket.send(JSON.stringify({ method, params }))
      const params = { threadId, turnId: 'plan-turn', itemId: 'plan-item' }
      emit('turn/started', { threadId, turn: { id: params.turnId } })
      emit('item/plan/delta', { ...params, delta: 'Partial proposed plan' })
      await page.getByText('Partial proposed plan', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Implement plan' }).count(), 0)
      const text = '# Plan without refresh\n\nThe final plan remains visible even when history cannot be read.\n\n- [ ] 修复实时 Plan 完成事件\n- [ ] 保留最终正文\n- [ ] 验证无需刷新\n\nPLAN-FINAL-UNIQUE-MARKER'
      const before = requests.length
      const startedAt = Date.now()
      emit('item/completed', { ...params, item: { id: params.itemId, type: 'plan', text } })
      await page.getByText('PLAN-FINAL-UNIQUE-MARKER', { exact: false }).waitFor()
      await page.getByRole('button', { name: 'Implement plan' }).waitFor()
      const completedDisplayMs = Date.now() - startedAt
      emit('turn/completed', { threadId, turn: { id: params.turnId, status: 'completed' } })
      await page.waitForTimeout(1200)
      assert.equal(await page.locator('.plan-card').count(), 1, 'no lost or duplicate plan after failed history read')
      assert.ok((await page.locator('.plan-card').innerText()).includes('PLAN-FINAL-UNIQUE-MARKER'))
      assert.equal(await page.locator('.plan-card-badge').count(), 0, 'completed plan is not stuck Updating')
      emit('turn/started', { threadId, turn: { id: 'next-turn' } })
      await page.waitForTimeout(250)
      assert.equal(await page.locator('.plan-card').count(), 1, 'next turn preserves completed plan')
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
        await page.waitForTimeout(2200)
        await page.screenshot({ path: path.join(output, `plan-realtime-${mode}-${dark ? 'dark' : 'light'}.png`) })
      }
      assert.deepEqual(errors, [])
      reports.push({ mode, viewport, completedDisplayMs, requestsAfterCompletion: requests.slice(before), planCards: 1, errors })
      await page.evaluate(() => window.planTest.stop())
      await context.close()
    }
    console.log('PASS: realtime plan visible before history refresh, retained after failed read and next turn; both renderers, light/dark')
  } finally {
    await fs.writeFile(path.join(output, 'plan-realtime-results.json'), JSON.stringify(reports, null, 2))
    await browser.close()
  }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
