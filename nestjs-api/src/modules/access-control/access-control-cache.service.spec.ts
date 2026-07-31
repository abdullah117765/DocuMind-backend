import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AccessScope } from '../../generated/prisma/client';
import { AccessControlCacheService } from './access-control-cache.service';
import {
  AccessCacheStamp,
  OrganizationAccess,
  PlatformAccess,
} from './access-control.types';

describe('AccessControlCacheService', () => {
  const client = {
    del: jest.fn(),
    get: jest.fn(),
    incr: jest.fn(),
    mget: jest.fn(),
    set: jest.fn(),
  };
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ cacheTtlSeconds: 300 }),
  };
  const service = new AccessControlCacheService(
    client as unknown as Redis,
    configService as unknown as ConfigService,
  );
  const platformAccess: PlatformAccess = {
    userId: 'user-1',
    roles: [
      {
        id: 'role-1',
        name: 'Super Admin',
        scope: AccessScope.PLATFORM,
      },
    ],
    permissions: ['platform.super_admin.assign'],
  };
  const organizationAccess: OrganizationAccess = {
    userId: 'user-1',
    organizationId: 'organization-1',
    membershipId: 'membership-1',
    roles: [
      {
        id: 'role-2',
        name: 'Manager',
        scope: AccessScope.ORGANIZATION,
      },
    ],
    permissions: ['documents.read'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a version stamp and cache miss for platform access', async () => {
    client.mget.mockResolvedValue(['4', '9']);
    client.get.mockResolvedValue(null);

    await expect(service.getPlatformAccess('user-1')).resolves.toEqual({
      stamp: {
        globalVersion: '4',
        userVersion: '9',
      },
      value: null,
    });
    expect(client.get).toHaveBeenCalledWith(
      'access-control:v1:platform:4:9:user-1',
    );
  });

  it('returns validated cached platform access', async () => {
    client.mget.mockResolvedValue([null, null]);
    client.get.mockResolvedValue(JSON.stringify(platformAccess));

    await expect(service.getPlatformAccess('user-1')).resolves.toEqual({
      stamp: {
        globalVersion: '0',
        userVersion: '0',
      },
      value: platformAccess,
    });
    expect(client.del).not.toHaveBeenCalled();
  });

  it('deletes malformed cached authorization data', async () => {
    client.mget.mockResolvedValue(['invalid', '-1']);
    client.get.mockResolvedValue(
      JSON.stringify({
        ...platformAccess,
        permissions: [42],
      }),
    );
    client.del.mockResolvedValue(1);

    await expect(service.getPlatformAccess('user-1')).resolves.toEqual({
      stamp: {
        globalVersion: '0',
        userVersion: '0',
      },
      value: null,
    });
    expect(client.del).toHaveBeenCalledWith(
      'access-control:v1:platform:0:0:user-1',
    );
  });

  it('does not cache a platform result after its version changed', async () => {
    const staleStamp: AccessCacheStamp = {
      globalVersion: '2',
      userVersion: '3',
    };
    client.mget.mockResolvedValue(['2', '4']);

    await expect(
      service.setPlatformAccess('user-1', staleStamp, platformAccess),
    ).resolves.toBe(false);
    expect(client.set).not.toHaveBeenCalled();
  });

  it('stores organization access under all three cache versions', async () => {
    const stamp: AccessCacheStamp = {
      globalVersion: '2',
      userVersion: '3',
      organizationVersion: '5',
    };
    client.mget.mockResolvedValue(['2', '3', '5']);
    client.set.mockResolvedValue('OK');

    await expect(
      service.setOrganizationAccess(
        'user-1',
        'organization-1',
        stamp,
        organizationAccess,
      ),
    ).resolves.toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      'access-control:v1:organization:2:3:5:organization-1:user-1',
      JSON.stringify(organizationAccess),
      'EX',
      300,
    );
  });

  it('returns validated cached organization access', async () => {
    client.mget.mockResolvedValue(['1', '2', '3']);
    client.get.mockResolvedValue(JSON.stringify(organizationAccess));

    await expect(
      service.getOrganizationAccess('user-1', 'organization-1'),
    ).resolves.toEqual({
      stamp: {
        globalVersion: '1',
        userVersion: '2',
        organizationVersion: '3',
      },
      value: organizationAccess,
    });
  });

  it('increments targeted and global cache versions', async () => {
    client.incr.mockResolvedValue(1);

    await service.invalidateUser('user-1');
    await service.invalidateOrganization('organization-1');
    await service.invalidateAll();

    expect(client.incr).toHaveBeenNthCalledWith(
      1,
      'access-control:v1:version:user:user-1',
    );
    expect(client.incr).toHaveBeenNthCalledWith(
      2,
      'access-control:v1:version:organization:organization-1',
    );
    expect(client.incr).toHaveBeenNthCalledWith(
      3,
      'access-control:v1:version:global',
    );
  });
});
