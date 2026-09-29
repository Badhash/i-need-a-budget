// Version de l'app affichee a l'utilisateur (ecran de chargement, reglages) :
// « 2026.09.29 · 9210f08 » = date du build (Europe/Paris) + SHA court du
// commit deploye. Injectee au build par vite.config.ts.
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
