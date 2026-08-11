import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;
  let appService: Pick<AppService, 'getHello' | 'getHealth'>;

  beforeEach(async () => {
    appService = {
      getHello: jest.fn(() => 'Hello World!'),
      getHealth: jest.fn(async () => ({
        checkedAt: '2026-08-11T00:00:00.000Z',
        checks: [],
        maintenance: {
          enabled: true,
          initialDelayMs: 60_000,
          intervalMs: 120_000,
          lastCompletedAt: null,
          lastError: null,
          lastFailedAt: null,
          lastStartedAt: null,
          lastSummary: null,
          running: false,
        },
        status: 'ok',
      })),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: appService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('returns the health payload', async () => {
      const response = {
        status: jest.fn(),
      };

      await expect(
        appController.getHealth(response as never),
      ).resolves.toMatchObject({ status: 'ok' });
      expect(response.status).not.toHaveBeenCalled();
    });
  });
});
