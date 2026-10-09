/**
 * C64 port builder: turns a user's own Atari 2600 ROM into a C64 .prg and .d64.
 * Each game is a "profile" (games/<id>.js) holding the finished C64 program with
 * every byte of the original game blanked, plus where the ROM's bytes go back in.
 * So no original game code is ever stored here. Runs in browsers and in Node.
 */

const games = [];

// ---------------------------------------------------------------- MD5
function md5(bytes: number[]) {
  const K = new Uint32Array(64),
    S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const len = bytes.length,
    total = ((len + 8) >> 6) + 1,
    M = new Uint32Array(total * 16);
  for (let i = 0; i < len; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[len >> 2] |= 0x80 << ((len % 4) * 8);
  M[total * 16 - 2] = (len * 8) >>> 0;
  M[total * 16 - 1] = Math.floor(len / 2 ** 29);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let blk = 0; blk < total * 16; blk += 16) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + M[blk + g]) >>> 0,
        s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, "0")).join(""))
    .join("");
}

// ---------------------------------------------------------------- ZIP
// [{name, data}] for every stored or deflated file in a .zip
async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    out = [];
  let p = 0;
  while (p + 30 <= bytes.length && dv.getUint32(p, true) === 0x04034b50) {
    const flags = dv.getUint16(p + 6, true),
      method = dv.getUint16(p + 8, true);
    let csize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true),
      xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen));
    const start = p + 30 + nlen + xlen;
    if (flags & 8) {
      // sizes in a trailing data descriptor: find the next header
      let q = start;
      while (
        q + 4 <= bytes.length &&
        dv.getUint32(q, true) !== 0x04034b50 &&
        dv.getUint32(q, true) !== 0x02014b50
      )
        q++;
      csize = q - start - (dv.getUint32(q - 16, true) === 0x08074b50 ? 16 : 12);
    }
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.push({ name, data: raw.slice() });
    else if (method === 8) {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      out.push({ name, data: new Uint8Array(await new Response(stream).arrayBuffer()) });
    }
    p = start + csize + (flags & 8 ? 16 : 0);
  }
  return out;
}

// ---------------------------------------------------------------- games
function addGame(g) {
  g.templateBytes = Uint8Array.from(atob(g.template), (c) => c.charCodeAt(0));
  const i = games.findIndex((x) => x.md5 === g.md5); // a newer profile for the same ROM replaces the old one
  if (i >= 0) games[i] = g;
  else games.push(g);
}

// Which game is this file (a ROM, or a .zip holding one)? -> {game, rom} or null
async function identify(bytes) {
  const match = (data) => {
    const h = md5(data);
    return games.find((g) => g.md5 === h);
  };
  let g = match(bytes);
  if (g) return { game: g, rom: bytes };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    for (const f of await unzip(bytes)) {
      g = match(f.data);
      if (g) return { game: g, rom: f.data };
    }
  }
  return null;
}

// Put the ROM's bytes back into the template: segments are [romStart, prgOffset, length]
function buildPrg(game, rom) {
  const out = game.templateBytes.slice();
  for (const [r, p, n] of game.segments) out.set(rom.subarray(r, r + n), p);
  return out;
}

// ---------------------------------------------------------------- D64
// A standard 35-track 1541 disk holding one PRG file
function buildD64(file, fileName, diskName, diskId) {
  const spt = (t) => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);
  const tracks = 35,
    off = [];
  let o = 0;
  for (let t = 1; t <= tracks; t++) {
    off[t] = o;
    o += spt(t) * 256;
  }
  const img = new Uint8Array(o);
  const used = Array.from({ length: tracks + 1 }, (_, t) => new Uint8Array(t ? spt(t) : 0));
  const at = (t, s) => off[t] + s * 256;
  const petscii = (str, n) => {
    const b = new Uint8Array(n).fill(0xa0);
    for (let i = 0; i < Math.min(n, str.length); i++) b[i] = str.toUpperCase().charCodeAt(i);
    return b;
  };

  // allocate like the 1541 does: tracks outward from the directory, 10-sector interleave
  const order = [];
  for (let t = 17; t >= 1; t--) order.push(t);
  for (let t = 19; t <= tracks; t++) order.push(t);
  const chain = [],
    blocks = Math.ceil(file.length / 254);
  let ti = 0,
    s = 0;
  while (chain.length < blocks) {
    if (ti >= order.length) throw new Error("the program does not fit on a disk");
    const t = order[ti],
      n = spt(t);
    let tries = 0;
    while (used[t][s] && tries < n) {
      s = (s + 1) % n;
      tries++;
    }
    if (used[t][s]) {
      ti++;
      s = 0;
      continue;
    }
    used[t][s] = 1;
    chain.push([t, s]);
    s = (s + 10) % n;
    if (used[t].every(Boolean)) {
      ti++;
      s = 0;
    }
  }
  chain.forEach(([t, s], i) => {
    const p = at(t, s),
      part = file.subarray(i * 254, (i + 1) * 254);
    if (i + 1 < chain.length) {
      img[p] = chain[i + 1][0];
      img[p + 1] = chain[i + 1][1];
    } else {
      img[p] = 0;
      img[p + 1] = part.length + 1;
    }
    img.set(part, p + 2);
  });

  used[18][0] = used[18][1] = 1; // directory: track 18 sector 1
  const dir = at(18, 1);
  img[dir] = 0;
  img[dir + 1] = 0xff;
  img[dir + 2] = 0x82; // closed PRG
  img[dir + 3] = chain[0][0];
  img[dir + 4] = chain[0][1];
  img.set(petscii(fileName, 16), dir + 5);
  img[dir + 30] = blocks & 255;
  img[dir + 31] = blocks >> 8;

  const bam = at(18, 0); // block availability map: track 18 sector 0
  img[bam] = 18;
  img[bam + 1] = 1;
  img[bam + 2] = 0x41;
  for (let t = 1; t <= tracks; t++) {
    let free = 0,
      bits = 0;
    for (let k = 0; k < spt(t); k++)
      if (!used[t][k]) {
        free++;
        bits |= 1 << k;
      }
    const e = bam + 4 * t;
    img[e] = free;
    img[e + 1] = bits & 255;
    img[e + 2] = (bits >> 8) & 255;
    img[e + 3] = (bits >> 16) & 255;
  }
  img.set(petscii(diskName, 16), bam + 0x90);
  img[bam + 0xa0] = img[bam + 0xa1] = 0xa0;
  img.set(petscii(diskId, 2), bam + 0xa2);
  img[bam + 0xa4] = 0xa0;
  img[bam + 0xa5] = 0x32;
  img[bam + 0xa6] = 0x41; // DOS type "2A"
  img[bam + 0xa7] = img[bam + 0xa8] = img[bam + 0xa9] = img[bam + 0xaa] = 0xa0;
  return img;
}

// ---------------------------------------------------------------- CRT
// An EasyFlash cartridge image (CRT hardware type 32: EasyFlash, Kung Fu Flash, the Ultimate
// devices, VICE) holding one .prg. Bank 0 starts the C64 as without a cartridge, copies the .prg
// to where LOAD puts it, switches the cartridge off and RUNs it: src/web/crtboot.asm, whose
// bytes tools/mkcrtboot.js puts here (bank 0's ROML code, then ROMH's last page).
const CRT_BOOT =
  "j4CPgMPCzTgwAAAAAAAAAa0+A41iA42eA60/A41jA6kBjQDerTwD8CugALkAgJn//8jQ9+5jA+5gA61gA8nA0A6pgI1gA+5CA61CA40A3s48A9DVrD0D8BqtYAONnAOtYwONnwOgALkAgJn//8jMPQPQ9KkEjQLerUADha6FLa1BA4WvhS4gM6UgWaZMrqeOFtAgo/2pAKiZAgCZAAKZAAPI0PSiPKADhrKEs6mghcKpVY0AoKIAoKAYIC3+qQiNggKpBI2IAiAV/SBb/1ggU+Qgv+Oi+5qihr0IgJ07A8rQ90xDA3ii/5rYoge9E/+dAAHKEPdMAAGph40C3mz8/0D///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////8b/wD/G/8=";
function buildCrt(prg, name) {
  const load = prg[0] | (prg[1] << 8),
    n = prg.length - 2,
    end = load + n;
  if (n < 1 || load < 0x0400 || end > 0xd000)
    throw new Error("the .crt needs a program between $0400 and $CFFF");
  const boot = Uint8Array.from(atob(CRT_BOOT), (c) => c.charCodeAt(0));
  const banks = 1 + Math.ceil(n / 0x4000);
  if (banks > 64) throw new Error("the program is too big for a cartridge");
  const rom = new Uint8Array(banks * 0x4000).fill(0xff); // per bank: ROML, then ROMH
  rom.set(boot.subarray(0, boot.length - 256), 0);
  rom.set(boot.subarray(boot.length - 256), 0x4000 - 256);
  const pages = n >> 8; // (the loader's first bytes: whole pages, the rest)
  if (pages > 255) throw new Error("the program is too big for a cartridge");
  rom.set([pages, n & 255, load & 255, load >> 8, end & 255, end >> 8], 9);
  rom.set(prg.subarray(2), 0x4000);
  const crt = new Uint8Array(0x40 + banks * 2 * (0x10 + 0x2000));
  const str = (s, at) => {
    for (let i = 0; i < s.length; i++) crt[at + i] = s.charCodeAt(i);
  };
  str("C64 CARTRIDGE   ", 0);
  crt[0x13] = 0x40; // header length
  crt[0x14] = 1; // version 1.0
  crt[0x17] = 32; // EasyFlash
  crt[0x18] = 1;
  crt[0x19] = 0; // EXROM, GAME: Ultimax at the start
  str(
    String(name)
      .toUpperCase()
      .replace(/[^\x20-\x5f]/g, " ")
      .slice(0, 32),
    0x20,
  );
  let p = 0x40;
  for (let b = 0; b < banks; b++)
    for (let h = 0; h < 2; h++) {
      str("CHIP", p);
      crt[p + 6] = 0x20;
      crt[p + 7] = 0x10; // packet length $2010
      crt[p + 9] = 2; // flash
      crt[p + 11] = b; // bank
      crt[p + 12] = h ? 0xa0 : 0x80; // load address
      crt[p + 14] = 0x20; // size $2000
      crt.set(rom.subarray((b * 2 + h) * 0x2000, (b * 2 + h + 1) * 0x2000), p + 0x10);
      p += 0x10 + 0x2000;
    }
  return crt;
}

// ---------------------------------------------------------------- making profiles
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const MIN_ROM_SHARE = 0.5;

/**
 * Turn a finished C64 port (.prg) and the ROM it was made from into a profile.
 * Every stretch of the .prg that is a copy of the ROM (8+ bytes, wherever and
 * however often it occurs) is blanked and recorded as [romStart, prgOffset,
 * length]. Runs of one repeated byte carry nothing of the game and are skipped.
 * -> {profile, ok (rebuilds the .prg exactly), blanked, romUsed, share, enough}
 * A port made by patching the ROM in place holds most of it byte for byte (every port here
 * holds 65% or more). When much less of the ROM is found, either the ROM isn't the one the
 * port was made from or the port is a rewrite of the game: its profile would still carry the
 * game's code, so none is offered (enough = false) under MIN_ROM_SHARE.
 */
function makeProfile(prg, rom, meta) {
  const MIN = 8,
    key = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const idx = new Map();
  for (let i = 0; i + 4 <= rom.length; i++) {
    const k = key(rom, i);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(i);
  }
  const segments = [];
  for (let p = 2; p + 4 <= prg.length;) {
    // (skip the 2-byte load address)
    let best = 0,
      bestR = -1;
    for (const r of idx.get(key(prg, p)) || []) {
      let n = 0;
      while (r + n < rom.length && p + n < prg.length && rom[r + n] === prg[p + n]) n++;
      if (n > best) {
        best = n;
        bestR = r;
      }
    }
    let uniform = true;
    for (let i = 1; i < best && uniform; i++) if (prg[p + i] !== prg[p]) uniform = false;
    if (best >= MIN && !uniform) {
      segments.push([bestR, p, best]);
      p += best;
    } else p++;
  }
  const template = prg.slice();
  for (const [, p, n] of segments) template.fill(0, p, p + n);
  const profile = {
    id: meta.id,
    title: meta.title,
    system: meta.system,
    original: meta.original,
    port: meta.port,
    version: meta.version,
    romName: meta.romName,
    romSize: rom.length,
    md5: md5(rom),
    fileName: meta.fileName,
    prgName: meta.prgName,
    diskName: meta.diskName,
    diskId: meta.diskId,
    controls: meta.controls,
    segments,
    template: toBase64(template),
  };
  const rebuilt = buildPrg({ templateBytes: template, segments }, rom);
  const ok = rebuilt.length === prg.length && rebuilt.every((b, i) => b === prg[i]);
  const used = new Uint8Array(rom.length);
  for (const [r, , n] of segments) used.fill(1, r, r + n);
  const romUsed = used.reduce((a, b) => a + b, 0),
    share = romUsed / rom.length;
  return {
    profile,
    ok,
    blanked: segments.reduce((a, s) => a + s[2], 0),
    romUsed,
    share,
    enough: ok && share >= MIN_ROM_SHARE,
  };
}

// The text of a profile file (games/<id>.js)
// The text of a profile file (games/<id>.json): plain data, never code. The
// "about" field says what it is; every copy of the ROM's bytes is blanked.
function profileSource(profile) {
  const about =
    `${profile.title} (${profile.system}) for the C64: builder profile. Contains no original game code: ` +
    `every copy of the ROM's bytes is blanked, and the user's ROM supplies them.`;
  return JSON.stringify({ about, ...profile }, null, 1) + "\n";
}

// Load the site's own profiles: games/index.json lists the files. Each is
// checked like a dropped one. Each gets its address as .file, and as .readme the
// address of its read-me if the list has one (readme_<id>.md), and as .source its source
// bundle's (source_<id>.zip, tools/mksource.js).
// -> number loaded (throws if the list can't be read)
async function loadHosted(base = "games/") {
  const fresh = { cache: "no-cache" }; // (always ask the server: right after a publish, not a stale copy)
  const list = await (await fetch(base + "index.json", fresh)).json();
  const readmes = new Set(list.readmes || []),
    sources = new Set(list.sources || []);
  let n = 0;
  for (const file of list.games || []) {
    try {
      const { profile, error } = parseProfile(await (await fetch(base + file, fresh)).text());
      if (error) {
        console.warn(file + ": " + error);
        continue;
      }
      profile.file = base + file;
      if (readmes.has("readme_" + profile.id + ".md"))
        profile.readme = base + "readme_" + profile.id + ".md";
      if (sources.has("source_" + profile.id + ".zip"))
        profile.source = base + "source_" + profile.id + ".zip";
      addGame(profile);
      n++;
    } catch (e) {
      console.warn(file + ": " + e.message);
    }
  }
  return n;
}

// A .zip of files [{name, data (bytes or text)}], stored (no compression) -> bytes
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const enc = new TextEncoder(),
    parts = [],
    dir = [];
  let off = 0;
  const d = new Date(),
    dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name),
      data = typeof f.data === "string" ? enc.encode(f.data) : f.data,
      crc = crc32(data);
    const head = (sig, extra) => {
      const h = new DataView(new ArrayBuffer(extra));
      h.setUint32(0, sig, true);
      return h;
    };
    const lh = head(0x04034b50, 30);
    lh.setUint16(4, 20, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    const ch = head(0x02014b50, 46);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, off, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    dir.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const dirSize = dir.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, off, true);
  const all = [...parts, ...dir, new Uint8Array(end.buffer)],
    out = new Uint8Array(off + dirSize + 22);
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

// The BASIC lines at the start of a .prg: [{num, text}] (REM and SYS spelled out)
function parseBasic(prg) {
  const load = prg[0] | (prg[1] << 8),
    lines = [];
  let p = 2;
  while (p + 4 < prg.length && lines.length < 100) {
    const next = prg[p] | (prg[p + 1] << 8);
    if (!next) break;
    const num = prg[p + 2] | (prg[p + 3] << 8);
    let q = p + 4,
      text = "";
    while (q < prg.length && prg[q]) {
      const c = prg[q++];
      text +=
        c === 0x8f
          ? "REM"
          : c === 0x9e
            ? "SYS"
            : c === 0x99
              ? "PRINT"
              : c >= 32 && c < 127
                ? String.fromCharCode(c)
                : "";
    }
    lines.push({ num, text });
    const np = next - load + 2;
    if (np <= p) break;
    p = np;
  }
  return lines;
}

// ---------------------------------------------------------------- profiles from files
// A profile is a JSON file: it is parsed as data, never run, and every field
// is checked. -> {profile} or {error}
function parseProfile(text) {
  if (!/^\s*\{/.test(text)) return { error: "this file isn't a game profile" };
  let p;
  try {
    p = JSON.parse(text);
  } catch (e) {
    return { error: "the profile is damaged (" + e.message + ")" };
  }
  const error = checkProfile(p);
  return error ? { error } : { profile: p };
}

function checkProfile(p) {
  const str = (v, max, re) =>
    typeof v === "string" && v.length > 0 && v.length <= max && (!re || re.test(v));
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "not a profile";
  if (!str(p.id, 40, /^[a-z0-9-]+$/)) return "bad id";
  for (const k of ["title", "system", "original", "port", "version", "romName"])
    if (!str(p[k], 200)) return "missing or bad " + k;
  if (!str(p.fileName, 40, /^[A-Za-z0-9._-]+$/)) return "bad fileName";
  for (const k of ["prgName", "diskName"])
    if (!str(p[k], 16, /^[\x20-\x5f\x61-\x7a]+$/)) return "bad " + k;
  if (!str(p.diskId, 2, /^[\x20-\x5f\x61-\x7a]+$/)) return "bad diskId";
  if (!str(p.md5, 32, /^[0-9a-f]{32}$/)) return "bad md5";
  if (!int(p.romSize, 1, 65536)) return "bad romSize";
  if (
    p.controls !== undefined &&
    !(
      Array.isArray(p.controls) &&
      p.controls.length <= 50 &&
      p.controls.every(
        (c) =>
          Array.isArray(c) &&
          c.length === 2 &&
          c.every((s) => typeof s === "string" && s.length <= 200),
      )
    )
  )
    return "bad controls";
  if (
    typeof p.template !== "string" ||
    p.template.length > 120000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(p.template)
  )
    return "bad template";
  let t;
  try {
    t = atob(p.template);
  } catch {
    return "bad template";
  }
  if (t.length < 3 || t.length > 65538) return "bad template size";
  if (!Array.isArray(p.segments) || p.segments.length > 20000) return "bad segments";
  for (const s of p.segments) {
    if (
      !Array.isArray(s) ||
      s.length < 3 ||
      !int(s[0], 0, p.romSize - 1) ||
      !int(s[2], 1, p.romSize) ||
      s[0] + s[2] > p.romSize ||
      !int(s[1], 2, t.length - 1) ||
      s[1] + s[2] > t.length
    )
      return "bad segments";
  }
  return null;
}

export {
  games,
  md5,
  unzip,
  zip,
  addGame,
  loadHosted,
  identify,
  buildPrg,
  buildD64,
  buildCrt,
  toBase64,
  makeProfile,
  MIN_ROM_SHARE,
  profileSource,
  parseBasic,
  parseProfile,
  checkProfile,
};
