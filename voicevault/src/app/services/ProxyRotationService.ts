// services/ProxyRotationService.ts

import fs from 'fs/promises';
import path from 'path';

export interface ProxyConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    protocol?: 'http' | 'https' | 'socks5';
    lastUsed?: Date;
    errorCount?: number;
    successCount?: number;
    isActive?: boolean;
}

export interface RateLimitConfig {
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
    maxConcurrentRequests: number;
    delayBetweenRequestsMs: number;
}

export interface RequestMetrics {
    timestamp: Date;
    proxy: ProxyConfig | { host: string; port: number };
    success: boolean;
    responseTime: number;
    statusCode?: number;
    error?: string;
}

export class ProxyRotationService {
    private proxies: ProxyConfig[] = [];
    private currentProxyIndex = 0;
    private requestQueue: Array<() => Promise<void>> = [];
    private isProcessingQueue = false;
    private concurrentRequests = 0;
    private requestHistory: RequestMetrics[] = [];
    private rateLimitConfig: RateLimitConfig;
    private lastRequestTime = Date.now();
    private requestCountPerMinute = 0;
    private requestCountPerHour = 0;
    private logsDir: string;
    private errorLogPath: string;
    private minuteTimer: NodeJS.Timeout;
    private hourTimer: NodeJS.Timeout;

    constructor(
        proxyFilePath?: string,
        rateLimitConfig?: Partial<RateLimitConfig>,
        errorLogPath?: string
    ) {
        this.rateLimitConfig = {
            maxRequestsPerMinute: 60,
            maxRequestsPerHour: 1000,
            maxConcurrentRequests: 5,
            delayBetweenRequestsMs: 1000,
            ...rateLimitConfig,
        };

        this.errorLogPath =
            errorLogPath || path.join(process.cwd(), 'logs', 'proxy-errors.log');

        this.logsDir = path.dirname(this.errorLogPath);
        this.ensureLogsDirectory();

        this.minuteTimer = setInterval(() => {
            this.requestCountPerMinute = 0;
        }, 60 * 1000);

        this.hourTimer = setInterval(() => {
            this.requestCountPerHour = 0;
        }, 60 * 60 * 1000);

        if (proxyFilePath) {
            this.loadProxiesFromFile(proxyFilePath).catch(console.error);
        }
    }

    private async ensureLogsDirectory() {
        try {
            await fs.mkdir(this.logsDir, { recursive: true });
        } catch (err) {
            console.error('Failed to create logs directory:', err);
        }
    }

    // services/ProxyRotationService.ts
    // Updated loadProxiesFromFile method only

    async loadProxiesFromFile(filePath: string): Promise<void> {
        const fullPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
        const content = await fs.readFile(fullPath, 'utf-8');
        const lines = content.split('\n').filter(Boolean);

        // Skip header line if it's CSV format
        const startIndex = lines[0].includes('ip,') ? 1 : 0;

        this.proxies = [];

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            try {
                let proxy: ProxyConfig;

                // Check if it's CSV format (contains quoted values and commas)
                if (line.includes('"') && line.includes(',')) {
                    proxy = this.parseCSVProxyLine(line);
                } else {
                    proxy = this.parseSimpleProxyLine(line);
                }

                this.proxies.push(proxy);
            } catch (error) {
                console.warn(`Failed to parse proxy line ${i + 1}: "${line}"`, error);
                await this.logError(new Error(`Failed to parse proxy line: ${line}`), null);
            }
        }

        console.log(`Loaded ${this.proxies.length} proxies from ${filePath}`);

        // Validate parsed proxies
        const validProxies = this.proxies.filter(p => p.host && p.port > 0);
        if (validProxies.length !== this.proxies.length) {
            console.warn(`Warning: ${this.proxies.length - validProxies.length} proxies were invalid and skipped`);
            this.proxies = validProxies;
        }
    }

    private parseCSVProxyLine(line: string): ProxyConfig {
        // Parse CSV line with quoted values
        const fields: string[] = [];
        let currentField = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(currentField);
                currentField = '';
            } else {
                currentField += char;
            }
        }
        fields.push(currentField); // Add last field

        // Map CSV fields to proxy config
        const proxy: ProxyConfig = {
            host: fields[0]?.replace(/"/g, '').trim() || '',
            port: parseInt(fields[7]?.replace(/"/g, '').trim() || fields[1]?.replace(/"/g, '').trim() || '80', 10),
            protocol: this.determineProtocolFromCSV(fields[8]?.replace(/"/g, '').trim()),
            isActive: true,
            errorCount: 0,
            successCount: 0,
            lastUsed: new Date(0),
        };

        // Parse protocols field if available
        const protocolsField = fields[8]?.replace(/"/g, '').trim();
        if (protocolsField) {
            const protocols = protocolsField.toLowerCase();
            if (protocols.includes('socks4') || protocols.includes('socks5')) {
                proxy.protocol = 'socks5';
            } else if (protocols.includes('https')) {
                proxy.protocol = 'https';
            }
        }

        // Validate required fields
        if (!proxy.host || isNaN(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
            throw new Error(`Invalid proxy data: ${line}`);
        }

        return proxy;
    }

    private parseSimpleProxyLine(line: string): ProxyConfig {
        const parts = line.trim().split(':');
        const proxy: ProxyConfig = {
            host: '',
            port: 80,
            protocol: 'http',
            isActive: true,
            errorCount: 0,
            successCount: 0,
            lastUsed: new Date(0),
        };

        // Parse host, port, optional auth, protocol
        // Format examples:
        // host:port
        // protocol://host:port
        // host:port:username:password
        // protocol://host:port:username:password
        let hostPart = parts[0];

        const protocolMatch = hostPart.match(/^(\w+):\/\//);
        if (protocolMatch) {
            const protocol = protocolMatch[1].toLowerCase();
            proxy.protocol = (protocol === 'socks4' || protocol === 'socks5') ? 'socks5' :
                (protocol === 'https' ? 'https' : 'http');
            hostPart = hostPart.replace(/^(\w+):\/\//, '');
        }

        proxy.host = hostPart;

        if (parts.length >= 2) {
            const port = parseInt(parts[1], 10);
            if (!isNaN(port) && port >= 1 && port <= 65535) {
                proxy.port = port;
            }
        }

        if (parts.length >= 4) {
            proxy.username = parts[2];
            proxy.password = parts[3];
        }

        return proxy;
    }

    private determineProtocolFromCSV(protocolsField: string): 'http' | 'https' | 'socks5' {
        if (!protocolsField) return 'http';

        const protocols = protocolsField.toLowerCase();
        if (protocols.includes('socks4') || protocols.includes('socks5')) {
            return 'socks5';
        }
        if (protocols.includes('https')) {
            return 'https';
        }
        return 'http';
    }

    getNextProxy(): ProxyConfig | null {
        if (this.proxies.length === 0) return null;

        for (let attempts = 0; attempts < this.proxies.length; attempts++) {
            const proxy = this.proxies[this.currentProxyIndex];
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;

            if (proxy.isActive) {
                if (proxy.errorCount && proxy.errorCount > 10) {
                    proxy.isActive = false;
                    continue;
                }
                return proxy;
            }
        }

        // Reset all proxies if no active ones
        this.proxies.forEach((p) => (p.isActive = true));
        return this.proxies[0] || null;
    }

    async executeRequest<T>(
        requestFn: (proxy: ProxyConfig | null) => Promise<T>,
        options?: { retryCount?: number; useProxy?: boolean }
    ): Promise<T> {
        const { retryCount = 3, useProxy = true } = options || {};

        return new Promise((resolve, reject) => {
            this.requestQueue.push(async () => {
                await this.waitForRateLimit();

                for (let attempt = 0; attempt < retryCount; attempt++) {
                    const proxy = useProxy ? this.getNextProxy() : null;
                    const startTime = Date.now();

                    try {
                        const result = await requestFn(proxy);
                        this.recordRequest({
                            timestamp: new Date(),
                            proxy: proxy || { host: 'direct', port: 0 },
                            success: true,
                            responseTime: Date.now() - startTime,
                        });
                        if (proxy) {
                            proxy.successCount = (proxy.successCount || 0) + 1;
                            console.log(`Using proxy: ${proxy}`);
                            proxy.lastUsed = new Date();
                        }
                        return resolve(result);
                    } catch (error: any) {
                        const responseTime = Date.now() - startTime;
                        this.recordRequest({
                            timestamp: new Date(),
                            proxy: proxy || { host: 'direct', port: 0 },
                            success: false,
                            responseTime,
                            statusCode: error.status || error.code,
                            error: error.message,
                        });
                        await this.logError(error, proxy);
                        if (proxy) {
                            proxy.errorCount = (proxy.errorCount || 0) + 1;
                            if (proxy.errorCount > 5) {
                                proxy.isActive = false;
                            }
                        }
                        if (attempt === retryCount - 1) {
                            return reject(error);
                        }
                        const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                        await this.delay(delayMs);
                    }
                }
            });
            this.processQueue();
        });
    }

    private async waitForRateLimit() {
        const now = Date.now();

        if (this.requestCountPerMinute >= this.rateLimitConfig.maxRequestsPerMinute) {
            const waitTime = 60000 - (now - this.lastRequestTime);
            if (waitTime > 0) await this.delay(waitTime);
        }

        if (this.requestCountPerHour >= this.rateLimitConfig.maxRequestsPerHour) {
            await this.delay(60 * 60 * 1000);
        }

        while (this.concurrentRequests >= this.rateLimitConfig.maxConcurrentRequests) {
            await this.delay(100);
        }

        this.concurrentRequests++;
        this.requestCountPerMinute++;
        this.requestCountPerHour++;
        this.lastRequestTime = Date.now();
    }

    private async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) return;
        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const req = this.requestQueue.shift();
            if (req) {
                try {
                    await req();
                } catch (err) {
                    console.error('Error processing request:', err);
                }
                this.concurrentRequests--;
                if (this.requestQueue.length > 0) {
                    await this.delay(this.rateLimitConfig.delayBetweenRequestsMs);
                }
            }
        }
        this.isProcessingQueue = false;
    }

    private recordRequest(metrics: RequestMetrics) {
        this.requestHistory.push(metrics);
        if (this.requestHistory.length > 1000) {
            this.requestHistory = this.requestHistory.slice(-1000);
        }
    }

    private async logError(error: any, proxy: ProxyConfig | null) {
        const timestamp = new Date().toISOString();
        const proxyInfo = proxy ? `${proxy.host}:${proxy.port}` : 'direct';
        const message = `[${timestamp}] Proxy: ${proxyInfo} - Error: ${error.message || error}\nStack: ${error.stack || ''}\n---\n`;
        try {
            await fs.appendFile(this.errorLogPath, message, 'utf-8');
        } catch (err) {
            console.error('Failed to write error log:', err);
        }
    }

    private delay(ms: number) {
        return new Promise((res) => setTimeout(res, ms));
    }

    getStats() {
        const successful = this.requestHistory.filter(r => r.success).length;
        const failed = this.requestHistory.filter(r => !r.success).length;
        const activeProxies = this.proxies.filter(p => p.isActive).length;
        const totalResponseTime = this.requestHistory.reduce((sum, r) => sum + r.responseTime, 0);
        const avgResponseTime = this.requestHistory.length ? totalResponseTime / this.requestHistory.length : 0;
        return {
            totalRequests: this.requestHistory.length,
            successfulRequests: successful,
            failedRequests: failed,
            activeProxies,
            totalProxies: this.proxies.length,
            averageResponseTime: avgResponseTime,
        };
    }

    getProxyStatus() {
        return this.proxies.map(p => ({
            host: p.host,
            port: p.port,
            protocol: p.protocol,
            isActive: p.isActive || false,
            errorCount: p.errorCount || 0,
            successCount: p.successCount || 0,
            lastUsed: p.lastUsed,
            successRate: (p.successCount || 0) / ((p.successCount || 0) + (p.errorCount || 0) || 1)
        }));
    }

    cleanup() {
        clearInterval(this.minuteTimer);
        clearInterval(this.hourTimer);
    }
}

// Singleton accessor
let instance: ProxyRotationService | null = null;

export function getProxyRotationService(
    proxyFilePath?: string,
    rateLimitConfig?: Partial<RateLimitConfig>
): ProxyRotationService {
    if (!instance) {
        const defaultProxyPath = process.env.PROXY_FILE_PATH || './proxies.txt';
        const defaultLogPath = path.join(process.cwd(), 'logs', 'proxy-errors.log');
        instance = new ProxyRotationService(proxyFilePath || defaultProxyPath, rateLimitConfig, defaultLogPath);
    }
    return instance;
}