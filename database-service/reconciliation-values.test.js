import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from './reconciliation-values.js'

test('comparison preserves dates, decimal precision and equivalent storage paths', () => {
  assert.equal(normalize('2026-09-16', { type: 'date' }), '2026-09-16')
  assert.equal(normalize(100, { type: 'numeric' }), normalize('100.00', { type: 'numeric' }))
  assert.notEqual(normalize('9007199254740993.01', { type: 'numeric' }), normalize('9007199254740993.02', { type: 'numeric' }))
  assert.equal(normalize('https://a/storage/v1/object/public/photos/a.png'), normalize('https://b/functions/v1/storage-files/public/photos/a.png'))
})
