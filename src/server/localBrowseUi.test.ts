import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createDirectoryListingHtml, createTextEditorHtml, decodeBrowsePath } from './localBrowseUi'

it('decodes raw development URLs once and wires the file dispatcher in Vite', async () => {
  expect(decodeBrowsePath('/tmp/source%2520%20%23.cpp')).toBe('/tmp/source%20 #.cpp')
  const vite = await readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8')
  expect(vite).toContain('const openingFile = url.pathname === "/codex-local-open"')
  expect(vite).toContain('normalizeLocalPath(url.searchParams.get("path") ?? "")')
})

it('opens source files through the dispatcher and renders a read-only C++ editor safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-editor-'))
  try {
    const path = join(dir, 'source #%.cpp')
    await writeFile(path, 'int main() {}\n// </script>', 'utf8')
    expect(await createDirectoryListingHtml(dir)).toContain(`/codex-local-open?path=${encodeURIComponent(path)}`)
    const html = await createTextEditorHtml(path, { readOnly: true })
    expect(html).toContain('ace/mode/c_cpp')
    expect(html).toContain('editor.setReadOnly(true)')
    expect(html).toContain('Read only')
    expect(html).not.toContain('// </script>')
    expect(html).toContain('<\\/script>')
    expect(html).toContain('Raw</a>')
    expect(html).toContain("localStorage.getItem('codex-web-local.dark-mode.v1')")
    expect(html).toContain("window.addEventListener('storage', applyTheme)")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
