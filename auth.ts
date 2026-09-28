/**
 * Authentication utilities for Vertex AI.
 *
 * Configuration comes exclusively from environment variables, using the same names
 * (and resolution order) as pi-vertex-anthropic. For each setting the first non-empty
 * source wins:
 *
 *   Project:      VERTEX_PROJECT_ID → ANTHROPIC_VERTEX_PROJECT_ID → GOOGLE_CLOUD_PROJECT → GCLOUD_PROJECT
 *   Region:       VERTEX_REGION → CLOUD_ML_REGION → GOOGLE_CLOUD_LOCATION → model default
 *   Credentials:  VERTEX_SERVICE_ACCOUNT_KEY → GOOGLE_APPLICATION_CREDENTIALS → ADC
 *
 * If no key file is configured, Google Application Default Credentials are used
 * (e.g. `gcloud auth application-default login` or the GCE metadata server).
 */

import { GoogleAuth } from "google-auth-library";
import type { AuthConfig } from "./types.js";

const SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

function firstEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/** Resolve the GCP project ID. */
export function resolveProjectId(): string | undefined {
  return firstEnv(
    "VERTEX_PROJECT_ID",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "GOOGLE_CLOUD_PROJECT",
    "GCLOUD_PROJECT",
  );
}

/** Resolve the Vertex location/region, falling back to `defaultLocation`. */
export function resolveLocation(defaultLocation = "us-central1"): string {
  return firstEnv("VERTEX_REGION", "CLOUD_ML_REGION", "GOOGLE_CLOUD_LOCATION") || defaultLocation;
}

/** Resolve the service account key file, if one is configured. */
export function resolveKeyFile(): string | undefined {
  return firstEnv("VERTEX_SERVICE_ACCOUNT_KEY", "GOOGLE_APPLICATION_CREDENTIALS");
}

/**
 * Get authentication configuration for a request.
 */
export function getAuthConfig(preferredRegion?: string): AuthConfig {
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error(
      "Vertex AI requires a project ID. Set VERTEX_PROJECT_ID (or ANTHROPIC_VERTEX_PROJECT_ID / GOOGLE_CLOUD_PROJECT).",
    );
  }

  return {
    projectId,
    location: preferredRegion || resolveLocation(),
    credentials: resolveKeyFile(),
  };
}

/** Options for google-auth-library, honoring an explicitly configured key file. */
export function getGoogleAuthOptions(): { scopes: string[]; keyFilename?: string } {
  const keyFilename = resolveKeyFile();
  return { scopes: SCOPES, ...(keyFilename ? { keyFilename } : {}) };
}

let cachedAuth: { key: string; auth: GoogleAuth } | undefined;

/** Shared GoogleAuth instance (re-created if the key file changes). */
export function getGoogleAuth(): GoogleAuth {
  const options = getGoogleAuthOptions();
  const key = options.keyFilename ?? "";
  if (!cachedAuth || cachedAuth.key !== key) {
    cachedAuth = { key, auth: new GoogleAuth(options) };
  }
  return cachedAuth.auth;
}

/**
 * Get an access token for raw HTTP requests.
 */
export async function getAccessToken(): Promise<string> {
  const client = await getGoogleAuth().getClient();
  const token = await client.getAccessToken();
  if (!token.token) {
    throw new Error("Failed to obtain a Google Cloud access token");
  }
  return token.token;
}

/** Hostname of the Vertex AI endpoint for a location. */
export function resolveVertexHost(location: string): string {
  if (location === "global") return "aiplatform.googleapis.com";
  // Multi-region endpoints (us, eu) live on the regional-endpoint domain.
  if (location === "us" || location === "eu") return `aiplatform.${location}.rep.googleapis.com`;
  return `${location}-aiplatform.googleapis.com`;
}

/**
 * Build the base URL for Vertex AI endpoints
 */
export function buildBaseUrl(projectId: string, location: string): string {
  return `https://${resolveVertexHost(location)}/v1/projects/${projectId}/locations/${location}`;
}
