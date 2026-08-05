export interface JwtPayload {
  sub: string;
  email: string;
  companyId: string;
  companySlug: string;
  roles: string[];
  permissions: string[];
}
