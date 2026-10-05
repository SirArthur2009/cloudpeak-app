import test from 'node:test'
import assert from 'node:assert/strict'
import { objectKey, canAccess } from './policy.js'

test('private files require an admin for reads and mutations', () => {
  for (const role of [undefined, 'client', 'guest']) {
    for (const action of ['sign-read', 'sign-upload', 'delete']) assert.equal(canAccess(role, 'admin-files', action), false)
  }
  assert.equal(canAccess('admin', 'admin-files', 'sign-read'), true)
  assert.equal(canAccess('client', 'puppy-photos', 'sign-read'), true)
  assert.equal(canAccess('client', 'puppy-photos', 'sign-upload'), false)
})

test('object keys preserve folder names and cannot escape their bucket', () => {
  assert.equal(objectKey('admin-files', 'folder/photo.png'), 'admin-files/folder/photo.png')
  for (const path of ['', '../private', 'folder/../file', '/absolute', 'folder//file', 'folder\\file', 'file\n']) {
    assert.throws(() => objectKey('puppy-photos', path))
  }
  assert.throws(() => objectKey('unknown', 'file'))
})
