import { INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { HealthModule } from '../src/modules/health/health.module';
import { ProbeController } from '../src/probe.controller';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [HealthModule],
      controllers: [ProbeController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('GET /health → 200', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status_code).toBe(200);
        expect(res.body.message).toBe('success');
        expect(res.body.data.status).toBe('ok');
      });
  });

  it('GET /probe → 200', () => {
    return request(app.getHttpServer())
      .get('/probe')
      .expect(200)
      .expect((res) => {
        expect(res.body.status_code).toBe(200);
        expect(res.body.message).toBe('server is ready');
        expect(res.body.status).toBe('ok');
        expect(res.body.data).toBeUndefined();
      });
  });

  afterEach(async () => {
    if (app) await app.close();
  });
});
