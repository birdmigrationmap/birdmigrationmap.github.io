# Bird Migration Map organization website

Astro static website for Bird Migration Map resources, web apps, publications, and datasets.

## Structure

- `src/`: maintainable Astro source for the landing page.
- `public/`: static files copied as-is into the deployed site.
- `public/2016/`, `public/2018/`, `public/explore-vp/`, `public/US/`: legacy static apps preserved at their existing public routes.
- `.github/workflows/deploy.yml`: GitHub Pages deployment through the Pages artifact workflow.

## Local workflow

Install dependencies once:

```sh
npm install
```

Run the development server:

```sh
npm run dev
```

Build the deployable artifact:

```sh
npm run build
```

Preview the built artifact locally:

```sh
npm run preview
```

## Deployment

The site deploys with GitHub Actions. On pushes to `main`, the workflow builds the Astro site, uploads `dist/` with `actions/upload-pages-artifact`, and deploys that artifact with `actions/deploy-pages`.

GitHub Pages should be configured to use **GitHub Actions** as the source.

The custom domain is kept in `public/CNAME` and copied into `dist/CNAME` during the build. To serve the site at `https://birdmigrationmap.vogelwarte.ch/`, the repository Pages settings must set the custom domain to `birdmigrationmap.vogelwarte.ch`, and DNS for that host must be a `CNAME` to `birdmigrationmap.github.io`.

The landing page uses relative links for local assets and subpages, and the main stylesheet is embedded directly into the page. That keeps the landing page deployable at both the default organization URL `https://birdmigrationmap.github.io/` and the custom domain root.
