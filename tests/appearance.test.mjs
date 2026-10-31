import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundFormat,backgroundSettings,DEFAULT_BACKGROUND} from '../src/shared/appearance.ts';
test('背景参数拒绝非有限数值并限制透明度、模糊与遮罩范围',()=>{
  assert.deepEqual(backgroundSettings(null),DEFAULT_BACKGROUND);
  assert.deepEqual(backgroundSettings({shade:NaN,blur:Infinity,opacity:1,enabled:false,fit:'bad',paused:true}),{...DEFAULT_BACKGROUND,opacity:55,enabled:false,paused:true});
  assert.deepEqual(backgroundSettings({shade:150,blur:100,opacity:999,fit:'contain'}),{...DEFAULT_BACKGROUND,shade:90,blur:24,opacity:100,fit:'contain'});
});
test('背景按文件头识别图片和视频，HTML及伪造后缀不被当作壁纸',()=>{
  assert.equal(backgroundFormat(Buffer.from('<html>file named wallpaper.png</html>')),null);
  assert.equal(backgroundFormat(Buffer.from('not a video.mp4')),null);
  for(const [bytes,kind,mime] of [[Buffer.from([137,80,78,71,13,10,26,10]),'image','image/png'],[Buffer.from([255,216,255,224]),'image','image/jpeg'],[Buffer.from('RIFF0000WEBP'),'image','image/webp'],[Buffer.from('GIF89a'),'image','image/gif'],[Buffer.from('0000ftypisom'),'video','video/mp4'],[Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('000webm')]),'video','video/webm']])assert.deepEqual(backgroundFormat(bytes),{kind,mime});
});
