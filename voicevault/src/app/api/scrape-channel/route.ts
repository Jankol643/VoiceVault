// src/app/api/scrape-channel/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { YoutubeScraperService } from '@/app/services/youtubeScraper.service';

export async function POST(request: NextRequest) {
    try {
        const { channelUrl } = await request.json();

        if (!channelUrl) {
            return NextResponse.json(
                { error: 'Channel URL is required' },
                { status: 400 }
            );
        }

        // Scrape videos using the server-side scraper service
        const videoUrls = await YoutubeScraperService.getAllVideoUrls(channelUrl);

        return NextResponse.json({ videoUrls });
    } catch (error: any) {
        console.error('Error scraping channel:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to scrape channel' },
            { status: 500 }
        );
    }
}

export async function GET(request: NextRequest) {
    const url = new URL(request.url);
    const channelUrl = url.searchParams.get('channelUrl');

    if (!channelUrl) {
        return NextResponse.json(
            { error: 'Channel URL is required' },
            { status: 400 }
        );
    }

    try {
        const videoUrls = await YoutubeScraperService.getAllVideoUrls(channelUrl);
        return NextResponse.json({ videoUrls });
    } catch (error: any) {
        console.error('Error scraping channel:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to scrape channel' },
            { status: 500 }
        );
    }
}