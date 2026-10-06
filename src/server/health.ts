import type { Request, Response } from 'express';

let dbStatus: 'connected' | 'disconnected' = 'disconnected';

export function setDbStatus(status: 'connected' | 'disconnected'): void {
  dbStatus = status;
}

export function getHealthResponse(): { status: 'ok'; db: 'connected' | 'disconnected' } {
  return { status: 'ok', db: dbStatus };
}

export function healthHandler(_req: Request, res: Response): void {
  res.json(getHealthResponse());
}
