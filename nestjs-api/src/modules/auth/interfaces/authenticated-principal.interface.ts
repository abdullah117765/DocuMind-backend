export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  isVerified: boolean;
  isEnvSuperAdmin?: boolean;
  name?: string;
  sessionId: string;
  tokenId: string;
}
