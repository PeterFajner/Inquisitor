// Imports esbuild resolves for the client build (scripts/client.ts).

// Stylesheets imported for their side effect: bundled into the entry's CSS.
declare module "*.css" {}

// A stylesheet's text, minified (the card layout parses the app's CSS: src/shared/layout).
declare module "*.css?text" {
  const css: string;
  export default css;
}

/** The card layout code's build (scripts/client.ts): a hash of every source file card heights depend on. */
declare const LAYOUT_BUILD: string;
