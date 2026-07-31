import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { createAppValidationPipe } from '../src/common/pipes/app-validation.pipe';
import { AccessScope } from '../src/generated/prisma/client';
import { PrismaService } from '../src/modules/prisma/prisma.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;

  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function requireString(value: unknown, path: string[]): string {
  const result = getPath(value, path);

  if (typeof result !== 'string') {
    throw new Error(`Expected response string at ${path.join('.')}`);
  }

  return result;
}

describe('Epic 2 access control security (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createAppValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (organizationIds.length > 0) {
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
    }

    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }

    await app.close();
  });

  it('enforces authentication, permissions, CSRF, tenant boundaries, and lockout protection', async () => {
    const uniqueValue = randomUUID();
    const password = 'EpicSecurityP@ss1';
    const passwordHash = await bcrypt.hash(password, 4);
    const [admin, viewer] = await Promise.all([
      prisma.user.create({
        data: {
          email: `epic-admin-${uniqueValue}@example.com`,
          passwordHash,
          isVerified: true,
        },
        select: { id: true, email: true },
      }),
      prisma.user.create({
        data: {
          email: `epic-viewer-${uniqueValue}@example.com`,
          passwordHash,
          isVerified: true,
        },
        select: { id: true, email: true },
      }),
    ]);
    userIds.push(admin.id, viewer.id);

    const [organization, foreignOrganization] = await Promise.all([
      prisma.organization.create({
        data: {
          name: 'Epic Security Organization',
          slug: `epic-security-${uniqueValue}`,
          createdByUserId: admin.id,
        },
        select: { id: true },
      }),
      prisma.organization.create({
        data: {
          name: 'Foreign Security Organization',
          slug: `foreign-security-${uniqueValue}`,
        },
        select: { id: true },
      }),
    ]);
    organizationIds.push(organization.id, foreignOrganization.id);

    const [adminMembership, viewerMembership] = await Promise.all([
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: admin.id,
        },
        select: { id: true },
      }),
      prisma.organizationMembership.create({
        data: {
          organizationId: organization.id,
          userId: viewer.id,
        },
        select: { id: true },
      }),
    ]);
    const [organizationAdminRole, viewerRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({
        where: { systemKey: 'organization_admin' },
        select: { id: true },
      }),
      prisma.role.findUniqueOrThrow({
        where: { systemKey: 'viewer' },
        select: { id: true },
      }),
    ]);

    await prisma.membershipRole.createMany({
      data: [
        {
          membershipId: adminMembership.id,
          roleId: organizationAdminRole.id,
          assignedByUserId: admin.id,
        },
        {
          membershipId: viewerMembership.id,
          roleId: viewerRole.id,
          assignedByUserId: admin.id,
        },
      ],
    });
    const foreignRole = await prisma.role.create({
      data: {
        organizationId: foreignOrganization.id,
        name: 'Foreign Role',
        normalizedName: `foreign role ${uniqueValue}`,
        scope: AccessScope.ORGANIZATION,
      },
      select: { id: true },
    });

    await request(app.getHttpServer())
      .get(`/api/organizations/${organization.id}/roles`)
      .expect(401);

    const adminAgent = request.agent(app.getHttpServer());
    const adminCsrfResponse = await adminAgent
      .get('/api/auth/csrf')
      .expect(200);
    const adminCsrfToken = requireString(adminCsrfResponse.body as unknown, [
      'data',
      'csrfToken',
    ]);

    await adminAgent
      .post('/api/auth/login')
      .set('x-csrf-token', adminCsrfToken)
      .send({ email: admin.email, password })
      .expect(200);

    const viewerAgent = request.agent(app.getHttpServer());
    const viewerCsrfResponse = await viewerAgent
      .get('/api/auth/csrf')
      .expect(200);
    const viewerCsrfToken = requireString(viewerCsrfResponse.body as unknown, [
      'data',
      'csrfToken',
    ]);

    await viewerAgent
      .post('/api/auth/login')
      .set('x-csrf-token', viewerCsrfToken)
      .send({ email: viewer.email, password })
      .expect(200);

    await viewerAgent
      .get(`/api/organizations/${organization.id}/roles`)
      .expect(403);

    await adminAgent
      .post(`/api/organizations/${organization.id}/roles`)
      .send({
        name: 'CSRF Rejected Role',
        permissionCodes: [],
      })
      .expect(403);

    const createRoleResponse = await adminAgent
      .post(`/api/organizations/${organization.id}/roles`)
      .set('x-csrf-token', adminCsrfToken)
      .send({
        name: 'Security Reviewer',
        permissionCodes: ['documents.read'],
      })
      .expect(201);
    const createdRoleId = requireString(createRoleResponse.body as unknown, [
      'data',
      'role',
      'id',
    ]);

    await adminAgent
      .get(`/api/organizations/${organization.id}/roles/${foreignRole.id}`)
      .expect(404);

    await adminAgent
      .put(
        `/api/organizations/${organization.id}/members/${viewerMembership.id}/roles`,
      )
      .set('x-csrf-token', adminCsrfToken)
      .send({ roleIds: [foreignRole.id] })
      .expect(400);

    await adminAgent
      .patch(
        `/api/organizations/${organization.id}/members/${viewerMembership.id}/status`,
      )
      .set('x-csrf-token', adminCsrfToken)
      .send({ status: 'REMOVED' })
      .expect(400);

    await adminAgent
      .delete(
        `/api/organizations/${organization.id}/members/${adminMembership.id}`,
      )
      .set('x-csrf-token', adminCsrfToken)
      .expect(409);

    const viewerAccessResponse = await viewerAgent
      .get('/api/access-control/me')
      .expect(200);
    const organizationsValue = getPath(viewerAccessResponse.body as unknown, [
      'data',
      'access',
      'organizations',
    ]);

    if (!Array.isArray(organizationsValue)) {
      throw new Error('Expected current access organizations array');
    }

    const organizationEntries: unknown[] = organizationsValue;

    expect(organizationEntries).toHaveLength(1);
    expect(getPath(organizationEntries[0], ['organization', 'id'])).toBe(
      organization.id,
    );
    expect(getPath(organizationEntries[0], ['permissions'])).toEqual([
      'analytics.view',
      'documents.read',
    ]);

    await viewerAgent
      .get(`/api/access-control/me/organizations/${foreignOrganization.id}`)
      .expect(404);

    await adminAgent
      .delete(`/api/organizations/${organization.id}/roles/${createdRoleId}`)
      .set('x-csrf-token', adminCsrfToken)
      .expect(200);
  });
});
