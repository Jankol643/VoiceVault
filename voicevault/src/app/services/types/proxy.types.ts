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
    proxy: ProxyConfig;
    success: boolean;
    responseTime: number;
    statusCode?: number;
    error?: string;
}

export interface ApiError {
    error: string;
    code?: string;
    message?: string;
}