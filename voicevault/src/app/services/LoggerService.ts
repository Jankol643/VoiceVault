// services/LoggerService.ts

import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, WriteStream } from 'fs';

export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    FATAL = 'FATAL'
}

export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    service: string;
    message: string;
    data?: any;
    error?: Error;
    correlationId?: string;
    proxy?: { host: string; port: number; protocol?: string };
    requestId?: string;
}

export interface LoggerConfig {
    logDir: string;
    logLevel: LogLevel;
    maxFileSize: number;
    maxFiles: number;
    enableConsole: boolean;
    enableFile: boolean;
    serviceName: string;
}

export class LoggerService {
    private static instance: LoggerService;
    private config: LoggerConfig;
    private logStream: WriteStream | null = null;
    private currentLogFile: string = '';
    private currentFileSize: number = 0;

    private constructor(config?: Partial<LoggerConfig>) {
        this.config = {
            logDir: path.join(process.cwd(), 'logs'),
            logLevel: process.env.LOG_LEVEL as LogLevel || LogLevel.INFO,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            maxFiles: 10,
            enableConsole: true,
            enableFile: true,
            serviceName: 'ProxyRotationService',
            ...config
        };

        this.initializeLogging().catch(console.error);
    }

    public static getInstance(config?: Partial<LoggerConfig>): LoggerService {
        if (!LoggerService.instance) {
            LoggerService.instance = new LoggerService(config);
        }
        return LoggerService.instance;
    }

    private async initializeLogging(): Promise<void> {
        if (!this.config.enableFile) return;

        try {
            await fs.mkdir(this.config.logDir, { recursive: true });
            await this.rotateLogFileIfNeeded();
        } catch (error) {
            console.error('Failed to initialize logging:', error);
        }
    }

    private getLogLevelPriority(level: LogLevel): number {
        const priorities = {
            [LogLevel.DEBUG]: 0,
            [LogLevel.INFO]: 1,
            [LogLevel.WARN]: 2,
            [LogLevel.ERROR]: 3,
            [LogLevel.FATAL]: 4
        };
        return priorities[level];
    }

    private shouldLog(level: LogLevel): boolean {
        const currentPriority = this.getLogLevelPriority(this.config.logLevel);
        const messagePriority = this.getLogLevelPriority(level);
        return messagePriority >= currentPriority;
    }

    private async rotateLogFileIfNeeded(): Promise<void> {
        if (!this.config.enableFile) return;

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const newLogFile = path.join(this.config.logDir, `${dateStr}.log`);

        if (newLogFile !== this.currentLogFile || this.currentFileSize >= this.config.maxFileSize) {
            await this.closeLogStream();
            await this.cleanupOldLogs();

            this.currentLogFile = newLogFile;
            this.currentFileSize = 0;

            try {
                const stats = await fs.stat(newLogFile).catch(() => null);
                if (stats) {
                    this.currentFileSize = stats.size;
                }
            } catch (error) {
                // File doesn't exist, that's fine
            }

            this.logStream = createWriteStream(this.currentLogFile, {
                flags: 'a',
                encoding: 'utf-8'
            });
        }
    }

    private async cleanupOldLogs(): Promise<void> {
        try {
            const files = await fs.readdir(this.config.logDir);
            const logFiles = files
                .filter(file => file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.config.logDir, file),
                    time: fs.stat(path.join(this.config.logDir, file)).then(stat => stat.mtime.getTime())
                }));

            const resolvedFiles = await Promise.all(
                logFiles.map(async file => ({
                    ...file,
                    time: await file.time
                }))
            );

            resolvedFiles.sort((a, b) => b.time - a.time);

            for (let i = this.config.maxFiles - 1; i < resolvedFiles.length; i++) {
                await fs.unlink(resolvedFiles[i].path);
            }
        } catch (error) {
            // Don't throw error during cleanup
        }
    }

    private async closeLogStream(): Promise<void> {
        if (this.logStream) {
            return new Promise((resolve) => {
                this.logStream!.end(() => {
                    this.logStream = null;
                    resolve();
                });
            });
        }
    }

    private formatLogEntry(entry: LogEntry): string {
        const timestamp = entry.timestamp.toISOString();
        const level = entry.level.padEnd(5);
        const service = entry.service;
        const correlation = entry.correlationId ? `[${entry.correlationId}]` : '';
        const requestId = entry.requestId ? `{${entry.requestId}}` : '';
        const proxyInfo = entry.proxy ?
            `[${entry.proxy.host}:${entry.proxy.port}${entry.proxy.protocol ? `/${entry.proxy.protocol}` : ''}]` : '';

        let logLine = `${timestamp} ${level} ${service}${correlation}${requestId}${proxyInfo} ${entry.message}`;

        if (entry.data) {
            try {
                logLine += ` | Data: ${JSON.stringify(entry.data, null, 0)}`;
            } catch {
                logLine += ` | Data: [Circular or non-serializable]`;
            }
        }

        if (entry.error) {
            logLine += ` | Error: ${entry.error.message}`;
            if (entry.error.stack) {
                logLine += `\n${entry.error.stack}`;
            }
        }

        return logLine + '\n';
    }

    public log(entry: LogEntry): void {
        if (!this.shouldLog(entry.level)) return;

        const formattedLog = this.formatLogEntry(entry);

        // Console output
        if (this.config.enableConsole) {
            const colors = {
                [LogLevel.DEBUG]: '\x1b[36m', // Cyan
                [LogLevel.INFO]: '\x1b[32m',  // Green
                [LogLevel.WARN]: '\x1b[33m',  // Yellow
                [LogLevel.ERROR]: '\x1b[31m', // Red
                [LogLevel.FATAL]: '\x1b[35m', // Magenta
            };
            const reset = '\x1b[0m';
            console.log(`${colors[entry.level]}${formattedLog.trim()}${reset}`);
        }

        // File output
        if (this.config.enableFile && this.logStream) {
            this.logStream.write(formattedLog);
            this.currentFileSize += Buffer.byteLength(formattedLog, 'utf-8');

            // Check if we need to rotate
            if (this.currentFileSize >= this.config.maxFileSize) {
                this.rotateLogFileIfNeeded().catch(console.error);
            }
        }
    }

    public debug(message: string, data?: any, context?: Partial<LogEntry>): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.DEBUG,
            service: this.config.serviceName,
            message,
            data,
            ...context
        });
    }

    public info(message: string, data?: any, context?: Partial<LogEntry>): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.INFO,
            service: this.config.serviceName,
            message,
            data,
            ...context
        });
    }

    public warn(message: string, data?: any, context?: Partial<LogEntry>): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.WARN,
            service: this.config.serviceName,
            message,
            data,
            ...context
        });
    }

    public error(message: string, error?: Error, data?: any, context?: Partial<LogEntry>): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.ERROR,
            service: this.config.serviceName,
            message,
            error,
            data,
            ...context
        });
    }

    public fatal(message: string, error?: Error, data?: any, context?: Partial<LogEntry>): void {
        this.log({
            timestamp: new Date(),
            level: LogLevel.FATAL,
            service: this.config.serviceName,
            message,
            error,
            data,
            ...context
        });
    }

    public async flush(): Promise<void> {
        await this.closeLogStream();
    }

    public async cleanup(): Promise<void> {
        await this.flush();
    }
}

// Export singleton accessor
export const logger = LoggerService.getInstance();