// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { AddComponentMenu } from '../FormBuilder'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('~/components/doc', () => ({ DocEditor: () => null }))

let container: HTMLDivElement
let root: Root
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function openMenu(props: { allowCheckbox?: boolean; allowNewTypes?: boolean } = {}) {
  const onAdd = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <MemoryRouter>
        <AddComponentMenu allowCheckbox allowNewTypes {...props} onAdd={onAdd} />
      </MemoryRouter>,
    ),
  )
  act(() => (container.querySelector('button') as HTMLButtonElement).click())
  const rows = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
  return { onAdd, rows, labels: rows.map((r) => r.textContent) }
}

describe('AddComponentMenu', () => {
  it('offers every component and adds the one picked', () => {
    const { onAdd, rows, labels } = openMenu()
    expect(labels).toContain('Short answer')
    expect(labels).toContain('Page break')
    act(() => rows.find((r) => r.textContent === 'Dropdown')!.click())
    expect(onAdd).toHaveBeenCalledWith('select')
  })

  it('hides flagged types when the flag is off', () => {
    const { labels } = openMenu({ allowNewTypes: false })
    expect(labels).not.toContain('Multiple choice')
    expect(labels).not.toContain('1 to 5 scale')
    expect(labels).toContain('Dropdown')
  })

  it('hides checkboxes on forms that disallow them', () => {
    const { labels } = openMenu({ allowCheckbox: false })
    expect(labels).not.toContain('Checkboxes')
  })
})
