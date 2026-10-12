const { chromium } = require('playwright')
const { expect } = require('@playwright/test')
const assert = require('node:assert/strict')
const { mkdir, writeFile } = require('node:fs/promises')
const { resolve } = require('node:path')

const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:4173'
const output = resolve('output/playwright')
const cwd = 'C:/mock/TestChat'
const threads = ['mock-header-a', 'mock-header-b'].map((id) => ({
  id, cwd, name: `Header TestChat ${id}`, preview: 'Header actions mock', model: 'gpt-5',
  modelProvider: 'openai', createdAt: 1, updatedAt: 1, status: { type: 'idle' },
  turns: [{ id: `${id}-turn`, status: 'completed', items: [
    { id: `${id}-reply`, type: 'agentMessage', text: 'Header needle [Notes](src/notes.md)' },
  ] }],
}))
const labels = {
  en: ['New conversation', 'Find in thread', 'Thread resources'],
  'zh-CN': ['新建对话', '会话内搜索', '线程资源'],
}

async function setup(page, theme, language, terminalAvailable = true) {
  const calls = [], errors = []
  let delaySearch = false, delayResources = false
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem('codex-web-local.dark-mode.v1', theme)
    localStorage.setItem('codex-web-local.ui-language.v1', language)
    const listeners = new Set()
    window.__headerListeners = listeners
    const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window)
    window.addEventListener = (type, callback, options) => {
      if (type === 'pointerdown' && callback?.name === 'onOutside') listeners.add(callback)
      return add(type, callback, options)
    }
    window.removeEventListener = (type, callback, options) => {
      if (type === 'pointerdown' && callback?.name === 'onOutside') listeners.delete(callback)
      return remove(type, callback, options)
    }
  }, { theme, language })
  await page.routeWebSocket('**/codex-api/ws', (ws) => {
    ws.send(JSON.stringify({ method: 'ready', params: { ok: true } }))
  })
  await page.route('**/codex-local-file?**', (route) => route.fulfill({ body: '' }))
  await page.route('**/codex-api/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const body = request.postDataJSON()
    const row = { path, method: body?.method, params: body?.params, body, bytes: 0 }
    calls.push(row)
    let payload = { data: [] }
    if (path === '/codex-api/rpc') {
      const { method, params } = body
      const thread = threads.find((thread) => thread.id === params?.threadId) || threads[0]
      let result = {}
      if (method === 'thread/list') result = { data: params?.archived ? [] : threads, nextCursor: null }
      else if (['thread/read', 'thread/resume'].includes(method)) result = { thread, model: 'gpt-5', modelProvider: 'openai' }
      else if (method === 'config/read') result = { config: { model: 'gpt-5', model_provider: 'openai' } }
      else if (method === 'model/list') result = { data: [{ id: 'gpt-5', model: 'gpt-5', isDefault: true }] }
      else if (method === 'skills/list') result = { data: [] }
      else if (method === 'thread/searchOccurrences') {
        if (delaySearch) await new Promise((done) => setTimeout(done, 500))
        result = { data: [{ threadId: thread.id, turnId: thread.turns[0].id, itemId: `${thread.id}-reply`,
          turnCursor: 'cursor', snippet: 'Header needle', snippetMatchRange: { start: 7, end: 13 } }], nextCursor: null }
      }
      payload = params?.threadId === 'missing-thread' && method === 'thread/read'
        ? { error: { message: 'Mock missing thread' } } : { result }
    } else if (path === '/codex-api/meta/methods') payload = { data: ['thread/list', 'thread/read', 'thread/resume', 'model/list', 'config/read', 'skills/list', 'thread/searchOccurrences'] }
    else if (path === '/codex-api/meta/notifications') payload = { data: [] }
    else if (path === '/codex-api/free-mode/status') payload = { enabled: false, hasAuth: true, provider: 'openai', models: ['gpt-5'] }
    else if (path === '/codex-api/thread-recent') payload = { result: null }
    else if (path === '/codex-api/home-directory') payload = { data: { path: cwd } }
    else if (path === '/codex-api/workspace-roots-state') payload = { data: { order: [cwd], active: [cwd], projectOrder: [cwd] } }
    else if (path === '/codex-api/thread-queue-state') payload = { data: {} }
    else if (path === '/codex-api/thread-terminal/status') payload = { available: terminalAvailable }
    else if (path === '/codex-api/thread-terminal/quick-commands') payload = { commands: [{ label: 'Mock test command', value: 'pnpm test', source: 'package' }] }
    else if (path === '/codex-api/thread-terminal/attach') payload = { session: { id: 'mock-terminal', threadId: body.threadId, cwd, shell: 'mock', buffer: 'Mock terminal ready' } }
    else if (path === '/codex-api/git/branches') payload = { data: { currentBranch: 'main', options: [], dirty: false } }
    else if (path === '/codex-api/thread-resources') {
      if (delayResources) await new Promise((done) => setTimeout(done, 500))
      const id = url.searchParams.get('threadId')
      payload = { data: [{ key: 'history-notes', label: 'Historical attachment', path: `${cwd}/old.txt`, url: '', kind: 'attachment', itemId: `${id}-reply`, turnId: `${id}-turn` }], nextCursor: null }
    }
    row.bytes = Buffer.byteLength(JSON.stringify(payload))
    await route.fulfill({ json: payload })
  })
  return { calls, errors, delaySearch: () => { delaySearch = true }, delayResources: () => { delayResources = true } }
}

function expensive(calls) {
  return calls.filter((call) => /thread-(?:recent|turn-page|resources|resource-source)|thread-terminal\/(?:attach|input)/.test(call.path)
    || ['thread/read', 'thread/resume', 'thread/turns/list', 'thread/searchOccurrences', 'thread/start'].includes(call.method))
}

async function main() {
  await mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined })
  const results = []
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 375, height: 812 }]) {
      for (const theme of ['light', 'dark']) for (const language of ['en', 'zh-CN']) {
        const page = await browser.newPage({ viewport })
        const fixture = await setup(page, theme, language)
        const [newLabel, searchLabel, resourcesLabel] = labels[language]
        const trigger = page.locator('.thread-header-actions-trigger')
        const menu = page.locator('.thread-header-actions-panel')
        const choose = async (label) => { await trigger.click(); await menu.getByRole('menuitem', { name: label, exact: true }).click() }
        const terminal = page.locator('.content-header-terminal-command')
        const chooseTerminal = async (label) => {
          await terminal.locator('.composer-dropdown-trigger').click()
          await expect(page.locator('.composer-dropdown-menu-wrap-teleported')).toHaveCSS('z-index', '270')
          await page.locator('.composer-dropdown-menu-wrap-teleported').getByRole('button', { name: label, exact: true }).click()
        }
        await page.goto(`${base}/#/thread/${threads[0].id}`)
        await page.locator(`[data-message-id="${threads[0].id}-reply"]`).waitFor()
        await page.waitForTimeout(700)
        await expect(page.locator('.content-header .content-title')).toHaveCount(0)
        await expect(page.locator('.content-header [aria-label="Start new thread"], .content-header [aria-label="新建线程"]')).toHaveCount(0)
        await expect(terminal).toBeVisible()
        await expect(page.locator('.content-leading .thread-header-actions-trigger')).toBeVisible()
        const triggerBox = await trigger.boundingBox(), terminalBox = await terminal.boundingBox()
        assert.ok(triggerBox.x + triggerBox.width <= terminalBox.x, 'menu is left of the independent terminal')
        await expect(page.locator('.thread-conversation-tools')).toBeHidden()
        await expect(page.locator('.header-git-trigger')).toBeVisible()
        assert.ok((await page.title()).includes(threads[0].name), 'browser title preserved')
        const baseline = expensive(fixture.calls).length
        await trigger.focus(); await page.keyboard.press('ArrowDown')
        await expect(menu.getByRole('menuitem').first()).toBeFocused()
        assert.equal(await page.evaluate(() => window.__headerListeners.size), 1)
        assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), labels[language])
        await page.keyboard.press('End'); await expect(menu.getByRole('menuitem').last()).toBeFocused()
        await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown')
        await expect(menu.getByRole('menuitem', { name: searchLabel, exact: true })).toBeFocused()
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused(); await expect(menu).toHaveCount(0)
        assert.equal(await page.evaluate(() => window.__headerListeners.size), 0)
        await trigger.click(); await page.locator('.conversation-list').click({ position: { x: 10, y: 10 } })
        await expect(menu).toHaveCount(0); await expect(trigger).toBeFocused()
        await trigger.click()
        await page.waitForTimeout(2500)
        assert.equal(expensive(fixture.calls).length, baseline, 'menu opening must not request history/resources or create terminal')
        const stem = `thread-header-${viewport.width}-${theme}-${language}`
        const screenshot = resolve(output, `${stem}-menu.png`)
        await page.screenshot({ path: screenshot })
        const bounds = await menu.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, 'menu fits viewport')
        assert.ok(Math.abs(bounds.x - triggerBox.x) <= 1, 'menu aligns with the left edge of its trigger')
        const bg = await menu.evaluate((el) => getComputedStyle(el).backgroundColor)
        assert.equal(bg, theme === 'dark' ? 'rgb(24, 24, 27)' : 'rgb(255, 255, 255)')
        await menu.getByRole('menuitem', { name: searchLabel, exact: true }).click()
        await expect(page.locator('.thread-search-bar input')).toBeFocused()
        assert.equal(expensive(fixture.calls).length, baseline, 'empty search opening does not read history')
        await page.locator('.thread-search-bar input').fill('needle')
        await expect(page.locator('.conversation-item.is-search-target')).toHaveAttribute('data-message-id', `${threads[0].id}-reply`)
        await page.waitForTimeout(2500)
        await page.screenshot({ path: resolve(output, `${stem}-search.png`) })
        await choose(resourcesLabel)
        await expect(page.locator('.thread-search-bar')).toHaveCount(0)
        const resources = page.locator('.thread-resources-panel')
        await expect(resources).toBeVisible()
        await resources.getByRole('button', { name: language === 'en' ? 'Related files' : '相关文件', exact: true }).click()
        await expect(resources.locator('.thread-resource-name')).toHaveText('Notes')
        await resources.getByRole('button', { name: language === 'en' ? 'Reference in composer' : '引用到输入框' }).click()
        await expect(page.locator('.thread-composer-file-chip-name')).toHaveText('Notes')
        await expect(page.locator('.thread-composer-file-chip-name')).toHaveAttribute('title', `${cwd}/src/notes.md`)
        await page.waitForTimeout(2500)
        await page.screenshot({ path: resolve(output, `${stem}-resources.png`) })
        await resources.getByRole('button', { name: language === 'en' ? 'Source message' : '来源消息' }).click()
        await expect(resources).toHaveCount(0)
        await expect(page.locator('.thread-conversation-tools')).toBeHidden()
        await choose(searchLabel)
        await page.locator('.thread-search-bar input').press('Escape')
        await expect(page.locator('.thread-conversation-tools')).toBeHidden()
        await chooseTerminal('Mock test command')
        await expect.poll(() => fixture.calls.filter((call) => call.path.endsWith('/input')).length).toBeGreaterThan(0)
        const input = fixture.calls.find((call) => call.path.endsWith('/input'))
        assert.equal(input.body.data, 'pnpm test\r')
        await chooseTerminal(language === 'en' ? 'Hide terminal' : '隐藏终端')
        await expect(page.locator('.thread-terminal-panel')).toHaveCount(0)
        await choose(resourcesLabel)
        await resources.getByRole('button', { name: language === 'en' ? 'Load history' : '加载历史', exact: true }).click()
        await expect(resources).toContainText(language === 'en' ? 'History loaded' : '历史已加载')
        await trigger.click()
        await page.evaluate((id) => { location.hash = `#/thread/${id}` }, threads[1].id)
        await page.locator(`[data-message-id="${threads[1].id}-reply"]`).waitFor()
        await expect(menu).toHaveCount(0); await expect(resources).toHaveCount(0)
        await choose(searchLabel)
        fixture.delaySearch()
        await page.locator('.thread-search-bar input').fill('needle')
        await expect.poll(() => fixture.calls.filter((call) => call.method === 'thread/searchOccurrences').length).toBe(2)
        await page.evaluate((id) => { location.hash = `#/thread/${id}` }, threads[0].id)
        await page.waitForTimeout(800)
        await expect(page.locator('.thread-search-bar')).toHaveCount(0)
        await expect(page.locator('.conversation-item.is-search-target')).toHaveCount(0)
        await choose(resourcesLabel)
        fixture.delayResources()
        await resources.getByRole('button', { name: language === 'en' ? 'Load history' : '加载历史', exact: true }).click()
        await page.locator('.header-git-trigger').click()
        await page.locator('.header-git-review-row').click()
        await expect(resources).toHaveCount(0)
        // Review is a modal covering the header; check the defensive keyboard path.
        await trigger.focus(); await page.keyboard.press('Enter')
        await expect(menu.getByRole('menuitem', { name: searchLabel, exact: true })).toBeDisabled()
        await expect(menu.getByRole('menuitem', { name: resourcesLabel, exact: true })).toBeDisabled()
        await page.keyboard.press('Escape')
        await page.locator('.review-pane-close').click()
        await page.waitForTimeout(700)
        await expect(page.locator('.thread-conversation-tools')).toBeHidden()
        await choose(newLabel)
        await expect(page).toHaveURL(`${base}/#/`)
        await expect(page.locator('.thread-header-actions-trigger')).toHaveCount(0)
        assert.equal(await page.evaluate(() => window.__headerListeners.size), 0)
        await expect(page.locator('.content-title')).toBeVisible()
        await expect(page.locator('.new-thread-folder-selected')).toHaveAttribute('title', cwd)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
        assert.equal(overflow, false)
        assert.deepEqual(fixture.errors, [])
        results.push({ viewport, theme, language, screenshot, menuExtraRequests: 0,
          apiRequests: fixture.calls.length, totalApiKB: fixture.calls.reduce((sum, call) => sum + call.bytes, 0) / 1024 })
        console.log(`${stem}: passed`)
        await page.close()
      }
    }
    const page = await browser.newPage()
    await setup(page, 'light', 'en', false)
    await page.goto(`${base}/#/thread/${threads[0].id}`)
    await page.locator(`[data-message-id="${threads[0].id}-reply"]`).waitFor()
    await page.locator('.thread-header-actions-trigger').click()
    await expect(page.locator('.content-header-terminal-command')).toHaveCount(0)
    await expect(page.getByRole('menuitem')).toHaveCount(3)
    await page.keyboard.press('Tab')
    await expect(page.locator('.thread-header-actions-panel')).toHaveCount(0)
    assert.equal(await page.evaluate(() => window.__headerListeners.size), 0)
    await page.locator('.thread-header-actions-trigger').focus(); await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('menuitem', { name: 'Thread resources', exact: true })).toBeFocused()
    await page.keyboard.press('Escape')
    await page.evaluate(() => { location.hash = '#/thread/missing-thread' })
    await page.waitForTimeout(500)
    await page.locator('.thread-header-actions-trigger').click()
    await expect(page.getByRole('menuitem', { name: 'Find in thread', exact: true })).toBeDisabled()
    await expect(page.getByRole('menuitem', { name: 'Thread resources', exact: true })).toBeDisabled()
    await page.getByRole('menuitem', { name: 'New conversation', exact: true }).click()
    assert.equal(await page.evaluate(() => window.__headerListeners.size), 0)
    await page.close()
    await writeFile(resolve(output, 'thread-header-actions-results.json'), JSON.stringify({ base, results }, null, 2))
  } finally { await browser.close() }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
