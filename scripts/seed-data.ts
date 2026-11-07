// Writes public/data/events.json, eras.json and their JSON Schemas from the curated list below.
// Times derived from the background cosmology (equality, recombination, acceleration…) are computed,
// not typed. Late events are dated by lookback and converted with the computed AGE_SECONDS.
// Run: node scripts/seed-data.ts

import { writeFileSync } from 'node:fs';
import { z } from 'astro/zod';
import { OMEGA_L, OMEGA_M, OMEGA_R, T_PLANCK_S, YEAR_S } from '../src/physics/constants.ts';
import { AGE_SECONDS, tAt, tAtRedshift } from '../src/physics/cosmology.ts';
import { eraSchema, eventSchema, erasSchema, eventsSchema, type CosmicEvent, type Era } from '../src/data/schema.ts';

const MYR = 1e6;
const GYR = 1e9;
const yr = (y: number) => y * YEAR_S;

type Src = { label: string; url: string };
const S = {
  planck2018: { label: 'Planck 2018 results VI: cosmological parameters', url: 'https://arxiv.org/abs/1807.06209' },
  planckInfl: { label: 'Planck 2018 results X: constraints on inflation', url: 'https://arxiv.org/abs/1807.06211' },
  planckUnits: { label: 'Planck units (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Planck_units' },
  gut: { label: 'Grand unification epoch (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Grand_unification_epoch' },
  guth: { label: 'Guth 1981, Inflationary universe', url: 'https://doi.org/10.1103/PhysRevD.23.347' },
  reheating: { label: 'Reheating (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Reheating' },
  baryogenesis: { label: 'Baryogenesis (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Baryogenesis' },
  sakharov: { label: 'Canetti, Drewes & Shaposhnikov 2012, Matter and antimatter in the universe', url: 'https://arxiv.org/abs/1204.4186' },
  atlasHiggs: { label: 'ATLAS 2012, Higgs boson observation', url: 'https://arxiv.org/abs/1207.7214' },
  cmsHiggs: { label: 'CMS 2012, Higgs boson observation', url: 'https://arxiv.org/abs/1207.7235' },
  ewCrossover: { label: "D'Onofrio & Rummukainen 2016, Standard Model cross-over on the lattice", url: 'https://arxiv.org/abs/1508.07161' },
  wimp: { label: 'Weakly interacting massive particle (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Weakly_interacting_massive_particle' },
  hotqcd: { label: 'HotQCD 2019, Chiral crossover in QCD', url: 'https://arxiv.org/abs/1812.08235' },
  hadronEpoch: { label: 'Hadron epoch (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Hadron_epoch' },
  cnb: { label: 'Cosmic neutrino background (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Cosmic_neutrino_background' },
  leptonEpoch: { label: 'Lepton epoch (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Lepton_epoch' },
  bbn: { label: 'Fields, Olive, Yeh & Young 2020, BBN after Planck', url: 'https://arxiv.org/abs/1912.01132' },
  recombination: { label: 'Recombination (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Recombination_(cosmology)' },
  darkAges: { label: 'Chronology of the universe: Dark Ages (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Chronology_of_the_universe#Dark_Ages_and_large-scale_structure_emergence' },
  popIII: { label: 'Bromm 2013, Formation of the first stars', url: 'https://arxiv.org/abs/1305.5178' },
  firstSN: { label: 'Population III star (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Population_III_star' },
  jades14: { label: 'Carniani et al. 2024, JADES-GS-z14-0', url: 'https://arxiv.org/abs/2405.18485' },
  uhz1: { label: 'Bogdán et al. 2023, an X-ray quasar at z ≈ 10 (UHZ1)', url: 'https://arxiv.org/abs/2305.15458' },
  quasar76: { label: 'Wang et al. 2021, a luminous quasar at z = 7.64', url: 'https://arxiv.org/abs/2101.03179' },
  kilonova: { label: 'Kasen et al. 2017, r-process in the GW170817 kilonova', url: 'https://arxiv.org/abs/1710.05463' },
  milkyWay: { label: 'Xiang & Rix 2022, a time-resolved picture of our Milky Way', url: 'https://arxiv.org/abs/2203.12110' },
  reion: { label: 'Bosman et al. 2022, end of reionization from quasar spectra', url: 'https://arxiv.org/abs/2108.03699' },
  madau: { label: 'Madau & Dickinson 2014, cosmic star-formation history', url: 'https://arxiv.org/abs/1403.0007' },
  riess: { label: 'Riess et al. 1998, accelerating universe from supernovae', url: 'https://arxiv.org/abs/astro-ph/9805201' },
  perlmutter: { label: 'Perlmutter et al. 1999, Ω and Λ from 42 supernovae', url: 'https://arxiv.org/abs/astro-ph/9812133' },
  ssAge: { label: 'Connelly et al. 2012, absolute chronology of the solar protoplanetary disk', url: 'https://doi.org/10.1126/science.1226919' },
  earthAge: { label: 'Age of Earth (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Age_of_Earth' },
  moon: { label: 'Giant-impact hypothesis (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Giant-impact_hypothesis' },
  zircon: { label: 'Wilde et al. 2001, evidence for oceans 4.4 Gyr ago', url: 'https://doi.org/10.1038/35051550' },
  earliestLife: { label: 'Earliest known life forms (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Earliest_known_life_forms' },
  goe: { label: 'Great Oxidation Event (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Great_Oxidation_Event' },
  eukaryotes: { label: 'Eukaryote: origin (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Eukaryote#Origin_of_eukaryotes' },
  cambrian: { label: 'Cambrian explosion (Wikipedia)', url: 'https://en.wikipedia.org/wiki/Cambrian_explosion' },
  kpg: { label: 'Renne et al. 2013, time scales around the K–Pg boundary', url: 'https://doi.org/10.1126/science.1230492' },
  sapiens: { label: 'Hublin et al. 2017, Jebel Irhoud Homo sapiens', url: 'https://doi.org/10.1038/nature22336' },
} satisfies Record<string, Src>;

type Since = { best: number; min: number; max: number };
type SeedEvent = Omit<CosmicEvent, 't_seconds' | 'lookback_years'> &
  ({ since: Since } | { agoYears: Since });

const tEq = tAt(OMEGA_R / OMEGA_M);
const aAcc = Math.cbrt(OMEGA_M / (2 * OMEGA_L));
const aLam = Math.cbrt(OMEGA_M / OMEGA_L);

const seed: SeedEvent[] = [
  { id: 'planck-time', name: 'Planck time', category: 'Spacetime & forces', since: { best: T_PLANCK_S, min: T_PLANCK_S, max: T_PLANCK_S }, label: '5.4×10⁻⁴⁴ s', certainty: 'Theoretical limit', summary: 'Earliest moment current physics can describe. Gravity is thought to split from a single unified force; spacetime behaves classically from here on.', sources: [S.planckUnits] },
  { id: 'strong-force-separates', name: 'Strong force separates', category: 'Spacetime & forces', since: { best: 1e-36, min: 1e-39, max: 1e-34 }, label: '~10⁻³⁶ s', certainty: 'Theoretical', summary: 'End of grand unification: the strong nuclear force splits from the electroweak force.', range_note: 'Depends on the unknown grand-unification energy scale; widened.', sources: [S.gut] },
  { id: 'cosmic-inflation', name: 'Cosmic inflation', category: 'Dark sector & expansion', since: { best: 1e-35, min: 1e-36, max: 1e-32 }, label: '~10⁻³⁶–10⁻³² s', certainty: 'Strong indirect evidence', summary: 'Space expands by at least a factor of 10²⁶. Quantum fluctuations are stretched into the density ripples that later seed galaxies.', range_note: 'Energy scale of inflation is only bounded from above; timing is model-dependent.', sources: [S.guth, S.planckInfl] },
  { id: 'reheating', name: 'Reheating fills space with particles', category: 'Particles', since: { best: 1e-32, min: 1e-36, max: 1e-30 }, label: '~10⁻³² s', certainty: 'Theoretical', summary: "Inflation ends; the inflaton field's energy converts into a hot soup of particles and radiation.", range_note: 'Reheating temperature is unknown over many orders of magnitude; widened.', sources: [S.reheating] },
  { id: 'baryogenesis', name: 'Matter beats antimatter', category: 'Particles', since: { best: 5e-13, min: 1e-32, max: 1e-11 }, label: 'by ~10⁻¹² s', certainty: 'Unknown mechanism', summary: 'Baryogenesis leaves a tiny excess of matter — about one extra particle per billion pairs. Why is still unsolved.', range_note: 'Mechanism unknown; could occur any time between reheating and the electroweak transition.', sources: [S.baryogenesis, S.sakharov] },
  { id: 'higgs', name: 'Higgs field switches on', category: 'Spacetime & forces', since: { best: 1e-12, min: 5e-13, max: 2e-11 }, label: '~10⁻¹² s', certainty: 'Well supported (LHC)', summary: 'Electroweak symmetry breaking: electromagnetism and the weak force separate; quarks, electrons and W/Z bosons gain mass.', sources: [S.atlasHiggs, S.cmsHiggs, S.ewCrossover] },
  { id: 'dark-matter-freeze-out', name: 'Dark matter freezes out', category: 'Dark sector & expansion', since: { best: 4e-8, min: 1e-10, max: 1e-6 }, label: '~10⁻⁸ s (if WIMP)', certainty: 'Model-dependent', summary: 'If dark matter is a heavy particle, its abundance locks in here. Its identity is still unknown.', range_note: 'Only meaningful for thermal-relic dark matter; the mass is unknown.', sources: [S.wimp] },
  { id: 'confinement', name: 'Quarks bind into protons and neutrons', category: 'Particles', since: { best: 1e-6, min: 1e-6, max: 3e-5 }, label: '~1 µs', certainty: 'Well supported', summary: 'Quark–gluon plasma cools enough for quarks to be confined inside hadrons.', sources: [S.hotqcd, S.hadronEpoch] },
  { id: 'hadron-annihilation', name: 'Protons and antiprotons annihilate', category: 'Particles', since: { best: 1e-3, min: 1e-4, max: 1e-2 }, label: '~1 ms', certainty: 'Well supported', summary: 'Nearly all hadrons annihilate with their antimatter partners, leaving the small matter excess behind.', sources: [S.hadronEpoch] },
  { id: 'neutrino-decoupling', name: 'Neutrinos decouple', category: 'Particles', since: { best: 1, min: 0.1, max: 2 }, label: '~1 s', certainty: 'Well supported', summary: 'Neutrinos stop interacting and stream freely — the cosmic neutrino background.', sources: [S.cnb] },
  { id: 'ee-annihilation', name: 'Electrons and positrons annihilate', category: 'Particles', since: { best: 10, min: 1, max: 200 }, label: '~10 s', certainty: 'Well supported', summary: 'Most electrons annihilate with positrons, heating the photons; the leftover electrons are all we have today.', sources: [S.leptonEpoch] },
  { id: 'bbn', name: 'First nuclei: H, He, Li', category: 'Elements', since: { best: 180, min: 180, max: 1200 }, label: '3–20 min', certainty: 'Precisely measured', summary: 'Big Bang nucleosynthesis: about 75% hydrogen, 25% helium by mass, a trace of lithium. Every other element comes later.', sources: [S.bbn] },
  { id: 'matter-domination', name: 'Matter starts to dominate', category: 'Dark sector & expansion', since: { best: tEq, min: tEq * 0.95, max: tEq * 1.05 }, label: '~50,000 yr', certainty: 'Precisely measured', summary: 'Matter (mostly dark matter) outweighs radiation; dark-matter clumps begin to grow, building the scaffolding for galaxies.', sources: [S.planck2018] },
  { id: 'recombination', name: 'Atoms form; CMB released', category: 'Particles', since: { best: tAtRedshift(1090), min: tAtRedshift(1100), max: tAtRedshift(1080) }, label: '~380,000 yr', certainty: 'Precisely measured', summary: 'Recombination: electrons join nuclei, the universe turns transparent, and the light we now see as the cosmic microwave background escapes.', sources: [S.planck2018, S.recombination] },
  { id: 'dark-ages', name: 'Dark ages begin', category: 'Structure', since: { best: tAtRedshift(1089), min: tAtRedshift(1089), max: tAtRedshift(1000) }, label: '~380,000 yr', certainty: 'Well supported', summary: 'No stars yet — only cooling neutral gas and growing dark-matter halos.', sources: [S.darkAges] },
  { id: 'first-stars', name: 'First stars ignite', category: 'Structure', since: { best: yr(150 * MYR), min: yr(100 * MYR), max: yr(250 * MYR) }, label: '~100–200 Myr', certainty: 'Indirect evidence', summary: 'Massive Population III stars form in the first gas clouds — the first stellar nebulae.', sources: [S.popIII] },
  { id: 'first-heavy-elements', name: 'First heavy elements forged', category: 'Elements', since: { best: yr(200 * MYR), min: yr(150 * MYR), max: yr(400 * MYR) }, label: '~200 Myr', certainty: 'Indirect evidence', summary: 'First stars fuse carbon, oxygen and iron, then explode as supernovae, seeding space with heavier elements.', sources: [S.firstSN] },
  { id: 'earliest-galaxies', name: 'Earliest galaxies seen', category: 'Structure', since: { best: tAtRedshift(14.32), min: tAtRedshift(14.5), max: tAtRedshift(13.0) }, label: '~290 Myr', certainty: 'Observed (JWST)', summary: 'The most distant confirmed galaxies, observed by the James Webb Space Telescope.', sources: [S.jades14] },
  { id: 'first-smbh', name: 'First supermassive black holes', category: 'Structure', since: { best: tAtRedshift(10.07), min: yr(400 * MYR), max: tAtRedshift(7.0) }, label: '~400–700 Myr', certainty: 'Observed', summary: "Black holes millions of times the Sun's mass already power quasars and active galaxies.", sources: [S.uhz1, S.quasar76] },
  { id: 'r-process', name: 'Gold and uranium from neutron-star mergers', category: 'Elements', since: { best: yr(500 * MYR), min: yr(300 * MYR), max: yr(1 * GYR) }, label: '~0.5 Gyr onward', certainty: 'Model-dependent', summary: 'Rapid neutron capture in mergers and rare supernovae makes the heaviest elements.', sources: [S.kilonova] },
  { id: 'milky-way', name: 'Milky Way begins assembling', category: 'Structure', since: { best: yr(600 * MYR), min: yr(400 * MYR), max: yr(1.5 * GYR) }, label: '~0.6 Gyr', certainty: 'Estimated', summary: "Our galaxy's oldest stars date from here; it grows by swallowing smaller galaxies.", sources: [S.milkyWay] },
  { id: 'reionization-complete', name: 'Reionization complete', category: 'Structure', since: { best: tAtRedshift(5.8), min: tAtRedshift(6.5), max: tAtRedshift(5.3) }, label: '~1 Gyr', certainty: 'Observed', summary: 'Ultraviolet light from stars and quasars has ionized nearly all the hydrogen between galaxies.', sources: [S.reion, S.planck2018] },
  { id: 'cosmic-noon', name: 'Cosmic noon', category: 'Structure', since: { best: tAtRedshift(1.86), min: tAtRedshift(2.5), max: tAtRedshift(1.5) }, label: '~3.5 Gyr', certainty: 'Observed', summary: "Peak rate of star formation in the universe's history.", sources: [S.madau] },
  { id: 'acceleration', name: 'Expansion starts accelerating', category: 'Dark sector & expansion', since: { best: tAt(aAcc), min: tAtRedshift(0.7), max: tAtRedshift(0.55) }, label: '~7.7 Gyr', certainty: 'Observed (supernovae)', summary: "Dark energy's push overtakes gravity's pull and cosmic expansion begins to speed up.", sources: [S.riess, S.perlmutter, S.planck2018] },
  { id: 'sun-forms', name: 'Solar nebula collapses; Sun forms', category: 'Structure', agoYears: { best: 4.5673 * GYR, min: 4.5671 * GYR, max: 4.5675 * GYR }, label: '4.6 Gyr ago', certainty: 'Precisely dated', summary: 'A cloud of gas and dust, enriched by earlier stars, collapses into the Sun and a planet-forming disk.', sources: [S.ssAge] },
  { id: 'earth-forms', name: 'Earth forms', category: 'Structure', agoYears: { best: 4.54 * GYR, min: 4.49 * GYR, max: 4.59 * GYR }, label: '4.54 Gyr ago', certainty: 'Precisely dated', summary: 'Rocky material in the disk accretes into Earth.', sources: [S.earthAge] },
  { id: 'moon-forms', name: 'Moon-forming impact', category: 'Structure', agoYears: { best: 4.51 * GYR, min: 4.43 * GYR, max: 4.53 * GYR }, label: '~4.5 Gyr ago', certainty: 'Well supported', summary: 'A Mars-sized body strikes the young Earth; the debris coalesces into the Moon.', sources: [S.moon] },
  { id: 'oceans', name: 'First oceans', category: 'Life', agoYears: { best: 4.4 * GYR, min: 4.0 * GYR, max: 4.4 * GYR }, label: '~4.4 Gyr ago', certainty: 'Indirect evidence', summary: 'Zircon crystals show liquid water on Earth within ~150 million years of its formation.', sources: [S.zircon] },
  { id: 'dark-energy-dominates', name: 'Dark energy dominates', category: 'Dark sector & expansion', since: { best: tAt(aLam), min: tAtRedshift(0.35), max: tAtRedshift(0.25) }, label: '~3.5 Gyr ago', certainty: 'Observed', summary: "Dark energy becomes the largest component of the universe's energy budget.", sources: [S.planck2018] },
  { id: 'earliest-life', name: 'Earliest life', category: 'Life', agoYears: { best: 3.8 * GYR, min: 3.5 * GYR, max: 4.1 * GYR }, label: '~3.8 Gyr ago', certainty: 'Debated (3.5–4.1)', summary: "Single-celled microbes appear in Earth's oceans.", sources: [S.earliestLife] },
  { id: 'great-oxidation', name: 'Great Oxidation Event', category: 'Life', agoYears: { best: 2.4 * GYR, min: 2.3 * GYR, max: 2.5 * GYR }, label: '~2.4 Gyr ago', certainty: 'Well dated', summary: 'Photosynthesizing cyanobacteria fill the atmosphere with oxygen.', sources: [S.goe] },
  { id: 'eukaryotes', name: 'Complex cells (eukaryotes)', category: 'Life', agoYears: { best: 1.8 * GYR, min: 1.6 * GYR, max: 2.1 * GYR }, label: '~1.8 Gyr ago', certainty: 'Debated', summary: 'Cells with nuclei and mitochondria arise, likely from one microbe engulfing another.', sources: [S.eukaryotes] },
  { id: 'cambrian', name: 'Cambrian explosion', category: 'Life', agoYears: { best: 538.8 * MYR, min: 538.6 * MYR, max: 539.0 * MYR }, label: '538 Myr ago', certainty: 'Well dated', summary: 'Most major animal groups appear in the fossil record.', sources: [S.cambrian] },
  { id: 'dinosaurs-extinct', name: 'Dinosaurs go extinct', category: 'Life', agoYears: { best: 66.043 * MYR, min: 66.032 * MYR, max: 66.054 * MYR }, label: '66 Myr ago', certainty: 'Precisely dated', summary: 'An asteroid impact ends the age of dinosaurs and opens the way for mammals.', sources: [S.kpg] },
  { id: 'homo-sapiens', name: 'Homo sapiens', category: 'Life', agoYears: { best: 300e3, min: 280e3, max: 350e3 }, label: '~300,000 yr ago', certainty: 'Well dated', summary: 'Anatomically modern humans appear in Africa.', sources: [S.sapiens] },
  { id: 'now', name: 'Now', category: 'Structure', agoYears: { best: 1, min: 1, max: 1 }, label: '13.8 billion years', certainty: 'Precisely measured', summary: 'Today: about 5% ordinary matter, 27% dark matter, 68% dark energy.', sources: [S.planck2018] },
];

const events: CosmicEvent[] = seed
  .map((e) => {
    const { ...rest } = e as SeedEvent & { since?: Since; agoYears?: Since };
    const since = 'since' in e ? e.since : undefined;
    const ago = 'agoYears' in e ? e.agoYears : undefined;
    delete (rest as { since?: Since }).since;
    delete (rest as { agoYears?: Since }).agoYears;
    if (ago) {
      return {
        ...rest,
        // Older lookback = earlier t, so min/max swap.
        t_seconds: { best: AGE_SECONDS - yr(ago.best), min: AGE_SECONDS - yr(ago.max), max: AGE_SECONDS - yr(ago.min) },
        lookback_years: ago,
      } as CosmicEvent;
    }
    return { ...rest, t_seconds: since! } as CosmicEvent;
  })
  .sort((a, b) => a.t_seconds.best - b.t_seconds.best);

const eras: Era[] = [
  { id: 'planck', era: 'Planck', lane: 'Epoch', start_s: 0, end_s: 1e-43, description: 'Quantum gravity; physics unknown' },
  { id: 'gut', era: 'Grand unification', lane: 'Epoch', start_s: 1e-43, end_s: 1e-36, description: 'Strong and electroweak forces unified' },
  { id: 'inflation', era: 'Inflation', lane: 'Epoch', start_s: 1e-36, end_s: 1e-32, description: 'Exponential expansion' },
  { id: 'electroweak', era: 'Electroweak', lane: 'Epoch', start_s: 1e-32, end_s: 1e-12, description: 'Electromagnetic and weak forces unified' },
  { id: 'quark', era: 'Quark', lane: 'Epoch', start_s: 1e-12, end_s: 1e-6, description: 'Quark–gluon plasma' },
  { id: 'hadron', era: 'Hadron', lane: 'Epoch', start_s: 1e-6, end_s: 1, description: 'Protons and neutrons form' },
  { id: 'lepton', era: 'Lepton', lane: 'Epoch', start_s: 1, end_s: 10, description: 'Leptons dominate the mass' },
  { id: 'photon', era: 'Photon', lane: 'Epoch', start_s: 10, end_s: tAtRedshift(1090), description: 'Light dominates; nuclei form' },
  { id: 'dark-ages', era: 'Dark ages', lane: 'Epoch', start_s: tAtRedshift(1090), end_s: yr(150 * MYR), description: 'Neutral gas, no stars' },
  { id: 'reionization', era: 'Reionization', lane: 'Epoch', start_s: yr(150 * MYR), end_s: tAtRedshift(5.8), description: 'First stars and galaxies' },
  { id: 'stars-galaxies', era: 'Stars & galaxies', lane: 'Epoch', start_s: tAtRedshift(5.8), end_s: AGE_SECONDS, description: 'Galaxies, planets, life' },
  { id: 'inflaton', era: 'Inflaton field', lane: 'Dominant component', start_s: 1e-36, end_s: 1e-32, description: 'Vacuum energy drives inflation' },
  { id: 'radiation', era: 'Radiation', lane: 'Dominant component', start_s: 1e-32, end_s: tEq, description: 'Radiation-dominated expansion' },
  { id: 'matter', era: 'Matter', lane: 'Dominant component', start_s: tEq, end_s: tAt(aLam), description: 'Matter-dominated (mostly dark matter)' },
  { id: 'dark-energy', era: 'Dark energy', lane: 'Dominant component', start_s: tAt(aLam), end_s: AGE_SECONDS, description: 'Dark-energy-dominated, accelerating' },
];

eventsSchema.parse(events);
erasSchema.parse(eras);

const out = new URL('../public/data/', import.meta.url);
writeFileSync(new URL('events.json', out), JSON.stringify(events, null, 1) + '\n');
writeFileSync(new URL('eras.json', out), JSON.stringify(eras, null, 1) + '\n');
writeFileSync(new URL('events.schema.json', out), JSON.stringify(z.toJSONSchema(z.array(eventSchema)), null, 2) + '\n');
writeFileSync(new URL('eras.schema.json', out), JSON.stringify(z.toJSONSchema(z.array(eraSchema)), null, 2) + '\n');
console.log(`Wrote ${events.length} events, ${eras.length} eras (age ${(AGE_SECONDS / YEAR_S / 1e9).toFixed(3)} Gyr).`);
