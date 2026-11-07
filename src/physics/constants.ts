// Physical and cosmological constants. Planck 2018 (TT,TE,EE+lowE+lensing), HANDOFF §6.1.
// Every physical number the app shows or a shader uses traces back to this file.

/** Julian year in seconds. */
export const YEAR_S = 3.15576e7;
export const KYR_S = 1e3 * YEAR_S;
export const MYR_S = 1e6 * YEAR_S;
export const GYR_S = 1e9 * YEAR_S;

/** Megaparsec in metres (IAU 2015). */
export const MPC_M = 3.0856775814913673e22;

/** Hubble constant, km/s/Mpc. */
export const H0_KM_S_MPC = 67.4;
export const LITTLE_H = H0_KM_S_MPC / 100;
/** Hubble constant in 1/s. */
export const H0_PER_S = (H0_KM_S_MPC * 1e3) / MPC_M;

export const OMEGA_M = 0.315;
export const OMEGA_B = 0.0493;
export const OMEGA_DM = OMEGA_M - OMEGA_B;
export const N_EFF = 3.046;
export const OMEGA_GAMMA_H2 = 2.47e-5;
export const OMEGA_GAMMA = OMEGA_GAMMA_H2 / (LITTLE_H * LITTLE_H);
/** Photons + massless neutrinos: Ω_γ (1 + 0.2271 N_eff). */
export const OMEGA_R = OMEGA_GAMMA * (1 + 0.2271 * N_EFF);
/** Flat universe: Ω_Λ = 1 − Ω_m − Ω_r (Planck quotes 0.685; the difference is logged in DECISIONS.md). */
export const OMEGA_L = 1 - OMEGA_M - OMEGA_R;
export const OMEGA_L_QUOTED = 0.685;

/** CMB temperature today, K. */
export const T_CMB0 = 2.7255;
/** Scalar spectral index. */
export const N_S = 0.965;
/** Amplitude of matter fluctuations in 8 Mpc/h spheres today. */
export const SIGMA_8 = 0.811;

// Fundamental constants (CODATA 2018, exact where defined).
export const C_M_S = 299792458;
export const H_PLANCK = 6.62607015e-34; // J s
export const K_BOLTZMANN = 1.380649e-23; // J/K
export const EV_J = 1.602176634e-19;
export const MEV_K = (1e6 * EV_J) / K_BOLTZMANN; // 1 MeV in kelvin ≈ 1.16e10 K

/** Planck time, s. */
export const T_PLANCK_S = 5.391247e-44;

// Inflation (HANDOFF §6.5): parametric and illustrative.
export const T_INFLATION_START_S = 1e-36;
export const T_INFLATION_END_S = 1e-32;
export const INFLATION_EFOLDS = 60;

// e⁺e⁻ annihilation (HANDOFF §6.3). Before it, photons share the neutrino temperature (4/11)^(1/3) T₀/a.
// Smooth step in log a between the epochs where the naive T₀/a crosses these temperatures.
export const EE_STEP_T_START_K = 1.5e10;
export const EE_STEP_T_END_K = 1.5e9;
export const EE_TA_RATIO = Math.cbrt(4 / 11);

// Neutron physics for BBN (HANDOFF §6.6).
export const NEUTRON_LIFETIME_S = 879;
export const NEUTRON_PROTON_Q_MEV = 1.293;
export const YP_TARGET = 0.247;
export const D_TO_H_FINAL = 2.5e-5;
export const LI7_TO_H_FINAL = 5e-10;
export const HE3_TO_H_FINAL = 1.0e-5;

// Recombination (HANDOFF §6.7).
export const Z_RECOMBINATION_MID = 1100;
export const Z_RECOMBINATION_WIDTH = 80;
export const Z_LAST_SCATTERING = 1090;
/** Residual ionisation after recombination (freeze-out). */
export const X_E_RESIDUAL = 2e-4;
