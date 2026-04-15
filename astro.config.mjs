import { defineConfig } from "astro/config";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://duetpalace.top",

  server: {
    host: true,
    port: 4321,
    open: true,
  },

  adapter: cloudflare()
});