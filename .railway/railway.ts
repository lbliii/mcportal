// Railway Infrastructure as Code for the hosted MCPortal service (replaces railway.toml).
// Check changes with `railway config plan`; apply with `railway config apply`.
//
// Still set in the Railway dashboard, not here:
//   - Variable values. The names below are preserve(): their values stay in Railway
//     and never enter source. See .env.example for what each one does.
//   - The public domain. MCPortal derives its public URL and Host allowlist from
//     RAILWAY_PUBLIC_DOMAIN.
//   - Postgres and its PITR backups (owned by the Postgres service, not this repo).
import { defineRailway, preserve, project, service, volume } from "railway/iac";

// This repository manages only its own resources in the environment.
export const partial = "mcportal";

export default defineRailway(() => {
  // Profiles and OAuth state when DATABASE_URL isn't set; also the file-store fallback.
  const data = volume("mcportal-volume", { region: "us-west2", sizeMB: 5000 });

  const mcportal = service("mcportal", {
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/health",
    healthcheckTimeout: 30,
    volumeMounts: { "/data": data },
    variables: {
      PORT: preserve(),
      DATABASE_URL: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      GITHUB_TOKEN: preserve(),
      MCPORTAL_TOKEN: preserve(),
      MCPORTAL_ADMINS: preserve(),
      MCPORTAL_ALLOWED_GITHUB_USERS: preserve(),
    },
  });

  return project("mcportal", { resources: [data, mcportal] });
});
