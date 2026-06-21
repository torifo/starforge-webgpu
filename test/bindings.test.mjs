// Cross-check that each WGSL shader's @group(0)/@binding(n) declarations match the
// bind-group-layout binding indices declared in gpu.js. This is a structural
// contract test: it parses both sources textually (no GPU) and compares the SET
// of binding indices per pipeline, plus a coarse resource-kind check.
//
// Run: node test/bindings.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

let pass = 0;
let fail = 0;
const log = (ok, msg) => {
  if (ok) {
    pass++;
    console.log(`  ok   ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL ${msg}`);
  }
};

// Parse @group(G) @binding(B) ... <decl> from a WGSL string.
// Returns array of { group, binding, kind } where kind is a coarse category.
function parseWgslBindings(src) {
  const out = [];
  const re =
    /@group\((\d+)\)\s*@binding\((\d+)\)\s*var(?:<([^>]+)>)?\s+\w+\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(src))) {
    const group = +m[1];
    const binding = +m[2];
    const addr = (m[3] || "").trim(); // e.g. "uniform" | "storage, read" | ""
    const ty = m[4].trim();
    let kind;
    if (addr.startsWith("uniform")) kind = "uniform";
    else if (addr.startsWith("storage")) {
      kind = addr.includes("read_write") ? "storage" : "read-only-storage";
    } else if (ty.startsWith("texture_2d")) kind = "texture";
    else if (ty.startsWith("sampler")) kind = "sampler";
    else kind = "other:" + ty;
    out.push({ group, binding, kind });
  }
  return out.filter((b) => b.group === 0).sort((a, b) => a.binding - b.binding);
}

// Extract the entries of a named bindGroupLayout from gpu.js text.
// Returns array of { binding, kind } sorted by binding.
function parseJsBGL(src, label) {
  // find `label: "<label>"` then the entries: [ ... ] up to the closing of that array
  const idx = src.indexOf(`label: "${label}"`);
  if (idx < 0) throw new Error(`BGL "${label}" not found in gpu.js`);
  const entriesIdx = src.indexOf("entries:", idx);
  // find matching closing bracket of the entries array
  const start = src.indexOf("[", entriesIdx);
  let depth = 0;
  let end = start;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const block = src.slice(start, end + 1);
  const out = [];
  const re = /\{\s*binding:\s*(\d+),[\s\S]*?\}/g;
  let m;
  while ((m = re.exec(block))) {
    const entry = m[0];
    const binding = +m[1];
    let kind;
    if (/buffer:\s*\{\s*type:\s*"uniform"/.test(entry)) kind = "uniform";
    else if (/buffer:\s*\{\s*type:\s*"read-only-storage"/.test(entry))
      kind = "read-only-storage";
    else if (/buffer:\s*\{\s*type:\s*"storage"/.test(entry)) kind = "storage";
    else if (/texture:/.test(entry)) kind = "texture";
    else if (/sampler:/.test(entry)) kind = "sampler";
    else kind = "unknown";
    out.push({ binding, kind });
  }
  return out.sort((a, b) => a.binding - b.binding);
}

const gpuSrc = read("src/gpu.js");

// Map: WGSL file -> { bgl label in gpu.js, restrict to bindings used by an entry }
// For multi-entry shaders we compare against the union of @group(0) bindings,
// which is exactly what the shared BGL must cover.
const cases = [
  { wgsl: "src/shaders/nbody.wgsl", bgl: "compute-bgl" },
  { wgsl: "src/shaders/render.wgsl", bgl: "render-bgl" },
  { wgsl: "src/shaders/nebula.wgsl", bgl: "nebula-bgl" },
  { wgsl: "src/shaders/bloom.wgsl", bgl: "bloom-bgl" },
  { wgsl: "src/shaders/composite.wgsl", bgl: "trail-bgl" },
  { wgsl: "src/shaders/final.wgsl", bgl: "final-bgl" },
];

console.log("binding contract (WGSL @group/@binding <-> gpu.js BGL)\n");

// storage in WGSL nbody is read_write -> JS uses "storage"; read-only -> "read-only-storage".
// Render shader uses storage,read -> JS "read-only-storage". These match our coarse kinds.
for (const c of cases) {
  console.log(`[${c.bgl}]  <-  ${c.wgsl}`);
  const w = parseWgslBindings(read(c.wgsl));
  const j = parseJsBGL(gpuSrc, c.bgl);

  const wB = w.map((x) => x.binding).join(",");
  const jB = j.map((x) => x.binding).join(",");
  log(wB === jB, `binding indices match  wgsl=[${wB}] js=[${jB}]`);

  // kind check per binding
  for (const wb of w) {
    const jb = j.find((x) => x.binding === wb.binding);
    if (!jb) {
      log(false, `binding ${wb.binding}: present in WGSL but missing in BGL`);
      continue;
    }
    log(jb.kind === wb.kind, `binding ${wb.binding}: ${wb.kind} (wgsl) == ${jb.kind} (js)`);
  }
  // extra JS bindings not in WGSL?
  for (const jb of j) {
    if (!w.find((x) => x.binding === jb.binding)) {
      log(false, `binding ${jb.binding}: in BGL but not declared in WGSL`);
    }
  }
  console.log("");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
