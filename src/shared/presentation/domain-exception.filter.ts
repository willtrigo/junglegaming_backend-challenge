// biome-ignore lint/style/useImportType: NestJS DI needs the runtime class reference
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

import { DomainError } from "@/shared/domain/domain-error";
import {
  IdempotencyConflictError,
  PlayerWalletMismatchError,
  WalletNotFoundError,
} from "@/wagering/application/submit-wager-transaction.errors";
import { WalletAlreadyExistsError } from "@/wallets/application/create-wallet.use-case";

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
        issues: exception.issues,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response
        .status(status)
        .json(typeof body === "string" ? { statusCode: status, message: body } : body);
      return;
    }

    if (exception instanceof WalletNotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    if (
      exception instanceof WalletAlreadyExistsError ||
      exception instanceof IdempotencyConflictError ||
      exception instanceof PlayerWalletMismatchError
    ) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    if (exception instanceof DomainError) {
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  }
}
