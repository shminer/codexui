// Run against the current worktree's Vite server on 4173. All conversation data is synthetic.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:4173'
const output = path.resolve('output/playwright')
const results = []
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Side flow regression</title></head><body><div id="app" style="height:100dvh"></div><script type="module" src="/scripts/fixtures/side-conversation-flow.js"></script></body></html>'

function instrument() {
  const raf = window.requestAnimationFrame.bind(window)
  const cancel = window.cancelAnimationFrame.bind(window)
  const observer = window.ResizeObserver
  const held = new Map()
  const active = new Set()
  const metrics = window.layoutMetrics = { paused: false, observerDelay: 0, rafCalls: 0, activeObservers: 0, longTasks: [] }
  window.requestAnimationFrame = callback => {
    metrics.rafCalls++
    const id = raf(time => {
      active.delete(id)
      if (metrics.paused) held.set(id, callback)
      else callback(time)
    })
    active.add(id)
    return id
  }
  window.cancelAnimationFrame = id => { held.delete(id); active.delete(id); cancel(id) }
  window.resumeLayout = () => {
    metrics.paused = false
    const callbacks = [...held.values()]
    held.clear()
    callbacks.forEach(callback => raf(callback))
  }
  window.pendingLayoutFrames = () => held.size + active.size
  window.ResizeObserver = class {
    constructor(callback) {
      this.connected = false
      this.targets = new Set()
      this.timers = new Set()
      this.observer = new observer(entries => {
        if (!metrics.observerDelay) { callback(entries, this); return }
        const timer = setTimeout(() => { this.timers.delete(timer); if (this.connected) callback(entries, this) }, metrics.observerDelay)
        this.timers.add(timer)
      })
    }
    observe(...args) {
      this.targets.add(args[0])
      if (!this.connected) { this.connected = true; metrics.activeObservers++ }
      this.observer.observe(...args)
    }
    unobserve(...args) {
      this.targets.delete(args[0])
      this.observer.unobserve(...args)
      if (!this.targets.size && this.connected) { this.connected = false; metrics.activeObservers-- }
    }
    disconnect() {
      if (this.connected) metrics.activeObservers--
      this.connected = false
      this.targets.clear()
      this.timers.forEach(clearTimeout)
      this.timers.clear()
      this.observer.disconnect()
    }
  }
  new PerformanceObserver(list => metrics.longTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true })
}

async function inspect(page, label, expected = null) {
  const layout = await page.evaluate(() => {
    const list = document.querySelector('.conversation-list')
    const rows = [...list.querySelectorAll('.conversation-item')].filter(row => row.getBoundingClientRect().height > 0)
    const errors = []
    let bottom = -Infinity
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (rect.top < bottom - 1) errors.push(`overlap: ${row.dataset.messageId}`)
      bottom = rect.bottom
      // Check message content itself, not just the outer row's declared height.
      for (const block of row.querySelectorAll('.message-body p, .message-body pre, .message-body table, .cmd-row, .context-compaction-marker')) {
        const bounds = block.getBoundingClientRect()
        if (bounds.height && (bounds.top < rect.top - 1 || bounds.bottom > rect.bottom + 1)) errors.push(`escaped content: ${row.dataset.messageId}`)
      }
      const blocks = [...row.querySelectorAll('.message-body p, .message-body pre, .message-body table')]
        .filter(block => !block.parentElement.closest('pre, table'))
      let blockBottom = rect.top
      for (const block of blocks) {
        const bounds = block.getBoundingClientRect()
        if (!bounds.height) continue
        if (bounds.top < blockBottom - 1) errors.push(`overlapping paragraphs: ${row.dataset.messageId}`)
        blockBottom = bounds.bottom
      }
    }
    const bounds = list.getBoundingClientRect()
    const composer = document.querySelector('.side-conversation-composer')?.getBoundingClientRect()
    if (composer && bounds.bottom > composer.top + 1) errors.push('list covers composer')
    if (document.documentElement.scrollWidth > innerWidth + 1 || list.scrollWidth > list.clientWidth + 1) errors.push('horizontal overflow')
    return {
      errors, rows: rows.length, text: list.textContent,
      virtual: !!list.querySelector('.vue-recycle-scroller__item-wrapper'),
      gap: list.scrollHeight - list.clientHeight - list.scrollTop,
      nodes: list.querySelectorAll('*').length, ...window.layoutMetrics,
    }
  })
  assert.deepEqual(layout.errors, [], label)
  assert.equal(layout.virtual, false, `${label}: side must use normal flow`)
  if (expected) assert.ok(layout.text.includes(expected), `${label}: missing ${expected}`)
  delete layout.text
  results.push({ label, ...layout })
  return layout
}

async function anchor(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.conversation-list')
    const top = list.getBoundingClientRect().top
    const row = [...list.querySelectorAll('[data-message-id]')].find(row => row.getBoundingClientRect().bottom > top)
    return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - top }
  })
}

async function run() {
  await fs.mkdir(output, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  try {
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
      const context = await browser.newContext({ viewport })
      const errors = []
      const requests = []
      context.on('page', page => page.on('pageerror', error => { errors.push(error.message); console.error(error.message) }))
      await context.addInitScript(instrument)
      await context.route('**/__side-flow-test', route => route.fulfill({ contentType: 'text/html', body: html }))
      await context.route(`${base}/codex-api/**`, route => {
        requests.push(new URL(route.request().url()).pathname)
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ prompts: [], data: [] }) })
      })
      await context.route(`${base}/__side-flow-image.svg`, async route => {
        await new Promise(resolve => setTimeout(resolve, 400))
        await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#5289aa"/><text x="20" y="80">Delayed image</text></svg>' })
      })
      const parent = await context.newPage()
      await parent.goto(`${base}/__side-flow-test`)
      await parent.waitForFunction(() => window.fixture && document.querySelector('.conversation-flow-content'))
      await parent.waitForTimeout(500)
      await inspect(parent, `embedded-${viewport.width}`, 'END-MARKER-29')
      const requestCount = requests.length
      const [popup] = await Promise.all([
        context.waitForEvent('page'), parent.getByRole('button', { name: 'Open in new window', exact: true }).click(),
      ])
      await popup.setViewportSize(viewport)
      await popup.waitForSelector('.conversation-flow-content')
      await popup.waitForTimeout(500)
      assert.equal(requests.length, requestCount, 'pop-out must not reload conversation data')
      assert.equal(await parent.evaluate(() => window.layoutMetrics.activeObservers), 0, 'old document observer disconnected')
      assert.equal(await popup.evaluate(() => window.layoutMetrics.activeObservers), 1, 'one content observer in popup')

      // Reproduce switching away: freeze both windows, append streamed then completed text,
      // and return to the popup while the opener remains suspended.
      await parent.evaluate(() => { window.layoutMetrics.paused = true; window.layoutMetrics.observerDelay = 500 })
      await popup.evaluate(() => { window.layoutMetrics.paused = true; window.layoutMetrics.observerDelay = 500 })
      await parent.evaluate(() => window.fixture.append(30, true))
      await parent.waitForTimeout(250)
      await parent.evaluate(() => window.fixture.complete(30))
      await popup.waitForTimeout(650)
      await inspect(popup, `background-update-${viewport.width}`, 'END-MARKER-30')
      await popup.evaluate(() => { window.resumeLayout(); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow')) })
      await popup.waitForTimeout(650)
      const resumed = await inspect(popup, `foreground-${viewport.width}`, 'END-MARKER-30')
      assert.ok(resumed.gap <= 16, `latest output followed in popup: ${resumed.gap}`)

      // Reading history must not be pulled to the bottom by new content or resize.
      await popup.locator('.conversation-list').evaluate(list => {
        list.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
        list.scrollTop = list.scrollHeight / 2
      })
      await popup.waitForTimeout(100)
      const reading = await anchor(popup)
      await parent.evaluate(() => window.fixture.append(31))
      await popup.waitForTimeout(650)
      assert.deepEqual(await anchor(popup), reading, 'new output preserves reading position')
      await popup.getByRole('button', { name: 'Load earlier messages', exact: true }).evaluate(button => button.click())
      await popup.waitForTimeout(650)
      const prepended = await anchor(popup)
      assert.equal(prepended.id, reading.id, 'prepend preserves message anchor')
      assert.ok(Math.abs(prepended.offset - reading.offset) <= 1, 'prepend preserves anchor offset')
      await inspect(popup, `history-${viewport.width}`, 'END-MARKER-31')

      // Command groups expand in flow without waiting for a row measurement.
      const group = popup.locator('.cmd-row-group').last()
      if (await group.count()) {
        await group.evaluate(button => button.click())
        await popup.waitForTimeout(550)
        await inspect(popup, `commands-${viewport.width}`)
      }
      await popup.getByRole('button', { name: 'Jump to latest output', exact: true }).click()
      await popup.waitForTimeout(600)
      for (const dark of [false, true]) {
        await parent.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
        await popup.waitForTimeout(2300)
        await inspect(popup, `screenshot-${viewport.width}-${dark ? 'dark' : 'light'}`, 'END-MARKER-31')
        await popup.screenshot({ path: path.join(output, `side-flow-${viewport.width}-${dark ? 'dark' : 'light'}.png`) })
      }

      await parent.evaluate(() => {
        window.fixture.state.messages = window.fixture.state.messages.map(message => message.id === 'turn-31-answer'
          ? { ...message, images: [`${location.origin}/__side-flow-image.svg`] } : message)
      })
      await popup.waitForFunction(() => [...document.querySelectorAll('img.message-image-preview')].some(image => image.complete && image.naturalHeight > 0))
      await popup.waitForTimeout(650)
      assert.ok((await inspect(popup, `delayed-image-${viewport.width}`)).gap <= 16, 'image growth follows latest')

      await parent.evaluate(() => window.resumeLayout())
      await popup.close()
      await parent.waitForSelector('.conversation-flow-content')
      await parent.waitForTimeout(600)
      await inspect(parent, `returned-${viewport.width}`, 'END-MARKER-31')
      assert.equal(await parent.evaluate(() => window.layoutMetrics.activeObservers), 1)
      assert.deepEqual(await parent.evaluate(() => window.fixture.requests), { earlier: 1, later: 0, latest: 0 })

      if (viewport.width === 375) {
        await parent.evaluate(() => { window.fixture.state.mode = 'flow' })
        await parent.waitForTimeout(300)
        // Failed history loads retain the page; a later request can recover.
        await parent.evaluate(() => { window.fixture.failEarlier = true })
        await parent.getByRole('button', { name: 'Load earlier messages', exact: true }).evaluate(button => button.click())
        await parent.getByText('Synthetic history failure', { exact: true }).waitFor()
        await inspect(parent, 'history-error-retains-body', 'END-MARKER-31')
        await parent.evaluate(() => {
          window.fixture.failEarlier = false
          window.fixture.state.hasMoreNewer = window.fixture.state.isHistoryWindow = true
        })
        await parent.getByRole('button', { name: 'Load later messages', exact: true }).evaluate(button => button.click())
        await parent.waitForFunction(() => window.fixture.requests.later === 1 && !window.fixture.state.hasMoreNewer)
        await inspect(parent, 'load-newer', 'END-MARKER-101')
        await parent.evaluate(() => window.fixture.latest())
        await parent.waitForTimeout(300)
        await inspect(parent, 'history-return-latest', 'END-MARKER-29')
        await parent.evaluate(() => window.fixture.locate('turn-10-answer'))
        assert.ok(await parent.locator('[data-message-id="turn-10-answer"]').evaluate(row => {
          const rect = row.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0
        }), 'search navigation reaches a real row')
        await parent.evaluate(() => window.fixture.latest())
        await parent.waitForTimeout(200)
        await inspect(parent, 'flow-search-return', 'END-MARKER-29')
        const start = Date.now()
        await parent.evaluate(() => window.fixture.stress())
        await parent.waitForFunction(() => document.querySelector('.conversation-list').textContent.includes('STRESS-END-999'))
        const stress = await inspect(parent, '1000-message-capacity', 'STRESS-END-999')
        results[results.length - 1].elapsedMs = Date.now() - start
        results[results.length - 1].textBytes = await parent.evaluate(() => new TextEncoder().encode(window.fixture.state.messages.map(message => message.text).join('')).length)
        assert.equal(stress.rows, 1000)
        await parent.evaluate(() => { window.fixture.state.mode = 'main' })
        await parent.waitForSelector('.vue-recycle-scroller__item-wrapper')
        assert.ok(await parent.locator('.conversation-item').count() < 1000, 'main still virtualizes')
        await parent.evaluate(() => window.fixture.locate('stress-500'))
        await parent.waitForSelector('[data-message-id="stress-500"]')
        await parent.evaluate(() => {
          window.fixture.state.mode = 'side'
          window.fixture.state.threadId = 'different-side-thread'
          window.fixture.state.messages = [{ id: 'new-thread', role: 'assistant', text: 'NEW-THREAD-ONLY' }]
        })
        await parent.waitForSelector('.conversation-flow-content')
        await inspect(parent, 'thread-switch', 'NEW-THREAD-ONLY')
        assert.equal(await parent.locator('[data-message-id="stress-500"]').count(), 0)
        await parent.getByRole('button', { name: 'Minimize side conversation', exact: true }).click()
        assert.equal(await parent.locator('.conversation-flow-content').count(), 0)
        await parent.evaluate(() => { window.fixture.state.visible = true })
        await parent.waitForSelector('.conversation-flow-content')
        await inspect(parent, 'reopened', 'NEW-THREAD-ONLY')
      }
      await parent.evaluate(() => window.fixture.unmount())
      await parent.waitForTimeout(800)
      assert.equal(await parent.evaluate(() => window.layoutMetrics.activeObservers), 0, 'unmount releases observers')
      assert.equal(await parent.evaluate(() => window.pendingLayoutFrames()), 0, 'unmount releases animation frames')
      assert.deepEqual(errors, [], 'no browser errors')
      results.push({ viewport, apiRequests: requests })
      await context.close()
    }
  } finally {
    await fs.writeFile(path.join(output, 'side-flow-results.json'), JSON.stringify(results, null, 2))
    await browser.close()
  }
  console.log(`PASS: ${results.filter(result => result.label).length} layout checks across 3 viewports, plus interaction/lifecycle assertions; screenshots and metrics: ${output}`)
}
run().catch(error => { console.error(error); process.exitCode = 1 })
