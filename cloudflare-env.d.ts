declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APP_ENCRYPTION_KEY?: string;
    GEMINI_API_KEY?: string;
    FIRECRAWL_API_KEY?: string;
    PRIVATE_REFRESH_ENABLED?: string;
  }
}
