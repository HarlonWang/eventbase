declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    EVENTBASE_APP_KEY: string;
    EVENTBASE_ADMIN_TOKEN: string;
  }
}

declare module "*.sql?raw" {
  const content: string;
  export default content;
}
