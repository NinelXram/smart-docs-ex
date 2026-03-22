import { describe, it, expect, vi } from 'vitest'

vi.mock('xlsx', () => ({
  utils: {
    book_new: vi.fn(() => ({})),
    aoa_to_sheet: vi.fn(() => ({})),
    book_append_sheet: vi.fn(),
  },
  write: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

import {
  injectVariables,
  generatePdf,
  generateDocx,
  generateXlsx,
} from '../../lib/templateEngine.js'

const RAW = 'This agreement is made with [VALUE] hereinafter, effective as of [VALUE] between parties.'

describe('injectVariables', () => {
  const variables = [
    { name: 'ClientName', marker: 'made with [VALUE] hereinafter' },
    { name: 'EffectiveDate', marker: 'effective as of [VALUE] between' },
  ]
  const values = { ClientName: 'Acme Corp', EffectiveDate: '2026-01-01' }

  it('replaces [VALUE] with the provided value in each marker', () => {
    const { content, warnings } = injectVariables(RAW, variables, values)
    expect(content).toContain('made with Acme Corp hereinafter')
    expect(content).toContain('effective as of 2026-01-01 between')
    expect(warnings).toHaveLength(0)
  })

  it('uses empty string when value is not provided', () => {
    const { content } = injectVariables(RAW, variables, { ClientName: 'Acme Corp' })
    expect(content).toContain('effective as of  between')
  })

  it('warns and skips a variable whose marker is not found', () => {
    const { warnings } = injectVariables(
      'unrelated content',
      [{ name: 'Missing', marker: 'not [VALUE] here' }],
      { Missing: 'x' }
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('"Missing"')
    expect(warnings[0]).toContain('not found')
  })

  it('warns and skips a variable whose marker has no [VALUE] token', () => {
    const { warnings } = injectVariables(
      RAW,
      [{ name: 'Bad', marker: 'agreement is made with' }],
      { Bad: 'x' }
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('malformed marker')
  })

  it('replaces first occurrence and warns when marker is duplicated', () => {
    const content = 'word [VALUE] end. word [VALUE] end.'
    const { content: result, warnings } = injectVariables(
      content,
      [{ name: 'Dup', marker: 'word [VALUE] end' }],
      { Dup: 'X' }
    )
    expect(result).toBe('word X end. word [VALUE] end.')
    expect(warnings[0]).toContain('2 times')
  })
})

describe('generatePdf', () => {
  it('throws — PDF generation has been removed', async () => {
    await expect(generatePdf('some content')).rejects.toThrow('PDF generation removed')
  })
})

describe('generateDocx', () => {
  it('throws — not yet implemented with new renderer', async () => {
    await expect(generateDocx('some content')).rejects.toThrow('not yet implemented')
  })
})

describe('generateXlsx', () => {
  it('returns a Blob', async () => {
    const blob = await generateXlsx('line1\nline2')
    expect(blob).toBeInstanceOf(Blob)
  })
})
