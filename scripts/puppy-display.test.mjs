import { test } from 'node:test'
import assert from 'node:assert/strict'
import { latestPuppyImage, availableLitterId } from '../src/lib/puppyDisplay.js'

test('cover uses upload time even when gallery sort order changes, and skips newer videos', () => {
  assert.equal(latestPuppyImage([
    { photo_url:'old.jpg', created_at:'2026-01-01', sort_order:99 },
    { photo_url:'new.jpg', created_at:'2026-02-01', sort_order:0 },
    { photo_url:'video.mp4?token=1', created_at:'2026-03-01' },
  ],'cover.jpg'),'new.jpg')
})
test('batch upload ties use newest image ID and fall back when no images exist', () => {
  assert.equal(latestPuppyImage([
    { id:2, photo_url:'last.jpg', created_at:'2026-02-01', sort_order:0 },
    { id:1, photo_url:'first.jpg', created_at:'2026-02-01', sort_order:99 },
  ]),'last.jpg')
  assert.equal(latestPuppyImage([{ photo_url:'clip.mov' }],'cover.jpg'),'cover.jpg')
})
test('default litter skips newer upcoming and fully placed litters, handles numeric IDs', () => {
  const litters=[{id:4},{id:3},{id:2},{id:1}]
  assert.equal(availableLitterId(litters,[{litter_id:3,status:'sold'},{litter_id:'2',status:'available'},{litter_id:1,status:'available'}]),2)
  assert.equal(availableLitterId(litters,[]),4)
  assert.equal(availableLitterId([],[]),'')
})
