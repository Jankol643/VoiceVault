// src/app/services/youtube.service.ts

export class YoutubeService {
    constructor() { }

    public static isValidChannel(channelString: string): boolean {
        if (!channelString || typeof channelString !== 'string') {
            return false;
        }

        const normalized = this.normalizeChannelInput(channelString);

        // Check all possible valid YouTube channel formats
        return this.isChannelId(normalized) ||
            this.isCustomUrl(normalized) ||
            this.isHandle(normalized) ||
            this.isLegacyUsername(normalized);
    }

    /**
     * Check if it's a YouTube Channel ID
     * Format: UC followed by 22 alphanumeric characters, dashes, or underscores
     */
    public static isChannelId(input: string): boolean {
        return /^UC[\w-]{22}$/.test(input);
    }

    /**
     * Check if it's a custom URL format
     * Format: c/ChannelName or channel/ChannelName
     */
    public static isCustomUrl(input: string): boolean {
        return /^(c\/|channel\/)[\w-]+$/i.test(input);
    }

    /**
     * Check if it's an @handle format
     * Format: @username
     */
    public static isHandle(input: string): boolean {
        return /^@[\w-]+$/.test(input);
    }

    /**
     * Check if it's a legacy username format
     * Format: username (without @ or UC prefix)
     */
    public static isLegacyUsername(input: string): boolean {
        return /^[\w-]+$/.test(input) && !input.startsWith('UC') && !input.startsWith('@');
    }

    /**
     * Normalize channel input by removing URL parts and cleaning up
     */
    private static normalizeChannelInput(channelString: string): string {
        if (!channelString) return '';

        let normalized = channelString.trim();

        // Remove common YouTube URL patterns
        const urlPatterns = [
            /^https?:\/\/(www\.)?youtube\.com\//i,
            /^https?:\/\/youtu\.be\//i,
            /^youtube\.com\//i,
            /^youtu\.be\//i
        ];

        for (const pattern of urlPatterns) {
            normalized = normalized.replace(pattern, '');
        }

        // Remove query parameters
        const queryIndex = normalized.indexOf('?');
        if (queryIndex !== -1) {
            normalized = normalized.substring(0, queryIndex);
        }

        // Remove trailing slashes
        normalized = normalized.replace(/\/+$/, '');

        return normalized;
    }

    /**
     * Check if input is a valid YouTube video URL
     */
    public static isValidVideoUrl(videoString: string): boolean {
        if (!videoString || typeof videoString !== 'string') {
            return false;
        }

        const normalized = this.normalizeVideoInput(videoString);

        return this.isStandardVideoUrl(normalized) ||
            this.isShortUrl(normalized) ||
            this.isEmbedUrl(normalized)
    }

    /**
     * Check if it's a standard YouTube video URL
     * Format: youtube.com/watch?v=VIDEO_ID
     */
    private static isStandardVideoUrl(input: string): boolean {
        return /^(www\.)?youtube\.com\/watch\?v=[\w-]{11}(&.*)?$/i.test(input);
    }

    /**
     * Check if it's a short YouTube URL
     * Format: youtu.be/VIDEO_ID
     */
    private static isShortUrl(input: string): boolean {
        return /^youtu\.be\/[\w-]{11}(\?.*)?$/i.test(input);
    }

    /**
     * Check if it's an embed URL
     * Format: youtube.com/embed/VIDEO_ID
     */
    private static isEmbedUrl(input: string): boolean {
        return /^(www\.)?youtube\.com\/embed\/[\w-]{11}(\?.*)?$/i.test(input);
    }

    /**
     * Check if it's just a video ID
     * Format: 11 alphanumeric characters, dashes, or underscores
     */
    private static isVideoId(input: string): boolean {
        return /^[\w-]{11}$/.test(input);
    }

    /**
     * Normalize video input by removing URL parts and extracting video ID
     */
    private static normalizeVideoInput(videoString: string): string {
        if (!videoString) return '';

        let normalized = videoString.trim();

        // Remove common YouTube URL prefixes
        const urlPatterns = [
            /^https?:\/\/(www\.)?youtube\.com\//i,
            /^https?:\/\/youtu\.be\//i,
            /^youtube\.com\//i,
            /^youtu\.be\//i
        ];

        for (const pattern of urlPatterns) {
            normalized = normalized.replace(pattern, '');
        }

        // Extract video ID from watch URL
        const watchMatch = normalized.match(/watch\?v=([\w-]{11})/i);
        if (watchMatch) {
            return watchMatch[1];
        }

        // Extract video ID from embed URL
        const embedMatch = normalized.match(/embed\/([\w-]{11})/i);
        if (embedMatch) {
            return embedMatch[1];
        }

        // Remove query parameters
        const queryIndex = normalized.indexOf('?');
        if (queryIndex !== -1) {
            normalized = normalized.substring(0, queryIndex);
        }

        // Remove trailing slashes
        normalized = normalized.replace(/\/+$/, '');

        return normalized;
    }

    /**
     * Extract video ID from any valid YouTube video URL format
     */
    public static extractVideoId(videoString: string): string | null {
        if (!YoutubeService.isValidVideoUrl(videoString)) {
            return null;
        }

        return YoutubeService.normalizeVideoInput(videoString);
    }

    /**
     * Generate different URL formats for a video ID
     */
    public getVideoUrls(videoId: string): {
        standard: string;
        short: string;
        embed: string;
    } {
        if (!YoutubeService.isVideoId(videoId)) {
            throw new Error('Invalid video ID format');
        }

        return {
            standard: `https://www.youtube.com/watch?v=${videoId}`,
            short: `https://youtu.be/${videoId}`,
            embed: `https://www.youtube.com/embed/${videoId}`
        };
    }

    /**
     * Extract channel ID or handle from a YouTube channel URL or identifier
     * Returns the normalized channel identifier for API use
     */
    public static extractChannelIdOrHandle(channelString: string): string | null {
        if (!this.isValidChannel(channelString)) {
            return null;
        }

        const normalized = this.normalizeChannelInput(channelString);

        // Return the normalized identifier based on the format
        if (this.isChannelId(normalized) ||
            this.isCustomUrl(normalized) ||
            this.isHandle(normalized) ||
            this.isLegacyUsername(normalized)) {
            return normalized;
        }

        return null;
    }

    /**
     * Resolve a channel ID or handle to a full YouTube channel URL
     * @param channelIdOrHandle - Channel ID (UC...), handle (@username), or custom URL identifier
     * @returns Full YouTube channel URL
     */
    public static async resolveChannelUrl(channelIdOrHandle: string): Promise<string> {
        const normalized = this.normalizeChannelInput(channelIdOrHandle);

        if (!normalized) {
            throw new Error('Invalid channel identifier');
        }

        // Handle different channel identifier formats
        if (this.isChannelId(normalized)) {
            // Channel ID format: UCxxxxxxxxxxxxxxxxxxxxx
            return `https://www.youtube.com/channel/${normalized}`;
        } else if (this.isHandle(normalized)) {
            // Handle format: @username
            // Remove the @ symbol for the URL
            const handle = normalized.substring(1);
            return `https://www.youtube.com/@${handle}`;
        } else if (this.isCustomUrl(normalized)) {
            // Custom URL format: c/ChannelName or channel/ChannelName
            if (normalized.startsWith('c/')) {
                const channelName = normalized.substring(2);
                return `https://www.youtube.com/c/${channelName}`;
            } else if (normalized.startsWith('channel/')) {
                const channelName = normalized.substring(8);
                return `https://www.youtube.com/channel/${channelName}`;
            }
        } else if (this.isLegacyUsername(normalized)) {
            // Legacy username format: username
            return `https://www.youtube.com/user/${normalized}`;
        }

        // If we can't determine the format, try to construct a URL with the original input
        // This handles cases where the input might already be a partial URL
        if (normalized.includes('youtube.com')) {
            // Already contains youtube.com, ensure it has proper protocol
            if (!normalized.startsWith('http')) {
                return `https://${normalized}`;
            }
            return normalized;
        }

        // Default to trying as a custom URL (most common for modern channels)
        return `https://www.youtube.com/${normalized}`;
    }


}