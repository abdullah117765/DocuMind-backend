export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  isVerified: boolean;
  sessionId: string;
  tokenId: string;
}
