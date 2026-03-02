// app/api/transcript/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { YoutubeService } from '@/app/services/youtube.service';

const execAsync = promisify(exec);

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const videoInput = searchParams.get('videoId');
        const language = searchParams.get('language') || 'en';
        const format = (searchParams.get('format') as 'json' | 'srt' | 'vtt' | 'txt') || 'json';

        console.log('API Request received:', { videoInput, language, format });

        if (!videoInput) {
            return NextResponse.json(
                {
                    error: 'videoId is required',
                    code: 'MISSING_VIDEO_ID'
                },
                { status: 400 }
            );
        }

        // Use YoutubeService to extract video ID
        const actualVideoId = YoutubeService.extractVideoId(videoInput);
        if (!actualVideoId) {
            return NextResponse.json(
                {
                    error: 'Invalid YouTube video ID or URL',
                    code: 'INVALID_VIDEO_ID'
                },
                { status: 400 }
            );
        }

        console.log('Extracted video ID:', actualVideoId);

        // Get available transcripts first
        const availableTranscripts = await getAvailableTranscripts(actualVideoId);
        console.log('Available transcripts:', availableTranscripts);

        // Check if requested language is available
        const availableLanguages = availableTranscripts.map(t => t.language_code);
        if (!availableLanguages.includes(language)) {
            console.warn(`Language ${language} not available. Available languages: ${availableLanguages.join(', ')}`);

            // Fallback to English if available, otherwise use first available
            const fallbackLanguage = availableLanguages.includes('en')
                ? 'en'
                : availableLanguages[0];

            if (!fallbackLanguage) {
                return NextResponse.json(
                    {
                        error: 'No transcripts available for this video',
                        code: 'NO_TRANSCRIPTS_AVAILABLE',
                        availableLanguages
                    },
                    { status: 404 }
                );
            }

            console.log(`Falling back to ${fallbackLanguage}`);
            // Use fallback language with dynamic format handling
            const transcript = await downloadTranscriptWithFormatFallback(
                actualVideoId,
                fallbackLanguage,
                format
            );

            return formatResponse(transcript.content, format, actualVideoId, transcript.actualFormat);
        }

        // Fetch transcript with format fallback
        const transcript = await downloadTranscriptWithFormatFallback(
            actualVideoId,
            language,
            format
        );

        console.log('Transcript fetched successfully');
        return formatResponse(transcript.content, format, actualVideoId, transcript.actualFormat);

    } catch (error: any) {
        console.error('Detailed error fetching transcript:', {
            message: error.message,
            stack: error.stack,
            code: error.code,
            stderr: error.stderr,
            stdout: error.stdout
        });

        return NextResponse.json(
            {
                error: `Failed to fetch transcript: ${error.message}`,
                code: 'FETCH_ERROR',
                details: error.stderr || error.stdout || 'No additional details'
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { videoId: videoInput, language = 'en', format = 'json' } = body;

        if (!videoInput) {
            return NextResponse.json(
                { error: 'videoId is required' },
                { status: 400 }
            );
        }

        // Use YoutubeService to extract video ID
        const actualVideoId = YoutubeService.extractVideoId(videoInput);
        if (!actualVideoId) {
            return NextResponse.json(
                { error: 'Invalid YouTube video ID or URL' },
                { status: 400 }
            );
        }

        // Get available transcripts first
        const availableTranscripts = await getAvailableTranscripts(actualVideoId);

        // Check if requested language is available
        const availableLanguages = availableTranscripts.map(t => t.language_code);
        if (!availableLanguages.includes(language)) {
            console.warn(`Language ${language} not available. Available languages: ${availableLanguages.join(', ')}`);

            // Fallback to English if available, otherwise use first available
            const fallbackLanguage = availableLanguages.includes('en')
                ? 'en'
                : availableLanguages[0];

            if (!fallbackLanguage) {
                return NextResponse.json(
                    { error: 'No transcripts available for this video' },
                    { status: 404 }
                );
            }

            console.log(`Falling back to ${fallbackLanguage}`);
            // Use fallback language with dynamic format handling
            const transcript = await downloadTranscriptWithFormatFallback(
                actualVideoId,
                fallbackLanguage,
                format
            );

            return formatResponse(transcript.content, format, actualVideoId, transcript.actualFormat);
        }

        // Fetch transcript with format fallback
        const transcript = await downloadTranscriptWithFormatFallback(
            actualVideoId,
            language,
            format
        );

        return formatResponse(transcript.content, format, actualVideoId, transcript.actualFormat);

    } catch (error: any) {
        console.error('Error fetching transcript:', error);
        return NextResponse.json(
            { error: `Failed to fetch transcript: ${error.message}` },
            { status: 500 }
        );
    }
}

function formatResponse(transcript: string, requestedFormat: string, videoId: string, actualFormat?: string) {
    console.log('Formatting response for requested format:', requestedFormat, 'actual format:', actualFormat);

    try {
        // Use actual format if different from requested
        const effectiveFormat = actualFormat || requestedFormat;
        const filename = `transcript-${videoId}.${effectiveFormat}`;

        if (effectiveFormat === 'json') {
            // Parse and re-stringify to ensure valid JSON
            const parsed = JSON.parse(transcript);
            return new NextResponse(JSON.stringify(parsed, null, 2), {
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Cache-Control': 'no-cache',
                    'X-Format-Used': actualFormat && actualFormat !== requestedFormat ? 'fallback' : 'requested'
                }
            });
        } else {
            return new NextResponse(transcript, {
                headers: {
                    'Content-Type': getContentType(effectiveFormat),
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Cache-Control': 'no-cache',
                    'X-Format-Used': actualFormat && actualFormat !== requestedFormat ? 'fallback' : 'requested'
                }
            });
        }
    } catch (error: any) {
        console.error('Error formatting response:', error);
        return NextResponse.json(
            {
                error: `Failed to format transcript: ${error.message}`,
                code: 'FORMAT_ERROR'
            },
            { status: 500 }
        );
    }
}

function getContentType(format: string): string {
    switch (format) {
        case 'json':
            return 'application/json';
        case 'txt':
            return 'text/plain';
        case 'srt':
            return 'text/plain';
        case 'vtt':
            return 'text/vtt';
        default:
            return 'text/plain';
    }
}

async function getAvailableTranscripts(videoId: string): Promise<Array<{ language: string; language_code: string }>> {
    try {
        const command = `yt-dlp --list-subs ${videoId}`;
        const { stdout, stderr } = await execAsync(command);

        if (stderr) {
            console.warn('yt-dlp stderr:', stderr);
        }

        const lines = stdout.split('\n');
        const transcripts: Array<{ language: string; language_code: string }> = [];

        // Parse the output to extract language information
        for (const line of lines) {
            const match = line.match(/^(\S+)\s+(\S+)/);
            if (match && match[1] !== 'Language') {
                transcripts.push({
                    language_code: match[1],
                    language: match[2]
                });
            }
        }

        return transcripts;
    } catch (error: any) {
        console.warn('Could not fetch available transcripts:', error.message);
        if (error.stderr) {
            console.warn('Command stderr:', error.stderr);
        }
        // Return default English as fallback
        return [{ language: 'English', language_code: 'en' }];
    }
}

async function downloadTranscriptWithFormatFallback(
    videoId: string,
    language: string,
    requestedFormat: string
): Promise<{ content: string; actualFormat: string }> {
    const tempDir = os.tmpdir();
    const outputTemplate = path.join(tempDir, `${videoId}_${language}`);

    // Build yt-dlp command with format fallback
    const command = [
        'yt-dlp',
        '--js-runtimes', 'node',
        `--sub-lang ${language}`,
        '--write-auto-sub',
        '--write-sub',
        '--skip-download',
        `--sub-format ${requestedFormat}`,
        `--output "${outputTemplate}"`,
        `https://www.youtube.com/watch?v=${videoId}`
    ].join(' ');

    try {
        const { stdout, stderr } = await execAsync(command);

        if (stderr && !stderr.includes('WARNING: No subtitle format found')) {
            console.warn('yt-dlp stderr:', stderr);
        }

        // Try to find the generated file with various extensions
        const possibleExtensions = [requestedFormat, 'vtt', 'srt', 'json'];

        for (const ext of possibleExtensions) {
            const filePath = `${outputTemplate}.${language}.${ext}`;
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                // Clean up
                fs.unlinkSync(filePath);
                return { content, actualFormat: ext };
            }
        }

        // If no file found, check for any file with videoId and language in the name
        const files = fs.readdirSync(tempDir);
        const matchingFiles = files.filter(f =>
            f.includes(videoId) &&
            f.includes(language) &&
            (f.endsWith('.vtt') || f.endsWith('.srt') || f.endsWith('.json'))
        );

        if (matchingFiles.length > 0) {
            const filePath = path.join(tempDir, matchingFiles[0]);
            const content = fs.readFileSync(filePath, 'utf-8');
            const actualFormat = matchingFiles[0].split('.').pop() || requestedFormat;

            // Clean up
            fs.unlinkSync(filePath);
            return { content, actualFormat };
        }

        throw new Error(`No transcript file found. Searched for formats: ${possibleExtensions.join(', ')}`);
    } catch (error: any) {
        console.error('Command execution error details:', {
            message: error.message,
            stderr: error.stderr,
            stdout: error.stdout,
            code: error.code
        });

        throw new Error(`Failed to download transcript: ${error.message}\nstderr: ${error.stderr || 'none'}`);
    }
}