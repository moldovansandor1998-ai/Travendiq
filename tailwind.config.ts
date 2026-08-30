import type { Config } from "tailwindcss";

/**
 * Travendiq Design System – színtételek.
 *
 * lagoon  = márka mélytürkiz (elsődleges identitás, linkek, kiemelések)
 * ink     = mély sötétkék-szürke (szöveg, elsődleges gombok, header/footer)
 * coral   = meleg naplemente-akcentus (CTA-k, kedvezményjelek, figyelmeztetések)
 * sand    = meleg semleges háttérskála
 * palm    = siker/megerősítés zöld
 *
 * Dark mode előkészítés: `darkMode: "class"` + a globals.css-ben :root/.dark
 * CSS-változók; a komponensek a változókon keresztül érik el a felületszíneket.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1rem", sm: "1.5rem" } },
    extend: {
      colors: {
        lagoon: {
          50: "#effaf8", 100: "#d7f2ee", 200: "#b0e4de", 300: "#7ccfc7",
          400: "#45b3ab", 500: "#26978f", 600: "#1a7a75", 700: "#18625f",
          800: "#174f4d", 900: "#164241", 950: "#062726",
        },
        ink: {
          50: "#f5f7f9", 100: "#e9edf1", 200: "#d3dbe3", 300: "#aebdcc",
          400: "#8299af", 500: "#627d95", 600: "#4d657b", 700: "#405364",
          800: "#1e2a38", 900: "#141f2b", 950: "#0b1420",
        },
        coral: {
          50: "#fff5ef", 100: "#ffe8d9", 200: "#ffcdb0", 300: "#ffaa7d",
          400: "#fb8a5c", 500: "#f2682f", 600: "#e04e17", 700: "#ba3b12",
          800: "#943116", 900: "#782b15",
        },
        sand: {
          50: "#faf9f7", 100: "#f3f1ec", 200: "#e7e3d9", 300: "#d5cfbf",
        },
        palm: {
          50: "#effaf2", 100: "#d7f2e0", 500: "#22a05a", 600: "#1a8249",
          700: "#16683c", 800: "#145332",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "-apple-system",
          "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgb(11 20 32 / 0.05), 0 1px 6px rgb(11 20 32 / 0.06)",
        lifted: "0 4px 12px rgb(11 20 32 / 0.08), 0 12px 32px rgb(11 20 32 / 0.12)",
        pop: "0 8px 24px rgb(11 20 32 / 0.16)",
      },
      borderRadius: { xl2: "1.25rem" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeUp: "fadeUp .35s ease-out both",
      },
      maxWidth: { page: "76rem" },
    },
  },
  plugins: [],
};
export default config;
