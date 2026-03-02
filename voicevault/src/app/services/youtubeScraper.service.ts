// src/app/services/youtubeScraper.service.ts
import 'server-only';

import puppeteer, { Browser, Page } from "puppeteer";

export class YoutubeScraperService {
    private static browser: Browser | null = null;

    /**
     * Initialize Puppeteer browser instance
     */
    private static async getBrowser(): Promise<Browser> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: 'new',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                    '--window-size=1920,1080',
                    '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process'
                ],
                defaultViewport: {
                    width: 1920,
                    height: 1080
                }
            });
        }
        return this.browser;
    }

    /**
     * Close the browser instance
     */
    public static async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Fetch page HTML using Puppeteer
     */
    private static async fetchPage(url: string): Promise<string> {
        let browser: Browser | null = null;
        let page: Page | null = null;

        try {
            browser = await this.getBrowser();
            page = await browser.newPage();

            // Set realistic headers and viewport
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            // Set extra headers
            await page.setExtraHTTPHeaders({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            });

            // Block unnecessary resources to speed up loading
            await page.setRequestInterception(true);
            page.on('request', (req) => {
                const resourceType = req.resourceType();
                if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font' || resourceType === 'media') {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            console.log(`Navigating to: ${url}`);

            // Navigate with longer timeout for YouTube
            await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 60000
            });

            // Wait for video content to load
            await page.waitForSelector('ytd-rich-grid-renderer, ytd-item-section-renderer, #contents', {
                timeout: 30000
            });

            // Scroll to load more content (for infinite scroll)
            await this.autoScroll(page);

            // Get the page HTML
            const html = await page.content();

            return html;
        } catch (error) {
            console.error('Error fetching page with Puppeteer:', error);

            // Try to get HTML even if some elements didn't load
            if (page) {
                try {
                    return await page.content();
                } catch (e) {
                    throw error;
                }
            }
            throw error;
        } finally {
            // Close the page, but keep browser open for reuse
            if (page && !page.isClosed()) {
                await page.close();
            }
        }
    }

    /**
     * Auto-scroll to load more content on infinite scroll pages
     */
    private static async autoScroll(page: Page): Promise<void> {
        await page.evaluate(async () => {
            await new Promise<void>((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight || totalHeight > 5000) {
                        clearInterval(timer);
                        setTimeout(resolve, 1000); // Wait for content to load
                    }
                }, 200);
            });
        });
    }

    /**
     * Improved video URL extraction that handles YouTube's data structure better
     */
    private static extractVideoUrlsFromHtml(html: string): string[] {
        const videoUrls: Set<string> = new Set();

        // Method 1: Look for video links in href attributes
        const videoIdRegex = /"videoId":"([A-Za-z0-9_-]{11})"/g;
        let match;
        while ((match = videoIdRegex.exec(html)) !== null) {
            const videoId = match[1];
            videoUrls.add(`https://www.youtube.com/watch?v=${videoId}`);
        }

        // Method 2: Look for shorts IDs
        const shortsRegex = /"shortVideoId":"([A-Za-z0-9_-]{11})"/g;
        while ((match = shortsRegex.exec(html)) !== null) {
            const videoId = match[1];
            videoUrls.add(`https://www.youtube.com/shorts/${videoId}`);
        }

        // Method 3: Look for video URLs in href attributes
        const urlRegex = /href="(\/watch\?v=[A-Za-z0-9_-]{11})"/g;
        while ((match = urlRegex.exec(html)) !== null) {
            const href = match[1];
            videoUrls.add(`https://www.youtube.com${href}`);
        }

        return Array.from(videoUrls);
    }

    /**
     * Improved continuation token extraction
     */
    private static extractContinuationToken(html: string): string | null {
        try {
            // Look for continuation token in various formats
            const patterns = [
                /"continuation":"([^"]+)"/,
                /"continuationCommand".*?"token":"([^"]+)"/,
                /continuation=([^&"]+)/,
                /"token":"([^"]+)"[^}]*}"continuationCommand"/,
                /data-continuation="([^"]+)"/
            ];

            for (const pattern of patterns) {
                const match = html.match(pattern);
                if (match && match[1]) {
                    const token = match[1].replace(/\\u0026/g, '&');
                    return `&continuation=${encodeURIComponent(token)}`;
                }
            }

            return null;
        } catch (error) {
            console.error('Error extracting continuation token:', error);
            return null;
        }
    }

    /**
     * Scrape videos from channel with pagination
     */
    private static async scrapeChannelVideos(
        channelUrl: string,
        continuationToken: string | null = null
    ): Promise<{
        videoUrls: string[];
        continuationToken: string | null;
    }> {
        try {
            let url = channelUrl;
            if (continuationToken) {
                // Check if channelUrl already has query parameters
                const separator = channelUrl.includes('?') ? '&' : '?';
                url = `${channelUrl}${separator}view=0&sort=dd&shelf_id=0${continuationToken}`;
            } else {
                // Add videos tab to URL if not already present
                if (!url.includes('/videos')) {
                    url = `${url}/videos`;
                }
                url = `${url}?view=0&sort=dd&shelf_id=0`;
            }

            console.log(`Scraping videos from: ${url}`);

            const html = await this.fetchPage(url);

            // Parse the HTML to extract video URLs and continuation token
            const videoUrls = this.extractVideoUrlsFromHtml(html);
            const nextContinuationToken = this.extractContinuationToken(html);

            console.log(`Found ${videoUrls.length} videos on this page`);

            return {
                videoUrls,
                continuationToken: nextContinuationToken
            };
        } catch (error) {
            console.error('Error scraping channel videos:', error);
            return { videoUrls: [], continuationToken: null };
        }
    }

    /**
     * Improved delay function with random jitter
     */
    private static delay(ms: number): Promise<void> {
        // Add random jitter to avoid pattern detection
        const jitter = Math.random() * 1000;
        return new Promise(resolve => setTimeout(resolve, ms + jitter));
    }

    /**
     * Enhanced getAllVideoUrls with better pagination handling
     */
    public static async getAllVideoUrls(channelUrl: string): Promise<string[]> {
        try {
            console.log(`Starting to scrape videos from: ${channelUrl}`);

            // Get videos from the channel
            const videoUrls: Set<string> = new Set();
            let continuationToken: string | null = null;
            let hasMoreVideos = true;
            let safetyCounter = 0;
            const maxPages = 20; // Reduced for safety

            // Initial delay before starting
            await this.delay(2000);

            while (hasMoreVideos && safetyCounter < maxPages) {
                console.log(`Fetching page ${safetyCounter + 1}...`);

                const result = await this.scrapeChannelVideos(channelUrl, continuationToken);

                // Add new video URLs
                result.videoUrls.forEach(url => videoUrls.add(url));

                if (result.continuationToken && result.videoUrls.length > 0) {
                    continuationToken = result.continuationToken;
                    console.log("Found continuation token for next page");
                } else {
                    hasMoreVideos = false;
                    console.log("No more videos found or no continuation token");
                }

                safetyCounter++;

                // Add delay between pages to avoid rate limiting
                if (hasMoreVideos) {
                    console.log("Waiting before next page...");
                    await this.delay(3000 + Math.random() * 2000); // 3-5 second delay
                }
            }

            console.log(`Total unique videos found: ${videoUrls.size}`);

            // Clean up browser instance
            await this.closeBrowser();

            return Array.from(videoUrls);
        } catch (error) {
            // Ensure browser is closed on error
            await this.closeBrowser().catch(console.error);
            console.error('Error getting video URLs:', error);
            throw error;
        }
    }

    /**
 * Get total video count from a channel
 */
    public static async getChannelVideoCount(channelUrl: string): Promise<number> {
        try {
            console.log(`Getting video count from: ${channelUrl}`);

            let url = channelUrl;
            // Ensure we're on the videos tab
            if (!url.includes('/videos')) {
                url = `${url}/videos`;
            }

            const html = await this.fetchPage(url);

            // Multiple patterns to extract video count from YouTube page
            const countPatterns = [
                // Pattern 1: From meta tags
                /"videoCountText"[^}]*"simpleText":"([\d,]+)\s*videos?"/,
                /"videoCountText"[^}]*"accessibility"[^}]*"accessibilityData"[^}]*"label":"([\d,]+)\s*videos?"/,
                /"videosCountText"[^}]*"text":"([\d,]+)\s*videos?"/,
                // Pattern 2: From channel header
                /"header"[^}]*"videosCountText"[^}]*"text":"([\d,]+)/,
                // Pattern 3: From stats
                /"videosCountText"[^}]*"runs"[^}]*"text":"([\d,]+)/,
                // Pattern 4: Direct text search
                /([\d,]+)\s*videos?\s*<\/span>/i,
                /([\d,]+)\s*videos?\s*<\/div>/i,
                // Pattern 5: From structured data
                /"videoCount"\s*:\s*"([\d,]+)/,
                /"videos"\s*{\s*"total"\s*:\s*([\d,]+)/,
                // Pattern 6: Try to count video elements as fallback
                /"videoId":"[A-Za-z0-9_-]{11}"/g
            ];

            let videoCount = 0;

            for (const pattern of countPatterns) {
                const match = html.match(pattern);
                if (match) {
                    if (pattern.toString().includes('videoId')) {
                        // This is the fallback pattern that counts video IDs
                        const matches = html.match(/"videoId":"[A-Za-z0-9_-]{11}"/g);
                        if (matches) {
                            const uniqueIds = new Set(matches.map(m => {
                                const idMatch = m.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
                                return idMatch ? idMatch[1] : null;
                            }).filter(Boolean));
                            videoCount = uniqueIds.size;
                            break;
                        }
                    } else {
                        // Extract number from matched text and remove commas
                        const countText = match[1] || match[0].match(/([\d,]+)/)?.[0];
                        if (countText) {
                            videoCount = parseInt(countText.replace(/,/g, ''), 10);
                            break;
                        }
                    }
                }
            }

            console.log(`Found ${videoCount} videos for channel`);

            // Clean up
            await this.closeBrowser();

            return videoCount;
        } catch (error) {
            console.error('Error getting channel video count:', error);
            await this.closeBrowser().catch(console.error);
            throw error;
        }
    }

    /**
     * Scrape all video URLs from channel with progress callback
     */
    public static async getAllVideoUrlsWithProgress(
        channelUrl: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<string[]> {
        try {
            console.log(`Starting to scrape videos from: ${channelUrl}`);

            // First get total count for progress tracking
            const totalCount = await this.getChannelVideoCount(channelUrl);
            onProgress?.(0, totalCount);

            // Get videos from the channel
            const videoUrls: Set<string> = new Set();
            let continuationToken: string | null = null;
            let hasMoreVideos = true;
            let safetyCounter = 0;
            const maxPages = Math.ceil(totalCount / 30) + 2; // ~30 videos per page

            let processedCount = 0;

            // Initial delay before starting
            await this.delay(2000);

            while (hasMoreVideos && safetyCounter < maxPages) {
                console.log(`Fetching page ${safetyCounter + 1}...`);

                const result = await this.scrapeChannelVideos(channelUrl, continuationToken);

                // Add new video URLs
                const newVideos = result.videoUrls.filter(url => !videoUrls.has(url));
                newVideos.forEach(url => videoUrls.add(url));
                processedCount += newVideos.length;

                // Update progress
                onProgress?.(processedCount, totalCount);

                if (result.continuationToken && result.videoUrls.length > 0) {
                    continuationToken = result.continuationToken;
                    console.log("Found continuation token for next page");
                } else {
                    hasMoreVideos = false;
                    console.log("No more videos found or no continuation token");
                }

                safetyCounter++;

                // Add delay between pages to avoid rate limiting
                if (hasMoreVideos) {
                    console.log("Waiting before next page...");
                    await this.delay(3000 + Math.random() * 2000); // 3-5 second delay
                }
            }

            console.log(`Total unique videos found: ${videoUrls.size}`);

            // Clean up browser instance
            await this.closeBrowser();

            return Array.from(videoUrls);
        } catch (error) {
            // Ensure browser is closed on error
            await this.closeBrowser().catch(console.error);
            console.error('Error getting video URLs:', error);
            throw error;
        }
    }
}