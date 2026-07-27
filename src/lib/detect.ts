// Framework detection from a repository's own files, so the create forms can
// fill in the two fields people always have to look up (build command and
// output directory) — and warn when the chosen service type cannot work.

export interface Detection {
  framework: string;
  buildCmd: string;
  outDir: string;
  hasBuild: boolean;
  hasStart: boolean;
  /** suits a static site (built output, no server process needed) */
  static: boolean;
  /** needs a long-running process */
  server: boolean;
  notes: string[];
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Inputs {
  pkg: any | null;
  rootFiles: string[];
  nextConfig?: string;
  astroConfig?: string;
  svelteConfig?: string;
  nuxtConfig?: string;
}

function dep(pkg: any, name: string): boolean {
  return Boolean(pkg?.dependencies?.[name] ?? pkg?.devDependencies?.[name]);
}

export function detectFramework({
  pkg,
  rootFiles,
  nextConfig,
  astroConfig,
  svelteConfig,
  nuxtConfig,
}: Inputs): Detection {
  const scripts = pkg?.scripts ?? {};
  const hasBuild = Boolean(scripts.build);
  const hasStart = Boolean(scripts.start);
  const notes: string[] = [];

  const packageManager: Detection['packageManager'] = rootFiles.includes('pnpm-lock.yaml')
    ? 'pnpm'
    : rootFiles.includes('yarn.lock')
      ? 'yarn'
      : rootFiles.includes('bun.lockb') || rootFiles.includes('bun.lock')
        ? 'bun'
        : 'npm';

  const build = (cmd = 'build') =>
    packageManager === 'npm' ? `npm run ${cmd}` : `${packageManager} run ${cmd}`;

  // No package.json at all — treat the repo as ready-to-serve files.
  if (!pkg) {
    const hasIndex = rootFiles.includes('index.html');
    return {
      framework: hasIndex ? 'Static HTML' : 'Unknown',
      buildCmd: '',
      outDir: '.',
      hasBuild: false,
      hasStart: false,
      static: hasIndex,
      server: false,
      notes: hasIndex
        ? ['No build step — files are served straight from the repository root.']
        : ['No package.json and no index.html found; check the output folder manually.'],
      packageManager,
    };
  }

  // Next.js: static only when configured to export.
  if (dep(pkg, 'next')) {
    const exports = /output\s*:\s*['"]export['"]/.test(nextConfig ?? '');
    if (exports) {
      return {
        framework: 'Next.js (static export)',
        buildCmd: build(),
        outDir: 'out',
        hasBuild,
        hasStart,
        static: true,
        server: false,
        notes: ["next.config sets output: 'export', so the build produces static files."],
        packageManager,
      };
    }
    return {
      framework: 'Next.js',
      buildCmd: build(),
      outDir: 'out',
      hasBuild,
      hasStart,
      static: false,
      server: true,
      notes: [
        "This Next.js app renders on the server — it needs a Node process, so create it as a Web Service rather than a static site (or add output: 'export' to next.config).",
      ],
      packageManager,
    };
  }

  if (dep(pkg, 'astro')) {
    const ssr = /adapter\s*:/.test(astroConfig ?? '');
    return {
      framework: 'Astro',
      buildCmd: build(),
      outDir: 'dist',
      hasBuild,
      hasStart,
      static: !ssr,
      server: ssr,
      notes: ssr
        ? ['astro.config declares an adapter, so this build expects a server runtime.']
        : [],
      packageManager,
    };
  }

  if (dep(pkg, '@sveltejs/kit')) {
    const staticAdapter = /adapter-static/.test(svelteConfig ?? '');
    return {
      framework: 'SvelteKit',
      buildCmd: build(),
      outDir: 'build',
      hasBuild,
      hasStart,
      static: staticAdapter,
      server: !staticAdapter,
      notes: staticAdapter
        ? []
        : ['No adapter-static in svelte.config — this build needs a Node process.'],
      packageManager,
    };
  }

  if (dep(pkg, 'nuxt') || dep(pkg, 'nuxt3')) {
    const generates = Boolean(scripts.generate);
    return {
      framework: 'Nuxt',
      buildCmd: generates ? build('generate') : build(),
      outDir: '.output/public',
      hasBuild,
      hasStart,
      static: generates,
      server: !generates,
      notes: generates
        ? ['Using the generate script, which pre-renders to .output/public.']
        : ['Without a generate script Nuxt builds a server app; deploy it as a Web Service.'],
      packageManager,
    };
  }

  if (dep(pkg, 'gatsby')) {
    return {
      framework: 'Gatsby',
      buildCmd: build(),
      outDir: 'public',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: [],
      packageManager,
    };
  }

  if (dep(pkg, '@docusaurus/core')) {
    return {
      framework: 'Docusaurus',
      buildCmd: build(),
      outDir: 'build',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: [],
      packageManager,
    };
  }

  if (dep(pkg, '@11ty/eleventy')) {
    return {
      framework: 'Eleventy',
      buildCmd: build(),
      outDir: '_site',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: [],
      packageManager,
    };
  }

  if (dep(pkg, 'react-scripts')) {
    return {
      framework: 'Create React App',
      buildCmd: build(),
      outDir: 'build',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: [],
      packageManager,
    };
  }

  if (dep(pkg, '@angular/cli') || dep(pkg, '@angular/core')) {
    return {
      framework: 'Angular',
      buildCmd: build(),
      outDir: 'dist',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: ['Angular nests output under dist/<project-name> — adjust if the path differs.'],
      packageManager,
    };
  }

  if (dep(pkg, 'vite')) {
    return {
      framework: 'Vite',
      buildCmd: build(),
      outDir: 'dist',
      hasBuild,
      hasStart,
      static: true,
      server: false,
      notes: [],
      packageManager,
    };
  }

  // Anything else with a start script is a plain Node service.
  if (hasStart) {
    return {
      framework: dep(pkg, 'express')
        ? 'Express'
        : dep(pkg, 'fastify')
          ? 'Fastify'
          : dep(pkg, 'hono')
            ? 'Hono'
            : 'Node service',
      buildCmd: hasBuild ? build() : '',
      outDir: 'dist',
      hasBuild,
      hasStart,
      static: false,
      server: true,
      notes: ['Has a start script — deploy this as a Web Service.'],
      packageManager,
    };
  }

  return {
    framework: 'Unknown',
    buildCmd: hasBuild ? build() : '',
    outDir: 'dist',
    hasBuild,
    hasStart,
    static: hasBuild,
    server: false,
    notes: ['Could not identify the framework — check the build command and output folder.'],
    packageManager,
  };
}
