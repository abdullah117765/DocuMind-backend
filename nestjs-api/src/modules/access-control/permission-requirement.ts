import { AccessScope } from '../../generated/prisma/client';

export const PERMISSION_REQUIREMENT_METADATA = Symbol('permission-requirement');

export enum PermissionMatch {
  ALL = 'ALL',
  ANY = 'ANY',
}

export interface PermissionRequirement {
  scope: AccessScope;
  permissionCodes: string[];
  match: PermissionMatch;
  organizationIdParam?: string;
}

export type PermissionRequirementOptions =
  | {
      scope: 'PLATFORM';
      match?: PermissionMatch;
    }
  | {
      scope: 'ORGANIZATION';
      match?: PermissionMatch;
      organizationIdParam?: string;
    };
