// src/test/fieldEditor.test.js
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { insertXlsx } from '../lib/fieldEditor.js'

// Build a minimal XLSX binary with a single string cell at A1
function makeBinary(cellValue) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([[cellValue]])
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return buf instanceof ArrayBuffer ? buf : buf.buffer
}

// Read a cell value back from a binary
function readCell(binary, addr) {
  const wb = XLSX.read(binary, { type: 'array' })
  const [sheet, ref] = addr.split('!')
  return wb.Sheets[sheet]?.[ref]?.v ?? null
}

describe('insertXlsx', () => {
  it('writes pattern as full cell content when pattern is just a token', () => {
    const binary = makeBinary('Bao Huynh')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', '{{name}}')
    expect(result.error).toBeUndefined()
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('{{name}}')
  })

  it('writes pattern preserving label prefix', () => {
    const binary = makeBinary('Name: Bao Huynh')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', 'Name: {{name}}')
    expect(result.error).toBeUndefined()
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('Name: {{name}}')
  })

  it('returns error when cell address does not exist in sheet', () => {
    const binary = makeBinary('hello')
    const result = insertXlsx(binary, 'Sheet1!Z99', 'name', '{{name}}')
    expect(result.error).toBe('cell_not_found')
  })

  it('overwrites previous cell content with new pattern', () => {
    const binary = makeBinary('old value')
    const result = insertXlsx(binary, 'Sheet1!A1', 'name', 'Label: {{name}}')
    expect(readCell(result.binary, 'Sheet1!A1')).toBe('Label: {{name}}')
  })
})
