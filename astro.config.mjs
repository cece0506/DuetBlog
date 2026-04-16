import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://duetpalace.top",
  image: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "**.notion-static.com",
      },
      {
        protocol: "https",
        hostname: "img.duetpalace.top",
      },
    ],
  },
  server: {
    host: true,
    port: 4321,
    open: true,
  },
});
