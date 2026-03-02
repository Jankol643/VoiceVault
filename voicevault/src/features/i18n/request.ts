// src/features/i18n/request.ts

import fs from "fs";
import path from "path";
import { getRequestConfig } from "next-intl/server";
import { serverJar } from "@/features/cookies/server-jar";
import { notFound } from "next/navigation";

// Define your locales
export const locales = {
  EN: "en-US",
  ES: "es-ES",
  RU: "ru-RU",
  DE: "de-DE",
  FR: "fr-FR",
} as const;

export type Locale = (typeof locales)[keyof typeof locales];

export const DEFAULT_LOCALE = locales.EN;

export const localesList = [
  locales.EN,
  locales.ES,
  locales.RU,
  locales.DE,
  locales.FR,
] as const;

export const localeOptionsList = [
  { value: locales.EN, label: "English" },
  { value: locales.ES, label: "Español" },
  { value: locales.RU, label: "Русский" },
  { value: locales.DE, label: "Deutsch" },
  { value: locales.FR, label: "Français" },
] as const;

const isDevEnvironment = process.env.NODE_ENV === "development";
const MESSAGES_ROOT_DIR = path.join(
  process.cwd(),
  "src/features/i18n/messages"
);

async function buildMessagesFromDirectory(dirPath: string) {
  const messages: Record<string, any> = {};

  try {
    const files = await fs.promises.readdir(dirPath, { withFileTypes: true });

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(dirPath, file.name);

        if (file.isDirectory()) {
          messages[file.name] = await buildMessagesFromDirectory(filePath);
        } else if (file.isFile() && file.name.endsWith(".json")) {
          const fileContent = await fs.promises.readFile(filePath, "utf-8");
          messages[path.basename(file.name, ".json")] = JSON.parse(fileContent);
        }
      })
    );
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return messages;
}

async function getDevMessages(locale: string) {
  const localeDir = path.join(MESSAGES_ROOT_DIR, locale);

  // Check if locale directory exists
  if (!fs.existsSync(localeDir)) {
    console.error(`Locale directory not found: ${localeDir}`);
    return {};
  }

  const messages = await buildMessagesFromDirectory(localeDir);
  return messages;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // Get locale from your serverJar
  const cookieLocale = await serverJar.locale.get();

  // Use requestLocale if available, otherwise fallback to cookie
  let locale = requestLocale || cookieLocale || DEFAULT_LOCALE;

  // Validate the locale
  if (!localesList.includes(locale as any)) {
    locale = DEFAULT_LOCALE;
  }

  let messages;

  if (isDevEnvironment) {
    messages = await getDevMessages(locale);
  } else {
    try {
      // For production, try to import the messages
      messages = (await import(`./locales/${locale}.json`)).default;
    } catch (error) {
      console.error(`Failed to load messages for locale ${locale}:`, error);
      // Fallback to empty messages or default locale
      messages = {};
    }
  }

  return {
    locale,
    messages,
  };
});