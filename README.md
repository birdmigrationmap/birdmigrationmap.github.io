# BMM website

Astro static website for Bird Migration Modelling resources, web apps, publications, and datasets.

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

The site deploys with GitHub Actions. On pushes to `master`, the workflow builds the Astro site, uploads `dist/` with `actions/upload-pages-artifact`, and deploys that artifact with `actions/deploy-pages`.

GitHub Pages should be configured to use **GitHub Actions** as the source. The custom domain is kept in `public/CNAME` and copied into `dist/CNAME` during the build.
