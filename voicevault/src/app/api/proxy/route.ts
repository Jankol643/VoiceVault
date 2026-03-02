// app/api/proxy/route.ts
import { NextRequest, NextResponse } from 'next/server';

// This ensures the route is server-side only
export const dynamic = 'force-dynamic';

// Import node-fetch and proxy agents
import fetch, { Headers } from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getProxyRotationService } from '@/app/services/ProxyRotationService';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { url, method = 'GET', headers = {}, body: requestBody, timeout = 30000 } = body;

        // Validate required parameters
        if (!url) {
            return NextResponse.json(
                { error: 'URL is required' },
                { status: 400 }
            );
        }

        // Validate URL format
        try {
            new URL(url);
        } catch (error) {
            return NextResponse.json(
                { error: 'Invalid URL format' },
                { status: 400 }
            );
        }

        const proxyService = getProxyRotationService();

        const result = await proxyService.executeRequest(async (proxy) => {
            const fetchOptions: any = {
                method,
                headers: new Headers(headers),
                timeout,
            };

            // Add request body if present
            if (requestBody && method !== 'GET' && method !== 'HEAD') {
                if (typeof requestBody === 'string') {
                    fetchOptions.body = requestBody;
                } else {
                    fetchOptions.body = JSON.stringify(requestBody);
                    // Set Content-Type header if not provided
                    if (!headers['Content-Type'] && !headers['content-type']) {
                        fetchOptions.headers.set('Content-Type', 'application/json');
                    }
                }
            }

            // Configure proxy if available
            if (proxy) {
                const proxyUrl = proxy.username && proxy.password
                    ? `${proxy.protocol || 'http'}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
                    : `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`;

                // Create appropriate agent based on protocol
                if (proxy.protocol === 'socks5') {
                    const agent = new SocksProxyAgent(proxyUrl);
                    fetchOptions.agent = agent;
                } else {
                    const agent = new HttpsProxyAgent(proxyUrl);
                    fetchOptions.agent = agent;
                }
            }

            // Execute the request
            const response = await fetch(url, fetchOptions);

            // Get response body as text first to handle both JSON and non-JSON responses
            const responseText = await response.text();

            // Try to parse as JSON, fall back to text if not valid JSON
            let data;
            try {
                data = JSON.parse(responseText);
            } catch {
                data = responseText;
            }

            return {
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                data,
                proxyUsed: proxy ? {
                    host: proxy.host,
                    port: proxy.port,
                    protocol: proxy.protocol
                } : null
            };
        }, {
            retryCount: 3,
            useProxy: true
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Proxy request failed:', error);

        // Return appropriate error response
        let statusCode = 500;
        let errorMessage = error.message || 'Internal server error';

        if (error.name === 'FetchError' || error.code === 'ECONNREFUSED') {
            statusCode = 502; // Bad Gateway
            errorMessage = 'Proxy connection failed';
        } else if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
            statusCode = 504; // Gateway Timeout
            errorMessage = 'Request timeout';
        }

        return NextResponse.json(
            {
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.stack : undefined
            },
            { status: statusCode }
        );
    }
}

// Add GET method for health check
export async function GET(request: NextRequest) {
    const proxyService = getProxyRotationService();
    const stats = proxyService.getStats();

    return NextResponse.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        stats,
        endpoints: {
            POST: '/api/proxy - Make a proxied request',
            parameters: {
                url: 'string - Target URL (required)',
                method: 'string - HTTP method (default: GET)',
                headers: 'object - Request headers',
                body: 'any - Request body',
                timeout: 'number - Request timeout in ms (default: 30000)'
            }
        }
    });
}