import type { Page, Request, Response } from "playwright";
import { config } from "../config/index.js";

export interface ApiCall {
  method: string;
  url: string;
  path: string;
  status?: number;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
  failed?: string;
  at: string;
}

export class NetworkProbe {
  readonly calls: ApiCall[] = [];
  private pending = new Map<Request, number>();

  attach(page: Page): void {
    page.on("request", (request) => {
      if (!this.isBusinessApi(request.url())) return;
      this.pending.set(request, Date.now());
    });
    page.on("response", (response) => {
      void this.record(response);
    });
    page.on("requestfailed", (request) => {
      if (!this.isBusinessApi(request.url())) return;
      this.calls.push({
        method: request.method(),
        url: request.url(),
        path: this.toPath(request.url()),
        failed: request.failure()?.errorText ?? "unknown",
        at: new Date().toISOString(),
      });
    });
  }

  private isBusinessApi(url: string): boolean {
    return url.includes(config.app.apiPrefix) || url.includes("/prop/");
  }

  private toPath(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private async record(response: Response): Promise<void> {
    const request = response.request();
    if (!this.isBusinessApi(request.url())) return;
    const startedAt = this.pending.get(request);
    this.pending.delete(request);

    let responseBody: string | undefined;
    try {
      const text = await response.text();
      responseBody = text.slice(0, 2000);
    } catch {
      responseBody = undefined;
    }

    this.calls.push({
      method: request.method(),
      url: request.url(),
      path: this.toPath(request.url()),
      status: response.status(),
      durationMs: startedAt ? Date.now() - startedAt : undefined,
      requestBody: request.postData()?.slice(0, 2000),
      responseBody,
      at: new Date().toISOString(),
    });
  }

  errors(): ApiCall[] {
    return this.calls.filter((call) => call.failed || (call.status !== undefined && call.status >= 400));
  }

  summary(): { total: number; errors: number; byPath: Record<string, number> } {
    const byPath: Record<string, number> = {};
    for (const call of this.calls) byPath[call.path] = (byPath[call.path] ?? 0) + 1;
    return { total: this.calls.length, errors: this.errors().length, byPath };
  }

  reset(): void {
    this.calls.length = 0;
    this.pending.clear();
  }
}
