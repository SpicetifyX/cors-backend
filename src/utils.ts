import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import * as yauzl from "yauzl";
import * as tar from "tar";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    return false;
  }
}

export function getSpicetifyxDir(): string {
  // Equivalent to Go's filepath.Join(os.UserHomeDir(), ".spicetify-manager")
  return path.join(os.homedir(), ".spicetify-manager");
}

export function getSpicetifyConfigDir(): string {
  // This needs to be adapted based on how Spicetify stores its config on different OS
  // For now, let's assume it's in APPDATA for Windows and ~/.config for Linux/macOS
  if (os.platform() === "win32") {
    return path.join(process.env.APPDATA!, "spicetify");
  } else {
    return path.join(os.homedir(), ".config", "spicetify");
  }
}

export function getSpicetifyExec(): string {
  const spicetifyxDir = getSpicetifyxDir();
  const binaryName = os.platform() === "win32" ? "spicetify.exe" : "spicetify";
  return path.join(spicetifyxDir, binaryName);
}

export function getConfigFilePath(): string {
  return path.join(getSpicetifyConfigDir(), "config.ini");
}

export function getExtensionsDir(): string {
  return path.join(getSpicetifyConfigDir(), "Extensions");
}

export function getCustomAppsDir(): string {
  return path.join(getSpicetifyConfigDir(), "CustomApps");
}

export function getThemesDir(): string {
  return path.join(getSpicetifyConfigDir(), "Themes");
}

export function getSettingsPath(): string {
  return path.join(getSpicetifyxDir(), "settings.json");
}

export function getAppPath(): string {
  // In a Node.js/Bun context, this would typically refer to the directory
  // where the main script is located. For now, let's use the current working directory.
  return process.cwd();
}

export function openURL(url: string): boolean {
  // This will open the URL in the default browser.
  // Requires the 'open' package or similar. For now, we'll just log it.
  // In a real application, you'd use a package like 'open' or 'opn'.
  console.log(`Attempting to open URL: ${url}`);
  return true;
}

export function spicetifyCommand(
  execPath: string,
  args: string[],
  onData: (data: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = `${execPath} ${args.join(" ")}`;
    const child = exec(command, (error, stdout, stderr) => {
      if (error) {
        onData(stderr);
        reject(error);
        return;
      }
      onData(stdout);
      resolve();
    });

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
  });
}

export async function httpGet(url: string, headers?: Record<string, string>): Promise<Response> {
  return fetch(url, { headers });
}

export async function downloadText(url: string): Promise<string> {
  const response = await httpGet(url);
  if (!response.ok) {
    throw new Error(`Failed to download text from ${url}: ${response.statusText}`);
  }
  return response.text();
}

export async function getLatestSpicetifyReleaseArchive(): Promise<string> {
  const githubAPIURL = "https://api.github.com/repos/spicetify/spicetify-cli/releases/latest";
  const response = await httpGet(githubAPIURL, { "User-Agent": "SpicetifyX-Manager" });

  if (!response.ok) {
    throw new Error(`Failed to fetch latest release: ${response.statusText}`);
  }

  const release = await response.json();
  const assets = release.assets;

  let archiveURL = "";
  const platform = os.platform();
  const arch = os.arch();

  for (const asset of assets) {
    const name: string = asset.name;
    if (name.includes("spicetify") && name.endsWith(".zip")) {
      if (
        (platform === "win32" && name.includes("windows")) ||
        (platform === "darwin" && name.includes("macos")) ||
        (platform === "linux" && name.includes("linux"))
      ) {
        if (
          (arch === "x64" && name.includes("x64")) ||
          (arch === "arm64" && name.includes("arm64")) ||
          (arch === "ia32" && name.includes("i386")) // For 32-bit systems
        ) {
          archiveURL = asset.browser_download_url;
          break;
        }
      }
    }
  }

  return archiveURL;
}

export function extractZipToDir(data: Buffer, destDir: string, stripTopDir: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(err);
        return;
      }

      if (!zipfile) {
        reject(new Error("Zipfile is undefined"));
        return;
      }

      let topDirName = "";
      let firstEntry = true;

      zipfile.on("entry", async (entry) => {
        if (/\/$/.test(entry.fileName)) {
          // Directory file names end with '/'.
          zipfile.readEntry();
        } else {
          // File entry
          if (firstEntry && stripTopDir) {
            const parts = entry.fileName.split("/");
            if (parts.length > 1) {
              topDirName = parts[0];
            }
            firstEntry = false;
          }

          let fileName = entry.fileName;
          if (stripTopDir && topDirName && fileName.startsWith(topDirName + "/")) {
            fileName = fileName.substring(topDirName.length + 1);
          }

          if (!fileName) {
            zipfile.readEntry();
            return;
          }

          const outputPath = path.join(destDir, fileName);
          await fs.mkdir(path.dirname(outputPath), { recursive: true });

          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
              reject(err);
              return;
            }

            if (!readStream) {
              reject(new Error("ReadStream is undefined"));
              return;
            }

            const writeStream = fs.createWriteStream(outputPath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
              zipfile.readEntry();
            });
            writeStream.on("error", reject);
          });
        }
      });

      zipfile.on("end", () => {
        resolve();
      });

      zipfile.on("error", reject);

      zipfile.readEntry();
    });
  });
}

export async function extractTarGz(data: Buffer, destDir: string): Promise<void> {
  const tempTarGzPath = path.join(os.tmpdir(), `temp-${Date.now()}.tar.gz`);
  await fs.writeFile(tempTarGzPath, data);

  try {
    await tar.x({
      file: tempTarGzPath,
      cwd: destDir,
      strip: 0, // No stripping by default, can be adjusted if needed
    });
  } finally {
    await fs.unlink(tempTarGzPath);
  }
}