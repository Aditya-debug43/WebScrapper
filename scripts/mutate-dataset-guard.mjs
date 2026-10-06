/**
 * MUTATION TESTING — the bundled-dataset guard
 * ============================================
 *
 * `tests/no-runtime-dataset.test.js` asserts that the application cannot
 * reach `src/data`. A guard that has never failed is a guard nobody has
 * tested: it could be walking the wrong tree, resolving no imports, or
 * matching a pattern that never occurs, and it would pass just as quietly as
 * a correct one.
 *
 * So each mutation below reintroduces exactly the mistake the guard exists to
 * catch, and the guard must fail for every one.
 *
 * Two of the cases are the other way round — `mustSurvive` — because a guard
 * that over-fires is its own problem. A comment quoting `demoSet` is the file
 * explaining what it replaced, and a guard that failed on its own
 * documentation would be deleted within a week.
 *
 * The original file is restored whether the guard fires or not, including on
 * a crash, so a failed run never leaves the tree mutated.
 *
 * Run from the repository root:  node scripts/mutate-dataset-guard.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GUARD = "tests/no-runtime-dataset.test.js";

const MUTANTS = [
  {
    name: "a page imports the dataset directly",
    file: "src/pages/Dashboard.jsx",
    apply: (s) => `import { products } from "../data/products";\n${s}`,
  },
  {
    /**
     * The worst available outcome: the screen looks healthy during an
     * outage, with real-looking numbers and nothing saying the backend is
     * down.
     */
    name: "an API service falls back to bundled data",
    file: "src/api/discoveryService.js",
    apply: (s) => `import { getProduct } from "../data/products";\n${s}`,
  },
  {
    /**
     * The indirect route, and the one a text search would miss — the
     * component never names the dataset, it names a util that reaches it.
     * This is how the whole catalogue stayed in the bundle for most of the
     * migration.
     */
    name: "a component reaches the dataset through a util",
    file: "src/components/layout/Masthead.jsx",
    apply: (s) => `import { demoSetIds } from "../../utils/demoSet";\n${s}`,
  },
  {
    name: "the app state seeds a default desk again",
    file: "src/state/AppStateContext.jsx",
    apply: (s) =>
      s.replace(
        "const [tracked, setTracked] = useState([]);",
        'const DEFAULT_TRACKED_PRODUCT_IDS = ["prod_dove_hair_fall"];\n  const [tracked, setTracked] = useState([]);'
      ),
  },
  {
    /**
     * Reaches no dataset module, so every reachability check stays green.
     * Only the named assertion can see a desk hardcoded in the frontend.
     */
    name: "the frontend hardcodes a default desk again",
    file: "src/api/discoveryService.js",
    apply: (s) => `${s}\nexport const DEFAULT_TRACKED_PRODUCT_IDS = ["prod_dove_hair_fall"];\n`,
  },
  {
    name: "a service stops going through the one transport",
    file: "src/api/dataSourcesService.js",
    apply: (s) => s.replace("apiRequest(", "fetchDirect("),
  },
  {
    name: "a comment mentioning demoSet is documentation, not a violation",
    file: "src/api/discoveryService.js",
    apply: (s) => `${s}\n// the stratified demoSet selection moved to the backend\n`,
    mustSurvive: true,
  },
  {
    name: "a util may still import the dataset — it is the parity oracle",
    file: "src/utils/demoSet.js",
    apply: (s) => `${s}\n// oracle, deliberately still reading src/data\n`,
    mustSurvive: true,
  },
];

let correct = 0;
const wrong = [];

for (const mutant of MUTANTS) {
  const path = resolve(ROOT, mutant.file);
  const original = readFileSync(path, "utf8");
  const mutated = mutant.apply(original);

  if (mutated === original) {
    wrong.push(`${mutant.name} — MUTATION DID NOT APPLY; its anchor text has moved`);
    console.log(`  NOT APPLIED  ${mutant.name}`);
    continue;
  }

  writeFileSync(path, mutated);
  let guardFired = false;
  try {
    execSync(`npx vitest run ${GUARD}`, { cwd: ROOT, stdio: "pipe", timeout: 180_000 });
  } catch {
    guardFired = true;
  } finally {
    writeFileSync(path, original);
  }

  const asExpected = mutant.mustSurvive ? !guardFired : guardFired;
  if (asExpected) {
    correct++;
    console.log(`  ${mutant.mustSurvive ? "ignored " : "caught  "}  ${mutant.name}`);
  } else {
    wrong.push(mutant.name + (mutant.mustSurvive ? " — the guard FIRED on documentation" : " — SURVIVED"));
    console.log(`  WRONG       ${mutant.name}`);
  }
}

console.log(`\n${correct}/${MUTANTS.length} mutants behaved correctly`);
if (wrong.length) {
  console.log("\nThe guard does not do what it claims:");
  for (const w of wrong) console.log("  " + w);
  process.exit(1);
}
