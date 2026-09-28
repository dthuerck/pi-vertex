import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBaseUrl,
  getAuthConfig,
  getGoogleAuthOptions,
  resolveKeyFile,
  resolveLocation,
  resolveProjectId,
  resolveVertexHost,
} from "../auth.js";

const VARS = [
  "VERTEX_PROJECT_ID",
  "ANTHROPIC_VERTEX_PROJECT_ID",
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "VERTEX_REGION",
  "CLOUD_ML_REGION",
  "GOOGLE_CLOUD_LOCATION",
  "VERTEX_SERVICE_ACCOUNT_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
];

describe("auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const name of VARS) delete process.env[name];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("resolveProjectId", () => {
    it("prefers VERTEX_PROJECT_ID", () => {
      process.env.VERTEX_PROJECT_ID = "vertex";
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = "anthropic";
      process.env.GOOGLE_CLOUD_PROJECT = "google";
      expect(resolveProjectId()).toBe("vertex");
    });

    it("falls back to ANTHROPIC_VERTEX_PROJECT_ID", () => {
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = "anthropic";
      process.env.GOOGLE_CLOUD_PROJECT = "google";
      expect(resolveProjectId()).toBe("anthropic");
    });

    it("falls back to GOOGLE_CLOUD_PROJECT, then GCLOUD_PROJECT", () => {
      process.env.GCLOUD_PROJECT = "gcloud";
      expect(resolveProjectId()).toBe("gcloud");
      process.env.GOOGLE_CLOUD_PROJECT = "google";
      expect(resolveProjectId()).toBe("google");
    });

    it("ignores empty values", () => {
      process.env.VERTEX_PROJECT_ID = "  ";
      process.env.GOOGLE_CLOUD_PROJECT = "google";
      expect(resolveProjectId()).toBe("google");
    });

    it("returns undefined when nothing is set", () => {
      expect(resolveProjectId()).toBeUndefined();
    });
  });

  describe("resolveLocation", () => {
    it("prefers VERTEX_REGION", () => {
      process.env.VERTEX_REGION = "europe-west1";
      process.env.CLOUD_ML_REGION = "us";
      process.env.GOOGLE_CLOUD_LOCATION = "us-west1";
      expect(resolveLocation()).toBe("europe-west1");
    });

    it("falls back to CLOUD_ML_REGION", () => {
      process.env.CLOUD_ML_REGION = "eu";
      process.env.GOOGLE_CLOUD_LOCATION = "us-west1";
      expect(resolveLocation()).toBe("eu");
    });

    it("falls back to GOOGLE_CLOUD_LOCATION", () => {
      process.env.GOOGLE_CLOUD_LOCATION = "us-west1";
      expect(resolveLocation()).toBe("us-west1");
    });

    it("uses default / explicit default when nothing is set", () => {
      expect(resolveLocation()).toBe("us-central1");
      expect(resolveLocation("global")).toBe("global");
    });
  });

  describe("resolveKeyFile", () => {
    it("prefers VERTEX_SERVICE_ACCOUNT_KEY over GOOGLE_APPLICATION_CREDENTIALS", () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/gac.json";
      expect(resolveKeyFile()).toBe("/gac.json");
      process.env.VERTEX_SERVICE_ACCOUNT_KEY = "/vertex.json";
      expect(resolveKeyFile()).toBe("/vertex.json");
    });

    it("feeds google-auth options", () => {
      expect(getGoogleAuthOptions().keyFilename).toBeUndefined();
      process.env.VERTEX_SERVICE_ACCOUNT_KEY = "/vertex.json";
      expect(getGoogleAuthOptions().keyFilename).toBe("/vertex.json");
    });
  });

  describe("getAuthConfig", () => {
    it("returns projectId and location when configured", () => {
      process.env.ANTHROPIC_VERTEX_PROJECT_ID = "my-project";
      const config = getAuthConfig("asia-east1");
      expect(config.projectId).toBe("my-project");
      expect(config.location).toBe("asia-east1");
    });

    it("throws when project ID is missing", () => {
      expect(() => getAuthConfig()).toThrow("Vertex AI requires a project ID");
    });
  });

  describe("endpoints", () => {
    it("resolves hosts for global, multi-region and regional locations", () => {
      expect(resolveVertexHost("global")).toBe("aiplatform.googleapis.com");
      expect(resolveVertexHost("eu")).toBe("aiplatform.eu.rep.googleapis.com");
      expect(resolveVertexHost("us")).toBe("aiplatform.us.rep.googleapis.com");
      expect(resolveVertexHost("us-east5")).toBe("us-east5-aiplatform.googleapis.com");
    });

    it("builds global endpoint URL", () => {
      expect(buildBaseUrl("my-project", "global")).toBe(
        "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global",
      );
    });

    it("builds regional endpoint URL", () => {
      expect(buildBaseUrl("my-project", "us-east5")).toBe(
        "https://us-east5-aiplatform.googleapis.com/v1/projects/my-project/locations/us-east5",
      );
    });
  });
});
