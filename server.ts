import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  fileExists,
  getSpicetifyExec,
  getSpicetifyConfigDir,
  getConfigFilePath,
  getSpicetifyxDir,
  getLatestSpicetifyReleaseArchive,
  httpGet,
  extractZipToDir,
  extractTarGz,
  getExtensionsDir,
  spicetifyCommand,
} from "./src/utils";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

// Define the InstallStatus type
type InstallStatus = {
  spotify: boolean;
  spicetify: boolean;
  patched: boolean;
};

type MarketplaceMeta = {
  name: string;
  description?: string;
  imageURL?: string;
  authors?: {
    name: string;
    url: string;
  }[];
  tags?: string[];
  stars?: number;
  subdir?: string;
};

app.get("/extensions", async (c) => {
  const extensionsDir = path.join(getSpicetifyConfigDir(), "Extensions");
  let installedExtensions: any[] = [];
  try {
    const entries = await fs.readdir(extensionsDir);
    installedExtensions = await Promise.all(
      entries.map(async (entry) => {
        if (entry.includes(".meta.json")) {
          const metaData = JSON.parse(
            (
              await fs.readFile(path.join(extensionsDir, entry))
            ).toString(),
          ) as {
            authors?: {
              name: string;
              url: string;
            }[];
            description?: string;
            imageURL?: string;
            name: string;
            tags?: string[];
          };

          return metaData;
        }
        return null;
      }),
    );
  } catch (error) {
    console.error("Error reading extensions directory:", error);
  }

  return c.json(installedExtensions.filter((ext) => ext != null));
});

app.get("/checkInstallation", async (c) => {
  let spotifyPath: string;
  let alreadyPatchedPath: string;

  if (os.platform() === "win32") {
    spotifyPath = path.join(process.env.APPDATA!, "Spotify");
  } else if (os.platform() === "darwin") {
    spotifyPath = path.join(os.homedir(), "Library", "Application Support", "Spotify");
  } else {
    // For other Linux-like systems, you might need to adjust this
    spotifyPath = path.join(os.homedir(), ".config", "spotify");
  }

  alreadyPatchedPath = path.join(spotifyPath, ".spicetify");

  const spotifyInstalled = await fileExists(spotifyPath);
  const binaryExists = await fileExists(getSpicetifyExec());
  const configExists = await fileExists(getConfigFilePath());
  const alreadyPatched = await fileExists(alreadyPatchedPath);
  const spicetifyInstalled = binaryExists && configExists;

  const installStatus: InstallStatus = {
    spotify: spotifyInstalled,
    spicetify: spicetifyInstalled,
    patched: alreadyPatched,
  };

  return c.json(installStatus);
});

app.post("/installSpicetifyBinary", async (c) => {
  try {
    const spicetifyxDir = getSpicetifyxDir();

    if (await fileExists(getSpicetifyExec())) {
      return c.json({ message: "Spicetify binary already installed, skipping" });
    }

    const archiveURL = await getLatestSpicetifyReleaseArchive();
    if (!archiveURL) {
      return c.json({ error: "No suitable release archive found for this platform" }, 404);
    }

    const resp = await httpGet(archiveURL);
    if (!resp.ok) {
      return c.json({ error: `Download failed: ${resp.statusText}` }, resp.status);
    }

    await fs.mkdir(spicetifyxDir, { recursive: true });

    const data = Buffer.from(await resp.arrayBuffer());

    if (archiveURL.endsWith(".zip")) {
      await extractZipToDir(data, spicetifyxDir, false);
    } else if (archiveURL.endsWith(".tar.gz")) {
      await extractTarGz(data, spicetifyxDir);
    } else {
      return c.json({ error: "Unsupported archive format" }, 400);
    }

    return c.json({ message: "Spicetify binary installed successfully" });
  } catch (error: any) {
    console.error("Error installing Spicetify binary:", error);
    return c.json({ error: error.message || "Failed to install Spicetify binary" }, 500);
  }
});

app.post("/installMarketplaceExtension", async (c) => {
  try {
    const { extensionURL, filename, meta } = await c.req.json();

    const extDir = getExtensionsDir();
    await fs.mkdir(extDir, { recursive: true });

    const resp = await httpGet(extensionURL);
    if (!resp.ok) {
      return c.json({ error: `Failed to download extension: ${resp.statusText}` }, resp.status);
    }
    const content = await resp.text();

    const destPath = path.join(extDir, filename);
    await fs.writeFile(destPath, content);

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(destPath + ".meta.json", JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "extensions", filename], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "Extension installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace extension:", error);
    return c.json({ error: error.message || "Failed to install marketplace extension" }, 500);
  }
});

import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  fileExists,
  getSpicetifyExec,
  getSpicetifyConfigDir,
  getConfigFilePath,
  getSpicetifyxDir,
  getLatestSpicetifyReleaseArchive,
  httpGet,
  downloadText,
  extractZipToDir,
  extractTarGz,
  getExtensionsDir,
  getThemesDir,
  spicetifyCommand,
} from "./src/utils";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

// Define the InstallStatus type
type InstallStatus = {
  spotify: boolean;
  spicetify: boolean;
  patched: boolean;
};

type MarketplaceMeta = {
  name: string;
  description?: string;
  imageURL?: string;
  authors?: {
    name: string;
    url: string;
  }[];
  tags?: string[];
  stars?: number;
  subdir?: string;
};

app.get("/extensions", async (c) => {
  const extensionsDir = path.join(getSpicetifyConfigDir(), "Extensions");
  let installedExtensions: any[] = [];
  try {
    const entries = await fs.readdir(extensionsDir);
    installedExtensions = await Promise.all(
      entries.map(async (entry) => {
        if (entry.includes(".meta.json")) {
          const metaData = JSON.parse(
            (
              await fs.readFile(path.join(extensionsDir, entry))
            ).toString(),
          ) as {
            authors?: {
              name: string;
              url: string;
            }[];
            description?: string;
            imageURL?: string;
            name: string;
            tags?: string[];
          };

          return metaData;
        }
        return null;
      }),
    );
  } catch (error) {
    console.error("Error reading extensions directory:", error);
  }

  return c.json(installedExtensions.filter((ext) => ext != null));
});

app.get("/checkInstallation", async (c) => {
  let spotifyPath: string;
  let alreadyPatchedPath: string;

  if (os.platform() === "win32") {
    spotifyPath = path.join(process.env.APPDATA!, "Spotify");
  } else if (os.platform() === "darwin") {
    spotifyPath = path.join(os.homedir(), "Library", "Application Support", "Spotify");
  } else {
    // For other Linux-like systems, you might need to adjust this
    spotifyPath = path.join(os.homedir(), ".config", "spotify");
  }

  alreadyPatchedPath = path.join(spotifyPath, ".spicetify");

  const spotifyInstalled = await fileExists(spotifyPath);
  const binaryExists = await fileExists(getSpicetifyExec());
  const configExists = await fileExists(getConfigFilePath());
  const alreadyPatched = await fileExists(alreadyPatchedPath);
  const spicetifyInstalled = binaryExists && configExists;

  const installStatus: InstallStatus = {
    spotify: spotifyInstalled,
    spicetify: spicetifyInstalled,
    patched: alreadyPatched,
  };

  return c.json(installStatus);
});

app.post("/installSpicetifyBinary", async (c) => {
  try {
    const spicetifyxDir = getSpicetifyxDir();

    if (await fileExists(getSpicetifyExec())) {
      return c.json({ message: "Spicetify binary already installed, skipping" });
    }

    const archiveURL = await getLatestSpicetifyReleaseArchive();
    if (!archiveURL) {
      return c.json({ error: "No suitable release archive found for this platform" }, 404);
    }

    const resp = await httpGet(archiveURL);
    if (!resp.ok) {
      return c.json({ error: `Download failed: ${resp.statusText}` }, resp.status);
    }

    await fs.mkdir(spicetifyxDir, { recursive: true });

    const data = Buffer.from(await resp.arrayBuffer());

    if (archiveURL.endsWith(".zip")) {
      await extractZipToDir(data, spicetifyxDir, false);
    } else if (archiveURL.endsWith(".tar.gz")) {
      await extractTarGz(data, spicetifyxDir);
    } else {
      return c.json({ error: "Unsupported archive format" }, 400);
    }

    return c.json({ message: "Spicetify binary installed successfully" });
  } catch (error: any) {
    console.error("Error installing Spicetify binary:", error);
    return c.json({ error: error.message || "Failed to install Spicetify binary" }, 500);
  }
});

app.post("/installMarketplaceExtension", async (c) => {
  try {
    const { extensionURL, filename, meta } = await c.req.json();

    const extDir = getExtensionsDir();
    await fs.mkdir(extDir, { recursive: true });

    const content = await downloadText(extensionURL);

    const destPath = path.join(extDir, filename);
    await fs.writeFile(destPath, content);

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(destPath + ".meta.json", JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "extensions", filename], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "Extension installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace extension:", error);
    return c.json({ error: error.message || "Failed to install marketplace extension" }, 500);
  }
});

app.post("/installMarketplaceTheme", async (c) => {
  try {
    const { themeID, cssURL, schemesURL, include, meta } = await c.req.json();

    const themesDir = getThemesDir();
    const destThemeDir = path.join(themesDir, themeID);
    await fs.mkdir(destThemeDir, { recursive: true });

    const cssContent = await downloadText(cssURL);
    await fs.writeFile(path.join(destThemeDir, "user.css"), cssContent);

    if (schemesURL) {
      try {
        const schemesContent = await downloadText(schemesURL);
        await fs.writeFile(path.join(destThemeDir, "color.ini"), schemesContent);
      } catch (error) {
        console.warn(`Could not download schemes from ${schemesURL}:`, error);
      }
    }

    if (include && Array.isArray(include)) {
      for (const incURL of include) {
        if (incURL.startsWith("http")) {
          try {
            const parts = incURL.split("/");
            const filename = parts[parts.length - 1];
            const content = await downloadText(incURL);
            await fs.writeFile(path.join(destThemeDir, filename), content);
          } catch (error) {
            console.warn(`Could not download include file from ${incURL}:`, error);
          }
        }
      }
    }

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(path.join(destThemeDir, "theme.meta.json"), JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";

    await spicetifyCommand(execPath, ["config", "current_theme", themeID], (data) => {
      spicetifyCommandOutput += data;
    });

    let firstScheme = "";
    const colorIniPath = path.join(destThemeDir, "color.ini");
    if (await fileExists(colorIniPath)) {
      const data = await fs.readFile(colorIniPath, "utf-8");
      const match = data.match(/^\[(.+)\]/m);
      if (match && match[1]) {
        firstScheme = match[1].trim();
      }
    }
    if (firstScheme) {
      await spicetifyCommand(execPath, ["config", "color_scheme", firstScheme], (data) => {
        spicetifyCommandOutput += data;
      });
    }

    return c.json({ message: "Theme installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace theme:", error);
    return c.json({ error: error.message || "Failed to install marketplace theme" }, 500);
  }
});

import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  fileExists,
  getSpicetifyExec,
  getSpicetifyConfigDir,
  getConfigFilePath,
  getSpicetifyxDir,
  getLatestSpicetifyReleaseArchive,
  httpGet,
  downloadText,
  extractZipToDir,
  extractTarGz,
  getExtensionsDir,
  getThemesDir,
  getCustomAppsDir, // Import this
  spicetifyCommand,
} from "./src/utils";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

// Define the InstallStatus type
type InstallStatus = {
  spotify: boolean;
  spicetify: boolean;
  patched: boolean;
};

type MarketplaceMeta = {
  name: string;
  description?: string;
  imageURL?: string;
  authors?: {
    name: string;
    url: string;
  }[];
  tags?: string[];
  stars?: number;
  subdir?: string;
};

app.get("/extensions", async (c) => {
  const extensionsDir = path.join(getSpicetifyConfigDir(), "Extensions");
  let installedExtensions: any[] = [];
  try {
    const entries = await fs.readdir(extensionsDir);
    installedExtensions = await Promise.all(
      entries.map(async (entry) => {
        if (entry.includes(".meta.json")) {
          const metaData = JSON.parse(
            (
              await fs.readFile(path.join(extensionsDir, entry))
            ).toString(),
          ) as {
            authors?: {
              name: string;
              url: string;
            }[];
            description?: string;
            imageURL?: string;
            name: string;
            tags?: string[];
          };

          return metaData;
        }
        return null;
      }),
    );
  } catch (error) {
    console.error("Error reading extensions directory:", error);
  }

  return c.json(installedExtensions.filter((ext) => ext != null));
});

app.get("/checkInstallation", async (c) => {
  let spotifyPath: string;
  let alreadyPatchedPath: string;

  if (os.platform() === "win32") {
    spotifyPath = path.join(process.env.APPDATA!, "Spotify");
  } else if (os.platform() === "darwin") {
    spotifyPath = path.join(os.homedir(), "Library", "Application Support", "Spotify");
  } else {
    // For other Linux-like systems, you might need to adjust this
    spotifyPath = path.join(os.homedir(), ".config", "spotify");
  }

  alreadyPatchedPath = path.join(spotifyPath, ".spicetify");

  const spotifyInstalled = await fileExists(spotifyPath);
  const binaryExists = await fileExists(getSpicetifyExec());
  const configExists = await fileExists(getConfigFilePath());
  const alreadyPatched = await fileExists(alreadyPatchedPath);
  const spicetifyInstalled = binaryExists && configExists;

  const installStatus: InstallStatus = {
    spotify: spotifyInstalled,
    spicetify: spicetifyInstalled,
    patched: alreadyPatched,
  };

  return c.json(installStatus);
});

app.post("/installSpicetifyBinary", async (c) => {
  try {
    const spicetifyxDir = getSpicetifyxDir();

    if (await fileExists(getSpicetifyExec())) {
      return c.json({ message: "Spicetify binary already installed, skipping" });
    }

    const archiveURL = await getLatestSpicetifyReleaseArchive();
    if (!archiveURL) {
      return c.json({ error: "No suitable release archive found for this platform" }, 404);
    }

    const resp = await httpGet(archiveURL);
    if (!resp.ok) {
      return c.json({ error: `Download failed: ${resp.statusText}` }, resp.status);
    }

    await fs.mkdir(spicetifyxDir, { recursive: true });

    const data = Buffer.from(await resp.arrayBuffer());

    if (archiveURL.endsWith(".zip")) {
      await extractZipToDir(data, spicetifyxDir, false);
    } else if (archiveURL.endsWith(".tar.gz")) {
      await extractTarGz(data, spicetifyxDir);
    } else {
      return c.json({ error: "Unsupported archive format" }, 400);
    }

    return c.json({ message: "Spicetify binary installed successfully" });
  } catch (error: any) {
    console.error("Error installing Spicetify binary:", error);
    return c.json({ error: error.message || "Failed to install Spicetify binary" }, 500);
  }
});

app.post("/installMarketplaceExtension", async (c) => {
  try {
    const { extensionURL, filename, meta } = await c.req.json();

    const extDir = getExtensionsDir();
    await fs.mkdir(extDir, { recursive: true });

    const content = await downloadText(extensionURL);

    const destPath = path.join(extDir, filename);
    await fs.writeFile(destPath, content);

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(destPath + ".meta.json", JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "extensions", filename], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "Extension installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace extension:", error);
    return c.json({ error: error.message || "Failed to install marketplace extension" }, 500);
  }
});

app.post("/installMarketplaceTheme", async (c) => {
  try {
    const { themeID, cssURL, schemesURL, include, meta } = await c.req.json();

    const themesDir = getThemesDir();
    const destThemeDir = path.join(themesDir, themeID);
    await fs.mkdir(destThemeDir, { recursive: true });

    const cssContent = await downloadText(cssURL);
    await fs.writeFile(path.join(destThemeDir, "user.css"), cssContent);

    if (schemesURL) {
      try {
        const schemesContent = await downloadText(schemesURL);
        await fs.writeFile(path.join(destThemeDir, "color.ini"), schemesContent);
      } catch (error) {
        console.warn(`Could not download schemes from ${schemesURL}:`, error);
      }
    }

    if (include && Array.isArray(include)) {
      for (const incURL of include) {
        if (incURL.startsWith("http")) {
          try {
            const parts = incURL.split("/");
            const filename = parts[parts.length - 1];
            const content = await downloadText(incURL);
            await fs.writeFile(path.join(destThemeDir, filename), content);
          } catch (error) {
            console.warn(`Could not download include file from ${incURL}:`, error);
          }
        }
      }
    }

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(path.join(destThemeDir, "theme.meta.json"), JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";

    await spicetifyCommand(execPath, ["config", "current_theme", themeID], (data) => {
      spicetifyCommandOutput += data;
    });

    let firstScheme = "";
    const colorIniPath = path.join(destThemeDir, "color.ini");
    if (await fileExists(colorIniPath)) {
      const data = await fs.readFile(colorIniPath, "utf-8");
      const match = data.match(/^\[(.+)\]/m);
      if (match && match[1]) {
        firstScheme = match[1].trim();
      }
    }
    if (firstScheme) {
      await spicetifyCommand(execPath, ["config", "color_scheme", firstScheme], (data) => {
        spicetifyCommandOutput += data;
      });
    }

    return c.json({ message: "Theme installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace theme:", error);
    return c.json({ error: error.message || "Failed to install marketplace theme" }, 500);
  }
});

app.post("/installMarketplaceApp", async (c) => {
  try {
    const { user, repo, appName, branch, meta } = await c.req.json();

    const ghHeaders = { "User-Agent": "SpicetifyX-Manager" };

    let archiveURL = "";
    let subdir = meta && meta.subdir ? meta.subdir : "";

    // --- Logic for finding release asset or zipball URL (similar to Go code) ---
    const releasesURL = `https://api.github.com/repos/${user}/${repo}/releases?per_page=30`;
    const releasesResp = await httpGet(releasesURL, ghHeaders);

    if (releasesResp.ok && releasesResp.status === 200) {
      const releases = await releasesResp.json();
      const needle = subdir.toLowerCase();

      for (const release of releases) {
        for (const asset of release.assets || []) {
          if (!asset.name.endsWith(".zip")) {
            continue;
          }
          const assetLow = asset.name.toLowerCase();
          if (!needle || assetLow.includes(needle)) {
            archiveURL = asset.browser_download_url;
            subdir = ""; // release zip is app-specific; no hoisting needed
            break;
          }
        }
        if (archiveURL) break;
      }

      if (!archiveURL && releases.length > 0) {
        archiveURL = releases[0].zipball_url;
      }
    }
    // --- End of logic for finding release asset or zipball URL ---

    if (!archiveURL) {
      const b = branch || "main";
      archiveURL = `https://api.github.com/repos/${user}/${repo}/zipball/${b}`;
    }

    const resp = await httpGet(archiveURL, ghHeaders);
    if (!resp.ok) {
      return c.json({ error: `Failed to download archive: ${resp.statusText}` }, resp.status);
    }
    const data = Buffer.from(await resp.arrayBuffer());

    const customAppsDir = getCustomAppsDir();
    const destDir = path.join(customAppsDir, appName);
    await fs.mkdir(destDir, { recursive: true });

    await extractZipToDir(data, destDir, true); // Assuming stripTopDir is always true for apps from zipball

    // Hoisting logic (similar to Go code)
    if (subdir) {
      const subPath = path.join(destDir, subdir);
      const subPathStat = await fs.stat(subPath);

      if (subPathStat.isDirectory()) {
        const entries = await fs.readdir(subPath);
        const movedNames: { [key: string]: boolean } = {};
        for (const entry of entries) {
          movedNames[entry] = true;
          await fs.rename(path.join(subPath, entry), path.join(destDir, entry));
        }

        const topEntries = await fs.readdir(destDir);
        for (const entry of topEntries) {
          if (!movedNames[entry] && entry !== subdir) { // Don't remove the subdir itself until after all contents are moved
            await fs.rm(path.join(destDir, entry), { recursive: true, force: true });
          }
        }
         await fs.rm(subPath, { recursive: true, force: true }); // Remove the empty subdir
      }
    }

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(path.join(destDir, "app.meta.json"), JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "custom_apps", appName], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "App installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace app:", error);
    return c.json({ error: error.message || "Failed to install marketplace app" }, 500);
  }
});

import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import {
  fileExists,
  getSpicetifyExec,
  getSpicetifyConfigDir,
  getConfigFilePath,
  getSpicetifyxDir,
  getLatestSpicetifyReleaseArchive,
  httpGet,
  downloadText,
  extractZipToDir,
  extractTarGz,
  getExtensionsDir,
  getThemesDir,
  getCustomAppsDir,
  spicetifyCommand,
} from "./src/utils";

import DiscordRPCService from "./src/discordService"; // Import the DiscordRPCService

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

// Define the InstallStatus type
type InstallStatus = {
  spotify: boolean;
  spicetify: boolean;
  patched: boolean;
};

type MarketplaceMeta = {
  name: string;
  description?: string;
  imageURL?: string;
  authors?: {
    name: string;
    url: string;
  }[];
  tags?: string[];
  stars?: number;
  subdir?: string;
};

const discordRpcService = new DiscordRPCService("1475108123336249490"); // Initialize DiscordRPCService

app.get("/extensions", async (c) => {
  const extensionsDir = path.join(getSpicetifyConfigDir(), "Extensions");
  let installedExtensions: any[] = [];
  try {
    const entries = await fs.readdir(extensionsDir);
    installedExtensions = await Promise.all(
      entries.map(async (entry) => {
        if (entry.includes(".meta.json")) {
          const metaData = JSON.parse(
            (
              await fs.readFile(path.join(extensionsDir, entry))
            ).toString(),
          ) as {
            authors?: {
              name: string;
              url: string;
            }[];
            description?: string;
            imageURL?: string;
            name: string;
            tags?: string[];
          };

          return metaData;
        }
        return null;
      }),
    );
  } catch (error) {
    console.error("Error reading extensions directory:", error);
  }

  return c.json(installedExtensions.filter((ext) => ext != null));
});

app.get("/checkInstallation", async (c) => {
  let spotifyPath: string;
  let alreadyPatchedPath: string;

  if (os.platform() === "win32") {
    spotifyPath = path.join(process.env.APPDATA!, "Spotify");
  } else if (os.platform() === "darwin") {
    spotifyPath = path.join(os.homedir(), "Library", "Application Support", "Spotify");
  } else {
    // For other Linux-like systems, you might need to adjust this
    spotifyPath = path.join(os.homedir(), ".config", "spotify");
  }

  alreadyPatchedPath = path.join(spotifyPath, ".spicetify");

  const spotifyInstalled = await fileExists(spotifyPath);
  const binaryExists = await fileExists(getSpicetifyExec());
  const configExists = await fileExists(getConfigFilePath());
  const alreadyPatched = await fileExists(alreadyPatchedPath);
  const spicetifyInstalled = binaryExists && configExists;

  const installStatus: InstallStatus = {
    spotify: spotifyInstalled,
    spicetify: spicetifyInstalled,
    patched: alreadyPatched,
  };

  return c.json(installStatus);
});

app.post("/installSpicetifyBinary", async (c) => {
  try {
    const spicetifyxDir = getSpicetifyxDir();

    if (await fileExists(getSpicetifyExec())) {
      return c.json({ message: "Spicetify binary already installed, skipping" });
    }

    const archiveURL = await getLatestSpicetifyReleaseArchive();
    if (!archiveURL) {
      return c.json({ error: "No suitable release archive found for this platform" }, 404);
    }

    const resp = await httpGet(archiveURL);
    if (!resp.ok) {
      return c.json({ error: `Download failed: ${resp.statusText}` }, resp.status);
    }

    await fs.mkdir(spicetifyxDir, { recursive: true });

    const data = Buffer.from(await resp.arrayBuffer());

    if (archiveURL.endsWith(".zip")) {
      await extractZipToDir(data, spicetifyxDir, false);
    } else if (archiveURL.endsWith(".tar.gz")) {
      await extractTarGz(data, spicetifyxDir);
    } else {
      return c.json({ error: "Unsupported archive format" }, 400);
    }

    return c.json({ message: "Spicetify binary installed successfully" });
  } catch (error: any) {
    console.error("Error installing Spicetify binary:", error);
    return c.json({ error: error.message || "Failed to install Spicetify binary" }, 500);
  }
});

app.post("/installMarketplaceExtension", async (c) => {
  try {
    const { extensionURL, filename, meta } = await c.req.json();

    const extDir = getExtensionsDir();
    await fs.mkdir(extDir, { recursive: true });

    const content = await downloadText(extensionURL);

    const destPath = path.join(extDir, filename);
    await fs.writeFile(destPath, content);

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(destPath + ".meta.json", JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "extensions", filename], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "Extension installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace extension:", error);
    return c.json({ error: error.message || "Failed to install marketplace extension" }, 500);
  }
});

app.post("/installMarketplaceTheme", async (c) => {
  try {
    const { themeID, cssURL, schemesURL, include, meta } = await c.req.json();

    const themesDir = getThemesDir();
    const destThemeDir = path.join(themesDir, themeID);
    await fs.mkdir(destThemeDir, { recursive: true });

    const cssContent = await downloadText(cssURL);
    await fs.writeFile(path.join(destThemeDir, "user.css"), cssContent);

    if (schemesURL) {
      try {
        const schemesContent = await downloadText(schemesURL);
        await fs.writeFile(path.join(destThemeDir, "color.ini"), schemesContent);
      } catch (error) {
        console.warn(`Could not download schemes from ${schemesURL}:`, error);
      }
    }

    if (include && Array.isArray(include)) {
      for (const incURL of include) {
        if (incURL.startsWith("http")) {
          try {
            const parts = incURL.split("/");
            const filename = parts[parts.length - 1];
            const content = await downloadText(incURL);
            await fs.writeFile(path.join(destThemeDir, filename), content);
          } catch (error) {
            console.warn(`Could not download include file from ${incURL}:`, error);
          }
        }
      }
    }

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(path.join(destThemeDir, "theme.meta.json"), JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";

    await spicetifyCommand(execPath, ["config", "current_theme", themeID], (data) => {
      spicetifyCommandOutput += data;
    });

    let firstScheme = "";
    const colorIniPath = path.join(destThemeDir, "color.ini");
    if (await fileExists(colorIniPath)) {
      const data = await fs.readFile(colorIniPath, "utf-8");
      const match = data.match(/^\[(.+)\]/m);
      if (match && match[1]) {
        firstScheme = match[1].trim();
      }
    }
    if (firstScheme) {
      await spicetifyCommand(execPath, ["config", "color_scheme", firstScheme], (data) => {
        spicetifyCommandOutput += data;
      });
    }

    return c.json({ message: "Theme installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace theme:", error);
    return c.json({ error: error.message || "Failed to install marketplace theme" }, 500);
  }
});

app.post("/installMarketplaceApp", async (c) => {
  try {
    const { user, repo, appName, branch, meta } = await c.req.json();

    const ghHeaders = { "User-Agent": "SpicetifyX-Manager" };

    let archiveURL = "";
    let subdir = meta && meta.subdir ? meta.subdir : "";

    // --- Logic for finding release asset or zipball URL (similar to Go code) ---
    const releasesURL = `https://api.github.com/repos/${user}/${repo}/releases?per_page=30`;
    const releasesResp = await httpGet(releasesURL, ghHeaders);

    if (releasesResp.ok && releasesResp.status === 200) {
      const releases = await releasesResp.json();
      const needle = subdir.toLowerCase();

      for (const release of releases) {
        for (const asset of release.assets || []) {
          if (!asset.name.endsWith(".zip")) {
            continue;
          }
          const assetLow = asset.name.toLowerCase();
          if (!needle || assetLow.includes(needle)) {
            archiveURL = asset.browser_download_url;
            subdir = ""; // release zip is app-specific; no hoisting needed
            break;
          }
        }
        if (archiveURL) break;
      }

      if (!archiveURL && releases.length > 0) {
        archiveURL = releases[0].zipball_url;
      }
    }
    // --- End of logic for finding release asset or zipball URL ---

    if (!archiveURL) {
      const b = branch || "main";
      archiveURL = `https://api.github.com/repos/${user}/${repo}/zipball/${b}`;
    }

    const resp = await httpGet(archiveURL, ghHeaders);
    if (!resp.ok) {
      return c.json({ error: `Failed to download archive: ${resp.statusText}` }, resp.status);
    }
    const data = Buffer.from(await resp.arrayBuffer());

    const customAppsDir = getCustomAppsDir();
    const destDir = path.join(customAppsDir, appName);
    await fs.mkdir(destDir, { recursive: true });

    await extractZipToDir(data, destDir, true); // Assuming stripTopDir is always true for apps from zipball

    // Hoisting logic (similar to Go code)
    if (subdir) {
      const subPath = path.join(destDir, subdir);
      const subPathStat = await fs.stat(subPath);

      if (subPathStat.isDirectory()) {
        const entries = await fs.readdir(subPath);
        const movedNames: { [key: string]: boolean } = {};
        for (const entry of entries) {
          movedNames[entry] = true;
          await fs.rename(path.join(subPath, entry), path.join(destDir, entry));
        }

        const topEntries = await fs.readdir(destDir);
        for (const entry of topEntries) {
          if (!movedNames[entry] && entry !== subdir) { // Don't remove the subdir itself until after all contents are moved
            await fs.rm(path.join(destDir, entry), { recursive: true, force: true });
          }
        }
         await fs.rm(subPath, { recursive: true, force: true }); // Remove the empty subdir
      }
    }

    if (meta) {
      const metaData = JSON.parse(meta);
      await fs.writeFile(path.join(destDir, "app.meta.json"), JSON.stringify(metaData, null, 2));
    }

    const execPath = getSpicetifyExec();
    let spicetifyCommandOutput = "";
    await spicetifyCommand(execPath, ["config", "custom_apps", appName], (data) => {
      spicetifyCommandOutput += data;
    });

    return c.json({ message: "App installed successfully", output: spicetifyCommandOutput });
  } catch (error: any) {
    console.error("Error installing marketplace app:", error);
    return c.json({ error: error.message || "Failed to install marketplace app" }, 500);
  }
});

// Discord RPC Endpoints
app.post("/discord/connect", async (c) => {
  try {
    const { clientId } = await c.req.json();
    if (clientId) {
        // Potentially update client ID if it's dynamic
        // For now, it's hardcoded in the service
    }
    const connected = await discordRpcService.connect();
    if (connected) {
      return c.json({ message: "Discord RPC connected." });
    } else {
      return c.json({ error: "Failed to connect to Discord RPC." }, 500);
    }
  } catch (error: any) {
    console.error("Error connecting to Discord RPC:", error);
    return c.json({ error: error.message || "Failed to connect to Discord RPC." }, 500);
  }
});

app.post("/discord/disconnect", async (c) => {
  try {
    await discordRpcService.disconnect();
    return c.json({ message: "Discord RPC disconnected." });
  } catch (error: any) {
    console.error("Error disconnecting from Discord RPC:", error);
    return c.json({ error: error.message || "Failed to disconnect from Discord RPC." }, 500);
  }
});

app.post("/discord/setActivity", async (c) => {
  try {
    const activity = await c.req.json();
    await discordRpcService.setActivity(activity);
    return c.json({ message: "Discord RPC activity set." });
  } catch (error: any) {
    console.error("Error setting Discord RPC activity:", error);
    return c.json({ error: error.message || "Failed to set Discord RPC activity." }, 500);
  }
});

app.post("/discord/clearActivity", async (c) => {
  try {
    await discordRpcService.clearActivity();
    return c.json({ message: "Discord RPC activity cleared." });
  } catch (error: any) {
    console.error("Error clearing Discord RPC activity:", error);
    return c.json({ error: error.message || "Failed to clear Discord RPC activity." }, 500);
  }
});

app.get("/discord/status", async (c) => {
  try {
    const isConnected = discordRpcService.isRpcConnected();
    return c.json({ connected: isConnected });
  } catch (error: any) {
    console.error("Error getting Discord RPC status:", error);
    return c.json({ error: error.message || "Failed to get Discord RPC status." }, 500);
  }
});

export default app;
