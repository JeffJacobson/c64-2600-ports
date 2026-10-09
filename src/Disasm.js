// The tracing 6502 disassembler's core (tools/disasm.js is its command line): an Atari 2600
// ROM and the game's symbols.js -> 64tass source that reassembles to the identical binary, and
// the RAM map. Plain JavaScript, so the builder page can run it too: it makes the disassembly
// from the player's own ROM for a game's source bundle (the site holds no original code).
//   Disasm.disassemble(rom (Uint8Array), symbols) -> { asm, ramMap, lines, labels }

  const w16 = (d, o) => d[o] | d[o + 1] << 8;
  function disassemble(rom, symbols) {
    const { game } = symbols;
    const BANKS = game.banks || [0xF000];
    if (rom.length !== 4096 * BANKS.length) throw new Error(`expected a ${4 * BANKS.length}K ROM`);

    const T = `00BRK.imp 01ORA.izx 05ORA.zp 06ASL.zp 08PHP.imp 09ORA.imm 0aASL.acc 0dORA.abs 0eASL.abs 10BPL.rel 11ORA.izy 15ORA.zpx 16ASL.zpx 18CLC.imp 19ORA.aby 1dORA.abx 1eASL.abx
    20JSR.abs 21AND.izx 24BIT.zp 25AND.zp 26ROL.zp 28PLP.imp 29AND.imm 2aROL.acc 2cBIT.abs 2dAND.abs 2eROL.abs 30BMI.rel 31AND.izy 35AND.zpx 36ROL.zpx 38SEC.imp 39AND.aby 3dAND.abx 3eROL.abx
    40RTI.imp 41EOR.izx 45EOR.zp 46LSR.zp 48PHA.imp 49EOR.imm 4aLSR.acc 4cJMP.abs 4dEOR.abs 4eLSR.abs 50BVC.rel 51EOR.izy 55EOR.zpx 56LSR.zpx 58CLI.imp 59EOR.aby 5dEOR.abx 5eLSR.abx
    60RTS.imp 61ADC.izx 65ADC.zp 66ROR.zp 68PLA.imp 69ADC.imm 6aROR.acc 6cJMP.ind 6dADC.abs 6eROR.abs 70BVS.rel 71ADC.izy 75ADC.zpx 76ROR.zpx 78SEI.imp 79ADC.aby 7dADC.abx 7eROR.abx
    81STA.izx 84STY.zp 85STA.zp 86STX.zp 88DEY.imp 8aTXA.imp 8cSTY.abs 8dSTA.abs 8eSTX.abs 90BCC.rel 91STA.izy 94STY.zpx 95STA.zpx 96STX.zpy 98TYA.imp 99STA.aby 9aTXS.imp 9dSTA.abx
    a0LDY.imm a1LDA.izx a2LDX.imm a4LDY.zp a5LDA.zp a6LDX.zp a8TAY.imp a9LDA.imm aaTAX.imp acLDY.abs adLDA.abs aeLDX.abs b0BCS.rel b1LDA.izy b4LDY.zpx b5LDA.zpx b6LDX.zpy b8CLV.imp b9LDA.aby baTSX.imp bcLDY.abx bdLDA.abx beLDX.aby
    c0CPY.imm c1CMP.izx c4CPY.zp c5CMP.zp c6DEC.zp c8INY.imp c9CMP.imm caDEX.imp ccCPY.abs cdCMP.abs ceDEC.abs d0BNE.rel d1CMP.izy d5CMP.zpx d6DEC.zpx d8CLD.imp d9CMP.aby ddCMP.abx deDEC.abx
    e0CPX.imm e1SBC.izx e4CPX.zp e5SBC.zp e6INC.zp e8INX.imp e9SBC.imm eaNOP.imp ecCPX.abs edSBC.abs eeINC.abs f0BEQ.rel f1SBC.izy f5SBC.zpx f6INC.zpx f8SED.imp f9SBC.aby fdSBC.abx feINC.abx`;
    const OPS = {};
    for (const t of T.split(/\s+/)) OPS[parseInt(t.slice(0, 2), 16)] = { mn: t.slice(2, 5).toLowerCase(), mode: t.slice(6) };
    const LEN = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, izx: 2, izy: 2, rel: 2, abs: 3, abx: 3, aby: 3, ind: 3 };
    const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');

    // TIA and RIOT registers. Reads and writes share addresses but mean different things.
    const TIA_W = ['VSYNC', 'VBLANK', 'WSYNC', 'RSYNC', 'NUSIZ0', 'NUSIZ1', 'COLUP0', 'COLUP1', 'COLUPF', 'COLUBK', 'CTRLPF',
      'REFP0', 'REFP1', 'PF0', 'PF1', 'PF2', 'RESP0', 'RESP1', 'RESM0', 'RESM1', 'RESBL', 'AUDC0', 'AUDC1', 'AUDF0', 'AUDF1',
      'AUDV0', 'AUDV1', 'GRP0', 'GRP1', 'ENAM0', 'ENAM1', 'ENABL', 'HMP0', 'HMP1', 'HMM0', 'HMM1', 'HMBL', 'VDELP0', 'VDELP1',
      'VDELBL', 'RESMP0', 'RESMP1', 'HMOVE', 'HMCLR', 'CXCLR'];
    const TIA_R = ['CXM0P', 'CXM1P', 'CXP0FB', 'CXP1FB', 'CXM0FB', 'CXM1FB', 'CXBLPF', 'CXPPMM', 'INPT0', 'INPT1', 'INPT2',
      'INPT3', 'INPT4', 'INPT5'];
    const RIOT = { 0x280: 'SWCHA', 0x281: 'SWACNT', 0x282: 'SWCHB', 0x283: 'SWBCNT', 0x284: 'INTIM', 0x285: 'TIMINT',
      0x294: 'TIM1T', 0x295: 'TIM8T', 0x296: 'TIM64T', 0x297: 'T1024T' };
    const WRITES = new Set(['sta', 'stx', 'sty', 'inc', 'dec', 'asl', 'lsr', 'rol', 'ror']);

    // One bank: its bytes, the address it runs at, and what the tracer found in it
    const banks = BANKS.map((org, i) => ({ org, d: rom.subarray(4096 * i, 4096 * i + 4096), isCode: new Uint8Array(4096) }));
    const bankOf = a => banks.find(b => a >= b.org && a < b.org + 4096);
    const hotspot = a => banks.length > 1 && (a & 0x1FFF) >= 0x1FF8 && (a & 0x1FFF) < 0x1FF8 + banks.length;
    const BANKSEL = banks.length > 1 ? 0xF000 | 0xFF8 : 0;   // named SelectBank0.. when used as $FFF8..

    // ---- Pass 1: trace code from each bank's reset vector ----
    const targets = new Set();             // code addresses reached by branch/jump/call
    const always = new Set(symbols.always || []);   // branches that are always taken (no fall-through)
    const queue = [];
    for (const b of banks) {
      const { d } = b;
      queue.push(w16(d, 0xFFC));
      for (const v of [0xFFA, 0xFFC, 0xFFE]) if (bankOf(w16(d, v)) === b) targets.add(w16(d, v));
      for (const a of symbols.code || []) if (bankOf(a) === b) { targets.add(a); queue.push(a); }   // reached only through jump tables
    }
    {
      while (queue.length) {
        let pc = queue.pop();
        const b = bankOf(pc);
        if (!b) continue;
        const { d, org, isCode } = b;
        for (;;) {
          const o = pc - org;
          if (o < 0 || o >= 4096 || isCode[o]) break;
          const op = OPS[d[o]];
          if (!op) throw new Error(`unknown opcode $${hex(d[o], 2)} at $${hex(pc, 4)}`);
          const n = LEN[op.mode];
          isCode[o] = 1;
          for (let i = 1; i < n; i++) isCode[o + i] = 2;
          const arg = n === 3 ? w16(d, o + 1) : d[o + 1];
          if (op.mode === 'rel') { const t = (pc + 2 + ((arg << 24) >> 24)) & 0xFFFF; targets.add(t); queue.push(t); }
          if (op.mn === 'jsr' || (op.mn === 'jmp' && op.mode === 'abs')) { targets.add(arg); queue.push(arg); }
          if (game.crossBank && ['abs', 'abx', 'aby'].includes(op.mode) && op.mn !== 'jsr' && op.mn !== 'jmp' && hotspot(arg)) {
            const to = banks[(arg & 0x1FFF) - 0x1FF8];
            if (to !== b) { const t = to.org + o + n; targets.add(t); queue.push(t); break; }
          }
          if ((op.mn === 'jmp') || op.mn === 'rts' || op.mn === 'rti' || op.mn === 'brk' || always.has(pc)) break;
          pc += n;
        }
      }
    }

    // ---- Pass 2: collect data references so tables get labels ----
    const dataRefs = new Set();
    for (const b of banks) for (let o = 0; o < 4096; o++) {
      if (b.isCode[o] !== 1) continue;
      const op = OPS[b.d[o]];
      if (['abs', 'abx', 'aby'].includes(op.mode) && op.mn !== 'jsr' && op.mn !== 'jmp') {
        const a = w16(b.d, o + 1);
        // (not inside an instruction or the vectors: no label can go there, so those stay label+offset)
        if (a >= 0x1000 && bankOf(a) === b && !hotspot(a) && b.isCode[a - b.org] !== 2 && a - b.org < 0xFFA) dataRefs.add(a);
      }
    }

    const resets = new Set(banks.map(b => w16(b.d, 0xFFC)));
    const resetName = a => banks.length === 1 ? 'Reset' : 'Reset' + banks.findIndex(b => w16(b.d, 0xFFC) === a);
    const label = new Map();
    for (const t of targets) if (bankOf(t)) label.set(t, resets.has(t) ? resetName(t) : 'L' + hex(t, 4));
    for (const t of dataRefs) if (!label.has(t)) label.set(t, 'T' + hex(t, 4));
    for (const [a, [name]] of Object.entries(symbols.labels)) label.set(+a, name);

    // RAM symbol lookup: exact name, or Name+offset inside an array
    const ramName = new Map();
    for (const [addr, name, size] of symbols.ram)
      for (let i = 0; i < size; i++) ramName.set(addr + i, i ? `${name}+${i}` : name);

    // Express a ROM address symbolically. If it lands mid-instruction, use the
    // nearest preceding label plus an offset. (Only within the bank the code runs in:
    // another address reaches this bank's own bytes on the 2600, so it stays a number.)
    let cur = banks[0];
    function sym(a) {
      if (bankOf(a) !== cur) return '$' + hex(a, 4);
      if (label.has(a)) return label.get(a);
      for (let b = a - 1; b >= Math.max(cur.org, a - 8); b--) if (label.has(b)) return `${label.get(b)}+${a - b}`;
      return '$' + hex(a, 4);
    }

    function operand(mn, mode, arg, pc) {
      if (mode === 'rel') return sym((pc + 2 + ((arg << 24) >> 24)) & 0xFFFF);
      if (mode === 'imm') return '#$' + hex(arg, 2);
      let name;
      if (arg < 0x80) {
        // The TIA decodes only the low address bits, so games often use mirrors
        // (reads at $30-$3F are $00-$0F): name the register, plus the mirror's offset.
        const base = WRITES.has(mn) ? arg & 0x3F : arg & 0x0F;
        const reg = (WRITES.has(mn) ? TIA_W : TIA_R)[base];
        name = !reg ? '$' + hex(arg, 2) : arg === base ? reg : `${reg}+$${hex(arg - base, 2)}`;
        if (mode === 'zpx' && arg === 0) name = '$00';   // indexed sweep over all of page zero
      } else if (arg < 0x100) name = ramName.get(arg) || '$' + hex(arg, 2);
      else if (RIOT[arg]) name = RIOT[arg];
      else if (hotspot(arg) && (arg & 0xF000) === 0xF000) name = 'SelectBank' + (arg - BANKSEL);
      else if (arg >= 0x1000) name = sym(arg);
      else name = '$' + hex(arg, 4);
      // Original used absolute addressing on a zero-page address (a timing trick): force it.
      const force = ['abs', 'abx', 'aby'].includes(mode) && arg < 0x100 ? '@w ' : '';
      switch (mode) {
        case 'zpx': case 'abx': return `${force}${name},x`;
        case 'zpy': case 'aby': return `${force}${name},y`;
        case 'izx': return `(${name},x)`;
        case 'izy': return `(${name}),y`;
        case 'ind': return `(${name})`;
        default: return force + name;
      }
    }

    // ---- Emit ----
    const L = [];
    const tassOut = `build/${game.asm.replace(/\.asm$/, '.a26')}`;
    L.push(
      `; ${game.title} (${game.from}) - disassembly`,
      '; Generated by tools/disasm.js from symbols.js. Assembles with 64tass to the original ROM',
      `; (MD5 ${game.md5}).`,
      ...(banks.length > 1 ? [`; ${banks.length * 4}K, ${banks.length} banks of 4K: ${banks.map((b, i) => `bank ${i} runs at $${hex(b.org, 4)}`).join(', ')}.`,
        '; Accessing $1FF8 selects bank 0 and $1FF9 bank 1 (F8 bank switching).'] : []),
      ';',
      `;   64tass --nostart -o ${tassOut} 2600/${game.asm}`,
      '',
      '; ---- TIA write registers ----');
    TIA_W.forEach((n, i) => L.push(`${n.padEnd(8)}= $${hex(i, 2)}`));
    L.push('', '; ---- TIA read registers ----');
    TIA_R.forEach((n, i) => L.push(`${n.padEnd(8)}= $${hex(i, 2)}`));
    L.push('', '; ---- RIOT (6532) I/O and timer ----');
    for (const [a, n] of Object.entries(RIOT)) L.push(`${n.padEnd(8)}= $${hex(+a, 4)}`);
    L.push('', '; ---- RAM ($80-$FF), see RAM-MAP.md ----');
    for (const [addr, name, size, desc] of symbols.ram)
      L.push(`${name.padEnd(13)}= $${hex(addr, 2)}${' '.repeat(10)}; ${size > 1 ? `${size} bytes. ` : ''}${desc}`);
    if (banks.length > 1) {
      L.push('', '; ---- bank switching: touching one of these selects that bank ----');
      banks.forEach((b, i) => L.push(`SelectBank${i} = $${hex(BANKSEL + i, 4)}`));
    }
    L.push('', '        .cpu "6502"');

    banks.forEach((b, bi) => {
      cur = b;
      const { d, org, isCode } = b;
      if (banks.length === 1) L.push(`        * = $${hex(org, 4)}`, '');
      else L.push('', `; ======== bank ${bi} ($${hex(org, 4)}) ========`, `        * = $${hex(4096 * bi, 4)}`, `        .logical $${hex(org, 4)}`, '');
      const vecStart = 0xFFA;
      // (code may run on into the vectors: Megamania's last routine ends with its rts as the
      // NMI vector's high byte; the vectors it covers are then that code)
      let o = 0;
      for (; o < vecStart || (o < 4096 && isCode[o] === 1);) {
        const pc = org + o;
        const info = symbols.labels[pc];
        if (info) L.push('', `; ${info[1]}`);
        if (label.has(pc)) L.push(`${label.get(pc)}:`);
        if (isCode[o] === 1) {
          const op = OPS[d[o]], n = LEN[op.mode];
          const arg = n === 3 ? w16(d, o + 1) : d[o + 1];
          const bytes = [...d.subarray(o, o + n)].map(x => hex(x, 2)).join(' ');
          const ins = n === 1 ? op.mn : `${op.mn} ${operand(op.mn, op.mode, arg, pc)}`;
          L.push(`        ${ins.padEnd(28)}; ${hex(pc, 4)}: ${bytes}`);
          o += n;
        } else {
          // Data run: stop at the next label so tables start on their own line
          let e = o + 1;
          while (e < vecStart && !isCode[e] && !label.has(org + e) && e - o < 8) e++;
          L.push(`        .byte ${[...d.subarray(o, e)].map(x => '$' + hex(x, 2)).join(', ').padEnd(54)}; ${hex(pc, 4)}`);
          o = e;
        }
      }
      L.push('', '        ; 6502 vectors' + (o > vecStart ? ` (the NMI vector, $${hex(w16(d, 0xFFA), 4)}, is the code above)` : ''));
      [[0xFFA, 'NMI'], [0xFFC, 'RESET'], [0xFFE, 'IRQ/BRK']].forEach(([v, n]) => {
        if (v >= o) L.push(`        .word ${sym(w16(d, v))}${' '.repeat(16)}; ${n}`);
      });
      if (banks.length > 1) L.push('        .here');
      L.push('');
    });
    const asm = L.join('\n');
    let ramMap;
    {
      const M = [`# ${game.title} (2600) RAM map`, '',
        'The 2600 has 128 bytes of RAM at `$80-$FF`. This is what the game keeps in each byte, worked out by reading',
        'the code and watching memory in `tools/vcs.js`. A `?` marks something not fully confirmed yet.', '',
        'Generated from `symbols.js` by `tools/disasm.js`; edit that file, not this one.', '',
        '| Address | Name | Bytes | What it holds |', '|---|---|---|---|'];
      for (const [addr, name, size, desc] of symbols.ram) {
        const range = size > 1 ? `$${hex(addr, 2)}-$${hex(addr + size - 1, 2)}` : `$${hex(addr, 2)}`;
        M.push(`| \`${range}\` | ${name} | ${size} | ${desc.replace(/\|/g, '\\|')} |`);
      }
      if (symbols.xram) {                  // cartridge RAM (SuperChip), named by the address it's read at
        M.push('', '## Cartridge RAM (SuperChip)', '', 'Written at `$F000-$F07F`, read at `$F080-$F0FF`.', '',
          '| Address | Name | Bytes | What it holds |', '|---|---|---|---|');
        for (const [addr, name, size, desc] of symbols.xram) {
          const range = size > 1 ? `$${hex(addr, 4)}-$${hex(addr + size - 1, 4)}` : `$${hex(addr, 4)}`;
          M.push(`| \`${range}\` | ${name} | ${size} | ${desc.replace(/\|/g, '\\|')} |`);
        }
      }
      M.push('', '## Routines', '', '| Address | Name | What it does |', '|---|---|---|');
      for (const [a, [name, desc]] of Object.entries(symbols.labels).sort((x, y) => x[0] - y[0]))
        M.push(`| \`$${hex(+a, 4)}\` | ${name} | ${desc} |`);
      ramMap = M.join('\n') + '\n';
    }
    return { asm, ramMap, lines: L.length, labels: label.size };
  }
  export { disassemble };