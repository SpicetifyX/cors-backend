import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

app.get("/extensions", async () => {
  const installedExtensions = await Promise.all(
    (await fs.readdir(path.join(process.env.APPDATA!, "Spicetify", "Extensions"))).map(async (entry) => {
      if (entry.includes(".meta.json")) {
        const metaData = JSON.parse((await fs.readFile(path.join(process.env.APPDATA!, "Spicetify", "Extensions", entry))).toString()) as {
          authors?: {
            name: string;
            url: string;
          }[];
          description?: string;
          imageURL: string;
          name: string;
          tags?: string[];
        };

        return metaData;
      }
    }),
  );

  console.log(installedExtensions);
  return new Response(JSON.stringify(installedExtensions.filter((ext) => ext != null)), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});

export default app;
