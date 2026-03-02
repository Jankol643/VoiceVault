// services/youtubeTranscript.service.ts

import { ProxyRotationService, ProxyConfig } from './ProxyRotationService';

export interface TranscriptEntry {
    text: string;
    start: number;
    duration: number;
}

export interface TranscriptOptions {
    language?: string;
    format?: 'json' | 'srt' | 'vtt' | 'txt';
    keepTemporaryFile?: boolean;
}

export interface ApiError {
    error: string;
    code?: string;
    message?: string;
}

export class YoutubeTranscriptService {
    private baseUrl: string;
    private proxyService: ProxyRotationService;

    constructor(baseUrl: string = '') {
        this.baseUrl = baseUrl;
        this.proxyService = new ProxyRotationService();
    }

    async fetchTranscript(
        videoId: string,
        options: TranscriptOptions = {}
    ): Promise<TranscriptEntry[] | string> {
        const { language = 'en', format = 'json' } = options;

        return this.proxyService.executeRequest(async (proxy) => {
            const fetchOptions: RequestInit = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videoId, language, format }),
            };

            // If proxy is specified, create an agent for Node.js fetch
            if (proxy && proxy.host !== 'direct') {
                const agent = await this.createProxyAgent(proxy);
                (fetchOptions as any).agent = agent; // Type assertion for node-fetch
            }

            const response = await fetch(`${this.baseUrl}/api/transcript`, fetchOptions);
            return this.handleResponse(response, format);
        }, { retryCount: 3, useProxy: true });
    }

    private async createProxyAgent(proxy: ProxyConfig) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        const proxyUrl = `${proxy.protocol || 'http'}://${proxy.host}:${proxy.port}`;
        const options: any = {};
        if (proxy.username && proxy.password) {
            options.headers = {
                'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}`,
            };
        }
        return new HttpsProxyAgent(proxyUrl);
    }

    private async handleResponse(response: Response, format: string) {
        const responseText = await response.text();
        if (!response.ok) {
            let data;
            try {
                data = JSON.parse(responseText);
            } catch {
                throw new Error('Invalid response from API');
            }
            const error: ApiError = data;
            let msg = error.error || 'Failed to fetch transcript';
            if (error.code === 'NO_TRANSCRIPTS_AVAILABLE') {
                msg = 'This video does not have any available transcripts';
            } else if (error.code === 'INVALID_VIDEO_ID') {
                msg = 'Invalid YouTube URL or video ID';
            } else if (error.code === 'FETCH_ERROR') {
                msg = 'Failed to fetch transcript. Please check if the video exists and has captions.';
            }
            throw new Error(msg);
        }

        if (format === 'json') {
            return JSON.parse(responseText) as TranscriptEntry[];
        }
        return responseText; // plain text formats
    }

    async getTranscriptWithTimestamps(videoId: string, language: string = 'en') {
        const transcript = (await this.fetchTranscript(videoId, { format: 'json', language })) as TranscriptEntry[];
        return transcript.map((entry) => ({
            time: this.formatTime(entry.start),
            text: entry.text,
        }));
    }

    private formatTime(seconds: number): string {
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        return hrs > 0
            ? `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
            : `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async getPlainTextTranscript(videoId: string, language: string = 'en'): Promise<string> {
        const data = await this.fetchTranscript(videoId, { format: 'txt', language });
        return data as string;
    }

    extractVideoId(urlOrId: string): string | null {
        if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;

        const patterns = [
            /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
            /^([a-zA-Z0-9_-]{11})$/,
        ];

        for (const pattern of patterns) {
            const match = urlOrId.match(pattern);
            if (match && match[1]) return match[1];
        }
        return null;
    }
}

export const youtubeTranscriptService = new YoutubeTranscriptService();