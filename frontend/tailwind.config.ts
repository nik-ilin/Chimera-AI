import type { Config } from "tailwindcss";

/*
 * Chimera design tokens (Stage B).
 * Colours reference CSS variables defined in globals.css. Never hardcode
 * hex/hsl in components — extend here so the look is tunable in one place.
 */
const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        // Editorial display = the grotesque, used large with tight tracking.
        display: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        // Chimera brand tokens (Stage B fusion palette)
        chimera: {
          clay: "hsl(var(--chimera-clay))",
          "clay-muted": "hsl(var(--chimera-clay-muted))",
          plum: "hsl(var(--chimera-plum))",
          "plum-muted": "hsl(var(--chimera-plum-muted))",
          ink: "hsl(var(--chimera-ink))",
          cream: "hsl(var(--chimera-cream))",
          sand: "hsl(var(--chimera-sand))",
          gold: "hsl(var(--chimera-gold))",
          // Legacy aliases (mapped to plum in globals.css)
          purple: "hsl(var(--chimera-purple))",
          "purple-muted": "hsl(var(--chimera-purple-muted))",
        },
      },
      borderRadius: {
        sm: "calc(var(--radius) - 6px)",
        md: "calc(var(--radius) - 3px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
        "2xl": "calc(var(--radius) + 8px)",
        "3xl": "calc(var(--radius) + 14px)",
        widget: "1.75rem",
        "widget-lg": "2.25rem",
        pill: "9999px",
      },
      boxShadow: {
        soft: "0 1px 3px hsl(28 20% 12% / 0.06)",
        widget:
          "0 1px 2px hsl(28 20% 12% / 0.04), 0 18px 40px -24px hsl(28 20% 12% / 0.18)",
        "widget-lg":
          "0 2px 4px hsl(28 20% 12% / 0.05), 0 30px 60px -28px hsl(28 20% 12% / 0.22)",
        ink: "0 1px 2px hsl(28 20% 12% / 0.06), 0 26px 50px -26px hsl(28 20% 12% / 0.40)",
        "clay-glow": "0 8px 24px -8px hsl(var(--chimera-clay) / 0.45)",
      },
      transitionTimingFunction: {
        smooth: "cubic-bezier(0.22, 1, 0.36, 1)",
        spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "token-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.5s ease both",
        "scale-in": "scale-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both",
        "token-in": "token-in 0.18s ease both",
        shimmer: "shimmer 1.8s linear infinite",
        float: "float 4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
