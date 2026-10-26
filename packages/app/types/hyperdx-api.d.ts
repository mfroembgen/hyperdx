// The serverless entry point is only used in Vercel preview deployments
// (HDX_PREVIEW_INLINE_API=true). In all other builds the import is skipped
// at build time by Vite when inline preview mode is disabled. This ambient declaration
// keeps TypeScript happy regardless of whether the API package has been
// built.
declare module '@hyperdx/api/build/serverless';
