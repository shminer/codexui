const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const { mkdtemp, mkdir, writeFile, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')

const base = process.env.PROFILE_BASE_URL || 'http://127.0.0.1:4173'
const output = resolve('output/playwright')
const marker = `PATH_MOCK_${Date.now()}`
const encode = (path) => path.split('/').map(encodeURIComponent).join('/')
const href = (path) => `/codex-local-browse${encode(path.startsWith('/') ? path : `/${path}`)}`

async function main() {
  await mkdir(output, { recursive: true })
  const temp = await mkdtemp(join(tmpdir(), 'codexui-TestChat-'))
  const root = temp.replace(/\\/g, '/')
  const file = join(temp, 'notes # %20.txt')
  const image = join(temp, 'image # %20.png')
  const urlFilePath = fileURLToPath(pathToFileURL(file)).replace(/\\/g, '/').replace(/^[a-z]:/iu, (drive) => drive.toUpperCase())
  const skillFile = join(temp, 'skills', 'PathSkill', 'SKILL.md')
  await mkdir(join(temp, 'skills', 'PathSkill'), { recursive: true })
  await writeFile(skillFile, '# PathSkill')
  await writeFile(file, 'correct target')
  await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'))
  const scenarios = [
    { name: 'windows', cwd: root, cases: [
      ['DriveBackslash', 'C:\\work\\notes.md:12', 'C:\\work\\notes.md', 'C:/work/notes.md'],
      ['DriveSlash', 'C:/work/notes.md#L12', 'C:/work/notes.md', 'C:/work/notes.md'],
      ['FileUrl', 'file:///C:/work/a%2520b.md', 'C:/work/a%20b.md', 'C:/work/a%20b.md'],
      ['Relative', 'src\\notes.md', 'src\\notes.md', `${root}/src/notes.md`],
      ['Parent', '../notes.md', '../notes.md', `${root.slice(0, root.lastIndexOf('/'))}/notes.md`],
      ['ActualFile', file, file, `${root}/notes # %20.txt`],
      ['ActualFileUrl', pathToFileURL(file).href, urlFilePath, urlFilePath],
      ['Unc', '\\\\server\\share\\folder\\..\\notes.md', '\\\\server\\share\\folder\\..\\notes.md', '//server/share/notes.md'],
      ['UncFileUrl', 'file://server/share/notes.md', '\\\\server\\share\\notes.md', '//server/share/notes.md'],
      ['DevicePath', '\\\\?\\C:\\work\\notes.md', 'C:\\work\\notes.md', 'C:/work/notes.md'],
      ['Reserved', 'C:/work/a#b?c%20.md', 'C:/work/a#b?c%20.md', 'C:/work/a#b?c%20.md'],
      ['Unicode', 'C:/work/\u6d4b\u8bd5 (1).md', 'C:/work/\u6d4b\u8bd5 (1).md', 'C:/work/\u6d4b\u8bd5 (1).md'],
    ] },
    { name: 'linux', cwd: '/home/user/TestChat', cases: [
      ['LinuxAbsolute', '/home/user/notes.md:12', '/home/user/notes.md', '/home/user/notes.md'],
      ['LinuxRelative', './src/../notes.md', './src/../notes.md', '/home/user/TestChat/notes.md'],
      ['LinuxHome', '~/notes.md', '~/notes.md', '/home/user/notes.md'],
      ['LinuxSpecial', '/tmp/a#b?c%20.md', '/tmp/a#b?c%20.md', '/tmp/a#b?c%20.md'],
      ['LinuxBackslash', '/tmp/a\\b.md', '/tmp/a\\b.md', '/tmp/a\\b.md'],
      ['LinuxFileUrl', 'file:///tmp/a%20b.md', '/tmp/a b.md', '/tmp/a b.md'],
      ['LinuxWhitespaceFileUrl', 'file:///tmp/report.txt%20', '/tmp/report.txt ', '/tmp/report.txt '],
      ['LinuxDoubleSlash', '//home/alice/../notes.md', '//home/alice/../notes.md', '/home/notes.md'],
      ['LinuxDoubleSlashBackslash', '//tmp/a\\b.md', '//tmp/a\\b.md', '/tmp/a\\b.md'],
      ['ExplicitUncFileUrl', 'file://server/share/notes.md', '\\\\server\\share\\notes.md', '//server/share/notes.md'],
    ] },
    { name: 'linux-double-slash', cwd: '//home/alice', cases: [
      ['LinuxDoubleSlashParent', '../notes.md', '../notes.md', '/home/notes.md'],
      ['LinuxDoubleSlashRelative', 'src/a\\b.md', 'src/a\\b.md', '/home/alice/src/a\\b.md'],
    ] },
    { name: 'unc', cwd: '\\\\server\\share\\TestChat', cases: [
      ['UncRelative', 'src\\notes.md', 'src\\notes.md', '//server/share/TestChat/src/notes.md'],
      ['UncRootBoundary', '../../../notes.md', '../../../notes.md', '//server/share/notes.md'],
    ] },
    { name: 'windows-home', cwd: 'C:\\Users\\alice\\TestChat', cases: [
      ['WindowsHome', '~/notes.md', '~/notes.md', 'C:/Users/alice/notes.md'],
      ['DriveBoundary', '../../../../notes.md', '../../../../notes.md', 'C:/notes.md'],
    ] },
  ]
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' })
      const page = await context.newPage()
      const errors = []
      const requests = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => { if (request.url().includes('/codex-api/')) requests.push(request.url()) })
      const thread = {
        id: 'mock-path-TestChat', cwd: scenario.cwd, preview: marker, name: 'TestChat path links',
        model: 'gpt-5', modelProvider: 'openai', createdAt: 1, updatedAt: 1, status: { type: 'idle' }, turns: [],
      }
      let sent = false
      let socket
      await page.routeWebSocket('**/codex-api/ws', (ws) => {
        socket = ws
        ws.send(JSON.stringify({ method: 'ready', params: { ok: true } }))
      })
      await page.route('**/codex-api/**', async (route) => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        let payload = { data: [] }
        if (path === '/codex-api/rpc') {
          const { method, params } = request.postDataJSON()
          let result = {}
          if (method === 'thread/list') result = { data: [thread], nextCursor: null }
          else if (['thread/read', 'thread/resume', 'thread/start'].includes(method)) result = { thread, model: 'gpt-5', modelProvider: 'openai' }
          else if (method === 'config/read') result = { config: { model: 'gpt-5', model_provider: 'openai' } }
          else if (method === 'model/list') result = { data: [{ id: 'gpt-5', model: 'gpt-5', isDefault: true }], nextCursor: null }
          else if (method === 'collaborationMode/list') result = { data: [] }
          else if (method === 'skills/list') result = { data: [{ cwd: scenario.cwd, skills: [{ name: 'PathSkill', description: '', path: skillFile, scope: 'user', enabled: true }], errors: [] }] }
          else if (method === 'turn/start') {
            const text = params.input.find((item) => item.type === 'text').text
            assert.ok(text.includes(marker), 'TestChat must send the unique marker')
            sent = true
            const imageMarkdown = scenario.name === 'windows' ? `\n\n![MockImage](${pathToFileURL(image).href})` : ''
            const reply = `${marker}\n\n${scenario.cases.map(([label, target]) => `[${label}](${target})`).join('\n\n')}\n\n[Web](https://example.com/docs?q=1#part)${imageMarkdown}`
            thread.turns = [{ id: 'mock-turn', status: 'completed', items: [
              { id: 'mock-user', type: 'userMessage', content: [{ type: 'text', text }] },
              { id: 'mock-reply', type: 'agentMessage', text: reply },
            ] }]
            result = { turn: { id: 'mock-turn', status: 'completed', items: [] } }
            setTimeout(() => socket?.send(JSON.stringify({ method: 'turn/completed', params: { threadId: thread.id, turn: thread.turns[0] } })), 100)
          }
          payload = { result }
        } else if (path === '/codex-api/meta/methods') payload = { data: ['thread/list', 'thread/read', 'thread/resume', 'thread/start', 'turn/start', 'model/list', 'config/read', 'skills/list'] }
        else if (path === '/codex-api/meta/notifications') payload = { data: ['turn/completed'] }
        else if (path === '/codex-api/free-mode/status') payload = { enabled: false, hasAuth: true, provider: 'openai', models: ['gpt-5'] }
        else if (path === '/codex-api/thread-recent') payload = { result: null }
        else if (path === '/codex-api/home-directory') payload = { data: { path: scenario.cwd } }
        else if (path === '/codex-api/workspace-roots-state') payload = { data: { order: [scenario.cwd], active: [scenario.cwd], labels: { [scenario.cwd]: 'TestChat' }, projectOrder: [scenario.cwd] } }
        else if (path === '/codex-api/thread-queue-state') payload = { data: {} }
        else if (path === '/codex-api/accounts') payload = { data: [], accounts: [] }
        else if (path === '/codex-api/git/branches') payload = { data: { options: [], dirty: false } }
        await route.fulfill({ json: payload })
      })
      await page.goto(`${base}/#/thread/${thread.id}`, { waitUntil: 'domcontentloaded' })
      await page.locator('.thread-composer-input').fill(`${marker}\n\n[Representative](src/notes.md)`)
      await page.locator('.thread-composer-submit').click()
      await page.waitForFunction(() => document.querySelector('.thread-composer-input')?.value === '')
      assert.ok(sent, 'mock turn/start was reached')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByRole('link', { name: scenario.cases[0][0], exact: true }).waitFor()
      for (const [label, , title, target] of scenario.cases) {
        const anchor = page.getByRole('link', { name: label, exact: true })
        const actual = await anchor.evaluate((a) => ({ href: a.getAttribute('href'), title: a.title, text: a.textContent }))
        const check = { scenario: scenario.name, label, hrefOk: actual.href === href(target), titleOk: actual.title === title, textOk: actual.text === label, ...actual }
        results.push(check)
        assert.ok(check.hrefOk && check.titleOk && check.textOk, JSON.stringify(check))
      }
      assert.equal(await page.getByRole('link', { name: 'Web', exact: true }).getAttribute('href'), 'https://example.com/docs?q=1#part')
      if (scenario.name === 'windows') {
        const preview = page.getByRole('img', { name: 'MockImage', exact: true })
        await preview.scrollIntoViewIfNeeded()
        assert.ok(await preview.evaluate((img) => img.decode().then(() => img.naturalWidth > 0)))
        const popupPromise = page.waitForEvent('popup')
        await page.getByRole('link', { name: 'ActualFile', exact: true }).click({ button: 'right' })
        await page.locator('.file-link-context-menu-item').filter({ hasText: 'Edit file' }).click()
        const popup = await popupPromise
        await popup.waitForLoadState()
        assert.equal(new URL(popup.url()).pathname, href(`${root}/notes # %20.txt`).replace('/codex-local-browse', '/codex-local-edit'))
        assert.ok((await popup.textContent('body')).includes('notes # %20.txt'))
        await popup.close()
        await page.locator('.search-dropdown-trigger').filter({ hasText: 'Skills' }).click()
        await page.locator('.search-dropdown-option-main').filter({ hasText: 'PathSkill' }).click()
        await page.locator('.thread-composer-input').click()
        const skillPopupPromise = page.waitForEvent('popup')
        await page.getByRole('button', { name: 'Open PathSkill SKILL.md', exact: true }).click()
        const skillPopup = await skillPopupPromise
        await skillPopup.waitForLoadState()
        assert.equal(new URL(skillPopup.url()).pathname, href(`${root}/skills/PathSkill/SKILL.md`))
        assert.ok((await skillPopup.textContent('body')).includes('# PathSkill'))
        await skillPopup.close()
      }
      assert.deepEqual(errors, [])
      for (const theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme })
        await page.waitForTimeout(2500)
        assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), theme === 'dark')
        const screenshot = join(output, `testchat-${scenario.name}-paths-${theme}-cjs.png`)
        await page.screenshot({ path: screenshot, fullPage: true })
      }
      if (scenario.name === 'windows') {
        const popupPromise = page.waitForEvent('popup')
        await page.getByRole('button', { name: 'Browse files', exact: true }).click()
        const popup = await popupPromise
        await popup.waitForLoadState()
        assert.equal(new URL(popup.url()).pathname, href(root))
        const fileLink = popup.locator('a.file-link').filter({ hasText: 'notes # %20.txt' })
        await fileLink.click()
        assert.ok((await popup.textContent('body')).includes('correct target'))
        await popup.close()
        const response = await page.request.get(`${base}/codex-local-image?${new URLSearchParams({ path: pathToFileURL(image).href })}`)
        assert.equal(response.status(), 200)
        assert.deepEqual(await response.body(), await readFile(image))
        const saved = await page.request.put(base + href(`${root}/notes # %20.txt`).replace('/codex-local-browse', '/codex-local-edit'), { data: 'saved target', headers: { 'Content-Type': 'text/plain' } })
        assert.equal(saved.status(), 200)
        assert.equal(await readFile(file, 'utf8'), 'saved target')
      }
      console.log(`${scenario.name}: ${scenario.cases.length} links passed, TestChat send/reload passed, ${requests.length} API requests`)
      await context.close()
    }
    await writeFile(join(output, 'local-paths-mock-results.json'), JSON.stringify({ marker, base, results }, null, 2))
  } finally {
    await browser.close()
    await rm(temp, { recursive: true, force: true })
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
