import { db } from '../db';
import { promptRunLogs } from '@shared/schema';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogMeta {
  [key: string]: unknown;
  stack?: string;
}

export class RunLogger {
  private promptRunId: string;

  constructor(promptRunId: string) {
    this.promptRunId = promptRunId;
  }

  async info(message: string, meta?: LogMeta): Promise<void> {
    await this.log('info', message, meta);
  }

  async warn(message: string, meta?: LogMeta): Promise<void> {
    await this.log('warn', message, meta);
  }

  async error(message: string, errorOrMeta?: Error | LogMeta): Promise<void> {
    let meta: LogMeta | undefined;
    
    if (errorOrMeta instanceof Error) {
      meta = {
        errorName: errorOrMeta.name,
        errorMessage: errorOrMeta.message,
        stack: errorOrMeta.stack,
      };
    } else {
      meta = errorOrMeta;
    }
    
    await this.log('error', message, meta);
  }

  private async log(level: LogLevel, message: string, meta?: LogMeta): Promise<void> {
    try {
      await db.insert(promptRunLogs).values({
        promptRunId: this.promptRunId,
        level,
        message,
        meta: meta ?? null,
      });
    } catch (err) {
      console.error(`[RunLogger] Failed to write log for run ${this.promptRunId}:`, err);
    }
  }

  static forRun(promptRunId: string): RunLogger {
    return new RunLogger(promptRunId);
  }
}
