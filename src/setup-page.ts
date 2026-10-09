import * as Builder from "./Builder";
import * as Disasm from "./Disasm";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// ---------------------------------------------------------------- tabs
const tabs = [
  ["tabBuild", "paneBuild"],
  ["tabMake", "paneMake"],
];
const show = (which) =>
  tabs.forEach(([t, p]) => {
    const on = t === which;
    $(t).setAttribute("aria-selected", String(on));
    $(p).hidden = !on;
  });
tabs.forEach(([t]) =>
  $(t).addEventListener("click", () => {
    show(t);
    history.replaceState(null, "", t === "tabMake" ? "#make" : "#");
  }),
);
if (location.hash === "#make") show("tabMake");

// A drop zone that takes several files; dropping anywhere on the page goes to the open tab
function dropZone(zone, input, handler) {
  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", () => {
    if (input.files.length) handler([...input.files]);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach((t) =>
    zone.addEventListener(t, (e) => {
      e.preventDefault();
      zone.classList.add("over");
    }),
  );
  ["dragleave", "drop"].forEach((t) =>
    zone.addEventListener(t, () => zone.classList.remove("over")),
  );
}
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  if (files.length) ($("paneBuild").hidden ? makeFiles : buildFiles)(files);
});

// ================================================================ build a game
// On the website, games/index.json lists the site's own profiles: then a ROM
// alone is enough for those games. Opened from disk on its own there is no
// list (or the browser won't let the page read it): then it works standalone.
let lastRom = null,
  lastProfile = null,
  siteMode = false;
let listed = [];
function listGames() {
  listed = Builder.games.filter((g) => !g.dropped).sort((a, b) => a.title.localeCompare(b.title));
  $("gameList").innerHTML = listed
    .map(
      (g, i) =>
        `<details><summary>${esc(g.title)}<span class="ver">(${esc(g.version)})</span></summary><div>` +
        `${esc(g.system)} original by ${esc(g.original)}.<br>C64 port by ${esc(g.port)}, version ${esc(g.version)}.<br>` +
        `Needs: <code class="long">${esc(g.romName)}</code> (${g.romSize} bytes)<br>MD5 <code class="long">${esc(g.md5)}</code>` +
        `<table>${(g.controls || []).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>` +
        `<div class="buttons">` +
        (g.readme
          ? `<button type="button" class="btn" data-readme="${i}">Read me</button>` +
            `<a class="btn" href="${esc(g.readme)}" download="${esc(baseName(g))}.md">Download README</a>`
          : "") +
        (g.file
          ? `<a class="btn" href="${esc(g.file)}" download="${esc(baseName(g))}.json">Download profile (.json)</a>`
          : "") +
        `</div></div></details>`,
    )
    .join("");
  $("showGames").textContent = `Supported games (${listed.length})`;
}
$("gameList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-readme]");
  if (b) showReadme(readmeFor(listed[+b.dataset.readme]), listed[+b.dataset.readme].title);
});

// ---------------------------------------------------------------- read-mes
// A game's README (Markdown, in the site's games/ folder), shown in the page. Only the
// Markdown our read-mes use: headings, paragraphs, lists, tables, `code`, **bold**, *italic*
// and links. Everything is escaped first; only http(s) links become links.
function inline(s) {
  const code = [];
  return (
    esc(s)
      .replace(/`([^`]+)`/g, (m, c) => `\u0000${code.push(c) - 1}\u0000`)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, "$1<em>$2</em>")
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>',
      )
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // oxlint-disable-next-line no-control-regex
      .replace(/\u0000(\d+)\u0000/g, (m, n) => `<code>${code[n]}</code>`)
  );
}
function markdown(text) {
  const lines = text.replace(/\r/g, "").split("\n"),
    out = [];
  const isRule = (r) => /^[\s|:-]+$/.test(r);
  const cells = (r) =>
    r
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const block = (l) => /^(#{1,6}\s|\s*\||\s*[*-]\s|```)/.test(l);
  let i = 0,
    m;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*)/.exec(l))) {
      const n = Math.min(m[1].length + 1, 4);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      i++;
    } else if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
      const head = rows.length > 1 && isRule(rows[1]);
      out.push(
        '<div class="scroll"><table>' +
          rows
            .filter((r) => !isRule(r))
            .map((r, k) => {
              const t = head && k === 0 ? "th" : "td";
              return (
                "<tr>" +
                cells(r)
                  .map((c) => `<${t}>${inline(c)}</${t}>`)
                  .join("") +
                "</tr>"
              );
            })
            .join("") +
          "</table></div>",
      );
    } else if (/^\s*[*-]\s/.test(l)) {
      const items = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (/^\s*[*-]\s/.test(lines[i]) || /^\s+\S/.test(lines[i]))
      ) {
        if (/^\s*[*-]\s/.test(lines[i])) items.push(lines[i].replace(/^\s*[*-]\s+/, ""));
        else items[items.length - 1] += " " + lines[i].trim();
        i++;
      }
      out.push("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
      // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
    } else if (/^```/.test(l)) {
      const code = [];
      // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      i++;
      out.push(`<pre>${esc(code.join("\n"))}</pre>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && (!para.length || !block(lines[i])))
        para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
// A read-me is the site's (g.readme, an address) or one dropped with the files ({name, text}),
// which goes with the game its first heading names, else with the profile dropped with it.
const droppedReadmes = [];
// The downloads' name: the profile's fileName with the version in it (games from Missile
// Command on have it there already, "missilecmd-0.1"; older ones get "-1.2" added)
function baseName(g) {
  const num = (String(g.version).match(/[\d.]*\d/) || [""])[0]; // (file names carry just the number)
  if (num && g.fileName.endsWith("-" + num)) return g.fileName;
  return g.fileName + "-" + String(g.version).trim().replace(/\s+/g, "-"); // ("beta 0.0.2": "beta-0.0.2")
}
function readmeFor(g) {
  if (g.readme) return { url: g.readme, name: baseName(g) + ".md" };
  const t = g.title.toLowerCase();
  return (
    droppedReadmes.find((r) => r.heading.toLowerCase().startsWith(t)) ||
    droppedReadmes.find((r) => r.md5 === g.md5)
  );
}
async function showReadme(src, title) {
  try {
    let text = src.text;
    if (src.url) {
      const r = await fetch(src.url, { cache: "no-cache" });
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      text = await r.text();
    }
    $("readmeBody").innerHTML = markdown(text);
    const a = $("readmeDl");
    if (a.href.startsWith("blob:")) URL.revokeObjectURL(a.href);
    a.href = src.url || URL.createObjectURL(new Blob([text], { type: "text/markdown" }));
    a.download = src.name;
    $("readmePanel").hidden = false;
    $("readmePanel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    bStatus(`Couldn't load the read-me for ${title}: ${e.message}`, "bad");
  }
}
$("readmeClose").addEventListener("click", () => {
  $("readmePanel").hidden = true;
});
$("showGames").addEventListener("click", () => {
  const open = $("gamesPanel").hidden;
  $("gamesPanel").hidden = !open;
  $("showGames").setAttribute("aria-expanded", String(open));
});
Builder.loadHosted()
  .then((n) => {
    if (!n) throw new Error("no games");
    siteMode = true;
    listGames();
    $("showGames").hidden = false;
    $("bDropTitle").textContent = "Drop a 2600 ROM here";
    $("bDropHint").textContent =
      "The .a26 file, or the .zip it came in. Or click to choose a file. " +
      "Game not listed? Drop its profile (.json) too.";
    $("modeNote").textContent = "This page lists the site's games.";
    $("selfDownload").hidden = false; // (only on the website: an offline copy has nothing to link to)
  })
  .catch(() => {
    $("modeNote").textContent =
      "Standalone: no game list here, so drop each ROM together with its profile " +
      "(and its README, to read it here).";
  });
const bStatus = (msg, cls) => {
  $("bStatus").textContent = msg;
  $("bStatus").className = "status " + (cls || "");
};
const link = (id, bytes, name) => {
  const a = $(id);
  if (a.href) URL.revokeObjectURL(a.href);
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  a.download = name;
};
const showLoaded = () => {
  const dropped = Builder.games.filter((g) => g.dropped);
  $("loaded").textContent = dropped.length
    ? "Profiles from your files: " + dropped.map((g) => g.title).join(", ") + "."
    : "";
};

// A dropped profile replaces the site's (or an earlier dropped) one for the same ROM,
// so a porter can try a new version of a listed game.
function addProfile(profile, source) {
  const same = Builder.games.find((g) => g.md5 === profile.md5);
  profile.dropped = source;
  profile.overridesSite = !!same && (!same.dropped || same.overridesSite);
  Builder.addGame(profile);
  showLoaded();
  return profile;
}

async function buildFiles(files) {
  $("bResult").classList.remove("show");
  try {
    let rom = null,
      readme = null,
      profileHere = null;
    for (const file of files) {
      if (/\.js$/i.test(file.name)) {
        bStatus(`${file.name}: game profiles are .json files.`, "bad");
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.(md|markdown|txt)$/i.test(file.name)) {
        // a read-me
        const text = new TextDecoder().decode(bytes),
          h = /^#+\s+(.+)$/m.exec(text);
        readme = { name: file.name, text, heading: h ? h[1].trim() : "", md5: null };
        droppedReadmes.unshift(readme);
        continue;
      }
      const isProfile = /\.json$/i.test(file.name) || (bytes[0] === 0x7b && bytes.length < 200000);
      if (!isProfile) {
        rom = { bytes, name: file.name };
        continue;
      }
      const { profile, error } = Builder.parseProfile(new TextDecoder().decode(bytes));
      if (error) {
        bStatus(`${file.name} isn't a usable game profile: ${error}.`, "bad");
        return;
      }
      lastProfile = profileHere = addProfile(profile, file.name);
    }
    if (readme) {
      const p = profileHere || lastProfile; // (used when its heading names no game)
      if (p) readme.md5 = p.md5;
      showReadme(readme, readme.name);
      if (!rom && !profileHere) {
        bStatus(`README loaded: ${readme.name}, shown below.`, "ok");
        if (!lastRom) return;
      }
    }
    if (rom) lastRom = rom;
    if (lastRom && Builder.games.length) return build(lastRom);
    if (lastRom)
      bStatus(`Got the ROM (${lastRom.name}). Now drop the game's profile (.json).`, "ok");
    else if (lastProfile)
      bStatus(
        `Profile loaded: ${lastProfile.title}. Now drop its ROM: ${lastProfile.romName}.`,
        "ok",
      );
  } catch (e) {
    bStatus("Something went wrong: " + e.message, "bad");
  }
}

async function build(rom) {
  const found = await Builder.identify(rom.bytes);
  if (!found) {
    bStatus(
      lastProfile && lastProfile.dropped
        ? `This ROM doesn't match the profile you dropped (${lastProfile.title}). It needs the exact ${lastProfile.romName}, MD5 ${lastProfile.md5}.`
        : siteMode
          ? "This ROM isn't supported. Each game needs the exact cartridge dump it was built from (other versions, " +
            'such as PAL ones, differ), or a .zip containing it. See "Supported games" for the file names and MD5s. ' +
            "If the game isn't listed, drop its profile (.json) too."
          : "This ROM doesn't match any profile you've dropped. Drop the game's profile (.json) too.",
      "bad",
    );
    return;
  }
  const g = found.game;
  const prg = Builder.buildPrg(g, found.rom);
  link("dlPrg", prg, g.fileName + ".prg");
  const d64 = Builder.buildD64(prg, g.prgName, g.diskName, g.diskId);
  link("dlD64", d64, g.fileName + ".d64");
  const crt = Builder.buildCrt(prg, g.title);
  link("dlCrt", crt, g.fileName + ".crt");
  $("rTitle").textContent = g.title + " for the Commodore 64";
  $("rCredits").textContent =
    `${g.system} original by ${g.original}. C64 port by ${g.port}, version ${g.version}.` +
    (g.dropped && siteMode
      ? ` (Built with the profile from your file ${g.dropped}, ` +
        (g.overridesSite
          ? "instead of this site's own profile for this game.)"
          : "not one of this site's games.)")
      : "");
  $("rControls").innerHTML = (g.controls || [])
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("");
  const readme = readmeFor(g); // (the site's, or one dropped with the files)
  $("rReadme").hidden = !readme;
  $("rReadme").onclick = () => showReadme(readme, g.title);
  const files = [
    { name: g.fileName + ".prg", data: prg },
    { name: g.fileName + ".d64", data: d64 },
    { name: g.fileName + ".crt", data: crt },
  ];
  let text = readme && readme.text; // (the .zip: the .prg, the .d64, the .crt and the read-me)
  if (readme && readme.url)
    try {
      const r = await fetch(readme.url, { cache: "no-cache" });
      if (r.ok) text = await r.text();
    } catch {
      /* (then the .zip goes without it) */
    }
  if (text) files.push({ name: baseName(g) + ".md", data: text });
  link("dlZip", Builder.zip(files), baseName(g) + ".zip");
  $("dlSrc").hidden = $("srcNote").hidden = !g.source;
  $("dlSrc").onclick = g.source ? () => sourceBundle(g, found.rom) : null;
  bStatus("ROM recognised: " + g.title + ". Your C64 version is ready:", "ok");
  $("bResult").classList.add("show");
}
// A game's source bundle (tools/mksource.js): everything that makes it, to build it or change it
// (its CLAUDE.md explains it all), with the 2600 disassembly made here from the player's own ROM:
// the site holds none of the original game.
async function sourceBundle(g, rom) {
  try {
    bStatus("Making the source bundle…", "ok");
    const r = await fetch(g.source, { cache: "no-cache" });
    if (!r.ok) throw new Error(r.status + " " + r.statusText);
    const files = await Builder.unzip(new Uint8Array(await r.arrayBuffer()));
    const sym = files.find((f) => /^games\/[^/]+\/2600\/symbols\.js$/.test(f.name));
    if (!sym) throw new Error("the bundle has no symbols.js");
    const module = { exports: {} };
    new Function("module", "exports", new TextDecoder().decode(sym.data))(module, module.exports);
    const symbols = module.exports;
    if (Builder.md5(rom) !== symbols.game.md5)
      throw new Error("this ROM isn't the one the source is for");
    files.push({
      name: sym.name.replace(/symbols\.js$/, symbols.game.asm),
      data: Disasm.disassemble(rom, symbols).asm,
    });
    const name = baseName(g) + "-src.zip";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([Builder.zip(files)], { type: "application/zip" }));
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
    bStatus(
      `Source bundle ready: ${name}. Its CLAUDE.md says what's in it and how to build it.`,
      "ok",
    );
  } catch (e) {
    bStatus("Couldn't make the source bundle: " + e.message, "bad");
  }
}
dropZone($("bDrop"), $("bFile"), buildFiles);

// ================================================================ make a profile
let prg = null,
  prgName = "",
  rom = null,
  romFile = "",
  made = null;
const notes = [];
async function makeFiles(files) {
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = file.name;
    if (
      /\.prg$/i.test(name) ||
      (bytes.length > 2 &&
        bytes[0] === 0x01 &&
        bytes[1] === 0x08 &&
        !/\.(a26|bin|rom|zip)$/i.test(name))
    ) {
      prg = bytes;
      prgName = name;
      prefill();
    } else if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const entry = (await Builder.unzip(bytes)).find((e) => /\.(a26|bin|rom)$/i.test(e.name));
      if (!entry) {
        notes.push(`${name}: no .a26 ROM inside this .zip`);
        continue;
      }
      rom = entry.data;
      romFile = entry.name;
    } else {
      rom = bytes;
      romFile = name;
    }
    if (rom && (!$("fRomName").value || $("fRomName").dataset.auto)) {
      $("fRomName").value = romFile;
      $("fRomName").dataset.auto = "1";
    }
  }
  showFiles();
}
$("fRomName").addEventListener("input", () => delete $("fRomName").dataset.auto);

function showFiles() {
  const sizeOk = rom && [2048, 4096, 8192, 12288, 16384, 32768, 65536].includes(rom.length);
  $("mFiles").innerHTML =
    `<div class="${prg ? "ok" : ""}">C64 program: ${prg ? esc(prgName) + ` (${prg.length} bytes)` : "not yet"}</div>` +
    `<div class="${rom ? (sizeOk ? "ok" : "bad") : ""}">2600 ROM: ${rom ? esc(romFile) + ` (${rom.length} bytes${sizeOk ? "" : ", an unusual size for a 2600 ROM"})` : "not yet"}</div>` +
    notes.map((n) => `<div class="bad">${esc(n)}</div>`).join("");
  $("make").disabled = !(prg && rom);
  $("needs").textContent = prg && rom ? "" : "Drop your .prg and ROM first.";
}

// Pre-fill from the BASIC lines (ports often put their credits and controls there)
function prefill() {
  const lines = Builder.parseBasic(prg);
  $("basic").textContent = lines.map((l) => `${l.num} ${l.text}`).join("\n");
  $("basicBox").hidden = !lines.length;
  // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
  const rems = lines
    .map((l) => l.text)
    .filter((t) => /^REM/.test(t))
    .map((t) => t.replace(/^REM\s*/, "").trim())
    .filter(Boolean);
  if (!rems.length) return;
  const cap = (s) =>
    s
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
      .replace(/ And /g, " and ");
  const set = (id, v) => {
    if (v && !$(id).value) $(id).value = v;
  };
  set("fTitle", cap(rems[0]));
  const controls = [];
  for (let i = 1; i < rems.length; i++) {
    const t = rems[i];
    let m;
    if (/^FROM THE ATARI/i.test(t)) continue;
    if ((m = t.match(/^(?:PROGRAMMED|DESIGNED|WRITTEN)(?: AT \S+)? BY\s*(.*)$/i))) {
      let who = m[1];
      // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
      while (i + 1 < rems.length && (!who || /,$/.test(who)))
        who = (who ? who + " " : "") + rems[++i];
      set("fOriginal", cap(who));
      continue;
    }
    if ((m = t.match(/^GRAPHICS BY\s+(.*)$/i))) {
      if ($("fOriginal").value && !/graphics/i.test($("fOriginal").value))
        $("fOriginal").value += ", graphics by " + cap(m[1]);
      continue;
    }
    if ((m = t.match(/^PORTED BY\s+(.*)$/i))) {
      set("fPort", cap(m[1]));
      continue;
    }
    if ((m = t.match(/^(?:VERSION|BETA|V)\s*([\d.]+.*)$/i))) {
      set("fVersion", /^BETA/i.test(t) ? m[1] + " beta" : m[1]);
      continue;
    }
    controls.push(t);
  }
  if (!$("fControls").value) $("fControls").value = controls.join("\n");
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "game";
$("make").addEventListener("click", () => {
  const title = $("fTitle").value.trim();
  if (!title) {
    alert("Please give the game a title.");
    $("fTitle").focus();
    return;
  }
  const id = slug(title),
    short = title.toUpperCase().slice(0, 16);
  const meta = {
    id,
    title,
    system: "Atari 2600",
    original: $("fOriginal").value.trim() || "unknown",
    port: $("fPort").value.trim() || "unknown",
    version: $("fVersion").value.trim() || "1.0",
    romName: $("fRomName").value.trim() || romFile,
    fileName: id + "-c64",
    prgName: short,
    diskName: short,
    diskId: (title.replace(/[^a-z0-9]/gi, "").slice(0, 2) || "GM").toUpperCase(),
    controls: $("fControls")
      .value.split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = l.match(/^(.*?)\s+[-–=:]\s+(.*)$/);
        return m ? [m[1], m[2]] : [l, ""];
      }),
  };
  const { profile, ok, blanked, romUsed, enough } = Builder.makeProfile(prg, rom, meta);
  const pct = Math.round((100 * romUsed) / rom.length),
    minPct = Math.round(100 * Builder.MIN_ROM_SHARE);
  // A port made by patching the ROM in place holds most of it byte for byte. When much less
  // is found, either this isn't the ROM the port was made from, or the port is a rewrite of
  // the game: either way the profile would still carry the game, so none is offered.
  const matches = enough;
  let html = "";
  if (!ok)
    html += `<p class="bad">Something went wrong: the profile doesn't rebuild your .prg exactly.</p>`;
  if (ok && !enough)
    html +=
      `<p class="bad">Only ${pct}% of this ROM appears in your .prg (a port made by patching the ROM ` +
      `holds ${minPct}% or more of it, usually much more). No profile was made: it would still contain the original ` +
      `game. Either this isn't the exact ROM the port was made from, or the port rewrote the game's code instead ` +
      `of running the ROM's; a profile can only be made for a port that runs the ROM's own code.</p>`;
  if (matches)
    html += `<p class="ok">Profile made and checked: it rebuilds your .prg byte for byte.</p>`;
  html +=
    `<table class="small">` +
    `<tr><td>Game</td><td>${esc(title)} (C64 port by ${esc(meta.port)}, version ${esc(meta.version)})</td></tr>` +
    `<tr><td>ROM</td><td><code class="long">${esc(meta.romName)}</code>, ${rom.length} bytes, MD5 <code class="long">${profile.md5}</code></td></tr>` +
    `<tr><td>Original game used</td><td>${romUsed} of ${rom.length} ROM bytes (${pct}%), in ${profile.segments.length} pieces, all blanked (${blanked} bytes)</td></tr>` +
    `<tr><td>File</td><td><code>${esc(id)}.json</code></td></tr></table>`;
  $("summary").innerHTML = html;
  const a = $("download");
  if (a.href) {
    URL.revokeObjectURL(a.href);
    a.removeAttribute("href");
  }
  made = matches ? profile : null;
  if (matches) {
    a.href = URL.createObjectURL(
      new Blob([Builder.profileSource(profile)], { type: "application/json" }),
    );
    a.download = id + ".json";
  }
  $("download").hidden = $("useIt").hidden = !matches;
  $("mResult").classList.add("show");
  $("mResult").scrollIntoView({ behavior: "smooth", block: "start" });
});

// Try the new profile straight away: load it and the ROM into the Build tab
$("useIt").addEventListener("click", async () => {
  if (!made) return;
  const { profile } = Builder.parseProfile(Builder.profileSource(made)); // exactly what the file holds
  lastProfile = addProfile(profile, made.id + ".json");
  lastRom = { bytes: rom, name: romFile };
  show("tabBuild");
  history.replaceState(null, "", "#");
  await build(lastRom);
});

dropZone($("mDrop"), $("mFile"), makeFiles);
showFiles();
window.Standalone = { buildFiles, makeFiles }; // (lets tests feed in files)
