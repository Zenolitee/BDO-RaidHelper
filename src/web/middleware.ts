import type { Request, Response, NextFunction } from 'express';

function setSecurityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; img-src 'self' https://cdn.discordapp.com data: blob:; object-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com;"
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
}

export { setSecurityHeaders };
