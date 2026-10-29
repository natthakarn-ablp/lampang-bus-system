declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MEETING_SECRETARY_USER_IDS?: string;
  }
}
