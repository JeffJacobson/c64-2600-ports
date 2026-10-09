import Bun from "bun"
import type { BuildConfig } from "bun"

await Bun.build({
    entrypoints: ['./index.html'],
    outdir: './build',
    target: "browser",
    compile: true,
    check: true
} as BuildConfig )