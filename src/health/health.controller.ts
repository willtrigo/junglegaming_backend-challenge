import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { DatabaseService } from "../database/database.service";

interface HealthStatus {
  readonly status: "ok";
}

@Controller("health")
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get("live")
  live(): HealthStatus {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<HealthStatus> {
    try {
      await this.database.ping();
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable", dependency: "postgres" });
    }
    return { status: "ok" };
  }
}
