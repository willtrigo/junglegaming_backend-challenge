export const APP_CONFIG = Symbol("APP_CONFIG");

export interface AppConfig {
  readonly port: number;
  readonly databaseUrl: string;
}

function requireEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = source[key];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadAppConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(requireEnv(source, "PORT"), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("Environment variable PORT must be a valid TCP port");
  }

  return {
    port,
    databaseUrl: requireEnv(source, "DATABASE_URL"),
  };
}
