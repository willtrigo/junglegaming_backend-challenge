// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import { EntityManager } from "@mikro-orm/postgresql";
import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";

interface HealthStatus {
  readonly status: "ok";
}

@Controller("health")
export class HealthController {
  constructor(private readonly em: EntityManager) {}

  @Get("live")
  live(): HealthStatus {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<HealthStatus> {
    try {
      await this.em.getConnection().execute("SELECT 1");
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        dependency: "postgres",
      });
    }
    return { status: "ok" };
  }
}
