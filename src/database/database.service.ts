import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Pool } from "pg";

import { APP_CONFIG, type AppConfig } from "../config/app-config";

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ connectionString: config.databaseUrl });
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
