"use client";

import React from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  Form,
  FormItem,
  FormLabel,
  FormField,
  FormControl,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Download, Loader2, X, FileText, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { HTTP_CODE_ENUM } from "@/features/api/http-codes";
import { YoutubeService } from "@/app/services/youtube.service";

const useFormSchema = () => {
  const t = useTranslations("components.youtubeForm.inputs");

  return z.object({
    url: z
      .string({ required_error: t("url.validation.required") })
      .trim()
      .min(1, {
        message: t("url.validation.required"),
      })
      .refine(
        (value) => {
          return YoutubeService.isValidVideoUrl(value);
        },
        { message: t("url.validation.invalid") }
      ),
    channelUrl: z
      .string()
      .optional()
      .refine(
        (value) => {
          if (!value) return true; // Optional field
          return (
            value.includes("youtube.com") &&
            (value.includes("/channel/") ||
              value.includes("/c/") ||
              value.includes("/@"))
          );
        },
        { message: t("channelUrl.validation.invalid") }
      ),
  });
};

export function YoutubeForm(props: { className?: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const channelInputRef = React.useRef<HTMLInputElement>(null);
  const [showTranscriptOptions, setShowTranscriptOptions] = React.useState(false);
  const [showChannelOptions, setShowChannelOptions] = React.useState(false);
  const [selectedFormat, setSelectedFormat] = React.useState<
    "json" | "srt" | "vtt" | "txt"
  >("txt");
  const [selectedLanguage, setSelectedLanguage] = React.useState("en");
  const [channelProcessing, setChannelProcessing] = React.useState(false);
  const [channelProgress, setChannelProgress] = React.useState({
    current: 0,
    total: 0,
  });

  const t = useTranslations("components.youtubeForm");
  const formSchema = useFormSchema();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      url: "",
      channelUrl: "",
    },
  });

  const errorMessage = form.formState.errors.url?.message;
  const channelErrorMessage = form.formState.errors.channelUrl?.message;
  const currentUrl = form.watch("url");
  const currentChannelUrl = form.watch("channelUrl");
  const videoId = YoutubeService.extractVideoId(currentUrl);
  const channelIdentifier =
    currentChannelUrl && currentChannelUrl.trim() !== ""
      ? YoutubeService.extractVideoId(currentChannelUrl) // You might need a different function for channel IDs
      : undefined;

  const isDisabled = !form.formState.isDirty;
  const isShowClearButton = currentUrl.length > 0;
  const isShowClearChannelButton = currentChannelUrl && currentChannelUrl.length > 0;

  function clearUrlField() {
    form.setValue("url", "");
    form.clearErrors("url");
    setShowTranscriptOptions(false);
    inputRef.current?.focus();
  }

  function clearChannelField() {
    form.setValue("channelUrl", "");
    form.clearErrors("channelUrl");
    setShowChannelOptions(false);
    channelInputRef.current?.focus();
  }

  async function triggerDownload(videoUrl: string, filename: string) {
    if (typeof window === "undefined") return;

    const proxyUrl = new URL("/api/download-proxy", window.location.origin);
    proxyUrl.searchParams.append("url", videoUrl);
    proxyUrl.searchParams.append("filename", filename);

    const link = document.createElement("a");
    link.href = proxyUrl.toString();
    link.target = "_blank";
    link.setAttribute("download", filename);
    link.setAttribute("type", "application/octet-stream");

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function downloadTranscript() {
    if (!videoId) {
      form.setError("url", {
        message: t("inputs.url.validation.invalid")
      });
      return;
    }

    try {
      console.log('Starting transcript download for:', videoId);

      // Create query parameters
      const queryParams = new URLSearchParams({
        videoId: videoId,
        language: selectedLanguage,
        format: selectedFormat
      });

      // Make the API call
      const response = await fetch(`/api/transcript?${queryParams.toString()}`);

      // Check if the response is OK first
      if (!response.ok) {
        // Clone the response to read error details
        const errorResponse = response.clone();
        let errorData;
        try {
          errorData = await errorResponse.json();
        } catch {
          // If not JSON, try text
          const errorText = await errorResponse.text();
          throw new Error(errorText || `Server error: ${response.status} ${response.statusText}`);
        }

        // Handle specific error codes from the API
        if (errorData.code === 'NO_TRANSCRIPTS_AVAILABLE') {
          throw new Error(t("errors.noTranscriptsAvailable") || 'This video does not have any available transcripts');
        } else if (errorData.code === 'INVALID_VIDEO_ID') {
          throw new Error(t("errors.invalidVideoId") || 'Invalid YouTube URL or video ID');
        } else if (errorData.code === 'FETCH_ERROR') {
          throw new Error(t("errors.fetchError") || 'Failed to fetch transcript. Please check if the video exists and has captions.');
        } else if (errorData.code === 'MISSING_VIDEO_ID') {
          throw new Error(t("errors.missingVideoId") || 'Video ID is required');
        } else if (errorData.error) {
          throw new Error(errorData.error);
        } else {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
      }

      // Get the blob data from the original response
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      // Get filename from Content-Disposition header if available
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = `transcript-${videoId}.${selectedFormat}`;

      if (contentDisposition) {
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        if (filenameMatch) {
          filename = filenameMatch[1];
        }
      }

      link.download = filename;

      document.body.appendChild(link);
      link.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);

      toast.success(t("toasts.transcriptSuccess"), {
        id: "toast-success",
        position: "top-center",
        duration: 1500,
      });
    } catch (error: any) {
      console.error('Error in downloadTranscript:', {
        message: error.message,
        stack: error.stack
      });

      // Use the specific error message from the API response
      const errorMessage = error.message || t("toasts.transcriptError");
      toast.error(errorMessage, {
        dismissible: true,
        id: "toast-error",
        position: "top-center",
        duration: 5000,
      });

      form.setError("url", {
        message: errorMessage
      });
    }
  }

  async function downloadChannelTranscripts() {
    if (!channelIdentifier) {
      form.setError("channelUrl", {
        message: t("inputs.channelUrl.validation.invalid"),
      });
      return;
    }

    setChannelProcessing(true);
    setChannelProgress({ current: 0, total: 0 });

    try {
      // Call the API route instead of direct service
      const response = await fetch('/api/scrape-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelUrl: currentChannelUrl }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch video list');
      }

      const data = await response.json();
      const videoIds = data.videoUrls || [];

      if (videoIds.length === 0) {
        toast.error(t("toasts.channelNoVideos"), {
          dismissible: true,
          id: "toast-error",
          position: "top-center",
        });
        setChannelProcessing(false);
        return;
      }

      setChannelProgress({ current: 0, total: videoIds.length });

      // Download each transcript
      for (let i = 0; i < videoIds.length; i++) {
        const videoUrl = videoIds[i];
        const vId = YoutubeService.extractVideoId(videoUrl) || videoUrl;

        if (!vId) continue;

        try {
          const queryParams = new URLSearchParams({
            videoId: vId,
            language: selectedLanguage,
            format: selectedFormat
          });

          const downloadUrl = `/api/transcript?${queryParams.toString()}`;
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = `transcript-${vId}.${selectedFormat}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.error(`Failed to download transcript for ${vId}`, err);
        }
        setChannelProgress({ current: i + 1, total: videoIds.length });
      }

      toast.success(t("toasts.channelSuccess", { count: videoIds.length }), {
        id: "toast-success",
        position: "top-center",
        duration: 3000,
      });
    } catch (error) {
      console.error(error);
      toast.error(t("toasts.channelError"), {
        dismissible: true,
        id: "toast-error",
        position: "top-center",
      });
    } finally {
      setChannelProcessing(false);
    }
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
  }

  const handleChannelDownloadClick = async () => {
    if (!channelIdentifier) {
      form.setError("channelUrl", {
        message: t("inputs.channelUrl.validation.invalid"),
      });
      return;
    }

    if (!currentChannelUrl) {
      form.setError("channelUrl", {
        message: t("inputs.channelUrl.validation.invalid"),
      });
      return;
    }

    try {
      setChannelProcessing(true);

      // Get video count from API
      const response = await fetch('/api/scrape-channel?action=count', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelUrl: currentChannelUrl, action: 'count' }),
      });

      if (!response.ok) {
        throw new Error('Failed to get video count');
      }

      const data = await response.json();
      const videoCount = data.videoCount || 0;

      // Show confirmation dialog with video count
      const confirmed = window.confirm(
        t("confirmations.channelDownload", { count: videoCount }) ||
        `This channel has ${videoCount} videos. Do you want to download all transcripts?`
      );

      if (!confirmed) {
        setChannelProcessing(false);
        return;
      }

      // If confirmed, start downloading
      setChannelProgress({ current: 0, total: videoCount });

      // Get video URLs from API
      const videosResponse = await fetch('/api/scrape-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelUrl: currentChannelUrl }),
      });

      if (!videosResponse.ok) {
        throw new Error('Failed to fetch video list');
      }

      const videosData = await videosResponse.json();
      const videoIds = videosData.videoUrls || [];

      if (videoIds.length === 0) {
        toast.error(t("toasts.channelNoVideos"), {
          dismissible: true,
          id: "toast-error",
          position: "top-center",
        });
        setChannelProcessing(false);
        return;
      }

      // Download each transcript
      for (let i = 0; i < videoIds.length; i++) {
        const vId = videoIds[i];
        try {
          const queryParams = new URLSearchParams({
            videoId: vId,
            language: selectedLanguage,
            format: selectedFormat
          });

          const downloadUrl = `/api/transcript?${queryParams.toString()}`;

          // Trigger download for each video
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = `transcript-${vId}.${selectedFormat}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);

          // Optional: Add a small delay between downloads
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (err) {
          console.error(`Failed to download transcript for ${vId}`, err);
        }
        setChannelProgress({ current: i + 1, total: videoIds.length });
      }

      toast.success(t("toasts.channelSuccess", { count: videoIds.length }), {
        id: "toast-success",
        position: "top-center",
        duration: 3000,
      });
    } catch (error) {
      console.error(error);
      toast.error(t("toasts.channelError"), {
        dismissible: true,
        id: "toast-error",
        position: "top-center",
      });
    } finally {
      setChannelProcessing(false);
    }
  };

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={cn("w-full space-y-4", props.className)}>
      {errorMessage ? (
        <p className="h-4 text-sm text-red-500 sm:text-start">{errorMessage}</p>
      ) : (
        <div className="h-4"></div>
      )}

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
        >
          {/* Video URL Section */}
          <div className="space-y-2">
            <FormLabel>{t("inputs.url.label")}</FormLabel>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
              <FormField
                control={form.control}
                name="url"
                rules={{ required: true }}
                render={({ field }) => (
                  <FormItem className="w-full">
                    <FormControl>
                      <div className="relative w-full">
                        <Input
                          {...field}
                          type="url"
                          ref={inputRef}
                          minLength={1}
                          maxLength={255}
                          placeholder={t("inputs.url.placeholder")}
                        />
                        {isShowClearButton && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={clearUrlField}
                            className="absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 cursor-pointer"
                          >
                            <X className="text-red-500" />
                          </Button>
                        )}
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button
                disabled={isDisabled}
                type="submit"
                className="flex items-center gap-2"
              >
                <Download size={16} />
                {t("buttons.downloadVideo")}
              </Button>
            </div>
          </div>
          {/* Transcript Options */}
          {videoId && (
            <div className="space-y-2">
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => setShowTranscriptOptions(!showTranscriptOptions)}
              >
                <FileText size={16} className="mr-2" />
                {t("buttons.transcriptOptions")}
              </Button>

              {showTranscriptOptions && (
                <div className="rounded-lg border p-4 space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="text-sm font-medium">
                        {t("inputs.transcriptFormat.label")}
                      </label>
                      <select
                        className="w-full mt-1 p-2 border rounded"
                        value={selectedFormat}
                        onChange={(e) => setSelectedFormat(e.target.value as any)}
                      >
                        <option value="txt">TXT</option>
                        <option value="srt">SRT</option>
                        <option value="vtt">VTT</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium">
                        {t("inputs.transcriptLanguage.label")}
                      </label>
                      <select
                        className="w-full mt-1 p-2 border rounded"
                        value={selectedLanguage}
                        onChange={(e) => setSelectedLanguage(e.target.value)}
                      >
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="fr">French</option>
                        <option value="de">German</option>
                        <option value="ja">Japanese</option>
                      </select>
                    </div>
                  </div>
                  <Button
                    type="button"
                    onClick={downloadTranscript}
                    className="w-full"
                  >
                    <Download size={16} className="mr-2" />
                    {t("buttons.downloadTranscript")}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Channel URL Section */}
          <div className="space-y-2">
            <FormLabel>{t("inputs.channelUrl.label")}</FormLabel>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
              <FormField
                control={form.control}
                name="channelUrl"
                render={({ field }) => (
                  <FormItem className="w-full">
                    <FormControl>
                      <div className="relative w-full">
                        <Input
                          {...field}
                          type="url"
                          ref={channelInputRef}
                          placeholder={t("inputs.channelUrl.placeholder")}
                        />
                        {isShowClearChannelButton && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={clearChannelField}
                            className="absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 cursor-pointer"
                          >
                            <X className="text-red-500" />
                          </Button>
                        )}
                      </div>
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button
                type="button"
                onClick={handleChannelDownloadClick}
                disabled={channelProcessing || !channelIdentifier}
                className="flex items-center gap-2"
              >
                {channelProcessing ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                {t("buttons.downloadChannel")}
              </Button>
            </div>
            {channelErrorMessage && (
              <p className="text-sm text-red-500">{channelErrorMessage}</p>
            )}
          </div>

          {/* Channel Options */}
          {showChannelOptions && channelIdentifier && (
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="text-sm font-medium">
                    {t("inputs.transcriptFormat.label")}
                  </label>
                  <select
                    className="w-full mt-1 p-2 border rounded"
                    value={selectedFormat}
                    onChange={(e) => setSelectedFormat(e.target.value as any)}
                  >
                    <option value="txt">TXT</option>
                    <option value="srt">SRT</option>
                    <option value="vtt">VTT</option>
                    <option value="json">JSON</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">
                    {t("inputs.transcriptLanguage.label")}
                  </label>
                  <select
                    className="w-full mt-1 p-2 border rounded"
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                  >
                    <option value="en">English</option>
                    <option value="es">Spanish</option>
                    <option value="fr">French</option>
                    <option value="de">German</option>
                    <option value="ja">Japanese</option>
                  </select>
                </div>
              </div>

              <Button
                type="button"
                onClick={downloadChannelTranscripts}
                disabled={channelProcessing}
                className="w-full"
              >
                {channelProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("buttons.processingChannel", {
                      current: channelProgress.current,
                      total: channelProgress.total,
                    })}
                  </>
                ) : (
                  <>
                    <Download size={16} className="mr-2" />
                    {t("buttons.downloadChannelTranscripts")}
                  </>
                )}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}