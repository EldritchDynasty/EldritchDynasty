import { loadContent } from '@ed/content';
import { measureDensity } from './density-gate.js';

const seeds = [
  901, 902, 903, 904, 905, 913, 914, 916, 918, 919, 920, 921, 924, 927, 928,
  930, 931, 932, 934, 940, 941, 942, 943, 947, 951,
];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const report = (name: string, xs: number[]) => {
  const m = mean(xs);
  const twoSe = 2 * sd(xs) / Math.sqrt(xs.length);
  console.log(`${name}: mean=${m.toFixed(4)} 2se=${twoSe.toFixed(4)} min=${Math.min(...xs).toFixed(4)} max=${Math.max(...xs).toFixed(4)}`);
};

const content = loadContent();
for (const term of [500, 300]) {
  const runs = seeds.map((seed) => measureDensity(content, seed, term));
  console.log(`term ${term}`);
  report('category.run', runs.map((r) => r.shapeRepeat.category.run));
  report('category.age', runs.map((r) => r.shapeRepeat.category.age));
  report('category.runExclPred', runs.map((r) => r.shapeRepeat.category.runWithoutPredetermined));
  report('category.ageExclPred', runs.map((r) => r.shapeRepeat.category.ageWithoutPredetermined));
  report('shapeWindow', runs.map((r) => r.shapeWindow));
  report('predetermined', runs.map((r) => r.predeterminedShare));
}
