// =============================================================================
// rules.test.mjs — the path rules, the sequence rule, the media allow-list
// and the Range parser.
//
// PARITY: the cases marked "(desktop)" are the desktop's own, COPIED from
// src/tools/rabbit_v0.1.0/bins/rabbitCloudBins.routes.test.js and
// bins/binMedia.test.js (never imported: the gateway shares no code with the
// desktop's server). A change to either side's rule that the other does not
// share fails here or there.
// =============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isSafeRelativePath, joinUnderRoot, isStrictlyUnder, realContained, rootPathModule } from '../src/rules/paths.mjs';
import { detectSequence, sequenceFromEntries, extOf } from '../src/rules/sequence.mjs';
import { mediaTypeForPath, isAllowedStill, mtAgrees, canonicalMediaType, ALLOWED } from '../src/rules/media.mjs';
import { planRange, contentRange } from '../src/rules/range.mjs';

const UNC = '\\\\salthours-nas\\footage';

describe('isSafeRelativePath (0091\'s CHECK)', () => {
  it('(desktop) round 2: a segment ending in a dot or a space is refused (".. " is ".." to Windows)', () => {
    for (const bad of ['.. /secret.mov', 'a/.. /b.mov', 'a/. /b.mov', 'clip.mov.', 'A001 /clip.mov', 'A001/clip.mov ', '.. ']) expect(isSafeRelativePath(bad), bad).toBe(false);
    for (const ok of ['A001/clip.mov', 'day 1/clip.mov', 'a.b/c.d', 'VFX/plate_seq', '.hidden/clip.mov']) expect(isSafeRelativePath(ok), ok).toBe(true);
  });
  it('(desktop) forward slashes inside the location, never out of it', () => {
    for (const ok of ['A001/clip.mov', 'clip.mov', 'VFX/plate_seq', 'a b/c d.png']) expect(isSafeRelativePath(ok), ok).toBe(true);
    for (const bad of ['/clip.mov', 'A001/', 'A001//clip.mov', '../clip.mov', 'a/../b.mov', 'a/./b', 'C:/x.mov', 'a\\b.mov', '', null]) expect(isSafeRelativePath(bad), String(bad)).toBe(false);
  });
  it('at most 1024 characters, and no NUL', () => {
    expect(isSafeRelativePath('a/' + 'b'.repeat(1022))).toBe(true);
    expect(isSafeRelativePath('a/' + 'b'.repeat(1023))).toBe(false);
    expect(isSafeRelativePath('a\0b.mov')).toBe(false);
  });
});

describe('joinUnderRoot (the desktop\'s resolveCloudFilePath, given the root)', () => {
  it('(desktop) joins the location root and the path, and refuses what would escape', () => {
    expect(joinUnderRoot(UNC, 'A001/clip.mov')).toBe('\\\\salthours-nas\\footage\\A001\\clip.mov');
    expect(joinUnderRoot(UNC, '../clip.mov')).toBeNull();
    expect(joinUnderRoot(UNC, 'C:/clip.mov')).toBeNull();
    expect(joinUnderRoot('Z:\\footage', 'A001/clip.mov')).toBe('Z:\\footage\\A001\\clip.mov');
  });
  it('(desktop) the root\'s shape chooses the path rules, not the computer', () => {
    expect(joinUnderRoot('/Volumes/footage', 'A001/clip.mov')).toBe('/Volumes/footage/A001/clip.mov');
    expect(joinUnderRoot('/Volumes/footage', 'VFX/plate_seq')).toBe('/Volumes/footage/VFX/plate_seq');
    expect(joinUnderRoot('/Volumes/footage', 'a/../../clip.mov')).toBeNull();
    expect(joinUnderRoot('z:/footage', 'A001/clip.mov')).toBe('z:\\footage\\A001\\clip.mov');
    expect(joinUnderRoot('\\\\salthours-nas\\footage\\', 'A001/clip.mov')).toBe('\\\\salthours-nas\\footage\\A001\\clip.mov');
    expect(joinUnderRoot('\\\\SALTHOURS-NAS\\Footage', 'A001/clip.mov')).toBe('\\\\SALTHOURS-NAS\\Footage\\A001\\clip.mov');
  });
  it('the container\'s mount root joins the POSIX way', () => {
    expect(joinUnderRoot('/locations/nas/footage', 'Day 1/A001.mov')).toBe('/locations/nas/footage/Day 1/A001.mov');
    expect(rootPathModule('/locations/nas/footage')).toBe(path.posix);
    expect(rootPathModule(UNC)).toBe(path.win32);
  });
  it('a path is strictly under its root: the root itself is not a clip, a sibling with the root as prefix is outside', () => {
    expect(isStrictlyUnder(UNC, UNC)).toBe(false);
    expect(isStrictlyUnder(UNC, UNC + '2\\clip.mov')).toBe(false);
    expect(isStrictlyUnder(UNC, UNC.toUpperCase() + '\\A\\clip.mov')).toBe(true);
    expect(isStrictlyUnder('/locations/nas/footage', '/locations/nas/footage2/x')).toBe(false);
    expect(isStrictlyUnder('/locations/nas/footage', '/LOCATIONS/nas/footage/x')).toBe(false);
    expect(isStrictlyUnder(UNC, '/locations/x')).toBe(false);
  });
});

describe('realContained: realpath of both, contained again (§10 row 8)', () => {
  let base, root, outside;
  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-paths-'));
    root = path.join(base, 'Share Root');
    outside = path.join(base, 'outside');
    fs.mkdirSync(path.join(root, 'A001'), { recursive: true });
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(root, 'A001', 'Clip.mp4'), 'x');
    fs.writeFileSync(path.join(outside, 'secret.mp4'), 'y');
    // A directory link out of the root: a junction on Windows (no privilege
    // needed), a symlink elsewhere.
    fs.symlinkSync(outside, path.join(root, 'link-out'), process.platform === 'win32' ? 'junction' : 'dir');
  });
  afterAll(() => { fs.rmSync(base, { recursive: true, force: true }); });

  it('a file inside the root resolves to its on-disk spelling', async () => {
    const got = await realContained(root, path.join(root, 'A001', 'Clip.mp4'));
    expect(got && path.basename(got)).toBe('Clip.mp4');
  });
  it('a link inside the root that points outside is refused', async () => {
    const joined = joinUnderRoot(root, 'link-out/secret.mp4');
    expect(joined).not.toBeNull(); // lexically inside…
    expect(await realContained(root, joined)).toBeNull(); // …really outside
  });
  it('a missing file or a missing root is refused', async () => {
    expect(await realContained(root, path.join(root, 'nope.mp4'))).toBeNull();
    expect(await realContained(path.join(base, 'no-root'), path.join(base, 'no-root', 'x'))).toBeNull();
  });
  it.runIf(process.platform !== 'win32')('a file symlink out of the root is refused (POSIX)', async () => {
    fs.symlinkSync(path.join(outside, 'secret.mp4'), path.join(root, 'A001', 'sneaky.mp4'));
    expect(await realContained(root, path.join(root, 'A001', 'sneaky.mp4'))).toBeNull();
  });
});

describe('sequences (the desktop\'s detectSequence, copied)', () => {
  let root;
  const mk = (dir, names) => { fs.mkdirSync(path.join(root, dir)); for (const n of names) fs.writeFileSync(path.join(root, dir, n), 'x'); };
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-seq-'));
    mk('seq', [1, 2, 3, 5].map((n) => `shot.${String(n).padStart(4, '0')}.exr`));
    mk('mixed', ['a.png', 'b.png']);
    mk('nested', ['f_01.png', 'f_02.png']); fs.mkdirSync(path.join(root, 'nested', 'inner'));
    mk('one', ['f_01.png']);
    mk('ok', [...Array.from({ length: 20 }, (_, i) => `shot.${String(i + 1).padStart(4, '0')}.exr`), 'Thumbs.db', 'render.log']);
    mk('three', [...[1, 2, 3, 4].map((i) => `shot.${i}.exr`), 'note1.txt', 'note2.txt', 'note3.txt']);
    mk('toomany', [...[1, 2, 3, 4].map((i) => `shot.${i}.exr`), 'note1.txt', 'note2.txt', 'note3.txt', 'note4.txt']);
    mk('onedigit', ['s.9.exr', 's.10.exr']);
    mk('mixedsep', ['img1.png', 'img_0002.png']);
    mk('mixedpad', ['img1.png', 'img0002.png']);
    mk('overflow', ['a.0998.png', 'a.0999.png', 'a.1000.png']);
    mk('pngs', ['p_001.png', 'p_002.png', 'p_003.png', '.DS_Store']);
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
  const d = (name) => detectSequence(path.join(root, name));

  it('(desktop) a numbered folder is one sequence with a pattern, a count and its gaps', async () => {
    const s = await d('seq');
    expect(s).toMatchObject({ pattern: 'shot.####.exr', ext: '.exr', frame_count: 4, first_frame: 1, last_frame: 5, missing_frames: 1 });
    expect(path.basename(s.middle_frame_path)).toBe('shot.0003.exr');
  });
  it('(desktop) unnumbered images, a folder with a subfolder, one frame and a missing folder are not sequences', async () => {
    expect(await d('mixed')).toBeNull();
    expect(await d('nested')).toBeNull();
    expect(await d('one')).toBeNull();
    expect(await d('nope')).toBeNull();
  });
  it('(desktop) two sidecars among twenty frames are set aside and reported', async () => {
    expect(await d('ok')).toMatchObject({ frame_count: 20, sidecars: 2, pattern: 'shot.####.exr' });
  });
  it('(desktop) three sidecars are tolerated whatever the size; four beside four frames is a folder', async () => {
    expect(await d('three')).toMatchObject({ frame_count: 4, sidecars: 3 });
    expect(await d('toomany')).toBeNull();
  });
  it('(desktop) single-digit frame numbers count', async () => {
    expect(await d('onedigit')).toMatchObject({ frame_count: 2, first_frame: 9, last_frame: 10 });
  });
  it('(desktop) a different separator or a different zero padding is another series', async () => {
    expect(await d('mixedsep')).toBeNull();
    expect(await d('mixedpad')).toBeNull();
  });
  it('(desktop) a padded series may outgrow its padding', async () => {
    expect(await d('overflow')).toMatchObject({ frame_count: 3, first_frame: 998, last_frame: 1000, pattern: 'a.####.png' });
  });
  it('the middle of an odd count, dotfiles ignored, and the frame is an allow-listed still for PNG only', async () => {
    const s = await d('pngs');
    expect(s.middle_frame_name).toBe('p_002.png');
    expect(isAllowedStill(s.middle_frame_path)).toBe(true);
    expect(isAllowedStill((await d('seq')).middle_frame_path)).toBe(false); // EXR: the desktop's
  });
  it('the pure half answers the same from entries, with no file system', () => {
    const e = (name, dir = false) => ({ name, isFile: !dir, isDirectory: dir });
    expect(sequenceFromEntries([e('a_1.jpg'), e('a_2.jpg'), e('a_3.jpg'), e('a_4.jpg')]).middle_frame_name).toBe('a_3.jpg');
    expect(sequenceFromEntries([e('a_1.jpg'), e('a_2.jpg'), e('sub', true)])).toBeNull();
    expect(extOf('x.MOV')).toBe('.mov');
    expect(extOf('x.toolongextension1')).toBe('');
  });
});

describe('media: the allow-list by the on-disk extension (D8), mt agreement (F13)', () => {
  it('serves exactly the design\'s list, .mov included', () => {
    expect(Object.fromEntries(ALLOWED)).toEqual({
      '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
      '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.bwf': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
    });
  });
  it('refuses the professional and the scriptable formats', () => {
    for (const p of ['a.mxf', 'a.mkv', 'a.avi', 'a.wmv', 'a.mts', 'a.r3d', 'a.braw', 'a.exr', 'a.dpx', 'a.tif', 'a.psd', 'a.svg', 'a.html', 'a', 'a.mp4.txt', 'a.MP4 ']) {
      expect(mediaTypeForPath(p), p).toBeNull();
    }
    expect(mediaTypeForPath('C:\\x\\A.MOV')).toBe('video/quicktime');
  });
  it('mt agrees when it names the same type (aliases and parameters aside), or names nothing', () => {
    expect(mtAgrees('video/mp4', 'video/mp4')).toBe(true);
    expect(mtAgrees('video/mp4; codecs="avc1.64001f"', 'video/mp4')).toBe(true);
    expect(mtAgrees('VIDEO/X-M4V', 'video/mp4')).toBe(true);
    expect(mtAgrees('audio/x-wav', 'audio/wav')).toBe(true);
    expect(mtAgrees(null, 'video/mp4')).toBe(true);
    expect(mtAgrees('', 'image/png')).toBe(true);
    expect(mtAgrees('video/mp4', 'image/png')).toBe(false);
    expect(mtAgrees('video/quicktime', 'video/mp4')).toBe(false);
    expect(mtAgrees('video/mp4', null)).toBe(false);
    expect(canonicalMediaType(' Image/JPG ')).toBe('image/jpeg');
  });
});

describe('Range (design §5 step 6)', () => {
  const S = 1000;
  it('no header: 200, the whole file', () => {
    expect(planRange(undefined, S)).toEqual({ status: 200, start: 0, end: 999, length: 1000 });
    expect(planRange(undefined, 0)).toEqual({ status: 200, start: 0, end: -1, length: 0 });
  });
  it('bytes=a-b, a- and -n: 206', () => {
    expect(planRange('bytes=0-99', S)).toEqual({ status: 206, start: 0, end: 99, length: 100 });
    expect(planRange('bytes=900-5000', S)).toEqual({ status: 206, start: 900, end: 999, length: 100 });
    expect(planRange('bytes=500-', S)).toEqual({ status: 206, start: 500, end: 999, length: 500 });
    expect(planRange('bytes=-100', S)).toEqual({ status: 206, start: 900, end: 999, length: 100 });
    expect(planRange('bytes=-5000', S)).toEqual({ status: 206, start: 0, end: 999, length: 1000 });
    expect(planRange('Bytes= 7-7 ', S)).toEqual({ status: 206, start: 7, end: 7, length: 1 });
  });
  it('multi-range, unsatisfiable and malformed: 416', () => {
    for (const h of ['bytes=0-1,5-6', 'bytes=1000-', 'bytes=1000-1001', 'bytes=-0', 'bytes=5-4', 'bytes=a-b', 'bytes=--1', 'bytes=1-2-3', 'items=0-1', 'bytes=', 'bytes=-', 'bytes=99999999999999999-', 'bytes=+1-2', 'bytes=0x1-2']) {
      expect(planRange(h, S).status, h).toBe(416);
    }
    expect(planRange('bytes=0-1,5-6', S).reason).toBe('multi');
    expect(planRange('bytes=0-', 0).status).toBe(416);
    expect(planRange('bytes=0-1', -1).status).toBe(416);
  });
  it('Content-Range for 206 and 416', () => {
    expect(contentRange(planRange('bytes=0-99', S), S)).toBe('bytes 0-99/1000');
    expect(contentRange(planRange('bytes=0-1,2-3', S), S)).toBe('bytes */1000');
  });
});
