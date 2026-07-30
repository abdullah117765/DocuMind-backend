import { User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const user: User = {
    id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'user@example.com',
    passwordHash: 'hashed-password',
    isVerified: false,
    createdAt: now,
    updatedAt: now,
  };
  const userDelegate = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prismaService = {
    user: userDelegate,
  } as unknown as PrismaService;
  const usersService = new UsersService(prismaService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('finds a user by normalized email', async () => {
    userDelegate.findUnique.mockResolvedValue(user);

    await expect(
      usersService.findByEmail('  USER@Example.COM '),
    ).resolves.toEqual(user);
    expect(userDelegate.findUnique).toHaveBeenCalledWith({
      where: {
        email: 'user@example.com',
      },
    });
  });

  it('finds a user by UUID', async () => {
    userDelegate.findUnique.mockResolvedValue(user);

    await expect(usersService.findById(user.id)).resolves.toEqual(user);
    expect(userDelegate.findUnique).toHaveBeenCalledWith({
      where: {
        id: user.id,
      },
    });
  });

  it('creates an unverified user with an already-hashed password', async () => {
    userDelegate.create.mockResolvedValue(user);

    await expect(
      usersService.create({
        email: ' USER@Example.COM ',
        passwordHash: user.passwordHash,
      }),
    ).resolves.toEqual(user);
    expect(userDelegate.create).toHaveBeenCalledWith({
      data: {
        email: 'user@example.com',
        passwordHash: user.passwordHash,
        isVerified: false,
      },
    });
  });

  it('marks a user as verified', async () => {
    const verifiedUser: User = {
      ...user,
      isVerified: true,
    };
    userDelegate.update.mockResolvedValue(verifiedUser);

    await expect(usersService.markVerified(user.id)).resolves.toEqual(
      verifiedUser,
    );
    expect(userDelegate.update).toHaveBeenCalledWith({
      where: {
        id: user.id,
      },
      data: {
        isVerified: true,
      },
    });
  });
});
