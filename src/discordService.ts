import { Client } from "discord-rpc";

type Activity = {
  details?: string;
  state?: string;
  largeImageKey?: string;
  largeImageText?: string;
  smallImageKey?: string;
  smallImageText?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  instance?: boolean;
};

class DiscordRPCService {
  private client: Client | null = null;
  private clientId: string;
  private isConnected: boolean = false;
  private activityTimeout: NodeJS.Timeout | null = null;
  private currentActivity: Activity | null = null;

  constructor(clientId: string) {
    this.clientId = clientId;
  }

  public async connect(): Promise<boolean> {
    if (this.isConnected) {
      console.log("Discord RPC already connected.");
      return true;
    }

    if (!this.client) {
      this.client = new Client({ transport: "ipc" });

      this.client.on("ready", () => {
        this.isConnected = true;
        console.log("Discord RPC connected!");
        if (this.currentActivity) {
          this.setActivity(this.currentActivity);
        }
      });

      this.client.on("disconnected", () => {
        this.isConnected = false;
        console.log("Discord RPC disconnected.");
        this.clearActivity();
        this.client = null; // Reset client on disconnect
      });

      // Attempt to connect
      try {
        await this.client.login({ clientId: this.clientId });
        return true;
      } catch (error) {
        console.error("Failed to connect to Discord RPC:", error);
        this.isConnected = false;
        this.client = null;
        return false;
      }
    }
    return false; // Should not reach here if this.client is null or already connected
  }

  public async disconnect(): Promise<void> {
    if (this.isConnected && this.client) {
      await this.client.destroy();
      this.isConnected = false;
      this.clearActivity();
      this.client = null;
      console.log("Discord RPC disconnected successfully.");
    }
  }

  public async setActivity(activity: Activity): Promise<void> {
    this.currentActivity = activity;
    if (this.isConnected && this.client) {
      try {
        await this.client.setActivity(activity);
        console.log("Discord RPC activity set:", activity);
      } catch (error) {
        console.error("Failed to set Discord RPC activity:", error);
      }
    } else {
      console.warn("Discord RPC not connected. Activity will be set on connection.");
    }
  }

  public async clearActivity(): Promise<void> {
    this.currentActivity = null;
    if (this.isConnected && this.client) {
      try {
        await this.client.clearActivity();
        console.log("Discord RPC activity cleared.");
      } catch (error) {
        console.error("Failed to clear Discord RPC activity:", error);
      }
    }
  }

  public isRpcConnected(): boolean {
    return this.isConnected;
  }
}

export default DiscordRPCService;
