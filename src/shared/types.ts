export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  /** Present only on invite-redeemed sessions — triggers the per-request user check. */
  tv?: number;
}
