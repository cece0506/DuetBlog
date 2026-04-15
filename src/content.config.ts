import fs from "node:fs/promises";
import path from "node:path";
import { defineCollection, z } from "astro:content";

const GENERATED_PATH = path.join(process.cwd(), "src", "generated", "notion-blog.json");

type GeneratedPost = {
  slug: string;
  title: string;
  date: string;
  status?: string;
  tags?: string[];
  cover?: string;
  excerpt?: string;
  body?: string;
  notionId?: string;
  notionUrl?: string;
};

const blog = defineCollection({
  loader: async () => {
    try {
      const raw = await fs.readFile(GENERATED_PATH, "utf8");
      const posts = JSON.parse(raw) as GeneratedPost[];
      return posts.map((post) => ({
        id: post.slug,
        ...post,
      }));
    } catch {
      return [];
    }
  },
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    date: z.string(),
    status: z.string().optional().default("Published"),
    tags: z.array(z.string()).optional().default([]),
    cover: z.string().optional(),
    excerpt: z.string().optional(),
    body: z.string().optional().default(""),
    notionId: z.string().optional(),
    notionUrl: z.string().optional(),
  }),
});

export const collections = { blog };
