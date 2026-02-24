import { Hono } from "hono";
import { cors } from "hono/cors";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';


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
  openURL,
} from "./src/utils";

import DiscordRPCService from "./src/discordService"; // Import the DiscordRPCService

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "*",
  }),
);

// Define types
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

interface AppSettings {
  discordRpc: boolean;
  closeToTray: boolean;
  checkUpdatesOnLaunch: boolean;
}

const DEFAULTS: AppSettings = {
  discordRpc: true,
  closeToTray: false,
  checkUpdatesOnLaunch: true,
};

// Initialize Discord RPC Service
const discordRpcService = new DiscordRPCService("1475108123336249490");

// Helper to read settings
async function readSettings(): Promise<AppSettings> {
  const settingsPath = path.join(getSpicetifyxDir(), "settings.json");
  if (await fileExists(settingsPath)) {
    const data = await fs.readFile(settingsPath, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(data) };
  }
  return DEFAULTS;
}

// Helper to write settings
async function writeSettings(settings: AppSettings): Promise<void> {
  const settingsPath = path.join(getSpicetifyxDir(), "settings.json");
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// Endpoints
app.get("/checkInstallation", async (c) => {
  let spotifyPath: string;
  let alreadyPatchedPath: string;

  if (os.platform() === "win32") {
    spotifyPath = path.join(process.env.APPDATA!, "Spotify");
  } else if (os.platform() === "darwin") {
    spotifyPath = path.join(os.homedir(), "Library", "Application Support", "Spotify");
  } else {
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


// Extensions Endpoints
app.get("/extensions", async (c) => {
    const extensionsDir = getExtensionsDir();
    let installedExtensions: any[] = [];
    try {
        const entries = await fs.readdir(extensionsDir);
        installedExtensions = await Promise.all(
            entries.map(async (entry) => {
                if (entry.endsWith(".js") && !entry.includes(".meta.json")) {
                    const metaFilePath = path.join(extensionsDir, entry + ".meta.json");
                    let metaData = {};
                    if (await fileExists(metaFilePath)) {
                        metaData = JSON.parse(await fs.readFile(metaFilePath, "utf-8"));
                    }
                    // Placeholder for isEnabled, needs actual Spicetify config parsing
                    return { id: entry, name: entry, addonFileName: entry, isEnabled: false, ...metaData };
                }
                return null;
            }),
        );
    } catch (error) {
        console.error("Error reading extensions directory:", error);
    }
    return c.json(installedExtensions.filter((ext) => ext != null));
});

app.post("/toggleExtension", async (c) => {
    try {
        const { addonFileName, enable } = await c.req.json();
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        const args = ["config", "extensions", enable ? "enable" : "disable", addonFileName];
        await spicetifyCommand(execPath, args, (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Extension toggled successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error toggling extension:", error);
        return c.json({ success: false, error: error.message || "Failed to toggle extension" }, 500);
    }
});

app.post("/deleteExtension", async (c) => {
    try {
        const { addonFileName } = await c.req.json();
        const extensionsDir = getExtensionsDir();
        await fs.unlink(path.join(extensionsDir, addonFileName));
        if (await fileExists(path.join(extensionsDir, addonFileName + ".meta.json"))) {
            await fs.unlink(path.join(extensionsDir, addonFileName + ".meta.json"));
        }
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        // Spicetify will automatically remove it from config if file is gone on next apply
        await spicetifyCommand(execPath, ["apply"], (data) => {
          spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Extension deleted successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error deleting extension:", error);
        return c.json({ success: false, error: error.message || "Failed to delete extension" }, 500);
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
      const metaData = typeof meta === 'string' ? JSON.parse(meta) : meta;
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


// Themes Endpoints
app.get("/themes", async (c) => {
    const themesDir = getThemesDir();
    let installedThemes: any[] = [];
    try {
        const entries = await fs.readdir(themesDir);
        installedThemes = await Promise.all(
            entries.map(async (entry) => {
                const themePath = path.join(themesDir, entry);
                if ((await fs.stat(themePath)).isDirectory()) {
                    const metaFilePath = path.join(themePath, "theme.meta.json");
                    let metaData = {};
                    if (await fileExists(metaFilePath)) {
                        metaData = JSON.parse(await fs.readFile(metaFilePath, "utf-8"));
                    }
                    // Placeholder for isActive, colorSchemes, activeColorScheme
                    return { id: entry, name: entry, isBundled: false, isActive: false, colorSchemes: ["Default"], activeColorScheme: "Default", ...metaData };
                }
                return null;
            }),
        );
    } catch (error) {
        console.error("Error reading themes directory:", error);
    }
    return c.json(installedThemes.filter((theme) => theme != null));
});

app.post("/applyTheme", async (c) => {
    try {
        const { themeId } = await c.req.json();
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["config", "current_theme", themeId], (data) => {
            spicetifyCommandOutput += data;
        });
        await spicetifyCommand(execPath, ["apply"], (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Theme applied successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error applying theme:", error);
        return c.json({ success: false, error: error.message || "Failed to apply theme" }, 500);
    }
});

app.post("/deleteTheme", async (c) => {
    try {
        const { themeId } = await c.req.json();
        const themesDir = getThemesDir();
        const themePath = path.join(themesDir, themeId);
        await fs.rm(themePath, { recursive: true, force: true });
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["apply"], (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Theme deleted successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error deleting theme:", error);
        return c.json({ success: false, error: error.message || "Failed to delete theme" }, 500);
    }
});

app.post("/setThemeColorScheme", async (c) => {
    try {
        const { themeId, colorScheme } = await c.req.json();
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["config", "color_scheme", colorScheme], (data) => {
            spicetifyCommandOutput += data;
        });
        await spicetifyCommand(execPath, ["apply"], (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Color scheme set successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error setting color scheme:", error);
        return c.json({ success: false, error: error.message || "Failed to set color scheme" }, 500);
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
      const metaData = typeof meta === 'string' ? JSON.parse(meta) : meta;
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


// Apps Endpoints
app.get("/apps", async (c) => {
    const customAppsDir = getCustomAppsDir();
    let installedApps: any[] = [];
    try {
        const entries = await fs.readdir(customAppsDir);
        installedApps = await Promise.all(
            entries.map(async (entry) => {
                const appPath = path.join(customAppsDir, entry);
                if ((await fs.stat(appPath)).isDirectory()) {
                    const metaFilePath = path.join(appPath, "app.meta.json");
                    let metaData = {};
                    if (await fileExists(metaFilePath)) {
                        metaData = JSON.parse(await fs.readFile(metaFilePath, "utf-8"));
                    }
                    // Placeholder for isEnabled
                    return { id: entry, name: entry, isEnabled: false, ...metaData };
                }
                return null;
            }),
        );
    } catch (error) {
        console.error("Error reading custom apps directory:", error);
    }
    return c.json(installedApps.filter((app) => app != null));
});

app.post("/toggleApp", async (c) => {
    try {
        const { appId, enable } = await c.req.json();
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        const args = ["config", "custom_apps", enable ? "enable" : "disable", appId];
        await spicetifyCommand(execPath, args, (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "App toggled successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error toggling app:", error);
        return c.json({ success: false, error: error.message || "Failed to toggle app" }, 500);
    }
});

app.post("/deleteApp", async (c) => {
    try {
        const { appId } = await c.req.json();
        const customAppsDir = getCustomAppsDir();
        const appPath = path.join(customAppsDir, appId);
        await fs.rm(appPath, { recursive: true, force: true });
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["apply"], (data) => {
          spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "App deleted successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error deleting app:", error);
        return c.json({ success: false, error: error.message || "Failed to delete app" }, 500);
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
      const metaData = typeof meta === 'string' ? JSON.parse(meta) : meta;
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


// Settings Endpoints
app.get("/settings", async (c) => {
    try {
        const settings = await readSettings();
        return c.json(settings);
    } catch (error: any) {
        console.error("Error reading settings:", error);
        return c.json({ error: error.message || "Failed to read settings" }, 500);
    }
});

app.post("/updateSettings", async (c) => {
    try {
        const newSettings = await c.req.json();
        const currentSettings = await readSettings();
        const updatedSettings = { ...currentSettings, ...newSettings };
        await writeSettings(updatedSettings);
        return c.json({ success: true, message: "Settings updated successfully" });
    } catch (error: any) {
        console.error("Error updating settings:", error);
        return c.json({ success: false, error: error.message || "Failed to update settings" }, 500);
    }
});

app.get("/appVersion", async (c) => {
    try {
        const packageJsonPath = path.join(dirname(fileURLToPath(import.meta.url)), '../package.json');
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        return c.json({ version: packageJson.version || "unknown" });
    } catch (error: any) {
        console.error("Error getting app version:", error);
        return c.json({ error: error.message || "Failed to get app version" }, 500);
    }
});

app.post("/openConfigFolder", async (c) => {
    try {
        const configDir = getSpicetifyConfigDir();
        await fs.mkdir(configDir, { recursive: true }); // Ensure directory exists
        const success = openURL(configDir); // Assuming openURL can handle directory paths
        if (success) {
            return c.json({ success: true, message: "Config folder opened" });
        } else {
            return c.json({ success: false, message: "Failed to open config folder" }, 500);
        }
    } catch (error: any) {
        console.error("Error opening config folder:", error);
        return c.json({ success: false, error: error.message || "Failed to open config folder" }, 500);
    }
});


// Spicetify Apply and Reset
app.post("/apply", async (c) => {
    try {
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["apply"], (data) => {
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Spicetify applied successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error applying Spicetify:", error);
        return c.json({ success: false, error: error.message || "Failed to apply Spicetify" }, 500);
    }
});

app.post("/reset", async (c) => {
    try {
        const execPath = getSpicetifyExec();
        let spicetifyCommandOutput = "";
        await spicetifyCommand(execPath, ["restore", "backup"], (data) => { // Assuming 'restore backup' is the equivalent of reset
            spicetifyCommandOutput += data;
        });
        return c.json({ success: true, message: "Spicetify reset successfully", output: spicetifyCommandOutput });
    } catch (error: any) {
        console.error("Error resetting Spicetify:", error);
        return c.json({ success: false, error: error.message || "Failed to reset Spicetify" }, 500);
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