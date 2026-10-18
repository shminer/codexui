const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')

const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:4173'
const output = resolve('output/playwright')
async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const routeName of ['home', 'thread', 'legacy-home', 'empty-catalog', 'failed-catalog']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
      const page = await context.newPage()
      const errors = []
      const calls = []
      let reloadCatalog = false
      const provider = routeName.endsWith('catalog') ? 'custom' : 'openai'
      const effortLabel = routeName === 'empty-catalog' ? 'High' : 'Ultra'
      if (routeName === 'legacy-home') await context.addInitScript(() => {
        if (!localStorage.getItem('model-refresh-seeded')) {
          localStorage.setItem('codex-web-local.selected-reasoning-effort-by-context.v1', JSON.stringify({ '__new-thread__': 'medium' }))
          localStorage.setItem('model-refresh-seeded', 'true')
        }
      })
      const thread = { id: 'model-refresh', name: 'Model refresh', preview: 'Refresh preferences', cwd: process.cwd(), model: 'gpt-5', modelProvider: 'openai', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [] }
      page.on('pageerror', error => errors.push(error.message))
      await page.routeWebSocket('**/codex-api/ws', ws => ws.send(JSON.stringify({ method: 'ready', params: { ok: true } })))
      await page.route('**/codex-api/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        let payload = { data: [] }
        if (path === '/codex-api/rpc') {
          const { method } = request.postDataJSON()
          calls.push(method)
          let result = {}
          if (method === 'thread/list') result = { data: [thread], nextCursor: null }
          else if (['thread/read', 'thread/resume', 'thread/start'].includes(method)) result = { thread, model: 'gpt-5', modelProvider: 'openai' }
          else if (method === 'config/read') result = { config: { model: 'gpt-5', model_provider: provider, model_reasoning_effort: 'medium', model_providers: { custom: { requires_openai_auth: routeName === 'failed-catalog' } } } }
          else if (method === 'model/list' && reloadCatalog && routeName === 'failed-catalog') {
            await route.fulfill({ status: 503, json: { error: 'Catalog temporarily unavailable' } })
            return
          }
          else if (method === 'model/list') result = { data: ['gpt-5', 'gpt-5.6'].map(model => ({ id: model, model, supportedReasoningEfforts: ['medium', 'high', 'ultra'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) })), nextCursor: null }
          else if (method === 'collaborationMode/list') result = { data: [] }
          else if (method === 'skills/list') result = { data: [] }
          payload = { result }
        } else if (path === '/codex-api/meta/methods') payload = { data: ['thread/list', 'thread/read', 'thread/resume', 'thread/start', 'model/list', 'config/read', 'skills/list'] }
        else if (path === '/codex-api/meta/notifications') payload = { data: [] }
        else if (path === '/codex-api/free-mode/status') payload = { enabled: false, hasAuth: true, provider: 'openai' }
        else if (path === '/codex-api/thread-recent') payload = { result: null }
        else if (path === '/codex-api/home-directory') payload = { data: { path: process.cwd() } }
        else if (path === '/codex-api/workspace-roots-state') payload = { data: { order: [process.cwd()], active: [process.cwd()], labels: {}, projectOrder: [process.cwd()] } }
        else if (path === '/codex-api/thread-queue-state') payload = { data: {} }
        else if (path === '/codex-api/accounts') payload = { data: { accounts: [{ accountId: 'account-a', storageId: 'account-a', isActive: true }] } }
        else if (path === '/codex-api/provider-models') payload = { data: reloadCatalog ? [] : ['gpt-5', 'gpt-5.6'], exclusive: true }
        else if (path === '/codex-api/git/branches') payload = { data: { options: [], dirty: false } }
        await route.fulfill({ json: payload })
      })
      const url = `${base}/#/${routeName === 'thread' ? `thread/${thread.id}` : ''}`
      await page.goto(url)
      const model = page.locator('.thread-composer .composer-dropdown-trigger').filter({ hasText: /GPT-5/ }).first()
      await model.waitFor()
      await page.waitForTimeout(1000)
      await model.click()
      await page.locator('.composer-dropdown-option').filter({ hasText: /^GPT-5\.6$/ }).click()
      const effort = page.locator('.thread-composer .composer-dropdown-trigger').filter({ hasText: /^Medium$/ })
      await effort.click()
      await page.locator('.composer-dropdown-option').filter({ hasText: new RegExp(`^${effortLabel}$`) }).click()
      const before = await page.evaluate(() => ({ ...localStorage }))
      const callsBefore = calls.length
      reloadCatalog = true
      await page.reload()
      await page.waitForTimeout(2000)
      const after = await page.evaluate(() => ({ ...localStorage }))
      const labels = await page.locator('.thread-composer .composer-dropdown-value').allTextContents()
      results.push({ routeName, url, before, after, labels, reloadCalls: calls.slice(callsBefore), errors })
      await writeFile(resolve(output, 'model-refresh-results.json'), JSON.stringify(results, null, 2))
      assert.ok(labels.includes('GPT-5.6'), JSON.stringify(results.at(-1)))
      assert.ok(labels.includes(effortLabel), JSON.stringify(results.at(-1)))
      assert.deepEqual(errors, [])
      assert.equal(calls.slice(callsBefore).filter(method => method === 'config/read').length, 1)
      assert.ok(calls.slice(callsBefore).filter(method => method === 'model/list').length <= 1)
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme })
        await page.reload()
        await page.getByRole('button', { name: 'GPT-5.6', exact: true }).waitFor()
        await page.getByRole('button', { name: effortLabel, exact: true }).waitFor()
        await page.waitForTimeout(2500)
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark')
        await page.screenshot({ path: resolve(output, `model-refresh-${routeName}-${theme}-cjs.png`), fullPage: true })
      }
      console.log(`${routeName}: model and ${effortLabel} persisted after refresh`)
      await context.close()
    }
  } finally { await browser.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
