import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewUrl } from '../src/social-api.js';
test('link previews restrict origins and reject URL authority tricks',()=>{
  assert.equal(previewUrl('https://open.spotify.com/track/example#section').href,'https://open.spotify.com/track/example');
  for(const url of ['http://spotify.com','https://spotify.com.evil.example','https://spotify.com@evil.example','https://127.0.0.1','https://localhost','https://spotify.com:8443','file:///etc/passwd']) assert.throws(()=>previewUrl(url));
});
