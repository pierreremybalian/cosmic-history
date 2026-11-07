// Site-wide copy and SEO.
export const SITE = {
  name: 'Cosmic History',
  title: 'Cosmic History — 13.8 billion years in one scroll',
  description:
    'A scroll-driven 3D journey from the Planck epoch to today. Every frame is computed from real cosmology, and every scene says how sure we are.',
  ogImage: '/og.png',
  themeColor: '#020205',
};

export const ACCURACY_LABEL = {
  measured: 'Measured',
  simulated: 'Simulated',
  modelled: 'Modelled',
  metaphor: 'Metaphor',
} as const;

export const ACCURACY_HELP = {
  measured: 'Shapes, colours or numbers come directly from observations.',
  simulated: 'Computed from physical laws applied to measured starting conditions.',
  modelled: 'A simplified physical model; correct in kind, simplified in detail.',
  metaphor: 'No tested physics describes this; the visual is an artistic stand-in.',
} as const;

export const CREDITS: { label: string; text: string; url?: string }[] = [
  {
    label: 'Cosmic microwave background',
    text: 'ESA and the Planck Collaboration: Planck 2018 SMICA map (PR3, inpainted), Planck Legacy Archive, shown colour mapped. Based on observations obtained with Planck (http://www.esa.int/Planck), an ESA science mission with instruments and contributions directly funded by ESA Member States, NASA, and Canada. Licence: CC BY-NC 3.0 IGO.',
    url: 'https://pla.esac.esa.int/',
  },
  {
    label: 'Cosmological parameters',
    text: 'Planck Collaboration 2018 VI, TT,TE,EE+lowE+lensing (H₀ = 67.4, Ωm = 0.315, Ωb = 0.0493).',
    url: 'https://arxiv.org/abs/1807.06209',
  },
  {
    label: 'Colour science',
    text: 'CIE 1931 2° standard observer colour-matching functions (5 nm), via the colour-science project.',
    url: 'https://www.colour-science.org/',
  },
  {
    label: 'Structure',
    text: 'Primordial field with n_s = 0.965 and the BBKS transfer function (Bardeen, Bond, Kaiser & Szalay 1986); truncated Zel’dovich approximation (Coles, Melott & Shandarin 1993).',
    url: 'https://doi.org/10.1086/164143',
  },
  {
    label: 'Star formation history',
    text: 'Madau & Dickinson 2014, cosmic star-formation rate density fit.',
    url: 'https://arxiv.org/abs/1403.0007',
  },
  {
    label: 'Nucleosynthesis',
    text: 'Fields, Olive, Yeh & Young 2020 for primordial abundances (Yp ≈ 0.247, D/H ≈ 2.5×10⁻⁵, Li/H ≈ 5×10⁻¹⁰).',
    url: 'https://arxiv.org/abs/1912.01132',
  },
  {
    label: 'Rendering',
    text: 'three.js WebGPU renderer and TSL shaders, Lenis smooth scroll, Astro.',
    url: 'https://threejs.org/',
  },
];
