import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://duetpalace.top",
  server: {
    host: true,
    port: 4321,
    open: true,
  },
});
