/** @type {import('tailwindcss').Config} */

/** HP Electric Blue scale — remaps legacy violet/purple/indigo utilities app-wide */
const hpBlue = {
  50: '#eef4ff',
  100: '#c9e0fc',
  200: '#a8cef9',
  300: '#7aabf5',
  400: '#4d88ef',
  500: '#296ef9',
  600: '#024ad8',
  700: '#0e3191',
  800: '#0a256f',
  900: '#061845',
  950: '#030d28',
}

export default {  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        hp: {
          ink: "#1a1a1a",
          primary: "#024ad8",
          "primary-bright": "#296ef9",
          "primary-deep": "#0e3191",
          cloud: "#f7f7f7",
          fog: "#e8e8e8",
          graphite: "#636363",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        /* Colorful glass accent hues */
        glass: {
          blue: "hsl(var(--c-blue))",
          violet: "hsl(var(--c-violet))",
          teal: "hsl(var(--c-teal))",
          rose: "hsl(var(--c-rose))",
          amber: "hsl(var(--c-amber))",
        },
        /* Remap legacy purple/violet UI to a richer violet so the app reads colorful */
        violet: hpBlue,
        purple: hpBlue,
        indigo: hpBlue,
      },
      boxShadow: {
        glass: "0 10px 30px -12px hsl(222 47% 25% / 0.28), inset 0 1px 0 0 rgb(255 255 255 / 0.5)",
        "glass-lg": "0 24px 56px -20px hsl(222 47% 22% / 0.34), inset 0 1px 0 0 rgb(255 255 255 / 0.55)",
      },
      backdropBlur: {
        xs: "2px",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
        xl: "var(--radius-xl)",
        pill: "9999px",
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        display: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        body: ['16px', { lineHeight: '1.38', letterSpacing: '0' }],
        caption: ['14px', { lineHeight: '1.5', letterSpacing: '0' }],
        'fine-print': ['12px', { lineHeight: '1.33', letterSpacing: '0' }],
      },
      maxWidth: {
        content: '1280px',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
}
